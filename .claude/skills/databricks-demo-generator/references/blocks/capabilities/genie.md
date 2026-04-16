---
name: Genie
category: ai-bi
disabled: false
buildable: true
---

# AI/BI Genie

**GenAI BI analyst**: business users ask questions in natural language, Genie answers from governed data and metrics.

## Pain

A VP's "simple question" ("Which segment is driving this spike?") triggers tickets → backlog → weeks of delay → opportunity lost. Analysts become helpdesk. Backlog of tiny asks never gets done. Business users stop asking and steer by gut.

## Key Features

- **Natural language queries** - no SQL required
- **Governed answers** - uses UC metrics and definitions
- **Visualizations** - auto-generates charts and tables
- **Conversation memory** - follow-up questions in context
- **Trusted data** - cites sources, shows SQL generated

## Position

*"Today, to get this view you'd open a ticket and wait weeks. With Genie, you type the question and get an answer in seconds."* FSI: RMs exploring client portfolios, risk exposures live.

## Demo Tips

- **The star of Act 2** - this is where live interaction happens
- Prepare 3-5 sample questions that drive the narrative:
  1. A baseline question ("What was revenue last month?")
  2. The anomaly question ("Why did returns spike?")
  3. A drill-down question ("Which products are affected?")
  4. The root cause hint ("What do these products have in common?")
- Write clear **Genie instructions** that include domain knowledge (baselines, thresholds)
- Genie finds the WHAT (data shows the problem) - Knowledge Assistant reveals the WHY (documents explain cause)
- Let the audience suggest follow-up questions for wow factor
- Show that Genie cites sources and can show the SQL it generated (trust)

## How It Works

- **Compound AI system**: Uses multiple specialized models — one for SQL generation, one for visualization, one for clarification questions
- **Text-to-SQL**: Converts natural language to SQL, executes it, returns results as tables/charts
- **Uses UC metadata**: Table names, column descriptions, PK/FK relationships help Genie understand your data model
- **Instructions guide behavior**: Domain knowledge ("baseline is $1M/day", "spike means >20% increase") improves accuracy
- **Learning from feedback**: Thumbs up/down and edited queries teach Genie over time
- **Shows its work**: Every answer includes the SQL generated — users can verify and trust

## Configuration

A well-configured Genie Space includes:
- **Instructions** - domain context, what's normal vs abnormal, business rules
- **Sample questions** - pre-loaded questions for the demo narrative
- **Connected tables** - gold layer tables with clean, meaningful data

## URL

https://www.databricks.com/product/business-intelligence/genie
