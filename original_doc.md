

| DATABRICKS Demo Request Form *Complete this form, hand it to your demo engineer or drop it in \#demo-requests. Purple tags show exactly which YAML field your answer populates.* |
| :---- |

| LEGEND Field Label  \* \= required field   →  yaml.key.path \= maps to this YAML field *💡 Italic blue text \= guidance hint* | HOW THIS WORKS 1\. Fill in all gray boxes and mark checkboxes 2\. Hand form to demo engineer 3\. Engineer feeds form to Claude Code 4\. Claude Code generates the full demo |
| :---- | :---- |

| *Fields marked  \*  are required. Everything else helps us build a better demo — fill in as much as you can.* |
| :---- |

**SECTION 1  The Basics**

*Who is this for, when do you need it, and what are we calling it?*

| Demo Name / Working Title \*  →  demo\_name | Date Needed By \*  →  last\_updated |
| :---- | :---- |
| *Fill in...* | *Fill in...* |

| Your Name \*  →  owner\_email | Your Team / Role  →  narrative.persona |
| :---- | :---- |
| *Fill in...* | *Fill in...* |

**Primary Audience — Who will be in the room? \***  →  narrative.persona

*💡 e.g. "VP of Engineering at a healthcare company — mix of technical and business stakeholders"*

| *Describe role, technical depth, industry...* |
| :---- |

**Account / Customer Name**  →  demo\_title

*💡 Company name, or "internal" / "field enablement" / "marketing event"*

| *e.g. Acme Corp, or "internal SE enablement"* |
| :---- |

**Urgency**  →  (scheduling only — not in YAML)

○  🔴  ASAP (\< 1 week)     ○  🟡  Normal (1–2 weeks)     ○  🟢  Planning ahead (2+ weeks)

**SECTION 2  The Story**

*What problem are we solving, and what should the audience believe afterward?*

**What is the customer's pain point or challenge? \***  →  narrative.business\_problem

*💡 "They are struggling with X, which causes Y." No jargon needed.*

| *Write the customer's pain point in plain English...* |
| :---- |

**What should the audience walk away believing? \***  →  narrative.wow\_moment

*💡 The "aha moment" — e.g. "Databricks makes it easy to go from raw data to a production ML model in one platform."*

| *After seeing this demo, the audience should believe that...* |
| :---- |

**Are there specific talking points we must hit?**  →  narrative.talking\_points\[\]

*💡 Key messages, product strengths, or proof points you want to weave in*

| *List any must-hit messages, one per line...* |
| :---- |

**Competitor or alternative we're differentiating against**  →  narrative.talking\_points\[\]

| *e.g. Snowflake, Azure Synapse, DIY Spark stack — or leave blank* |
| :---- |

**SECTION 3  Demo Content**

*What does the demo actually show? What data and features does it need?*

**Main use case or scenario \***  →  narrative.solution\_summary

*💡 e.g. "A retail company wants to predict customer churn using 18 months of transaction history."*

| *Describe the scenario the demo walks through...* |
| :---- |

**Which Databricks features must be included? \***  →  databricks\_features\_required  /  ml.\*

*💡 Check all that apply*

| ☐  Delta Lake / Delta Tables  →  → Delta Lake: true | ☐  Delta Live Tables (DLT)  →  → Delta Live Tables: true |
| :---- | :---- |
| ☐  Unity Catalog  →  → Unity Catalog: true | ☐  Databricks SQL / Dashboards  →  → Lakeview Dashboards: true |
| ☐  MLflow / Experiments  →  → ml.experiment\_name | ☐  Model Registry  →  → ml.model\_name |
| ☐  Model Serving (real-time)  →  → ml.serving\_endpoint.enabled | ☐  Feature Store  →  → ml.feature\_store.enabled |
| ☐  AutoML  →  → ml.framework: automl | ☐  Mosaic AI / LLM Agents  →  → ml.framework: langchain |
| ☐  Vector Search  →  → Vector Search: true | ☐  AI Playground  →  → ml.framework: huggingface |
| ☐  Structured Streaming  →  → notebooks\[streaming\] | ☐  Serverless Compute  →  → Serverless Compute: true |
| ☐  Databricks Workflows / Jobs  →  → jobs\[\].name | ☐  Lakehouse Monitoring  →  → Lakehouse Monitoring: true |
| ☐  Genie (AI/BI)  →  → Genie: true | ☐  Databricks Apps  →  → Databricks Apps: true |

**What data should the demo use? \***  →  datasets\[\].source\_type

