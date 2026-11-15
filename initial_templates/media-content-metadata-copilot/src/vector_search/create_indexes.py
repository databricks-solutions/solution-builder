"""
Orbitline+ — Vector Search for "more like this" and clip repurposing.

  title_profiles        one searchable text profile per title (AI synopsis + genres + moods + themes + setting; the title name is left out so look-alikes match on content, not on words in the name)
  title_profiles_index  Delta-sync index (managed embeddings, databricks-gte-large-en) → "more like this"
  scenes_index          Delta-sync index over every scene description → "find me clips for …" (repurposing)

Idempotent: creates the Vector Search endpoint if missing; re-running refreshes the profiles table and triggers a
sync of existing indexes.

    python create_indexes.py --catalog media_advertising --schema content_metadata_copilot --endpoint dbdemos_vs_endpoint
"""
from __future__ import annotations

import argparse
import time

from databricks.sdk import WorkspaceClient
from databricks.sdk.errors import NotFound
from databricks.sdk.service.vectorsearch import (
    DeltaSyncVectorIndexSpecRequest, EmbeddingSourceColumn, EndpointType, PipelineType, VectorIndexType)
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


def ensure_endpoint(w: WorkspaceClient, endpoint: str):
    """Create the demo's own Vector Search endpoint if it doesn't exist yet, then wait until it is ONLINE."""
    try:
        w.vector_search_endpoints.get_endpoint(endpoint)
        print(f"endpoint {endpoint} exists")
    except NotFound:
        print(f"creating endpoint {endpoint}")
        w.vector_search_endpoints.create_endpoint(name=endpoint, endpoint_type=EndpointType.STANDARD)
    for _ in range(90):
        st = w.vector_search_endpoints.get_endpoint(endpoint).endpoint_status
        state = str(getattr(st, "state", ""))
        if "ONLINE" in state:
            return
        print("  endpoint state:", state)
        time.sleep(20)
    raise RuntimeError(f"Vector Search endpoint {endpoint} not ONLINE after 30 min")


def ensure_index(w: WorkspaceClient, endpoint: str, name: str, source: str, pk: str, text_col: str, cols: list[str]):
    try:
        w.vector_search_indexes.get_index(name)
        print(f"{name} exists → sync")
        try:
            w.vector_search_indexes.sync_index(name)
        except Exception as e:  # a sync already running is fine
            print("  sync:", str(e)[:160])
        return
    except Exception:
        pass
    print(f"creating {name} on {endpoint}")
    w.vector_search_indexes.create_index(
        name=name, endpoint_name=endpoint, primary_key=pk, index_type=VectorIndexType.DELTA_SYNC,
        delta_sync_index_spec=DeltaSyncVectorIndexSpecRequest(
            source_table=source, pipeline_type=PipelineType.TRIGGERED,
            embedding_source_columns=[EmbeddingSourceColumn(name=text_col, embedding_model_endpoint_name="databricks-gte-large-en")],
            columns_to_sync=cols))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", default="media_advertising")
    ap.add_argument("--schema", default="content_metadata_copilot")
    ap.add_argument("--endpoint", default="dbdemos_vs_endpoint")
    ap.add_argument("--wait", default="true")
    args, _ = ap.parse_known_args()
    s = f"{args.catalog}.{args.schema}"
    spark = get_spark()
    spark.sql(f"""
    CREATE OR REPLACE TABLE {s}.title_profiles
    TBLPROPERTIES (delta.enableChangeDataFeed = true) AS
    SELECT g.title_id, g.title, g.source, g.content_type, g.release_year, g.maturity_rating, g.primary_genre,
      concat(coalesce(g.ai_synopsis, g.synopsis, ''),
             ' Genres: ', array_join(coalesce(g.ai_genres, g.genres), ', '),
             '. Moods: ', array_join(coalesce(g.ai_moods, g.moods), ', '),
             '. Themes: ', array_join(coalesce(g.ai_themes, g.themes), ', '),
             '. Setting: ', coalesce(g.ai_setting, ''), '.') AS profile_text
    FROM {s}.gold_title_scorecard g
    """)
    spark.sql(f"ALTER TABLE {s}.title_profiles ALTER COLUMN title_id SET NOT NULL")
    spark.sql(f"COMMENT ON TABLE {s}.title_profiles IS 'One searchable text profile per title (AI synopsis + tags + setting) — "
              f"source of the title_profiles_index vector index (more like this).'")
    spark.sql(f"ALTER TABLE {s}.scenes SET TBLPROPERTIES (delta.enableChangeDataFeed = true)")

    w = WorkspaceClient()
    ensure_endpoint(w, args.endpoint)
    ensure_index(w, args.endpoint, f"{s}.title_profiles_index", f"{s}.title_profiles", "title_id", "profile_text",
                 ["title_id", "title", "source", "content_type", "release_year", "maturity_rating", "primary_genre", "profile_text"])
    ensure_index(w, args.endpoint, f"{s}.scenes_index", f"{s}.scenes", "scene_id", "description",
                 ["scene_id", "title_id", "scene_no", "start_tc", "end_tc", "episode", "description"])
    if args.wait.lower() == "true":
        for name in [f"{s}.title_profiles_index", f"{s}.scenes_index"]:
            for _ in range(90):
                st = w.vector_search_indexes.get_index(name).status
                if st and st.ready:
                    print(f"{name} READY ({st.indexed_row_count} rows)")
                    break
                time.sleep(20)
            else:
                print(f"{name} not ready yet — it keeps syncing in the background")


if __name__ == "__main__":
    main()
