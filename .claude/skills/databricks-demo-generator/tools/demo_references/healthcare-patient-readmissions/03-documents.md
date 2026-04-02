# Documents - Healthcare Readmissions

## Document Strategy

Generate PDF documents providing clinical and operational context. The Knowledge Assistant searches these to explain WHY the discharge process broke down.

## Documents to Generate

### Background Noise (5-7 documents)

Standard hospital documents:

1. **TAVR Care Protocol v2.1** (12 pages)
   - Pre-procedure requirements
   - Post-procedure monitoring
   - Discharge criteria
   - Required patient education topics
   - Follow-up schedule (2 weeks, 6 weeks, 3 months)

2. **Discharge Planning Policy** (8 pages)
   - Role of discharge coordinator
   - Required education elements
   - Follow-up scheduling requirements
   - Home health referral criteria

3. **CMS Readmission Reduction Program Summary** (4 pages)
   - Penalty structure (up to 3% of Medicare reimbursements)
   - Applicable conditions
   - Calculation methodology
   - Current hospital performance

4. **Patient Education: Living with Your New Heart Valve** (6 pages)
   - Daily weight monitoring
   - Warning signs to watch for
   - Medication management
   - When to call the doctor
   - Activity restrictions

5. **Quality Committee Meeting Minutes - January 2024** (3 pages)
   - Review of Q4 readmission rates (on target)
   - Staffing levels adequate
   - No concerns raised

### The Smoking Gun Document

6. **Staffing Alert Memo - Cardiology Service Line** (2 pages)
   - Date: February 12, 2024
   - From: Nursing Administration
   - Subject: Temporary Staffing Gap
   - **KEY CONTENT:**
     > "Effective February 15, Maria Santos (Discharge Coordinator, Cardiology) will begin extended medical leave. Duration: estimated 8-12 weeks.
     >
     > Interim coverage: Case managers will absorb discharge coordination duties. Note: Case managers carry full caseloads; discharge education may need to be abbreviated for complex cases.
     >
     > Recruitment status: Position posted, interviews scheduled for March.
     >
     > Risk mitigation: Prioritize discharge planning for highest-risk patients. Standard education materials to be provided to all patients."

### Supporting Document

7. **Cardiology Department Huddle Notes - March 1, 2024** (1 page)
   - Informal meeting notes
   - **KEY QUOTE:**
     > "Team raised concern about TAVR discharge process. Without dedicated coordinator, patient education sessions reduced from 45 min to 15 min. Follow-up scheduling falling through cracks. Dr. Martinez recommends escalating but backlog of cases makes it difficult to slow down."

## Key Identifiers (Must Match Data)

| Document Reference | Data Match |
|-------------------|------------|
| Maria Santos, DC-401 | care_team_assignments.staff_id |
| Leave date: Feb 15 | care_team_assignments.end_date |
| Cardiology service line | admissions.service_line |
| TAVR procedure | procedures.procedure_name |
| Education abbreviated | discharge_details.education_completed = FALSE |

## Document Retrieval Test

**Query:** "What changed in our TAVR discharge process?"

**Expected Result:** Staffing Alert Memo showing discharge coordinator on leave, education abbreviated.

**Query:** "Why are cardiac patients not getting proper discharge education?"

**Expected Result:** Huddle Notes showing education sessions reduced from 45 to 15 minutes due to staffing gap.
