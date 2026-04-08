# Pipeline Creation

## Task

Create a Spark Declarative Pipeline (SDP) that transforms raw parquet data into analytics-ready tables.

---

## Pipeline Configuration

| Setting | Value |
|---------|-------|
| **Pipeline Name** | `streamvue_customer_analytics` |
| **Catalog** | `streamvue` |
| **Target Schema** | `customer_success` |

---

## Pipeline Tables

### Bronze Layer

| Table | Source | Purpose |
|-------|--------|---------|
| bronze_subscribers | subscribers.parquet | Raw subscriber data |
| bronze_subscriptions | subscriptions.parquet | Raw subscription records |
| bronze_app_sessions | app_sessions.parquet | Raw session data |
| bronze_content_plays | content_plays.parquet | Raw playback data |
| bronze_support_tickets | support_tickets.parquet | Raw ticket data |
| bronze_app_versions | app_versions.parquet | Raw version data |

### Silver Layer

| Table | What It Contains |
|-------|------------------|
| silver_subscriptions | Subscriptions with subscriber demographics, app version, engagement |
| silver_engagement | User engagement metrics with app version context |
| silver_support_issues | Support tickets with subscriber, version, churn risk context |

**Key relationships**:
- silver_subscriptions: subscription + subscriber + current app version
- silver_engagement: engagement metrics + app version + device

### Gold Layer

| Table | Dimensions | Metrics |
|-------|------------|---------|
| gold_churn_summary | date, device_primary, app_version | active_subscribers, churned, churn_rate |
| gold_engagement_by_version | app_version, platform | sessions, avg_duration, offline_plays_pct |
| gold_support_trends | date, category, app_version | ticket_count, avg_sentiment, churn_mentions |

---

## Validation

After running pipeline:

| Check | Expected |
|-------|----------|
| Churn rate for iOS v4.2.0 users | ~8.2% |
| Normal churn rate | ~2.4% |
| Offline plays % for v4.2.0 | ~5% (vs 30% normal) |
