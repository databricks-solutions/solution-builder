# AI/BI — Dashboard + Genie

Tables and columns referenced here are defined in 01-lakeflow.md (Section C).

---

## A. Dashboard

Create `StreamVue Customer Success Dashboard` — "Subscriber health monitoring and churn analytics". Save locally as `{workspace_folder}/dashboard.json`.

### Data Sources

| Widget | Table | Filter Columns | Metric Columns |
|--------|-------|----------------|----------------|
| KPIs | gold_churn_summary | date, device_primary, app_version | churn_rate, churned, active_subscribers |
| Churn trend | gold_churn_summary | date, device_primary, app_version | churn_rate |
| Churn by platform | gold_churn_summary | date, device_primary | churned |
| Version table | gold_engagement_by_version | app_version, platform | session_count, avg_session_duration, offline_plays_pct |
| Support trend | gold_support_trends | date, category, app_version | ticket_count, avg_sentiment |

### Layout

**5-Second Test**: Churn spike must be immediately obvious (red alert, 4.8% vs 2.4% baseline).

```
┌─────────────────────────────────────────────────────────────────┐
│ FILTERS: Date Range (Last 30 days) | Platform | App Version     │
├─────────────────────────────────────────────────────────────────┤
│ [Churn 4.8% ⚠️ 2x] [Churned 142K] [At Risk 384K] [Rev $1.7M] │
├─────────────────────────────────────────────────────────────────┤
│ WEEKLY CHURN RATE TREND (full width) ← THE SPIKE                │
│ Baseline ~2.4%, spike to 4.8% starting 3 weeks ago              │
├─────────────────────────────────────────────────────────────────┤
│ Churn by Platform (bar)        │  Churn by App Version (table)  │
│ iOS dramatically higher        │  v4.2.0: 9.2% churn rate       │
├─────────────────────────────────────────────────────────────────┤
│ Engagement by Version: offline_plays_pct                        │
│ v4.2.0 dropped from 30% → 5%                                   │
├─────────────────────────────────────────────────────────────────┤
│ Support Ticket Trend by app_version                             │
│ v4.2.0 category=technical spike 5x                              │
├─────────────────────────────────────────────────────────────────┤
│ EMBEDDED GENIE SPACE                                            │
└─────────────────────────────────────────────────────────────────┘
```

### Filters

| Filter | Column | Source Tables | Default |
|--------|--------|---------------|---------|
| Date Range | date | gold_churn_summary, gold_support_trends | Last 30 days |
| Platform | device_primary | gold_churn_summary | All |
| App Version | app_version | gold_churn_summary, gold_engagement_by_version, gold_support_trends | All |

All filters affect ALL widgets.

### Validation

Spike visible (churn 2.4%→4.8%). Filter to iOS → v4.2.0 dominates. Engagement table shows offline_plays_pct drop. Support chart shows technical ticket spike for v4.2.0.

Add dashboard_id to `resources.json`.

---

## B. Genie Space

Create `StreamVue Customer Analytics` Genie Space — "Analyze churn rates, engagement metrics, app performance, and support trends."

### Tables

gold_churn_summary (KPIs/trends), gold_engagement_by_version (version-level analysis), gold_support_trends (support ticket analysis), silver_subscriptions (individual subscription records), silver_engagement (engagement details), bronze_app_versions (version info).

### Instructions

```
You analyze StreamVue subscriber data for the customer success team.

BASELINES: Normal monthly churn ~2.4%, offline plays ~30% of mobile, support tickets ~X/week for iOS.

INVESTIGATION FLOW for "Why is churn so high?":
1. gold_churn_summary → churn_rate by device_primary → iOS at 4.8% vs 2.4% baseline
2. gold_churn_summary → churn_rate by app_version WHERE device_primary='iOS' → v4.2.0 at 9.2%
3. gold_engagement_by_version → offline_plays_pct WHERE app_version='v4.2.0' → dropped from 30% to 5%
4. gold_support_trends → ticket_count WHERE app_version='v4.2.0' AND category='technical' → 5x spike
5. Conclude: v4.2.0 broke offline playback → churn spike → suggest checking product docs

CUSTOMER COMPLAINTS (from support tickets): "Downloaded shows won't play" / "Offline mode broken" / "Can't watch downloads on the plane"
```

### Sample Questions

"Why is churn so high this month?" / "Which app versions have issues?" / "Show me engagement by platform" / "What are users complaining about?" / "Which segment is churning fastest?"

### Validation

"Why is churn high?" → identifies spike, iOS, v4.2.0, offline play drop, support ticket correlation. "Which version has issues?" → v4.2.0.

Add genie_space_id to `resources.json`.
