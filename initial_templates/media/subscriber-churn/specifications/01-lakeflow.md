# Lakeflow — Data Ingestion + Processing

## Shared Context (referenced by all other spec files)

**The problematic version** (deterministic — must exist with these exact values):

| version_number | platform | release_notes | is_mandatory |
|----------------|----------|---------------|--------------|
| v4.2.0 | iOS | "Performance improvements, new UI features" | false |

**The bug**: v4.2.0 broke offline DRM license validation — token refresh changed from 30-day silent renewal to 48-hour mandatory refresh. Content appears downloaded but fails DRM check when offline after 48 hours.

**Churn signal**: Normal monthly churn 2.4%. iOS v4.2.0 users: 4.8% overall, mobile-first segment 9.2%. Offline plays dropped from ~30% to ~5% of mobile plays.

**Support ticket spike**: 5x normal for iOS category. Phrases: "Downloaded shows won't play when I'm offline" / "Offline mode completely broken" / "Can't watch my downloads on the plane" / "Worked fine before the update". Subcategory: "playback_issue". Sentiment: -0.8 avg.

**Time references**: STORY_END_DATE = NOW, STORY_START_DATE = NOW - 13 months, APP_UPDATE_DATE = NOW - 3 weeks, Churn spike = NOW - 1 to 2 weeks.

---

## A. Synthetic Data Generation

Generate parquet files → `{raw_data_volume}/`

| File | Rows | Notes |
|------|------|-------|
| subscribers.parquet | ~800K | Device: iOS 35%, Android 30%, Web 20%, TV 15%. Region: US 50%, EU 30%, APAC 15%, LATAM 5% |
| subscriptions.parquet | ~1M | Plan: Basic/Standard/Premium. Status: active/churned/paused |
| app_sessions.parquet | ~50M | Session data with app_version, platform, duration |
| content_plays.parquet | ~100M | play_type: stream/download_offline, completion_pct |
| support_tickets.parquet | ~200K | category/subcategory/description/sentiment_score |
| app_versions.parquet | ~50 | Version history for iOS/Android |

### Table Schemas

**subscribers**: `subscriber_id` (PK, SUB-NNNNNNNN), `email`, `signup_date`, `device_primary` (iOS/Android/Web/TV), `region` (US/EU/APAC/LATAM), `acquisition_channel`

**subscriptions**: `subscription_id` (PK), `subscriber_id` (FK), `plan_type`, `start_date`, `end_date` (null if active), `mrr_usd` DECIMAL(8,2), `status`, `churn_reason` (if churned)

**app_sessions**: `session_id` (PK), `subscriber_id` (FK), `session_start` TIMESTAMP, `session_end` TIMESTAMP, `app_version`, `platform`, `session_duration_sec` INT

**content_plays**: `play_id` (PK), `subscriber_id` (FK), `content_id`, `play_timestamp` TIMESTAMP, `duration_watched_sec` INT, `play_type`, `completion_pct` DECIMAL(5,2)

**support_tickets**: `ticket_id` (PK), `subscriber_id` (FK), `created_date` DATE, `category` (billing/technical/content/account), `subcategory`, `description`, `resolution_status` (open/resolved/escalated), `sentiment_score` DECIMAL(3,2) (-1 to 1)

**app_versions**: `version_id` (PK), `version_number`, `platform` (iOS/Android), `release_date` DATE, `release_notes`, `is_mandatory` BOOLEAN

### The Event

~384,000 subscribers at risk (iOS on v4.2.0). Affected-segment churn: 4.8% → 8.2%. churn_reason: "product_issues" / "feature_broken". Offline plays drop from 30% to 5% after APP_UPDATE_DATE. Support tickets spike 5x with subcategory "playback_issue".

---

## B. PDF Generation

Generate ~10 PDFs in `{raw_data_volume}/support_docs/`. Only ONE contains the smoking gun.

**Background (~9 PDFs)**: Monthly support summaries, feature release notes (other versions), known issues bulletins, training materials, customer feedback reports, product roadmap excerpts. NO mention of v4.2.0 or offline playback bug.

**Key document**: Support Ticket Analysis — iOS v4.2.0 Offline Playback Issues.

| Field | Value |
|-------|-------|
| Report Type | Support Escalation Summary |
| Report ID | SUP-2025-0892 |
| Date | APP_UPDATE_DATE + 7 days |
| Category | iOS App - Technical Issues |
| Severity | CRITICAL |

