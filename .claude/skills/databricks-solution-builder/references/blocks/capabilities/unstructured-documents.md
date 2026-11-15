---
name: Unstructured documents (PDF)
category: agent-bricks
disabled: false
buildable: true
skill: databricks-genie-agents
genie_code_workshop: false
requires: [genie]
---

# Unstructured documents (PDF)

Policies, procedures, manuals, incident reports, and other PDFs that the demo's Genie agent answers from, alongside the structured data it already queries. The documents live in a Unity Catalog volume attached to the Genie agent; the agent reads them through content search and cites the file it used.

This is the document path for every demo. There is no separate document agent to route to: one Genie agent answers numbers from tables and policy or incident questions from documents, in the same turn.

## When to Use

- The story needs the **why** or the **rule** behind a number: the refund policy behind a refund total, the root-cause report behind an anomaly, the SOP behind an alert.
- The audience will ask "what does our policy say about X?" and the answer must come from a real document, with a citation.
- Qualitative context (expert analysis, regulatory text, inspection findings) that cannot live in a SQL table.

Skip it when the story is purely quantitative. Genie alone is enough.

## Key Decisions

1. **Dedicated volume.** Put the PDFs in their own **MANAGED** volume that holds only documents (for example `<catalog>.<schema>.<demo>_documents`). The whole volume is indexed, so one stray file (an eval-questions JSON, a CSV export) gets indexed too. External volumes are not indexed.
2. **Corpus size.** 5–15 focused documents of mixed types (policy, SOP, incident or audit report, guideline). Every document should serve a question the demo asks. Generic filler dilutes retrieval.
3. **Content carries the facts the questions ask.** Each question in the demo flow must be answerable from a document. Write the specific rule, threshold, date, or root cause into the text. Include one document with the "smoking gun" finding the story hinges on, stated plainly enough that a straightforward question surfaces it.
4. **Identifiers match the data.** Document IDs, merchant or patient or asset IDs, dates, and amounts must be the exact values in the tables. A mismatch (`M-847291` vs `MERCH-847291`) breaks the investigation feel.
5. **Volume description and routing instruction.** The Genie agent decides what to read from these hints, so write them as product copy:
   - Volume `description`: what is in the documents, when to use them, and to cite the file by name.
   - A text instruction on the agent: numbers, counts, and totals come from the tables; policy, procedure, and incident questions come from the documents.
6. **Wait for indexing before the first question.** Content search builds an index after the volume is attached. Asking before it finishes returns an error, not an answer. The build waits until the index reports ready.
7. **Agent mode only.** Documents are read only when the demo asks the Genie agent in agent mode. Chat-style Genie conversations do not read volumes, so a demo built on chat mode will say the documents are not there.

## How to build it (authoritative for documents)

The `databricks-genie-agents` Databricks Agent Skill (DAS) is the reference for everything else about the Genie agent: tables, instructions, sample questions, `create-space` / `update-space`, and the Agent-mode query loop (`query-genie-agent.md` § Agent Mode API). It does **not** document attaching a documents volume. **This section is the reference for that part; follow it even if the DAS shows a `serialized_space` with tables only.** The working implementation of every step is `DEMO_SKILL_DIR/references/dab/scripts/deploy_genie.py`; copy from it rather than re-deriving.

1. **Volume + files (Build step 01).** Create a dedicated **MANAGED** volume, suffixed like every resource: `<catalog>.<schema>.<demo>_documents_<suffix>`. Upload only the PDFs (no README, no JSON, no hidden files). Count the files you uploaded: you need that number in step 4.
2. **Attach it in `serialized_space`.** Add a `volumes` list next to `tables` in `data_sources`. `description` is a **list of strings**:
   ```json
   "data_sources": {
     "tables": [ ... ],
     "volumes": [
       {
         "path": "/Volumes/<catalog>/<schema>/<volume>",
         "description": ["What the documents are (policies, SOPs, incident reports…). Use them for WHY / WHAT-DOES-THE-POLICY-SAY questions, not for numbers. Cite the file you used by name. Key document: <the smoking-gun file>."]
       }
     ]
   }
   ```
   Add one text instruction that routes the two kinds of questions: numbers, counts, and totals come from the tables; policy, procedure, and incident questions come from the documents, citing the file.
3. **Content search turns on by itself.** `create-space` or an `update-space` that **adds** the volume enables content search (parse + index). There is no separate enable call. An update that does not add the volume (it is already in the saved space) does nothing: if a first attach failed, remove `volumes` with one `update-space`, then add it back with a second one. `VOLUME_INDEX_FEATURE_PREVIEW_NOT_ENABLED` means the workspace preview is off: stop and tell the user; it cannot be fixed from the build.
4. **Wait for the index before any document question.** Get the volume id (`databricks volumes read <catalog>.<schema>.<volume> -o json | jq -r .volume_id`), then poll `databricks api get /api/2.0/volume-indexes/<volume_id>` every ~30 s:
   - `NOT_FOUND` for the first minutes after attaching is normal. Past ~5 minutes, the volume is not attached to the agent.
   - `PENDING` / `RUNNING`: keep waiting (a 10-file corpus usually takes a few minutes).
   - `SUCCEEDED` **and** `file_state_counts.success_files` ≥ the number of files you uploaded: done. (The counts are JSON strings, e.g. `"success_files": "12"`; compare them as numbers. `failed_files` / `skipped_files` > 0 means a file is unreadable or too large: fix or drop it.)
   - `SUCCEEDED` with fewer files that never grows: the index is stale (left by an earlier attach) and will not refresh. Create a fresh volume, upload again, point the agent at it.
   - Any other state: failure. Report its `error` field.
5. **Grants.** Whoever asks the agent (the app service principal, demo users) needs `READ VOLUME` on the volume and `CAN RUN` on the Genie agent, in addition to `SELECT` on the tables.
6. **Smoke-test in Agent mode.** Ask one numbers question and one document question with the DAS Agent-mode loop (`POST /api/2.0/genie/agents/<space_id>/responses`). The document answer must quote the document and name the file. `databricks genie start-conversation` / `genie ask` use chat mode, which never reads volumes: a "no documents" answer there is expected and proves nothing.
7. **Record it.** `resources.json` → `created_resources.documents_volume` = `/Volumes/<catalog>/<schema>/<volume>` (only after step 4 passes).

## Limits to respect

- PDF, DOC/DOCX, PPT/PPTX, MD, TXT, and JPG/PNG/TIFF are read. Keep demo documents as PDF or DOCX.
- Up to 10 volumes per agent. Up to 10,000 files per volume.
- Files over 100 MB or 500 pages are skipped.

## Pitfalls

- Documents that could describe any company. Name the demo's own entities, sites, products, and dates.
- The smoking-gun finding buried on page 9 of a 12-page report. Put it in the opening section.
- Undated documents. Include an effective date or revision so the agent can answer "as of when?".
- Volume shared with other files. The index covers everything in it.
- Asking the agent before the index is `SUCCEEDED`. The first question fails with a content-search error, which looks like a broken demo.

## Connections

- **Genie** (required): the Genie agent is the only consumer. Attach the documents volume to the same agent that holds the demo's tables. Genie's own block covers the tables.
- **Synthetic data gen**: the documents are generated alongside the data. Their IDs, dates, and amounts must match the generated tables.
- **Dashboards**: a dashboard KPI that raises a "why" question is answered by the Genie agent's document citation.
- **App**: an app that offers an assistant calls the same Genie agent in agent mode (see the `databricks-apps` block for the app side).

## URL

https://docs.databricks.com/aws/en/genie/
