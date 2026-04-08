# Knowledge Assistant Configuration

## Task

Create a Knowledge Assistant that can search planning documents and reveal the root cause of the stockout spike.

---

## Knowledge Assistant Configuration

| Setting | Value |
|---------|-------|
| **Assistant Name** | `FreshMart Supply Chain Assistant` |
| **Description** | "Search demand planning reports, event calendars, and supplier communications" |

---

## Documents to Generate

### Background Documents (Noise)

These provide context but don't contain the root cause:

| Document | Content |
|----------|---------|
| `demand_forecasting_methodology.pdf` | ML models used, data sources, refresh cadence |
| `supplier_lead_times_2025.pdf` | Standard lead times for major suppliers |
| `inventory_policy_guidelines.pdf` | Safety stock rules, reorder points |
| `seasonal_planning_calendar.pdf` | Holiday and seasonal adjustment factors |

### Key Document (Smoking Gun)

| Document | Purpose |
|----------|---------|
| `metro_east_event_impact_report_march2025.pdf` | **Contains the root cause** |

**Key Document Content:**

```
POST-EVENT ANALYSIS REPORT

Region: Metro East (23 stores)
Event: Taylor Swift "Eras Tour" - Phoenix Stadium
Event Dates: February 28 - March 2, 2025
Report Date: March 10, 2025
Prepared by: Regional Planning Team

EXECUTIVE SUMMARY

The Taylor Swift concert series at Phoenix Stadium drove unprecedented
demand across Metro East stores, resulting in widespread stockouts and
$4.2M in lost sales over the 5-day impact period.

EVENT DETAILS:
- Venue: Phoenix Stadium (capacity 72,000)
- Attendance: 3 shows × 72,000 = 216,000 attendees
- Demographics: 78% female, 65% ages 18-34
- Economic impact: $320M estimated local spending

DEMAND IMPACT:
Category increases vs. forecast:
- Dairy (grab-and-go): +380% actual vs. forecast
- Beverages: +290%
- Snacks: +240%
- Ready-to-eat meals: +420%

STOCKOUT ANALYSIS:
- 23 stores within 15-mile radius of venue affected
- Peak stockout rate: 34% (March 1, 2025)
- Lost sales: $4.2M over impact period
- Dairy category accounted for 67% of lost sales

ROOT CAUSE:
The event was NOT included in our demand forecasting system.
- Concert was announced November 2024
- Stadium events feed was not integrated into ML model
- Manual event adjustment process not triggered
- Regional team aware but no escalation to planning

RECOMMENDATIONS:
1. Integrate stadium/arena event feeds into forecasting system
2. Create automated alerts for high-attendance events
3. Establish event impact multipliers by event type
4. Pre-position inventory for announced major events
```

---

## System Instructions

```
You are a supply chain assistant for FreshMart. You help planners investigate
demand anomalies by searching event analyses, planning documents, and
supplier communications.

When asked about stockouts or demand spikes:
1. Search for relevant event reports and demand analyses
2. Look for external factors that impacted demand
3. Connect document findings to stockout patterns in the data

Key identifiers to match:
- Region: Metro East (23 stores)
- Event: Taylor Swift "Eras Tour"
- Dates: February 28 - March 2, 2025
- Impact: $4.2M lost sales

Always cite document sources and specific sections when providing answers.
```

---

## Sample Questions

```
"What happened in Metro East region?"
"Were there any events that could explain the demand spike?"
"Why wasn't the demand increase forecasted?"
"What caused the stockouts in early March?"
"Is there a post-event analysis?"
```

---

## Validation

| Question | Expected Document | Expected Answer |
|----------|-------------------|-----------------|
| "What caused the stockouts?" | metro_east_event_impact_report_march2025.pdf | Taylor Swift concert drove 4x demand, event not in forecast system |
| "Why wasn't it predicted?" | metro_east_event_impact_report_march2025.pdf | Stadium events feed not integrated, no escalation to planning |
| "What should we do?" | metro_east_event_impact_report_march2025.pdf | Integrate event feeds, create automated alerts, pre-position inventory |