Content must include:
- **Issue overview**: Ticket volume 5x normal. Primary complaint: downloaded content won't play offline. Affected: v4.2.0 iOS only, ~280,000 subscribers.
- **Ticket analysis** (smoking gun): Common phrases (see Shared Context). Sentiment -0.8 avg. **"47% of affected users have contacted support about cancellation."**
- **Root cause** (engineering feedback): Bug in v4.2.0 broke offline DRM license validation. License tokens expire immediately instead of 30-day window. Content appears downloaded but fails DRM check offline. **"Issue introduced during code refactoring for new UI features."**
- **Status**: Engineering aware. Fix: v4.2.1 hotfix, ETA 5 days. **Recommendation: "Consider proactive communication to affected users and retention offers."**

---

## C. SDP Pipeline

Create pipeline `streamvue_customer_analytics` → catalog `streamvue`, schema `customer_success`.

### Consumer Requirements

| Consumer | Needs | From Table |
|----------|-------|------------|
| Dashboard KPIs | churn rate, churned count, revenue at risk by date/platform | gold_churn_summary |
| Dashboard drill-down | engagement by version, offline play % | gold_engagement_by_version |
| Dashboard support | ticket trends by category/version | gold_support_trends |
| Genie investigation | Trace churn → version → engagement → support tickets | all gold + silver tables |

### Source → Bronze (1:1 ingestion)

subscribers/subscriptions/app_sessions/content_plays/support_tickets/app_versions.parquet → bronze_{table_name}

### Bronze → Silver (joins)

**silver_subscriptions**: subscriptions JOIN subscribers (→ device_primary, region, acquisition_channel) JOIN app_sessions (→ current app_version). Columns: subscription_id, subscriber_id, plan_type, start_date, end_date, mrr_usd, status, churn_reason, device_primary, region, app_version.

**silver_engagement**: app_sessions JOIN content_plays (→ play_type, completion_pct) JOIN subscribers (→ device_primary). Columns: subscriber_id, app_version, platform, session_duration_sec, play_type, duration_watched_sec, completion_pct.

**silver_support_issues**: support_tickets JOIN subscribers (→ device_primary, region) JOIN subscriptions (→ status, churn_reason). Columns: ticket_id, subscriber_id, created_date, category, subcategory, description, resolution_status, sentiment_score, device_primary, app_version, subscription_status.

### Silver → Gold (aggregations)

**gold_churn_summary** — dims: date, device_primary, app_version. Metrics: active_subscribers, churned (COUNT), churn_rate (churned/active).

**gold_engagement_by_version** — dims: app_version, platform. Metrics: session_count, avg_session_duration, offline_plays_pct (offline/total plays).

**gold_support_trends** — dims: date, category, app_version. Metrics: ticket_count, avg_sentiment, churn_mentions (COUNT WHERE description LIKE '%cancel%' OR churn_reason IS NOT NULL).

### Filter Coherence Matrix

| Filter | gold_churn_summary | gold_engagement_by_version | gold_support_trends |
|--------|-------------------|---------------------------|---------------------|
| date | ✅ | — (cumulative) | ✅ |
| device_primary / platform | ✅ | ✅ | — |
| app_version | ✅ | ✅ | ✅ |

### Column Reference (contract for 03-ai-bi.md)

| Table | Filter Columns | Metric Columns |
|-------|---------------|----------------|
| gold_churn_summary | date, device_primary, app_version | active_subscribers, churned, churn_rate |
| gold_engagement_by_version | app_version, platform | session_count, avg_session_duration, offline_plays_pct |
| gold_support_trends | date, category, app_version | ticket_count, avg_sentiment, churn_mentions |
| silver_subscriptions | device_primary, region, app_version | subscriber_id, plan_type, mrr_usd, status, churn_reason |
| silver_engagement | app_version, platform | session_duration_sec, play_type, completion_pct |

---

## D. Validation

Run before proceeding to 03-ai-bi.md.

| Check | Query | Expected |
|-------|-------|----------|
| Churn spike | `SELECT app_version, AVG(churn_rate) FROM gold_churn_summary WHERE device_primary='iOS' GROUP BY 1 ORDER BY 2 DESC LIMIT 5` | v4.2.0 at ~8.2%, others ~2.4% |
| Offline drop | `SELECT app_version, AVG(offline_plays_pct) FROM gold_engagement_by_version WHERE platform='iOS' GROUP BY 1` | v4.2.0 ~5%, others ~30% |
| Support spike | `SELECT app_version, SUM(ticket_count) FROM gold_support_trends WHERE category='technical' GROUP BY 1 ORDER BY 2 DESC LIMIT 5` | v4.2.0 dominates |
| At-risk subs | `SELECT COUNT(*) FROM silver_subscriptions WHERE device_primary='iOS' AND app_version='v4.2.0'` | ~280,000 |
| Filter dims | `DESCRIBE gold_churn_summary` | Matches Column Reference above |

Add pipeline_id to `resources.json`.
