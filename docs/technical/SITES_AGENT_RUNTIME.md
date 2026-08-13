# Site-native bounded Agent Runtime

| Field | Value |
|---|---|
| Verification date | 2026-08-09 |
| Deployment runtime | vinext on Cloudflare Workerd |
| Agent contract | `AgentRun/v1` |
| Agent definition | `bim-review-manager` 1.1.0 |
| Default Provider | `scripted` / `deterministic-site-script-v1` |
| External inference | Disabled and not required |
| Result | Phase 2 bounded Agent exit gate passed locally |

## What is implemented

The GPT Sites application now owns a real typed Agent loop instead of invoking
the deterministic reviewer directly and presenting it as an Agent. The default
full-review trajectory is:

```text
validated in-memory IFC upload
  → AgentRun starts with fixed budgets
  → discover three healthy Site-resident tools
  → inspect_ifc_model
  → schema-valid inventory observation
  → run_deterministic_review
  → exactly one canonical ReviewRun
  → critique_review_evidence
  → bounded evidence-completeness observation
  → final response linked to that exact ReviewRun
```

The inspection result determines the next action. An explicit inventory-only
objective stops honestly after inspection. An objective outside the supported
IFC door-information and egress scope returns `unsupported_scope` after bounded
inspection and creates no verdict. The default review objective performs all
three tool calls and completes in four Provider steps.

## Runtime components

- `src/contracts/agent.ts` mirrors the frozen public `AgentRun/v1` fields,
  states, events, stop reasons, actions, tool descriptors, and budgets.
- `src/runtime/agent/actions.ts` rejects malformed, oversized, cyclic,
  non-JSON, or extra-field Provider actions.
- `src/runtime/agent/registry.ts` owns the allowlisted tool catalogue, input
  and output validation, safe public observations, effects, and canonical-run
  provenance.
- `src/runtime/agent/kernel.ts` executes the bounded
  Provider → action → tool → observation loop and converts every terminal path
  into a typed `AgentRun`.
- `src/runtime/agent/provider.ts` supplies the offline observation-dependent
  scripted policy. It receives structured observations, never raw IFC bytes.
- `src/runtime/agent/tools.ts` implements IFC inspection, deterministic review,
  and evidence critique over one request-scoped context.
- `src/runtime/agent/bim-review.ts` binds the definition, Provider, connector,
  tools, and in-memory IFC context into one Site profile.

The generic kernel contains the typed delegation boundary and validates
specialist result identity, but the hosted MVP definition has a zero-delegation
budget and no scheduler. Multi-Agent topology is not needed to prove the
domain-bounded runtime and cannot be activated by a user objective.

## Canonical verdict boundary

Only `run_deterministic_review` is registered as a canonical-review-producing
tool. The kernel records the ID returned by its schema-valid output and applies
all of these checks:

1. at most one canonical review tool may execute in an Agent run;
2. a final response cannot invent a ReviewRun ID;
3. after a canonical review exists, the final response must link that exact ID;
4. without a canonical review, the final response must have a null link; and
5. evidence critique and Agent prose receive read-only structured data and
   cannot mutate the retained `ReviewRun`.

If critique or Provider execution fails after deterministic review completes,
the API may still return the canonical `ReviewRun` beside a failed `AgentRun`;
it never relabels the Agent as successful or discards the deterministic result.

## Privacy and trace boundary

The IFC byte array remains only in the request-scoped tool context. Provider
requests contain the objective, tool schemas, and bounded observations. Public
events contain tool identity and a deliberately bounded observation projection.
They do not contain:

- raw STEP text or IFC bytes;
- full source-file hashes;
- source filenames;
- unrestricted property dumps;
- credentials or environment values; or
- private reasoning or hidden Provider state.

The default Provider makes zero network or paid inference calls. The public
capability route reports this explicitly and reports local hardware discovery
as deferred, rather than showing non-functional camera, Revit, ESP32, or robot
capabilities.

## HTTP surface

| Route | Behaviour |
|---|---|
| `GET /api/capabilities` | Healthy Agent, Provider, connector, tool schemas, effects, and upload limit |
| `POST /api/agent-runs` | One multipart IFC plus optional bounded `objective` |
| `POST /api/agent-runs/sample/{sample_id}` | Bundled IFC with optional JSON objective |

The product-level batch flow is intentionally a browser coordinator rather
than a new HTTP contract: the user can select multiple IFC files or bundled
samples, and the client submits the existing single-file route sequentially.
Each IFC file has a 50 MiB bound; an oversized file is represented as
`SKIPPED` without issuing an upload request, while other files continue.
Each successful file keeps its own `AgentRun`/`ReviewRun` and local history
entry; the coordinator returns a `bim-review-batch-quick-check/v1` aggregate
for triage and copyable JSON/Markdown. A failed file records its filename,
error code, and message without turning the whole batch into a false zero or
PASS. Server-side atomic batches, queueing, resume, and cross-device batch
history are deferred until a separate retention and job-control decision.

Successful creation returns:

```json
{
  "agent_run": { "state": "COMPLETED", "linked_review_run_id": "…" },
  "review_run": { "run_id": "…", "findings": [] }
}
```

The two IDs must match for `full_review`. Inventory-only and unsupported-scope
responses contain a completed non-verdict AgentRun with both links null.

## Verification

From `apps/gpt-sites`:

```bash
npm run test:agent-kernel
npm test
```

The kernel suite covers eleven trajectories: observation-dependent action,
disallowed tool, malformed input, malformed output, repeated action, step
budget, tool budget, sanitized Provider failure, strict action shape, canonical
link authorization, and delegation budget. The production Workerd suite then
runs all five checked-in IFC samples and a real multipart upload through the
Agent path. Each resulting canonical deterministic payload deep-equals the
Python golden, and the returned Site `AgentRun` validates against the Python
`AgentRun/v1` Pydantic contract.

This completes the implementation scope described by the public assignment and
current product boundary in [`HKU_ASSIGNMENT_BRIEF.md`](../source/HKU_ASSIGNMENT_BRIEF.md).
Run persistence, retrieval, deletion, exports, localization, and the final
public results workspace remain Phase 3 work.
