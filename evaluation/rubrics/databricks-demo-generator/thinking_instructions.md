# Databricks demo-generator reasoning rubric

Evaluate the reasoning process, not verbosity. A strong run:

1. Reads the platform architecture and only the domain/capability references needed for the request.
2. Preserves the staged workflow and does not skip user gates unless the prompt explicitly authorizes continuation.
3. Treats story, data, specifications, and resources as one coherence contract; downstream decisions cite upstream facts.
4. Distinguishes proposed resources from resources actually created. It never invents IDs or pre-seeds `created_resources`.
5. For live evaluation, discovers and obeys `SB_EVAL_*` namespace variables and does not mutate resources outside them.
6. Uses the project filesystem as durable state between ordered cases without assuming conversation history persists.

Diagnostic findings should identify the earliest step that caused a downstream failure so shared-cwd cascades are not double-counted.

## Dimension checklist

1. Intent capture identifies whether the request is vague, moderate, or detailed.
2. Explicitly requested capabilities are preserved rather than replaced by defaults.
3. Platform dependencies are checked before a story commits to components.
4. Reference reads are targeted and relevant to the active stage.
5. The business protagonist has a role that can act on the demo insight.
6. The catalyst is observable in the proposed synthetic data.
7. Business value is quantified in dollars, time, risk, or another decision metric.
8. The wow moment follows from the data rather than appearing as unsupported narration.
9. Each selected product has a distinct walkthrough moment.
10. No component is included only as architectural ornament.
11. Architecture dependencies flow from sources through processing to consumption.
12. Governance and identity boundaries are considered where the scenario needs them.
13. Specifications inherit exact entity names and keys from the approved story.
14. Temporal fields and model cutoffs avoid future-data leakage.
15. Synthetic data supports every dashboard, query, model, and agent claim.
16. Dashboard metrics can visibly prove the promised business moment.
17. Genie questions are answerable from the specified tables and measures.
18. Agent routing criteria are explicit and non-overlapping.
19. App interactions call resources that the specifications actually define.
20. Build order respects sequential data prerequisites.
21. Independent post-pipeline work is identified for safe parallel execution.
22. Created resource IDs are recorded only after creation and validation.
23. Failed or skipped resources are explained without fabricated identifiers.
24. Filesystem state is inspected before each ordered prompt is answered.
25. The run does not assume prior conversation state across SkillForge cases.
26. Existing artifacts are updated consistently instead of recreated blindly.
27. Live evaluation variables are discovered before any mutation.
28. Every live name remains within the supplied catalog, schema, and prefix.
29. Cleanup identity is retained in `resources.json` even when deployment fails later.
30. Reasoning distinguishes diagnostic recommendations from hard acceptance requirements.
31. A downstream failure is traced to its earliest causal artifact.
32. The final reasoning checks coherence across all generated deliverables.
