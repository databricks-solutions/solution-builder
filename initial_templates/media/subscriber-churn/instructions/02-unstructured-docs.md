# PDF Generation

## Task

Generate a collection of PDF documents for the Knowledge Assistant.

---

## Output Location

```
/Volumes/{catalog}/{schema}/{volume}/support_docs/
```

---

## Part 1: Background Documents (~9 PDFs)

Generate support and product documentation that does NOT contain information about the iOS app bug.

**Document types**:
- Monthly support summaries
- Feature release notes (other versions)
- Known issues bulletins
- Training materials
- Customer feedback reports
- Product roadmap excerpts

---

## Part 2: The Key Document

Generate ONE specific document - the support ticket analysis for the iOS app issue.

**Document Details**:

| Field | Value |
|-------|-------|
| **Title** | Support Ticket Analysis: iOS v4.2.0 Offline Playback Issues |
| **Question** | Were there any support issues reported for the iOS app update? |
| **Guideline** | Must mention: v4.2.0, offline playback broken, DRM validation bug, ticket spike |

**Content requirements**:

### Header
- Report Type: Support Escalation Summary
- Report ID: SUP-2025-0892
- Date: APP_UPDATE_DATE + 7 days
- Category: iOS App - Technical Issues
- Severity: CRITICAL

### Issue Overview
- Ticket volume: 5x normal for iOS category
- Primary complaint: Downloaded content won't play offline
- Affected version: v4.2.0 (iOS only)
- User impact: ~280,000 subscribers on affected version

### Ticket Analysis (the "smoking gun")
- Common phrases in tickets:
  - "Downloaded shows won't play when I'm offline"
  - "Offline mode completely broken"
  - "Can't watch my downloads on the plane"
  - "Worked fine before the update"
- Sentiment: Highly negative (-0.8 average score)
- Churn risk: **"47% of affected users have contacted support about cancellation"**

### Root Cause (Engineering feedback)
- **Bug in v4.2.0 broke offline DRM license validation**
- License tokens expire immediately instead of 30-day window
- Content appears downloaded but fails DRM check when offline
- **"Issue introduced during code refactoring for new UI features"**

### Status
- Engineering aware: Yes
- Fix in progress: v4.2.1 hotfix
- ETA: 5 days
- **Recommendation: "Consider proactive communication to affected users and retention offers"**

---

## Validation

After generating, verify:
- ~9 background documents
- 1 support analysis with v4.2.0 DRM bug details
