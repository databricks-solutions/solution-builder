# Calder Pine Private Wealth — Advisor Morning Book

**Industry:** Financial Services (wealth management)
**Customer:** Calder Pine Private Wealth, a *fictional* US wealth manager: 36 advisors in 6 offices, ~5,400 client households, $7.6B AUM.

## The story

The Fed cut rates three times this summer (Fed funds 4.50% → 3.75%, June / July / September 2026). Every cut put
client money in motion:

| Signal (planted in the data) | What happened | Firm-wide |
|---|---|---|
| **CD maturities** | 12-month CDs bought at 5%+ in 2025 now renew at **3.55%** | $119M maturing in the next 60 days |
| **Idle sweep cash** | Sweep pays **0.25%**; the fictional online bank *Brightline Direct* advertises **4.00%** | sweep cash doubled from **$326M → $650M** since May |
| **Refi window** | 2023-vintage mortgages at 7%+ vs **5.90%** today | $378M of mortgages ≥ 0.75 pt above market |
| **Life events** | deaths, inheritances, retirements, business sales, job changes (held-away 401(k)s) | $920M of investable money in motion in total |
| **AUM at risk** | after a death or an inheritance, households the advisor called within 30 days kept **99.0%** of their assets; households nobody called kept **75.7%** ($18.5M walked out) | `gold_life_event_retention` |

Three more findings drive the demo:
- **Targeted beats generic:** signal-triggered next-best actions convert at **30.2%** vs **7.4%** for the default annual
  review (41.7% when the advisor acts within 14 days).
- **Propensity ≠ suitability:** advisors sold buffered structured notes to clients who had just inherited money, and
  those offers "converted", so the propensity model ranks them high. **121 of the 148 complaints** (82%) of the last
  18 months came from complex products that fail today's suitability rules. The model's #1 pick fails suitability
  for 23.5% of households with a signal.
- **The aha: Margaret Castellano (HH-10042)**, 67, widowed May 22, has $812K sitting in sweep, a $260K CD at 5.10%
  maturing Oct 9, and a $150K transfer to Brightline Direct in August. On Sep 15 she called and asked about moving
  money to Brightline "where her son banks"; AI Functions flag that CRM note as a flight risk. Nobody has called her in 110 days.
  The model's top action for her is a **structured note**, which is **blocked** on S1 (risk), S3 (liquidity),
  S4 (experience) and S5 (vulnerable client). The copilot builds the suitable meeting instead.

**Personas**
- **Elena Marsh**: Senior Wealth Advisor, CFP, Denver (advisor `ADV-007`). She is the app user.
- **Head of the wealth desk**: uses the dashboard + Genie (money in motion, AUM at risk, conversion, complaints).
- **Compliance**: the suitability rules S1–S7 and the policy library (Genie agent) are theirs.

## Demo script (≈12 minutes): what the deployed app actually does

1. **Morning book** (`/`). Headline: *"Good morning, Elena. $28M of your clients' money is in motion, and $7.44M could
   walk."* Tiles: **69** households with a signal ($118M AUM), **25** to act on within 14 days, **$7.44M** AUM at risk
   (11 households), **17** where the model's #1 pick is blocked. The *Call first today* table ranks the book: #1
   Margaret Castellano ($2.86M in motion, $1.43M at risk). Her model pick, *Structured note*, is struck through with a
   **Blocked** badge, and her best suitable action is *CD / Treasury ladder*.
2. **Ask the copilot.** Click the starter **"Who should I call first this morning, and why?"**. The dock agent calls
   `get_morning_book` (Lakebase) and answers *"Call Margaret Castellano first: $2.86M in motion, $1.43M at risk…"*,
   listing the bereavement, inheritance, external outflow, CD maturity and idle cash. It adds that the model's top idea
   (structured note) is FAIL and the best suitable step is the CD ladder. Follow with the suggested chip **"Can I pitch
   the note?"**, which calls `get_client_brief`: *"No, it fails S1 risk, S3 liquidity, S4 experience and S5 vulnerable client;
   instead: government money market for the $812K sweep, CD/Treasury ladder for the $260K CD maturing 10/9, estate review;
   managed portfolio only as REVIEW after a planning meeting."* (Wording varies by run; the facts come from the tools.)
