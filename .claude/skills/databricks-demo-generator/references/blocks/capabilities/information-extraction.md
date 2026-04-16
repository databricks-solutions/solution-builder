---
name: Information Extraction
category: agent-bricks
disabled: true
buildable: true
---

# Information Extraction

**Document-to-table agent** that transforms unstructured documents (PDFs, images, text) into structured data using a visual UI and `ai_extract` SQL function.

## Pain

Extracting data from contracts, invoices, and reports means regex nightmares, custom NLP pipelines, or manual data entry. Every new document type requires new code. Compliance teams drown in unstructured data they can't analyze.

## Key Features

- **Visual schema builder** - define fields with natural language, no regex or ML training
- **Auto-schema generation** - describe what you want, get a JSON schema
- **Iterative refinement** - review extractions, add feedback, improve accuracy
- **SQL deployment** - run via `ai_extract()` or scheduled Spark pipelines
- **HIPAA compliant** - safe for healthcare documents

## Position

Any "we have thousands of documents to process" conversation. Contracts, invoices, medical records, compliance reports. "Show the agent what you want, and it extracts at scale."

## How It Works

- **Point at your documents**: Select files from Unity Catalog volumes or tables (PDFs, images, text)
- **Define the schema**: Describe fields in natural language or provide a sample JSON — the agent generates the extraction schema
- **Review and refine**: See sample extractions, add field-specific guidelines (date formats, units, edge cases)
- **Deploy with one click**: Get pre-built SQL queries or schedule automated pipelines for new documents
- **Optional fine-tuning**: Evaluate on up to 100 samples, Databricks can optimize the extraction model for better accuracy and lower cost

## Demo Tips

- Perfect for document-heavy industries: FSI (contracts, loan docs), Healthcare (medical records), Insurance (claims)
- Show the visual UI: "no regex, no ML training — just show it what you want"
- Emphasize speed: "from documents to structured table in 5 minutes"
- Position alongside Knowledge Assistant: KA answers questions, Information Extraction turns documents into data
- Great for compliance: "every contract in a queryable table"

## URL

https://docs.databricks.com/aws/en/generative-ai/agent-bricks/info-extraction
