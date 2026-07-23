---
name: Information Extraction
category: agent-bricks
disabled: true
buildable: true
---

# Information Extraction

**Document-to-table agent** that transforms unstructured documents (PDFs, images, text) into structured data using a visual UI and `ai_extract` SQL function.

## Pain

Extracting data from contracts, invoices, reports means regex nightmares, custom NLP pipelines, or manual entry. Every new document type requires new code. Compliance teams drown in unstructured data they can't analyze.

## Key Features

- **Visual schema builder** — define fields with natural language, no regex or ML training
- **Auto-schema generation** — describe what you want, get a JSON schema
- **Iterative refinement** — review extractions, add feedback, improve accuracy
- **SQL deployment** — run via `ai_extract()` or scheduled Spark pipelines
- **HIPAA compliant** — safe for healthcare documents

## Position

Any "we have thousands of documents to process" conversation. Contracts, invoices, medical records, compliance reports. "Show the agent what you want, it extracts at scale."

## How It Works

- **Point at documents**: Select files from UC volumes or tables (PDFs, images, text)
- **Define schema**: Describe fields in natural language or provide sample JSON — agent generates extraction schema
- **Review and refine**: See sample extractions, add field-specific guidelines (date formats, units, edge cases)
- **Deploy with one click**: Pre-built SQL queries or scheduled pipelines for new documents
- **Optional fine-tuning**: Evaluate on up to 100 samples; Databricks optimizes the extraction model for accuracy and cost

## Demo Tips

- Perfect for document-heavy industries: FSI (contracts, loan docs), Healthcare (medical records), Insurance (claims)
- Show the visual UI: "no regex, no ML training — just show it what you want"
- Speed: "documents to structured table in 5 minutes"
- Position alongside Knowledge Assistant: KA answers questions, Information Extraction turns documents into data
- Compliance: "every contract in a queryable table"

## URL

https://docs.databricks.com/aws/en/generative-ai/agent-bricks/info-extraction
