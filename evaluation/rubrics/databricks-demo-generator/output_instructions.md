# Databricks demo-generator output rubric

Judge output and filesystem artifacts together. Require:

- The requested business protagonist, catalyst, measurable value, and Databricks capabilities appear in one coherent walkthrough.
- `resources.json`, `README.md`, `architecture.md`, and specifications agree on names, schemas, capabilities, and dependencies.
- Every required artifact for the case exists and is substantive; placeholders and dead resource IDs fail.
- Functional specifications describe outcomes and contracts, while build artifacts contain the implementation.
- Selected capabilities are neither omitted nor added as disconnected ornamentation.
- Live resources use the supplied evaluation prefix and record enough identity for deterministic cleanup.

Custom or qualitative judgments are diagnostic. Deterministic facts, patterns, assertions, trace expectations, and verification commands carry the hard requirements.

## Dimension checklist

1. `README.md` names a protagonist, challenge, catalyst, and resolution.
2. The story includes a measurable business value statement.
3. The requested industry and sub-vertical remain recognizable.
4. Every requested capability appears in the walkthrough.
5. Unrequested capabilities do not distract from the main question.
6. `resources.json.capabilities` agrees with the story and specifications.
7. `created_resources` starts empty before a live build.
8. Created IDs are syntactically plausible and not placeholder text.
9. `architecture.md` uses the renderer's required JSON schema.
10. Architecture edges represent real data or control dependencies.
11. Architecture nodes cover all buildable capabilities.
12. Lakeflow specifications define sources, targets, grain, and quality rules.
13. Governance specifications name securable objects and access boundaries.
14. ML specifications define labels, features, temporal splits, and metrics.
15. Dashboard specifications define business measures and visible insights.
16. Genie specifications define tables, joins, measures, and example questions.
17. Knowledge Assistant specifications define a real source corpus.
18. Supervisor specifications define routable agents and decision rules.
19. App specifications define pages, data contracts, and agent interactions.
20. Shared identifiers use the same names and types across component specs.
21. Build artifacts are present for each implementation requirement.
22. SQL and Python are executable rather than illustrative pseudocode.
23. Generated configs reference the approved catalog and schema.
24. Resource manifests record endpoints and experiment paths when required.
25. App artifacts follow the shipped template's stack and structural contracts.
26. No output claims a deployment that the trace or manifest cannot substantiate.
27. Errors preserve partial resource identity for cleanup.
28. Live catalogs and schemas start with the required evaluation prefix.
29. Live opaque IDs have corresponding tracked creation evidence.
30. WITH and WITHOUT outputs are both available for comparison.
31. The report exposes gaps without turning advisory scores into merge gates.
32. The cumulative shared-cwd output remains coherent after the final case.
