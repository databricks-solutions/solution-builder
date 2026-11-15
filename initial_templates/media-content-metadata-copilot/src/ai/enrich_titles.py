"""
Orbitline+ — AI metadata generation with Databricks AI Functions.

For every title: build a "dossier" (current synopsis + every scene description with timecodes) and ask
`ai_query` (structured JSON output) to tag it with the Orbitline+ controlled vocabulary — genres, moods,
themes, content warnings WITH the scene that evidences each one, keywords, a spoiler-free synopsis, the
setting and the best promo-clip scene. Then, deterministically (no LLM):

  * keep only terms that exist in `taxonomy` (anything else is dropped, never invented)
  * map talent from `credits` (director + top-billed cast)
  * derive the brand-safety tier from the warnings (Standards Guide §4)
  * score the PROPOSED metadata with the same completeness formula as the current metadata

Output: ai_title_enrichment (one row per title) + ai_tag_accuracy (AI vs the generator's ground truth).

    python enrich_titles.py --catalog media_advertising --schema content_metadata_copilot [--model databricks-gpt-5-4-mini]
"""
from __future__ import annotations

import argparse

from pyspark.sql import SparkSession


def get_spark() -> SparkSession:
    try:
        active = SparkSession.getActiveSession()
        if active is not None:
            return active
    except Exception:
        pass
    from databricks.connect import DatabricksSession  # type: ignore

    return DatabricksSession.builder.serverless(True).getOrCreate()


PROMPT = (
    "You are a senior metadata editor at a streaming service. Read the title dossier and tag it using ONLY the "
    "controlled vocabulary below.\\n"
    "GENRES (1-3): {genres}\\n"
    "MOODS (2-4, the strongest only): {moods}\\n"
    "THEMES (2-4, the central ones only): {themes}\\n"
    "CONTENT WARNINGS: {warnings}\\n"
    "Content-warning rules (Orbitline+ Standards Guide): tag a warning ONLY when a scene explicitly depicts it on screen; "
    "never infer it from genre, mood or suspense. Violence = a character is physically hurt on screen (a chase, gunfire "
    "or explosions alone are not enough unless someone is hurt). Graphic Violence = blood, gore or a killing shown in close-up. "
    "Strong Language = the scene explicitly mentions profanity or swearing. Frightening Scenes = content designed to frighten "
    "a young child (menace, screaming, fire, monsters, jump scares) — ordinary tension or nervousness is NOT frightening. "
    "Drug Use = illegal drugs are consumed on screen (smuggled 'contraband' is not drug use). One entry per warning, citing "
    "the scene number and quoting the evidence.\\n"
    "Also write a spoiler-free 2-sentence synopsis (<= 60 words), 5-8 lowercase search keywords, the setting "
    "(<= 8 words) and pick the single best scene for a promo clip.\\n\\n"
)

SCHEMA = """{"type":"json_schema","json_schema":{"name":"tags","strict":true,"schema":{"type":"object","properties":{
 "genres":{"type":"array","items":{"type":"string"}},
 "moods":{"type":"array","items":{"type":"string"}},
 "themes":{"type":"array","items":{"type":"string"}},
 "content_warnings":{"type":"array","items":{"type":"object","properties":{"warning":{"type":"string"},"scene_no":{"type":"integer"},"evidence":{"type":"string"}},"required":["warning","scene_no","evidence"],"additionalProperties":false}},
 "keywords":{"type":"array","items":{"type":"string"}},
 "synopsis":{"type":"string"},
 "setting":{"type":"string"},
 "promo_clip_scene_no":{"type":"integer"},
 "promo_clip_reason":{"type":"string"},
 "confidence":{"type":"number"}},
 "required":["genres","moods","themes","content_warnings","keywords","synopsis","setting","promo_clip_scene_no","promo_clip_reason","confidence"],
 "additionalProperties":false}}}"""