3. **Margaret's page**: click **Start with #1: Margaret Castellano** (`/clients/HH-10042`). Badges: Moderately
   Conservative (2/5), 12-yr horizon, liquidity Medium, experience Moderate, **Recent bereavement (spouse, May 2026)**,
   trusted contact on file. Tiles: AUM $3.58M, sweep $812K, in motion $2.86M, at risk $1.43M, last contact **110 days**.
   Point at the **CRM note** of Sep 15 and its AI Functions chips (*amount: $750K · family: Daniel · other firm:
   Brightline Direct*). In **Next best actions**, click the **Structured note** row (propensity 43%, $2,284/yr expected
   revenue, **Blocked S1,S3,S4,S5**) to expand the rule-by-rule findings with citations. The CD ladder (55%) and the govt
   money market (60%) are Suitable, and the managed portfolio is Review.
4. Click **Prep meeting** and narrate the streamed steps (~30 s): *Read 5 signals, 5 accounts, 4 CRM notes (flight-risk
   mention: Brightline Direct) → Scored 7 candidate actions (1. STRUCTURED-NOTE p=0.43…) → Suitability: 4 pass · 1 review
   · 2 blocked → Policy guidance retrieved → Meeting brief + outreach drafted*. The page scrolls to the brief:
   - **Model's #1 pick blocked: Structured note**, with the four failed rules.
   - **Agenda (suitable actions only):** 1. Estate & beneficiary review ($3.58M), 2. CD / Treasury ladder ($471K),
     3. Govt money market ($211K). *Not on this agenda:* managed portfolio (S5: only after a planning meeting +
     supervisor pre-approval), structured note and private credit (blocked).
   - **Policy library (Genie agent):** *"No, you cannot recommend a buffered structured note to this client…
     complex products are prohibited for 12 months after a bereavement…"*, with first-meeting agenda and outreach rules,
     citing `cpw_02_vulnerable_clients.md` and `cpw_01_best_interest_suitability.md`.
   - **Required disclosures** D-CRS, D-CD, D-TSY, D-MMF; a **call opener** (channel: *personal call, then email*); and
     an empathetic, product-free email ending with the required footer.
5. Edit a line of the email, type a note (*Thursday 10am at the Denver office, Daniel joining*), choose *Estate &
   beneficiary review* and click **Meeting booked**: *"Decision logged: Meeting booked, Estate & beneficiary review, written to
   Lakebase and Delta (advisor_decisions) for the wealth-desk dashboard."* The audit trail shows the AI prep and the
   human decision; the Morning book's *Recent activity* shows both.
6. **Loans angle: Raj & Priya Mehta.** **My book** → filter **Lending** → **Raj Mehta** (`/clients/HH-10077`): a
   $780K mortgage at **7.25%** with Summit Home Loans, a lake house needing **$400K** by mid-November, and ARXT (employer stock) at
   **38%** of the portfolio. **Prep meeting** → agenda: *Mortgage refinance* (saves **~$695/month**, break-even ~23
   months, from the lending playbook), *Direct indexing* for ARXT, and *Securities-based credit line* (**Review**: S6
   concentration → 50% advance rate, supervisor review). Click **Send email & log proposal**.
7. **Desk insights** (`/insights`): opportunities by signal, conversion by response speed (41.7% < 14 days … 7.4%
   generic), retention after a death/inheritance (99% vs 75.7%), and sweep cash vs outflows.
8. **Wealth-desk dashboard** (`/dashboard`, embedded AI/BI): *Money in motion* page (KPIs $920M in motion, $119M CDs
   maturing, $167M AUM at risk, $378M refi window, 30.2% vs 7.4% conversion; sweep cash trend; rates; AUM at risk by
   advisor; top 25 households) and *Next best action & suitability* page (conversion by approach, retention, complaints by
   suitability, today's scored actions by status, **Desk activity**, where the two decisions you just logged appear on top as
   *Morning Book (live)*).
9. Optional chat chips: **"Money in motion firm-wide"** → Genie: **$920.1M** (idle cash $246.3M, held-away 401(k) $172.5M,
   CD maturity $119.0M…; refi $377.9M and concentrated positions $152.6M reported separately). **"Does calling fast
   matter?"** → **99.0% vs 75.7%**. The home-page card *Why the model never gets the last word* → **148 complaints, 121 from
   offers that fail today's rules**.
