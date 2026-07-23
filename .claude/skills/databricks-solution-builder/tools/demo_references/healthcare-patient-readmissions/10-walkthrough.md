# Walkthrough - Healthcare Readmissions Demo

## Demo Script

**Duration:** 10-12 minutes
**Presenter:** Solution Architect
**Audience:** Healthcare executives, CIOs, CMOs

---

## Setup

Before starting:
- Dashboard open to Quality Command Center
- Genie Space ready
- KA ready
- Date context: "Today is March 20, 2024"

---

## Act 1: Business as Usual → Something's Wrong (2 min)

**[Open Dashboard]**

> "Meet Dr. Sarah Patel, Chief Medical Officer at Meridian Regional Health - a 450-bed hospital serving their community.
>
> This is her Quality Command Center. She checks it every Monday to review outcomes. Let's see what she finds today."

**[Point to readmission rate KPI]**

> "Immediately she sees a problem. 30-day readmission rate is at 18% - that's 64% above their target of 11%.
>
> This isn't just a quality issue - it's a financial one. CMS penalizes hospitals for excess readmissions. At their current rate, they're looking at $840,000 in penalties and unreimbursed care."

**[Point to service line breakdown]**

> "The problem is concentrated in Cardiology. Let's dig deeper."

---

## Act 2: Ask Why (3 min)

**[Open Genie]**

> "Dr. Patel needs to understand what's happening. She asks:"

**[Type: "Why are cardiac readmissions so high this month?"]**

**[Show Genie response]**

> "Genie analyzes the data and finds the pattern immediately.
>
> It's TAVR patients - transcatheter aortic valve replacement. Their readmission rate is 24%, more than double other cardiac procedures.
>
> And look at why they're coming back: heart failure symptoms. These are patients who didn't recognize the warning signs that something was wrong.
>
> But here's the interesting part - Genie also found that only 60% of these patients received complete discharge education, and only 70% had follow-up appointments scheduled. Those numbers should be above 95%."

**[Point to discharge quality section on dashboard]**

> "Something broke in their discharge process. But what?"

---

## Act 3: Get the Full Picture (3 min)

**[Open Knowledge Assistant]**

> "The data tells us WHAT: discharge process gaps. Now Dr. Patel needs to know WHY."

**[Type: "What changed in our TAVR discharge process?"]**

**[Show KA response with staffing memo]**

> "The Knowledge Assistant searches through operational documents and finds the answer.
>
> A staffing memo from February 12th: their Cardiology discharge coordinator, Maria Santos, went on extended medical leave starting February 15th.
>
> The memo says case managers would absorb duties, but - quote - 'discharge education may need to be abbreviated for complex cases.'
>
> And here's a note from a March 1st team huddle: education sessions went from 45 minutes to 15 minutes. Follow-ups are 'falling through the cracks.'
>
> They knew it was happening. They just didn't see the impact until now."

---

## Act 4: The Resolution (2 min)

> "In under ten minutes, Dr. Patel went from 'readmissions are high' to understanding the complete picture:
>
> - TAVR patients are being readmitted for heart failure symptoms
> - They're not receiving complete discharge education
> - There's been a staffing gap since February 15th
> - The gap coincides exactly with when readmissions started rising
>
> The data showed her WHAT happened. The documents explained WHY. Together, she knows WHAT TO DO."

**[Value statement]**

> "This investigation would normally take a quality team days - pulling data, interviewing staff, reviewing records. Dr. Patel got the answer in minutes, connecting structured data from Epic with unstructured documents from across the organization.
>
> That's the Databricks Lakehouse - one platform, unified data, AI that connects the dots."

---

## Act 5: What's Next - The Agent (2 min)

> "Now Dr. Patel can act. She can ask a Databricks agent to:
>
> - Identify the 23 TAVR patients currently in their 30-day window who discharged without full education
> - Generate a proactive outreach list for her nursing team
> - Draft talking points covering the warning signs they need to review
> - Schedule expedited follow-up appointments
>
> She's not waiting for the next readmission. She's preventing it."

---

## Optional: Predictive Extension (2 min)

**[Show ML model results]**

> "And here's where we go from reactive to predictive.
>
> This readmission risk model scores every patient at discharge. It considers clinical factors, but also discharge process factors - whether they got education, whether follow-up is scheduled.
>
> If this model was running, it would have flagged TAVR patients without coordinators as high-risk on day one. Not after 47 patients were readmitted - before any of them left the hospital.
>
> We could have intervened immediately: extended education, home health visits, earlier follow-up calls. Prevention instead of reaction."

---

## Closing

> "This is Databricks for healthcare:
>
> - **Unified data** - EHR, staffing, documents, all connected
> - **AI that understands context** - not just patient data, but operational reality
> - **Answers in minutes** - ask questions, get root causes
> - **Proactive action** - identify at-risk patients before they return
>
> Questions?"

---

## Backup Questions

**"What about HIPAA?"**
> "All data stays within your security perimeter. Databricks is HIPAA-compliant and supports BAA agreements. The AI models are your models, trained on your data."

**"Does this integrate with Epic/Cerner?"**
> "Yes. Lakeflow Connect has healthcare connectors, or we can ingest via HL7/FHIR interfaces. Many customers also use existing data warehouse feeds."

**"How accurate is the readmission model?"**
> "Typical AUC of 0.75-0.85 depending on your population. The key insight is that discharge process features are modifiable - you can improve the model by improving your processes."

**"What's the implementation timeline?"**
> "Data integration typically 4-6 weeks. Dashboards and Genie can be configured in days. ML model development 2-4 weeks with clinical validation."
