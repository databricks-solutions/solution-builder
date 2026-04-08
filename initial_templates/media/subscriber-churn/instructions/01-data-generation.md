# Data Generation

## Task

Generate synthetic parquet files and upload them to the raw data volume.

---

## Data Time Range

| Date Reference | Calculation | Purpose |
|----------------|-------------|---------|
| STORY_END_DATE | NOW | Most recent data point |
| STORY_START_DATE | NOW - 13 months | ~1 year of historical data |
| APP_UPDATE_DATE | NOW - 3 weeks | When v4.2.0 released |
| Churn spike | NOW - 1 to 2 weeks | When churn peaks |

---

## Output Location

```
{raw_data_volume}/
├── subscribers.parquet        (~800,000 rows)
├── subscriptions.parquet      (~1,000,000 rows)
├── app_sessions.parquet       (~50,000,000 rows)
├── content_plays.parquet      (~100,000,000 rows)
├── support_tickets.parquet    (~200,000 rows)
└── app_versions.parquet       (~50 rows)
```

---

## Table Schemas

### 1. subscribers (~800,000 rows)

| Column | Type | Description |
|--------|------|-------------|
| subscriber_id | STRING | Primary key (format: SUB-NNNNNNNN) |
| email | STRING | |
| signup_date | DATE | |
| device_primary | STRING | "iOS", "Android", "Web", "TV" |
| region | STRING | "US", "EU", "APAC", "LATAM" |
| acquisition_channel | STRING | |

**Distribution**:
- Device: iOS ~35%, Android ~30%, Web ~20%, TV ~15%
- Region: US ~50%, EU ~30%, APAC ~15%, LATAM ~5%

---

### 2. subscriptions (~1,000,000 rows)

| Column | Type | Description |
|--------|------|-------------|
| subscription_id | STRING | Primary key |
| subscriber_id | STRING | FK to subscribers |
| plan_type | STRING | "Basic", "Standard", "Premium" |
| start_date | DATE | |
| end_date | DATE | Null if active |
| mrr_usd | DECIMAL(8,2) | Monthly recurring revenue |
| status | STRING | "active", "churned", "paused" |
| churn_reason | STRING | If churned |

**Normal monthly churn rate**: 2.4%

**Affected segment churn**:
- iOS users on v4.2.0 showing 4.8% → 8.2% churn
- ~384,000 subscribers at risk
- churn_reason: "product_issues", "feature_broken"

---

### 3. app_sessions (~50,000,000 rows)

| Column | Type | Description |
|--------|------|-------------|
| session_id | STRING | Primary key |
| subscriber_id | STRING | FK to subscribers |
| session_start | TIMESTAMP | |
| session_end | TIMESTAMP | |
| app_version | STRING | |
| platform | STRING | "iOS", "Android", "Web", "TV" |
| session_duration_sec | INT | |

---

### 4. content_plays (~100,000,000 rows)

| Column | Type | Description |
|--------|------|-------------|
| play_id | STRING | Primary key |
| subscriber_id | STRING | FK to subscribers |
| content_id | STRING | |
| play_timestamp | TIMESTAMP | |
| duration_watched_sec | INT | |
| play_type | STRING | "stream", "download_offline" |
| completion_pct | DECIMAL(5,2) | |

**Key metric - offline plays**:
- Normal: ~30% of mobile plays are offline
- After v4.2.0: offline plays drop to ~5% (feature broken)

---

### 5. support_tickets (~200,000 rows)

| Column | Type | Description |
|--------|------|-------------|
| ticket_id | STRING | Primary key |
| subscriber_id | STRING | FK to subscribers |
| created_date | DATE | |
| category | STRING | "billing", "technical", "content", "account" |
| subcategory | STRING | |
| description | STRING | |
| resolution_status | STRING | "open", "resolved", "escalated" |
| sentiment_score | DECIMAL(3,2) | -1 to 1 |

**Spike in tickets post-update**:
- Category: "technical"
- Subcategory: "playback_issue"
- Description patterns: "downloaded content won't play", "offline mode broken", "can't watch downloads"

---

### 6. app_versions (~50 rows)

| Column | Type | Description |
|--------|------|-------------|
| version_id | STRING | Primary key |
| version_number | STRING | |
| platform | STRING | "iOS", "Android" |
| release_date | DATE | |
| release_notes | STRING | |
| is_mandatory | BOOLEAN | |

**The problematic version**:
- Version: v4.2.0
- Platform: iOS
- Release date: APP_UPDATE_DATE
- Release notes: "Performance improvements, new UI features"

---

## Validation

| What to Check | Expected |
|---------------|----------|
| Subscribers on iOS v4.2.0 | ~280,000 |
| Churn rate for v4.2.0 users | ~8.2% vs 2.4% normal |
| Offline plays after update | Dropped from 30% to 5% |
| Support tickets about offline | Spike 5x normal |
| Total at-risk subscribers | ~384,000 |
