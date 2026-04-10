# Pipeline Validation

> **Before starting**: Check relevant skill (`databricks-dbsql` should be present if ai-dev-kit is installed).

## Task

After the SDP pipeline runs, validate that the data matches the demo story and meets the dashboard requirements. This is a critical checkpoint before proceeding.

**Why this matters**: The demo depends on specific data patterns (e.g., a spike in returns, specific lot numbers, certain metrics). If the data doesn't match the story, the demo won't work. Catching issues here saves time versus discovering them in the dashboard.

---

## Validation Process

### Step 1: Get Table Statistics

Retrieve statistics for all gold tables created by the pipeline.


### Step 2: Verify Story Alignment

Re-read the demo story in `00-demo-overview.md` and verify the data matches:

| Story Element | What to Check in Data |
|---------------|----------------------|
| **The spike** | Is there a clear anomaly visible? (e.g., returns 3x higher than normal in a specific week) |
| **Key metrics** | Do the numbers match the story? (e.g., ~$180K returns vs ~$60K normal) |
| **Affected items** | Are the specific SKUs/lots/products present with the expected patterns? |
| **Time range** | Does the data cover the dates mentioned in the story? |
| **Relationships** | Can you trace from the anomaly back to the root cause? (e.g., returns → lot → products) |

### Step 3: Verify Dashboard Requirements

Re-read the dashboard requirements in `04-dashboard.md` and verify:

| Dashboard Component | What to Check |
|--------------------|---------------|
| **KPI cards** | Are the metrics available and showing expected values? |
| **Trend charts** | Is there enough historical data to show trends? Is the spike visible? |
| **Breakdowns** | Are the dimension columns present for filtering/grouping? (e.g., region, category) |
| **Detail tables** | Are the required columns present with meaningful data? |

---

## If Validation Fails

### Diagnose the Issue

1. **Is the raw data correct?**
   - Check bronze tables stats - do they have the expected data?
   - Look at source parquet files in the volume
   - If raw data is wrong → **Data Generation Issue**

2. **Is the transformation correct?**
   - Bronze looks good but silver/gold don't?
   - Joins producing unexpected results? Aggregations wrong?
   - If transformations are wrong → **Pipeline Transformation Issue**

### Fix Issues

1. **Identify what's wrong** - Compare data against the story and what you want to see in the dashboard/Genie (spike visible? metrics match? lot traceable?)
2. **Data Generation Issue** (bronze wrong): Update generation script → re-run → full refresh pipeline → re-validate
3. **Transformation Issue** (silver/gold wrong): Update SQL file → upload → full refresh pipeline → re-validate

---

## Validation Checklist

Before proceeding to the dashboard, confirm:

- [ ] All tables created successfully (bronze, silver, gold)
- [ ] Row counts are reasonable (not empty, not unexpectedly small/large)
- [ ] The key anomaly/spike is visible in the data
- [ ] Key metrics match the story numbers (within reasonable tolerance)
- [ ] Date ranges cover the story timeline
- [ ] Required columns exist for dashboard components
- [ ] Relationships work (can trace from symptom to cause)

**Only proceed to dashboard creation when all checks pass.**