JSON_TYPE = ("STRUCT<genres: ARRAY<STRING>, moods: ARRAY<STRING>, themes: ARRAY<STRING>, "
             "content_warnings: ARRAY<STRUCT<warning: STRING, scene_no: INT, evidence: STRING>>, keywords: ARRAY<STRING>, "
             "synopsis: STRING, setting: STRING, promo_clip_scene_no: INT, promo_clip_reason: STRING, confidence: DOUBLE>")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", default="media_advertising")
    ap.add_argument("--schema", default="content_metadata_copilot")
    ap.add_argument("--model", default="databricks-gpt-5-4-mini")
    ap.add_argument("--sample", type=int, default=0, help="dev only: tag N titles into ai_title_enrichment_raw_sample and stop")
    args, _ = ap.parse_known_args()
    fqs = f"{args.catalog}.{args.schema}"
    spark = get_spark()
    spark.sql(f"USE {fqs}")

    vocab = {r["facet"]: r["terms"] for r in spark.sql(
        "SELECT facet, array_join(collect_list(term), ', ') AS terms FROM taxonomy WHERE NOT is_generic GROUP BY facet").collect()}
    prompt = PROMPT.format(genres=vocab["genre"], moods=vocab["mood"], themes=vocab["theme"],
                           warnings=vocab["content_warning"]).replace("'", "\\'")

    # 1) the AI call — one structured ai_query per title
    raw_table = "ai_title_enrichment_raw_sample" if args.sample else "ai_title_enrichment_raw"
    sample_filter = (f"WHERE abs(hash(t.title_id)) % 1400 < {args.sample} OR t.title_id IN ('TTL-HB-0117', 'TTL-HB-0233')"
                     if args.sample else "")
    spark.sql(f"""
    CREATE OR REPLACE TABLE {raw_table} AS
    WITH d AS (
      SELECT t.title_id, t.title, t.content_type, t.runtime_min, m.synopsis,
             concat_ws('\\n', array_sort(collect_list(concat(lpad(cast(s.scene_no AS STRING), 2, '0'), ' [', s.start_tc, '] ',
                       s.description)))) AS scene_text
      FROM titles t JOIN title_metadata m USING (title_id) JOIN scenes s USING (title_id)
      {sample_filter}
      GROUP BY ALL)
    SELECT title_id,
           ai_query('{args.model}',
                    concat('{prompt}', 'TITLE: ', title, ' (', content_type, ', ', runtime_min, ' min)\\n',
                           'CURRENT SYNOPSIS: ', coalesce(synopsis, ''), '\\nSCENES:\\n', scene_text),
                    responseFormat => '{SCHEMA.replace(chr(10), '')}',
                    failOnError => false) AS resp,
           current_timestamp() AS enriched_at,
           '{args.model}' AS model
    FROM d
    """)

    if args.sample:
        print("sample written to", raw_table)
        return

    # 2) deterministic post-processing: taxonomy mapping, talent from credits, brand tier, completeness
    spark.sql("""
    CREATE OR REPLACE TABLE ai_title_enrichment AS
    WITH p AS (
      SELECT title_id, model, enriched_at, from_json(resp.result, '""" + JSON_TYPE + """') AS j, resp.errorMessage AS error
      FROM ai_title_enrichment_raw),
    v AS (SELECT collect_set(CASE WHEN facet = 'genre' THEN term END) AS g, collect_set(CASE WHEN facet = 'mood' THEN term END) AS mo,
                 collect_set(CASE WHEN facet = 'theme' THEN term END) AS th, collect_set(CASE WHEN facet = 'content_warning' THEN term END) AS cw
          FROM taxonomy WHERE NOT is_generic),
    tal AS (SELECT title_id, slice(transform(array_sort(collect_list(struct(billing_order, person_name))), x -> x.person_name), 1, 5) AS talent
            FROM credits GROUP BY title_id),
    m AS (
      SELECT p.title_id, p.model, p.enriched_at, p.error,
        array_distinct(filter(j.genres, g -> array_contains(v.g, g))) AS ai_genres,
        slice(array_distinct(filter(j.moods, x -> array_contains(v.mo, x))), 1, 4) AS ai_moods,
        slice(array_distinct(filter(j.themes, x -> array_contains(v.th, x))), 1, 4) AS ai_themes,
        filter(j.content_warnings, w -> array_contains(v.cw, w.warning)) AS ai_warning_evidence,
        slice(j.keywords, 1, 8) AS ai_keywords, j.synopsis AS ai_synopsis, j.setting AS ai_setting,
        j.promo_clip_scene_no, j.promo_clip_reason, j.confidence AS ai_confidence, tal.talent AS ai_talent
      FROM p LEFT JOIN tal USING (title_id) CROSS JOIN v)
    SELECT m.*,
      array_distinct(transform(ai_warning_evidence, w -> w.warning)) AS ai_content_warnings,
      CASE WHEN arrays_overlap(transform(ai_warning_evidence, w -> w.warning),
                               array('Graphic Violence','Sexual Content','Nudity','Drug Use','Self-Harm','Suicide')) THEN 'Restricted'
           WHEN size(ai_warning_evidence) > 0 THEN 'Standard' ELSE 'Family-Safe' END AS ai_brand_safety_tier,
      ( CASE WHEN size(filter(ai_genres, g -> g <> 'Drama')) >= 1 OR size(ai_genres) >= 2 THEN 15 WHEN size(ai_genres) = 1 THEN 7 ELSE 0 END
      + CASE WHEN size(ai_moods) >= 2 THEN 15 WHEN size(ai_moods) = 1 THEN 7 ELSE 0 END
      + CASE WHEN size(ai_themes) >= 2 THEN 15 WHEN size(ai_themes) = 1 THEN 7 ELSE 0 END
      + 20
      + CASE WHEN size(ai_talent) >= 3 THEN 15 WHEN size(ai_talent) >= 1 THEN 7 ELSE 0 END
      + CASE WHEN size(ai_keywords) >= 5 THEN 10 WHEN size(ai_keywords) >= 1 THEN 5 ELSE 0 END
      + CASE WHEN length(ai_synopsis) >= 120 THEN 10 WHEN length(ai_synopsis) > 0 THEN 4 ELSE 0 END ) AS ai_completeness_score
    FROM m
    """)
    spark.sql("COMMENT ON TABLE ai_title_enrichment IS 'AI-generated metadata per title (ai_query, structured output) mapped onto the "
              "Orbitline+ taxonomy: genres, moods, themes, content warnings with the evidencing scene, keywords, synopsis, setting, "
              "promo-clip scene, talent from credits, derived brand-safety tier and the completeness score the proposal would reach. "
              "A PROPOSAL — it only becomes live metadata once an editor approves it in the Metadata Copilot app.'")

    # 3) accuracy vs ground truth (for the talk track: "how good are the AI tags?")
    spark.sql("""
    CREATE OR REPLACE TABLE ai_tag_accuracy AS
    WITH x AS (
      SELECT 'genre' AS facet, e.ai_genres AS ai, t.true_genres AS truth FROM ai_title_enrichment e JOIN title_truth t USING (title_id)
      UNION ALL SELECT 'mood', e.ai_moods, t.true_moods FROM ai_title_enrichment e JOIN title_truth t USING (title_id)
      UNION ALL SELECT 'theme', e.ai_themes, t.true_themes FROM ai_title_enrichment e JOIN title_truth t USING (title_id)
      UNION ALL SELECT 'content_warning', e.ai_content_warnings, t.true_warnings FROM ai_title_enrichment e JOIN title_truth t USING (title_id))
    SELECT facet,
      sum(size(array_intersect(ai, truth))) AS true_positives,
      sum(size(ai)) AS ai_tags, sum(size(truth)) AS true_tags,
      round(sum(size(array_intersect(ai, truth))) / nullif(sum(size(ai)), 0), 3) AS precision,
      round(sum(size(array_intersect(ai, truth))) / nullif(sum(size(truth)), 0), 3) AS recall
    FROM x GROUP BY facet
    """)
    spark.sql("COMMENT ON TABLE ai_tag_accuracy IS 'Precision/recall of the AI tags vs the generator ground truth, per facet (eval only).'")
    for r in spark.sql("SELECT * FROM ai_tag_accuracy ORDER BY facet").collect():
        print(r.asDict())
    print("errors:", spark.sql("SELECT count(*) c FROM ai_title_enrichment WHERE error IS NOT NULL OR ai_synopsis IS NULL").first()["c"])


if __name__ == "__main__":
    main()
