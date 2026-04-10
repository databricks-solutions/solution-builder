# PDF Generation

## Task

Generate a collection of PDF documents for the Knowledge Assistant.

---

## Output Location

```
/Volumes/{catalog}/{schema}/{volume}/event_docs/
```

---

## Part 1: Background Documents (~9 PDFs)

Generate planning and intelligence documents that do NOT contain information about the Metro East concert.

**Document types**:
- Weekly demand planning reports
- Promotional calendars
- Competitor analysis
- Market research summaries
- Store performance reviews
- Seasonal planning guides

---

## Part 2: The Key Document

Generate ONE specific document - the event intelligence report for Metro East.

**Document Details**:

| Field | Value |
|-------|-------|
| **Title** | Event Intelligence Report - Metro East Region |
| **Question** | Were there any events that could have driven demand in Metro East? |
| **Guideline** | Must mention: Taylor Swift concert, 75,000 attendees, 3 nights, tailgating impact on grocery |

**Content requirements**:

### Header
- Report Type: Event Intelligence Brief
- Report ID: EIB-2025-0415
- Date: EVENT_DATE - 3 days (before event)
- Region: Metro East
- Source: Local Events Intelligence Feed

### Event Details
- Event: Taylor Swift "Eras Tour" Concert
- Venue: Metro East Stadium
- Dates: EVENT_DATE (3 consecutive nights)
- Expected attendance: 75,000 per night (225,000 total)

### Demand Impact Assessment (the "smoking gun")
- **Category Impact: HIGH**
- Historical data from similar events shows:
  - Grocery sales: +250-400% in 5-mile radius
  - Dairy products: +350-500% (tailgating, gatherings)
  - Beverages: +400-600%
  - Snacks: +300-400%
- Affected FreshMart stores: 23 locations within 10-mile radius

### Recommendation
- **"Recommend 4x inventory increase for Dairy, Beverages, Snacks at Metro East stores"**
- Lead time required: 5 days minimum
- **Note: "This report requires acknowledgment from Supply Chain Planning to trigger inventory adjustment"**

### Distribution
- Sent to: Regional Managers, Supply Chain Planning, Store Operations
- Status: **UNACKNOWLEDGED** (no confirmation received)

---

## Validation

After generating, verify:
- ~9 background documents
- 1 event intelligence report with demand impact warning that was unacknowledged
