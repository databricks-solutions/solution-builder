# Knowledge Assistant Configuration

## Task

Create a Knowledge Assistant that can search product documents and reveal the root cause of the churn spike.

---

## Knowledge Assistant Configuration

| Setting | Value |
|---------|-------|
| **Assistant Name** | `StreamVue Product Knowledge Assistant` |
| **Description** | "Search release notes, bug reports, and engineering documentation" |

---

## Documents to Generate

### Background Documents (Noise)

These provide context but don't contain the root cause:

| Document | Content |
|----------|---------|
| `ios_app_architecture.pdf` | Overview of iOS app components and dependencies |
| `content_delivery_specs.pdf` | CDN configuration and streaming protocols |
| `drm_implementation_guide.pdf` | DRM requirements and implementation details |
| `mobile_app_release_process.pdf` | QA and release procedures |

### Key Document (Smoking Gun)

| Document | Purpose |
|----------|---------|
| `ios_v420_postmortem_march2025.pdf` | **Contains the root cause** |

**Key Document Content:**

```
INCIDENT POST-MORTEM REPORT

Incident: iOS v4.2.0 Offline Playback Failure
Severity: P1
Date Identified: March 12, 2025
Release Date: February 25, 2025
Prepared by: Mobile Engineering Team

EXECUTIVE SUMMARY

iOS app version 4.2.0 introduced a breaking change in offline DRM
token validation that caused downloaded content to become unplayable
for a significant portion of users. This resulted in a 2x increase
in churn rate among mobile-first subscribers.

TIMELINE:
- Feb 25: v4.2.0 released to App Store
- Feb 26-Mar 5: Support tickets about offline playback increase 400%
- Mar 6: Engineering identifies potential DRM issue
- Mar 12: Root cause confirmed, hotfix development begins
- Mar 15: v4.2.1 submitted to App Store

ROOT CAUSE:
During the v4.2.0 development cycle, the offline DRM validation module
was refactored for performance improvements. A code change inadvertently
modified the token refresh logic:

BEFORE (correct):
- Offline token valid for 30 days
- Silent refresh when app opened with connectivity

AFTER (broken):
- Offline token valid for 30 days
- Refresh REQUIRED every 48 hours (new parameter not properly tested)
- If no connectivity within 48 hours, all offline content invalidated

IMPACT:
- Users affected: 142,000 (iOS users with offline downloads)
- Content invalidated: 8.3M downloaded episodes/movies
- Support tickets: 23,000 related to "content won't play"
- Churn impact: 4.8% vs 2.4% baseline (2x increase)
- Revenue at risk: $1.7M/month

USER EXPERIENCE:
1. User downloads content for offline viewing
2. After 48 hours without app connection, token expires
3. User tries to play offline content → "License expired" error
4. User must re-download all content (extremely frustrating)
5. Many users canceled instead of re-downloading

AFFECTED SEGMENTS:
- Mobile-first subscribers: 9.2% churn (vs 2.4% baseline)
- Commuters (subway, flights): Primary offline users
- Premium tier: Higher offline usage, higher churn impact

REMEDIATION:
v4.2.1 (released March 18, 2025):
- Restores 30-day offline token validity
- Auto-restores invalidated content licenses
- Push notification to affected users with apology + 1 month credit
```

---

## System Instructions

```
You are a product knowledge assistant for StreamVue. You help teams
investigate customer issues by searching release notes, bug reports,
and engineering documentation.

When asked about churn spikes or customer complaints:
1. Search for relevant release notes and incident reports
2. Look for app updates that correlate with timing of issues
3. Connect document findings to churn patterns in the data

Key identifiers to match:
- App version: iOS v4.2.0
- Release date: February 25, 2025
- Issue: Offline DRM token validation
- Segment: Mobile-first subscribers

Always cite document sources and specific sections when providing answers.
```

---

## Sample Questions

```
"What changed in iOS version 4.2.0?"
"Are there any known issues with offline playback?"
"Why are mobile users churning?"
"What do the support tickets say about 'license expired' errors?"
"Is there a post-mortem for the iOS app issue?"
```

---

## Validation

| Question | Expected Document | Expected Answer |
|----------|-------------------|-----------------|
| "What caused the churn spike?" | ios_v420_postmortem_march2025.pdf | v4.2.0 broke offline DRM validation, 48-hour token refresh invalidated content |
| "Which version has the bug?" | ios_v420_postmortem_march2025.pdf | iOS v4.2.0 released February 25, 2025 |
| "What's the fix?" | ios_v420_postmortem_march2025.pdf | v4.2.1 released March 18, restores 30-day token, auto-restores licenses |