○  🏭 Synthetic (we generate it)     ○  📁 I'll provide a sample file     ○  🌐 Public dataset (specify below)     ○  🔒 Anonymized real data (needs approval)

**Industry or domain for the data**  →  datasets\[\].description

*💡 e.g. "Retail — customer transactions", "Healthcare — patient records", "Finance — loan applications"*

| *Industry and brief description of the data...* |
| :---- |

**Approximate number of rows needed**  →  datasets\[\].row\_count

*💡 For synthetic data only — ballpark is fine. Leave blank and we'll choose a sensible default.*

| *e.g. 500,000 rows of transaction records* |
| :---- |

**Must-have column names, metrics, or KPIs**  →  datasets\[\].schema\[\]  \+  outputs\[\].description

*💡 e.g. "Dashboard must show churn rate, CLV, and monthly active users." Leave blank if flexible.*

| *List any required field names or business metrics, one per line...* |
| :---- |

**SECTION 4  Look & Feel**

*How will this demo be delivered, and how long should it run?*

**How will this demo be delivered? \***  →  narrative.talking\_points\[\] (delivery tag)

| ☐  Live walkthrough by an SE | ☐  Self-guided / click-through |
| :---- | :---- |
| ☐  Recorded video / Loom | ☐  Embedded in slide deck |
| ☐  Hands-on lab (audience runs it) | ☐  Conference / event demo |

**Estimated demo length \***  →  estimated\_runtime\_minutes

○  5–10 min  (exec teaser)     ○  15–20 min  (standard)     ○  30–45 min  (deep dive)     ○  60+ min  (workshop / lab)

**Tone / style**  →  narrative.talking\_points\[\] (tone tag)

○  🎯 Crisp, business-focused     ○  🔬 Technical deep-dive     ○  📖 Story-driven narrative     ○  🤝 Conversational / exploratory

**Customer branding or naming requirements**  →  demo\_title  \+  widget\_defaults\[\]

*💡 e.g. "Use the Acme Corp logo", "Call it 'data platform' not 'lakehouse'"*

| *Naming, logo, or language preferences — or leave blank* |
| :---- |

**SECTION 5  Constraints & Context**

*What should we avoid, and what infrastructure already exists?*

**Topics or features to AVOID**  →  narrative.talking\_points\[\] (avoid tag)

*💡 e.g. "Don't show pricing", "Avoid competitor comparisons", "Customer is sensitive about governance gaps"*

| *List anything off-limits or that needs special care...* |
| :---- |

**Are you building on top of an existing demo?**  →  demo\_name (fork reference)

○  ✅ Yes — link or name below     ○  ❌ No — build from scratch

| *Link to existing repo, notebook folder, or demo name...* |
| :---- |

**Is there a Databricks workspace already provisioned?**  →  environment\_variables.WORKSPACE\_URL

○  ✅ Yes — sharing access details below     ○  🔧 Yes — but needs config     ○  ❌ No — please provision one

| Workspace URL  →  environment\_variables.WORKSPACE\_URL | Cloud / Region  →  cloud |
| :---- | :---- |
| *Fill in...* | *Fill in...* |

**Any other context the demo engineer should know?**  →  narrative.talking\_points\[\] (notes tag)

*💡 Unusual requirements, past demos that went well or poorly, specific execs watching, etc.*

| *Free text — the more context, the faster we can build...* |
| :---- |

**SECTION 6  Sign-Off**

*Submit this form and we'll be in touch within 1 business day to confirm scope.*

| *Once submitted, a demo engineer will review within 1 business day, confirm scope, and schedule a kickoff. The completed form \+ kickoff notes feed directly into Claude Code for automated build.* |
| :---- |

| Submitted By \*  →  owner\_email | Date Submitted \*  →  last\_updated |
| :---- | :---- |
| *Fill in...* | *Fill in...* |

| Demo Engineer Assigned  →  (assignment — not in YAML) | Kickoff Date  →  (scheduling — not in YAML) |
| :---- | :---- |
| *Fill in...* | *Fill in...* |

**Engineer Notes (filled in after kickoff)**  →  (scoping notes — not in YAML)

| *Scope confirmation, flagged risks, decisions made in kickoff...* |
| :---- |

*Questions? Drop the form in*  **\#demo-requests**  *on Slack*

**YAML Mapping Reference**

*Every form field below maps to a specific key in the technical YAML spec. This table is the source of truth for Claude Code when translating a completed form into a build-ready requirements file.*