10. Close with **Reset the demo** (header). It clears preps, decisions, chat history and the Delta `advisor_decisions`
    table and re-syncs the book from Delta.

### Genie space: *Calder Pine - Wealth Desk* (answers verified via the conversation API)
- *How much client money is in motion across the firm, by signal type?* → **$920.2M** (idle cash $246.3M, held-away 401(k) $172.5M, CD maturity $119.0M, business sale $111.7M, inheritance $89.7M …)
- *After a death or an inheritance, what share of their assets did households keep when the advisor called within 30 days vs when nobody called?* → **99.0%** (71 events, $0.5M out) vs **75.7%** (79 events, $18.5M out)
- *What is the conversion rate of targeted next-best actions vs generic annual reviews?* → **30.2%** (15,809 offers) vs **7.4%** (12,949)
- *Which advisors have the most AUM at risk?* → Anthony Rizzo (Boston) $16.1M, Dominic Shaw (Austin) $14.3M, Yuki Tanaka (New York) $11.6M …
- *How many complaints did we receive in the last 18 months, and how many came from complex products that would fail today's suitability rules?* → **148**, of which **121 (81.8%)**
- *How has sweep cash changed since the rate cuts?* → $403.8M (Jun) → **$650.3M** (Sep 2026), up from ~$326M a year ago

Talking points: the model predicts *acceptance*, the rules decide *suitability*, and the two are never mixed; the
agenda is deterministic, and the LLM only explains and writes; every policy statement is grounded in the Knowledge
Assistant; every AI output is a draft the advisor approves; decisions land in Lakebase (app) and Delta (analytics) with
an audit trail; everything is governed in Unity Catalog, including the model.

## What's built

| Layer | Asset |
|---|---|
| Data | `data_generation/generate_data.py`: 5,400 households, 24K accounts (CDs with maturities, sweep, held-away 401(k)s), 2K mortgages, 1.5K life events, 12 months of flows (64.8K rows), 31K CRM notes, 12-month rates, 12-action NBA catalog, 7 suitability rules, 28.8K historical offers; gold `gold_household_signals`, `gold_flows_monthly`, `gold_nba_conversion`, `gold_life_event_retention`; PK/FK (RELY) |
| AI Functions | `src/ai/note_insights.sql`: `ai_classify` (life-event / intent category), `ai_extract` (amount, timeframe, family member, other institution), `ai_analyze_sentiment` over the last 60 days of CRM notes → `note_insights` (flight-risk flag) |
| ML | `src/ml/train_nba_model.py`: XGBoost propensity on 18 months of offers (holdout AUC 0.74, top-decile lift 2.5×) → `<catalog>.<schema>.nba_propensity_model@champion`; scores every (household, action), applies suitability rules S1–S7 → `nba_recommendations`, ranks each book → `household_opportunities` |
| Documents | `src/policy_docs/*.md` (Best Interest & Suitability, Vulnerable Client & Bereavement, Product Disclosures, Client Communications, Lending & Rollover playbooks) in the `policy_docs` volume, searched by the Genie agent (Agent mode) |
| App | `app/`: AppKit (Node/React) *Advisor Morning Book* on Lakebase: ranked book, client page (signals, AI-read notes, NBA × suitability), streamed **meeting prep** (`server/services/prep.ts`), outreach editor, decision write-back to Lakebase + Delta, chat agent (`server/agent/advisor.ts`, OpenAI Agents SDK on `databricks-gpt-5-4`: `ask_data` (Genie agent: desk analytics + policy library), `get_morning_book`, `get_client_brief`), desk insights, embedded dashboard, MLflow tracing |
| BI | `dashboard/wealth_desk.lvdash.json` (schema-less datasets, 2 pages, 19 widgets) · `genie/genie_space.json` (serialized v2, 18 tables, instructions, 6 example SQLs) |
| Deploy | `databricks.yml` (Lakebase database, dashboard, app + agent-traces experiment, setup job) · `dab_instructions.md`: `databricks bundle deploy` → `bundle run wealth_advisor_setup` → `bundle run wealth_advisor_app` |

Data lives in `financial_services.wealth_advisor_nba`.
