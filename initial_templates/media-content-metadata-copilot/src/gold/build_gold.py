"""
Orbitline+ — gold layer + Unity Catalog metric view (dashboard, Genie, app).

  gold_title_scorecard   one row per title: current metadata vs the AI proposal, completeness now vs proposed,
                         last-4-week engagement, expected impressions for a well-tagged peer, discovery gap,
                         missing content warnings, safety risk, re-tag priority
  primary_genre = the most specific AI genre (fixed precedence, Drama last) — stable across AI runs.

  gold_title_weekly      title × week engagement with source, library group, primary genre, completeness band
  gold_retag_pilot       the July re-tag pilot: 4 weeks before vs 4 weeks after, pilot vs Harborlight control
  mv_content_discovery   metric view — governed discovery KPIs shared by the dashboard and Genie

    python build_gold.py --catalog media_advertising --schema content_metadata_copilot
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", default="media_advertising")
    ap.add_argument("--schema", default="content_metadata_copilot")
    args, _ = ap.parse_known_args()
    s = f"{args.catalog}.{args.schema}"
    spark = get_spark()
    spark.sql(f"USE {s}")

    spark.sql("""
    CREATE OR REPLACE TABLE gold_title_weekly AS
    WITH pilot AS (SELECT DISTINCT title_id FROM retag_events)
    SELECT e.title_id, t.title, e.week_start, t.source, t.content_type,
      CASE WHEN p.title_id IS NOT NULL THEN 'Harborlight - re-tagged in pilot'
           WHEN t.source = 'Harborlight Library' THEN 'Harborlight - not re-tagged'
           ELSE 'Rest of library' END AS library_group,
      element_at(array_sort(transform(coalesce(a.ai_genres, m.genres), g -> named_struct('r', coalesce(array_position(array(
        'Horror','Sci-Fi','Fantasy','Thriller','Mystery','Action','Western','War','Documentary','Animation','Family',
        'Romantic Comedy','Romance','Sports','Coming-of-Age','Comedy','Crime','Adventure','Musical','Drama'), g), 99), 'g', g))), 1).g AS primary_genre,
      m.completeness_score,
      CASE WHEN m.completeness_score < 40 THEN '1. Poor (<40)' WHEN m.completeness_score < 70 THEN '2. Partial (40-69)'
           WHEN m.completeness_score < 90 THEN '3. Good (70-89)' ELSE '4. Complete (90+)' END AS completeness_band,
      e.impressions, e.search_impressions, e.play_starts, e.completions, e.minutes_watched
    FROM engagement_weekly e JOIN titles t USING (title_id) JOIN title_metadata m USING (title_id)
    LEFT JOIN ai_title_enrichment a USING (title_id) LEFT JOIN pilot p USING (title_id)
    """)
    spark.sql("COMMENT ON TABLE gold_title_weekly IS 'Weekly engagement per title with library group (Harborlight re-tagged in pilot / "
              "Harborlight not re-tagged / Rest of library), primary genre and CURRENT metadata completeness band.'")

    spark.sql("""
    CREATE OR REPLACE TABLE gold_title_scorecard AS
    WITH lw AS (SELECT max(week_start) AS last_week FROM engagement_weekly),
    e4 AS (
      SELECT title_id, sum(impressions) AS impressions_4w, sum(search_impressions) AS search_impressions_4w,
             sum(play_starts) AS play_starts_4w, sum(completions) AS completions_4w, sum(minutes_watched) AS minutes_watched_4w
      FROM engagement_weekly, lw WHERE week_start > date_sub(lw.last_week, 28) GROUP BY title_id),
    base AS (
      SELECT t.*, m.genres, m.moods, m.themes, m.content_warnings, m.warnings_reviewed, m.talent, m.keywords, m.synopsis,
        m.collections, m.brand_safety_tier, m.completeness_score, m.tagged_by, m.last_tagged_date,
        a.ai_genres, a.ai_moods, a.ai_themes, a.ai_content_warnings, a.ai_warning_evidence, a.ai_keywords, a.ai_synopsis,
        a.ai_setting, a.ai_talent, a.ai_brand_safety_tier, a.ai_completeness_score, a.ai_confidence,
        a.promo_clip_scene_no, a.promo_clip_reason,
        element_at(array_sort(transform(coalesce(a.ai_genres, m.genres), g -> named_struct('r', coalesce(array_position(array(
        'Horror','Sci-Fi','Fantasy','Thriller','Mystery','Action','Western','War','Documentary','Animation','Family',
        'Romantic Comedy','Romance','Sports','Coming-of-Age','Comedy','Crime','Adventure','Musical','Drama'), g), 99), 'g', g))), 1).g AS primary_genre,
        coalesce(e4.impressions_4w, 0) AS impressions_4w, coalesce(e4.search_impressions_4w, 0) AS search_impressions_4w,
        coalesce(e4.play_starts_4w, 0) AS play_starts_4w, coalesce(e4.completions_4w, 0) AS completions_4w,
        coalesce(e4.minutes_watched_4w, 0) AS minutes_watched_4w,
        round(e4.completions_4w / nullif(e4.play_starts_4w, 0), 3) AS completion_rate_4w
      FROM titles t JOIN title_metadata m USING (title_id) LEFT JOIN ai_title_enrichment a USING (title_id)
      LEFT JOIN e4 USING (title_id)),
    peers AS (   -- what a WELL-TAGGED title of the same primary genre earns (median of completeness >= 80)
      SELECT primary_genre, percentile(impressions_4w, 0.5) AS peer_impressions_4w,
             percentile(completion_rate_4w, 0.5) AS peer_completion_rate_4w
      FROM base WHERE completeness_score >= 80 GROUP BY primary_genre)
    SELECT b.*,
      CAST(p.peer_impressions_4w AS BIGINT) AS peer_impressions_4w,
      round(p.peer_completion_rate_4w, 3) AS peer_completion_rate_4w,
      round(b.impressions_4w / nullif(p.peer_impressions_4w, 0), 2) AS impressions_vs_peer,
      CAST(greatest(p.peer_impressions_4w - b.impressions_4w, 0) AS BIGINT) AS discovery_gap_impressions_4w,
      array_except(b.ai_content_warnings, b.content_warnings) AS missing_warnings,
      size(array_except(b.ai_content_warnings, b.content_warnings)) > 0 AS has_missing_warnings,
      (size(array_except(b.ai_content_warnings, b.content_warnings)) > 0
        AND (b.brand_safety_tier = 'Family-Safe' AND b.ai_brand_safety_tier <> 'Family-Safe'
             OR array_contains(b.collections, 'Little Ones (under 7)') OR array_contains(b.collections, 'Family Movie Night'))) AS safety_risk,
      b.ai_completeness_score - b.completeness_score AS completeness_uplift,
      CASE WHEN b.completeness_score < 40 THEN '1. Poor (<40)' WHEN b.completeness_score < 70 THEN '2. Partial (40-69)'
           WHEN b.completeness_score < 90 THEN '3. Good (70-89)' ELSE '4. Complete (90+)' END AS completeness_band,
      -- priority: under-exposed titles that viewers finish (hidden gems) + any safety risk first
      round( (1 - least(b.impressions_4w / nullif(p.peer_impressions_4w, 0), 1)) * 60
           + least(coalesce(b.completion_rate_4w, 0) / nullif(p.peer_completion_rate_4w, 0), 1.3) * 30
           + (100 - b.completeness_score) * 0.1, 1) AS retag_priority_score,
      (b.completion_rate_4w >= p.peer_completion_rate_4w AND b.impressions_4w < 0.4 * p.peer_impressions_4w) AS hidden_gem
    FROM base b LEFT JOIN peers p USING (primary_genre)
    """)
    spark.sql("COMMENT ON TABLE gold_title_scorecard IS 'One row per title: current metadata (genres, moods, themes, content_warnings, talent, "
              "keywords, synopsis, collections, brand_safety_tier, completeness_score) next to the AI proposal (ai_*), last-4-week "
              "engagement, peer benchmark (median of well-tagged titles of the same primary_genre), discovery_gap_impressions_4w, "
              "missing_warnings (AI-detected warnings absent from the live metadata), safety_risk (missing warnings on a title sold "
              "as Family-Safe or sitting in a kids/family row), hidden_gem (viewers finish it but it is barely shown) and retag_priority_score.'")

    spark.sql("""
    CREATE OR REPLACE TABLE gold_retag_pilot AS
    WITH d AS (SELECT min(retag_date) AS pilot_date FROM retag_events),
    g AS (
      SELECT t.title_id, t.title,
        CASE WHEN t.title_id IN (SELECT title_id FROM retag_events) THEN 'Pilot (re-tagged)' ELSE 'Control (not re-tagged)' END AS pilot_group
      FROM titles t WHERE t.source = 'Harborlight Library')
    SELECT g.title_id, g.title, g.pilot_group, d.pilot_date,
      sum(CASE WHEN e.week_start >= date_sub(d.pilot_date, 28) AND e.week_start < d.pilot_date THEN e.impressions END) AS impressions_4w_before,
      sum(CASE WHEN e.week_start >= d.pilot_date AND e.week_start < date_add(d.pilot_date, 28) THEN e.impressions END) AS impressions_4w_after,
      sum(CASE WHEN e.week_start >= date_sub(d.pilot_date, 28) AND e.week_start < d.pilot_date THEN e.play_starts END) AS play_starts_4w_before,
      sum(CASE WHEN e.week_start >= d.pilot_date AND e.week_start < date_add(d.pilot_date, 28) THEN e.play_starts END) AS play_starts_4w_after,
      sum(CASE WHEN e.week_start >= d.pilot_date AND e.week_start < date_add(d.pilot_date, 28) THEN e.minutes_watched END)
        - sum(CASE WHEN e.week_start >= date_sub(d.pilot_date, 28) AND e.week_start < d.pilot_date THEN e.minutes_watched END) AS minutes_watched_change
    FROM g CROSS JOIN d JOIN engagement_weekly e USING (title_id)
    GROUP BY ALL
    """)
    spark.sql("COMMENT ON TABLE gold_retag_pilot IS 'The July re-tag pilot: per Harborlight title, impressions/play starts in the 4 weeks "
              "before vs the 4 weeks from the pilot date (2026-07-27). pilot_group = Pilot (re-tagged) | Control (not re-tagged).'")

    spark.sql(f"""
      CREATE OR REPLACE VIEW {s}.mv_content_discovery
      WITH METRICS LANGUAGE YAML
      COMMENT 'Governed content-discovery KPIs: impressions, play starts, completion rate and impressions per title by library group, source, genre and metadata completeness.'
      AS $$
      version: 1.1
      source: {s}.gold_title_weekly
      dimensions:
        - name: week_start
          expr: week_start
        - name: source
          expr: source
        - name: library_group
          expr: library_group
        - name: primary_genre
          expr: primary_genre
        - name: completeness_band
          expr: completeness_band
        - name: content_type
          expr: content_type
      measures:
        - name: impressions
          expr: SUM(impressions)
        - name: play_starts
          expr: SUM(play_starts)
        - name: completions
          expr: SUM(completions)
        - name: minutes_watched
          expr: SUM(minutes_watched)
        - name: titles
          expr: COUNT(DISTINCT title_id)
        - name: impressions_per_title
          expr: SUM(impressions) / NULLIF(COUNT(DISTINCT title_id), 0)
        - name: play_starts_per_title
          expr: SUM(play_starts) / NULLIF(COUNT(DISTINCT title_id), 0)
        - name: completion_rate
          expr: SUM(completions) / NULLIF(SUM(play_starts), 0)
        - name: play_rate
          expr: SUM(play_starts) / NULLIF(SUM(impressions), 0)
      $$
    """)
    for t in ["gold_title_scorecard", "gold_title_weekly", "gold_retag_pilot"]:
        print(t, spark.table(t).count())


if __name__ == "__main__":
    main()
