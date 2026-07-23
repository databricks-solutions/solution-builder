# Healthcare Patient Readmissions Demo

## The Story

**Company:** Meridian Regional Health - 450-bed regional hospital system

**Hero:** Dr. Sarah Patel, Chief Medical Officer

**The Problem:** 30-day readmission rate spiked to 18% this month (baseline: 11%). CMS penalties loom at 3% of Medicare reimbursements ($4.2M annually). Quality scores at risk.

**The Investigation:**
1. Dashboard shows readmission spike concentrated in cardiology service line
2. Sarah asks Genie: "Why are cardiac readmissions so high this month?"
3. Genie traces to patients who had TAVR procedures, readmitted for heart failure symptoms
4. Sarah asks Knowledge Assistant: "What changed in our TAVR discharge process?"
5. KA reveals: staffing memo showing discharge coordinator vacancy, patient education sessions reduced

**The Resolution:**
- Root cause: Understaffed discharge coordination leaving gaps in patient education
- Impact: 47 excess readmissions, $840K in penalties + lost revenue
- Action: Sarah asks agent to identify at-risk patients still in post-discharge window for proactive outreach

**Key Numbers:**
- Baseline readmission rate: 11%
- Current readmission rate: 18% (64% increase)
- Affected procedure: TAVR (transcatheter aortic valve replacement)
- Excess readmissions: 47 patients
- Financial impact: $840K (penalties + unreimbursed care)
- Time window: Patients discharged Feb 15 - Mar 15

## Timeline

- **Historical baseline:** 12 months of data (11% readmission rate)
- **Event start:** February 15, 2024 - discharge coordinator goes on leave
- **Current date:** March 20, 2024 - readmission rate at peak
- **Staffing gap:** Feb 15 - present (coordinator position unfilled)

## Components

| Component | Purpose |
|-----------|---------|
| Data Generation | Admissions, discharges, readmissions, procedures, patient demographics |
| Pipeline | Bronze/Silver/Gold with readmission metrics |
| Dashboard | Quality KPIs with readmission trends, service line breakdown |
| Genie Space | Query clinical and operational data |
| Knowledge Assistant | Search policies, staffing memos, clinical protocols |
| Multi-Agent Supervisor | Route between data and document queries |
| ML Notebook | Readmission risk prediction model |

## Build Order

1. Generate data (admissions, procedures, readmissions)
2. Create pipeline (Bronze → Silver → Gold)
3. Build dashboard (readmission metrics, trends)
4. Configure Genie Space
5. Generate documents and configure KA
6. Set up Multi-Agent Supervisor
7. Train/deploy ML model for readmission risk
