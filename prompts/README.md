# Prompt Assets

The assessment asks for code and prompts. These prompt contracts are checked in as a deliberate downstream boundary, but the runnable MVP does **not** call an external language model.

| Prompt | Purpose | Verdict authority |
|---|---|---|
| [`explain-finding.md`](explain-finding.md) | Explain one completed finding in plain language | None |
| [`summarize-run.md`](summarize-run.md) | Summarize a completed review without hiding uncertainty | None |

The deterministic Python rules create the complete `Finding` and `ReviewRun` first. Any future provider adapter must receive only those validated objects, enforce the output schema, and fall back to the checked-in deterministic explanation if generation fails.

## Non-negotiable guardrails

- A prompt cannot assign or change `PASS`, `FAIL`, or `REVIEW`.
- It cannot infer a missing property or measurement.
- It cannot introduce a standard, clause, exception, or threshold absent from rule evidence.
- It cannot describe a demo project rule as statutory compliance.
- Generated text is optional presentation; structured evidence remains the source of truth.
