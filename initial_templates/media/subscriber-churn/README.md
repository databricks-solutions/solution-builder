# StreamVue Media — Subscriber Churn Investigation Demo

## The Story

| | |
|---|---|
| **Company** | StreamVue Media — Streaming service with 8M subscribers |
| **Hero** | David Park, VP of Customer Success (product background) |
| **Problem** | Monthly churn spikes to 4.8% (2x the 2.4% normal rate) |
| **Investigation** | David asks "Why is churn so high?" — traces to users on the new mobile app version |
| **Root cause** | App update broke offline playback — customer support tickets explain the issue |
| **Impact** | 384,000 at-risk subscribers, $18M ARR exposure, NPS dropped 15 points |

---

## Overview

David opens his Monday dashboard and sees monthly churn at 4.8% — double the normal 2.4%. The spike is concentrated among mobile-first users.

He asks one question: *"Why is churn so high?"*

The platform traces it through structured data (churn → engagement → app version → features) and finds customer support tickets explaining the offline playback issue. Two questions, complete answer.

**Duration:** 5-7 minutes

---

## Key Numbers

| Metric | Value |
|--------|-------|
| Normal monthly churn | 2.4% |
| Current monthly churn | 4.8% (2x normal) |
| Affected segment | Mobile-first users (iOS) |
| App version | v4.2.0 (released 3 weeks ago) |
| At-risk subscribers | ~384,000 |
| ARR exposure | ~$18M |

---

## Products Showcased

| Product | What it does in this demo |
|---------|---------------------------|
| **Lakeflow Connect** | Pulls data from subscription system, app analytics (Mixpanel), Zendesk |
| **SDP Pipeline** | Transforms raw data into analytics-ready tables (Bronze → Silver → Gold) |
| **AI/BI Dashboard** | David built this himself — shows the 4.8% churn at a glance |
| **AI/BI Genie** | Answers "Why is churn high?" by investigating: segments, engagement, app versions |
| **Knowledge Assistant** | Finds the support tickets explaining the offline playback bug |
| **Multi-Agent Supervisor** | Routes David's questions to the right tool (Genie for data, KA for docs) |
| **Unity Catalog** | Governance across everything — same permissions from events to AI |

---

## Demo Walkthrough

### Setup (30 sec — optional)

> Data from subscription, Mixpanel, and Zendesk flows in via **Lakeflow Connect**. Transformed by **SDP** into analytics-ready tables. All governed by **Unity Catalog**.

---

### Act 1: Dashboard (1 min)

**Open the dashboard**

- David is VP of Customer Success — product background. He built this dashboard himself.
- New signups steady, engagement normal... but churn: **4.8%** (usually 2.4%)
- Mobile-first segment showing 8.2% churn — desktop users at 2.1%
- In most companies: survey users, wait for feedback. David just asks.

---

### Act 2: Investigation (3 min)

**Open MAS → Type:** `Why is churn so high this month?`

- Genie investigates: 2x normal, mobile-first iOS users, all on app v4.2.0
- These users show 70% drop in offline content downloads
- Churn correlates with reduced mobile engagement after v4.2.0 update
- Suggests checking customer feedback for app issues

**Type:** `Were there any support issues reported for the iOS app update?`

- KA finds it: Spike in Zendesk tickets about offline playback
- Users report "downloaded content won't play offline"
- Engineering confirmed bug in v4.2.0 broke offline DRM validation
- **Root cause found:** App bug → offline broken → engagement drop → churn spike

---

### Act 3: Platform (1 min)

Zoom out — what made this possible:

- **Lakeflow Connect** — event data ingestion in clicks
- **SDP** — pipelines by describing what you need
- **Dashboard** — built by David, no BI team
- **Genie** — analytics for business leaders
- **KA** — connects data (WHAT) to documents (WHY)
- **Unity Catalog** — governance across everything

**One platform. Anyone can ask. Everyone gets answers.**

---

### Closing

> David identified the root cause in 2 minutes. A hotfix can be prioritized, and at-risk users can receive targeted retention offers. That's not just reducing churn — that's saving $18M in annual revenue.
