# Adapting the Harvestly Loyalty Segmentation Demo to Your Data

This project bundles the Harvestly Loyalty Segmentation demo with a synthetic dataset so you can experience it immediately. When you're ready to run it on your own data, this guide walks you through the conversion.

## What this demo does
Harvestly Co. runs an 800K-member loyalty program. The demo segments the base by Recency-Frequency-Monetary behavior into four cohorts (Champions, New Loyalists, Cooling Off, Win-Back) and pairs each cohort with the right marketing tactic from the Customer Marketing Playbook. The result: a segment-specific campaign plan instead of a one-size-fits-all blast that destroys margin.

## What's bundled
- The full demo pipeline (data → pipeline → dashboard → agents).
- A synthetic data generator (Faker-based) that creates realistic test data on your first `bundle deploy`.
- A Genie Code skill (in `.assistant/skills/`) that knows how to help you adapt this project. Open Genie Code and ask "how do I use my own customer table?" — it'll guide you.

## First run (with synthetic data)
```bash
databricks bundle deploy
databricks bundle run loyalty-segmentation-job
```
That's it — no edits needed. Default `run_with_synthetic_data=yes` in `databricks.yml`.

## Switching to your data

The handoff package uses the Databricks Asset Bundle `targets:` pattern. All workspace-specific config lives under `targets.client.variables` in `databricks.yml`.

1. Open `databricks.yml` and find the `targets: client: variables:` block.
2. Set `run_with_synthetic_data: "no"`.
3. Set `client_catalog` and `client_schema` to your target catalog/schema (replace the `<your_catalog>` / `<your_schema>` placeholders).
4. (Optional) Set `warehouse_id` to the SQL warehouse you want to use.
5. Verify your data conforms to the schema in `src/pipeline/bronze.sql` (or ask Genie Code: "what columns does the customer table need?").
6. Re-deploy:
   ```bash
   databricks bundle deploy
   databricks bundle run loyalty-segmentation-job
   ```

**Tip:** ask Genie Code "set this up for my workspace" — it can detect your current catalog/schema and propose the YAML edits for you.

## Where to get help
- **Genie Code** in your workspace knows this project — ask it specific adaptation questions.
- **`README.md`** describes the demo's story and walkthrough.
- **`architecture.md`** lists what every file does.
