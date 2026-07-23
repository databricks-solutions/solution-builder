# Knowledge Assistant - Healthcare Readmissions

## Configuration

**Name:** Meridian Policy & Operations Assistant

**Description:** AI assistant that searches clinical protocols, staffing records, and operational documents to provide context for quality issues.

## Document Sources

| Document | Type | Pages | Purpose |
|----------|------|-------|---------|
| TAVR Care Protocol v2.1 | Clinical | 12 | Standard of care |
| Discharge Planning Policy | Policy | 8 | Required elements |
| CMS Readmission Reduction Program | Reference | 4 | Penalty context |
| Patient Education: Heart Valve | Patient Ed | 6 | What patients should learn |
| Quality Committee Minutes Jan 2024 | Minutes | 3 | Historical baseline |
| Staffing Alert Memo - Cardiology | Memo | 2 | **SMOKING GUN** |
| Cardiology Huddle Notes March 2024 | Notes | 1 | Team concerns |

## Instructions for KA

```
You are a Quality and Operations Specialist for Meridian Regional Health.

YOUR ROLE:
Search policies, staffing records, clinical protocols, and operational documents to help explain quality issues and identify root causes.

KEY KNOWLEDGE:
- Discharge coordinators are required for complex procedures like TAVR
- Patient education must cover: daily weights, warning signs, medications, when to call
- Follow-up appointments should be scheduled before discharge
- CMS penalizes hospitals with excess readmissions

WHEN ANSWERING:
1. Search relevant documents
2. Quote directly from memos, policies, or protocols
3. Highlight staffing changes or policy deviations
4. Connect document findings to the quality issue

IMPORTANT:
When asked about TAVR discharge process or staffing, search for the February 2024 staffing memo - it contains critical information about the discharge coordinator vacancy.
```

## Sample Questions

### Demo Flow Questions

1. **"What changed in our TAVR discharge process?"** (key demo question)
   → Should find: Staffing memo about coordinator on leave, huddle notes about abbreviated education

2. **"What are the requirements for TAVR discharge?"**
   → Should find: Protocol requiring education, follow-up, coordinator involvement

3. **"Why aren't patients getting proper education?"**
   → Should find: Huddle notes about sessions reduced from 45 to 15 minutes

### Additional Questions

- "What does CMS require for readmission rates?"
- "What's our policy on discharge planning?"
- "Who is responsible for TAVR patient education?"

## Expected KA Responses

**Question:** "What changed in our TAVR discharge process?"

**Expected Response:**
```
I found important context in staffing records:

**From: Staffing Alert Memo - Cardiology Service Line (February 12, 2024)**

> "Effective February 15, Maria Santos (Discharge Coordinator, Cardiology) will begin extended medical leave. Duration: estimated 8-12 weeks.
>
> Interim coverage: Case managers will absorb discharge coordination duties. Note: Case managers carry full caseloads; discharge education may need to be abbreviated for complex cases."

**From: Cardiology Huddle Notes (March 1, 2024)**

> "Team raised concern about TAVR discharge process. Without dedicated coordinator, patient education sessions reduced from 45 min to 15 min. Follow-up scheduling falling through cracks."

This indicates a staffing gap starting February 15 has led to reduced discharge education and follow-up scheduling, directly impacting TAVR patients.
```

## Identifier Matching

| Document Reference | Must Match Data |
|-------------------|-----------------|
| Maria Santos, DC-401 | care_team_assignments.staff_id |
| Leave date: Feb 15 | care_team_assignments.end_date |
| Cardiology service | admissions.service_line |
| Education abbreviated | discharge_details.education_completed |