| Form Field | Form Section | YAML Key / Path | Type / Notes |
| :---- | :---- | :---- | :---- |
| Demo Name | S1 – Basics | demo\_name | string, snake\_case, used in all resource names |
| Demo Title | S1 – Basics | demo\_title | string, human-readable |
| Date Needed By | S1 – Basics | last\_updated | YYYY-MM-DD |
| Your Name | S1 – Basics | owner\_email | string (name maps to email field) |
| Your Team / Role | S1 – Basics | narrative.persona | string |
| Primary Audience | S1 – Basics | narrative.persona \+ narrative.business\_problem | string, drives demo tone |
| Account Name | S1 – Basics | demo\_title (suffix) | string, appended to title |
| Urgency | S1 – Basics | (scheduling metadata only) | not in YAML — used for planning |
| Customer Pain Point | S2 – Story | narrative.business\_problem | string, multi-line |
| Walk Away Believing | S2 – Story | narrative.wow\_moment | string |
| Competitor / Alternative | S2 – Story | narrative.talking\_points\[\] | appended as a talking point |
| Main Use Case / Scenario | S3 – Content | narrative.solution\_summary | string |
| Features: Delta Lake | S3 – Content | databricks\_features\_required.Delta Lake | boolean |
| Features: Delta Live Tables | S3 – Content | databricks\_features\_required.Delta Live Tables | boolean |
| Features: Unity Catalog | S3 – Content | databricks\_features\_required.Unity Catalog | boolean |
| Features: Databricks SQL | S3 – Content | databricks\_features\_required.Lakeview Dashboards | boolean |
| Features: MLflow | S3 – Content | ml.framework \+ ml.experiment\_name | enables ml section |
| Features: Model Registry | S3 – Content | ml.model\_name \+ ml.registered\_model\_alias | enables ml registry |
| Features: Model Serving | S3 – Content | ml.serving\_endpoint.enabled | boolean |
| Features: Feature Store | S3 – Content | ml.feature\_store.enabled | boolean |
| Features: AutoML | S3 – Content | ml.framework \= "automl" | string enum |
| Features: Mosaic AI / LLMs | S3 – Content | ml.framework \= "langchain" | "huggingface" | string enum |
| Features: Vector Search | S3 – Content | databricks\_features\_required.Vector Search | boolean |
| Features: Streaming | S3 – Content | notebooks\[\].purpose (streaming tag) | adds streaming notebook |
| Features: Serverless | S3 – Content | databricks\_features\_required.Serverless Compute | boolean |
| Features: Workflows/Jobs | S3 – Content | jobs\[\].name | adds job definition |
| Features: Genie (AI/BI) | S3 – Content | databricks\_features\_required.Genie | boolean |
| Features: Databricks Apps | S3 – Content | databricks\_features\_required.Databricks Apps | boolean |
| Data Source Type | S3 – Content | datasets\[\].source\_type | synthetic|csv|parquet|delta|api |
| Industry / Data Domain | S3 – Content | datasets\[\].description | string |
| Must-Have Metrics / KPIs | S3 – Content | outputs\[\].description \+ datasets\[\].schema\[\] | drives schema definition |
| Delivery Format | S4 – Look & Feel | narrative.talking\_points\[\] (delivery tag) | metadata for engineer |
| Demo Length | S4 – Look & Feel | estimated\_runtime\_minutes | integer: 10|20|45|60 |
| Tone / Style | S4 – Look & Feel | narrative.talking\_points\[\] (tone tag) | metadata for engineer |
| Branding / Naming | S4 – Look & Feel | demo\_title \+ widget\_defaults\[\] | overrides display names |
| Topics to Avoid | S5 – Constraints | narrative.talking\_points\[\] (avoid tag) | engineer guardrails |
| Existing Demo to Extend | S5 – Constraints | demo\_name (fork reference) | string or "new" |
| Workspace URL | S5 – Constraints | environment\_variables.WORKSPACE\_URL | string URL |
| Cloud Provider | S5 – Constraints | cloud | aws | azure | gcp |
| Additional Context | S5 – Constraints | narrative.talking\_points\[\] (notes tag) | freeform |
| Submitted By | S6 – Sign-off | owner\_email | string |
| Date Submitted | S6 – Sign-off | last\_updated | YYYY-MM-DD |
| Assigned Engineer | S6 – Sign-off | (assignment metadata) | not in YAML |
| Engineer Notes | S6 – Sign-off | (scoping notes) | not in YAML — pre-build only |

*Fields marked "(scheduling only — not in YAML)" are used by the engineering team for planning but do not appear in the generated YAML spec. All other fields map 1-to-1 or contribute to a YAML array/object as noted.*