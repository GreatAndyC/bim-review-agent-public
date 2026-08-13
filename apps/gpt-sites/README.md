# BIM Review Agent — GPT Sites Runtime

This directory contains the Site-native delivery track for the BIM Review
Agent. It runs as a vinext application in Cloudflare Workerd, accepts one or
more real IFC STEP uploads up to 50 MiB per file, and keeps the core review
path inside the Site deployment.

The original Python/IfcOpenShell application remains the deterministic
reference implementation. This application is the WebAssembly/TypeScript port
required by the GPT Sites MVP PRD; it is not a frontend for an external Python
BIM service.

## Runtime boundary

- `web-ifc` is forced to its browser build and statically imports the WASM as a
  `WebAssembly.Module`, because Workers disallow runtime WASM compilation.
- The compatibility transform is fail-fast: a `web-ifc` upgrade that changes
  the Emscripten bootstrap stops the build until the adapter is reviewed.
- Uploads are decoded in memory, bounded at 50 MiB per file, checked for the
  `.ifc` extension and IFC STEP header, hashed, and not retained by the Phase 0
  route. Browser batch import skips an oversized file without blocking other
  files.
- D1 is bound as `DB` for expiring run metadata. R2 is deliberately absent from
  the memory-first core path.
- No external BIM computation backend or external inference service is needed.
- A typed, budgeted Agent kernel discovers three Site-resident tools, validates
  every Provider action and tool observation, and authorizes only the
  deterministic tool's canonical `ReviewRun` link.
- The default scripted Provider performs zero external inference calls. Local
  hardware discovery and multi-Agent scheduling are explicitly disabled in
  this hosted MVP profile.
- D1 retains only chunked derived Agent/Review JSON for 24-hour anonymous
  access. A one-time opaque token authorizes reads, JSON export, and early hard
  deletion; raw IFC bytes remain request-memory-only.
- D1 enforces one active review lease per browser session and a two-minute
  stale-lease deadline. Bundled samples and real IFC uploads have no
  anonymous-session count quota; each upload still passes the 50 MiB per-file
  bound, multipart bound, IFC validation, parser/runtime safeguards, and
  active-review lease. Session identifiers are hashed before storage.
- `BIM_REVIEW_UPLOADS_ENABLED=false` is the operational kill switch for real
  IFC uploads; bundled samples remain available.

## Prerequisites

- Node.js `>=22.13.0`
- npm

## Local development

```bash
cd apps/gpt-sites
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), then run the Phase 0
runtime gate in a second terminal:

```bash
npm run smoke:phase0
```

The Phase 0 smoke test verifies runtime health, a valid bounded upload,
rejection of a renamed non-IFC file, real parsing of `clean.ifc`, and a D1
create/read/delete round trip. The equivalence gate executes all five samples
and one real multipart upload through the complete Site-native rule path:

```bash
npm run smoke:equivalence
```

It compares every deterministic `ReviewRun` field with the checked-in Python
golden—not only the PASS/FAIL/REVIEW counts.

Exercise the complete Site Agent trajectory:

```bash
npm run smoke:agent
```

Or create one run manually:

```bash
curl -sS -X POST http://localhost:3000/api/agent-runs/sample/mixed_review \
  -H 'X-BIM-Review-Session: local-demo-session-0123456789'
```

The response contains one typed `agent_run` and its linked canonical
`review_run`, plus a one-time `access` envelope. `GET /api/capabilities`
exposes the actual hosted Provider, connector, tool schemas, effects, budgets,
parser health, and deferred hardware boundary.

The browser creates the anonymous admission header automatically. Direct API
clients must provide a random 16–80 character `X-BIM-Review-Session` value.
This value scopes admission and the active-review lease but does not authorize
result reads; retained access still requires the separate Bearer token. Real
upload starts are not counted against a per-session quota; bundled sample
starts remain subject to their demo window.

Use `Authorization: Bearer <access_token>` with the returned retrieval paths.
The token is never accepted in a URL. The `.json` path downloads the canonical
ReviewRun, and the delete path immediately removes both derived documents and
their metadata.

## Verification

```bash
npm run typecheck
npm run lint
npm test
```

`npm test` first exercises eleven fail-closed kernel trajectories, performs a
production build, verifies the server-rendered surface, starts that exact built
Worker on an isolated local port, and runs the Phase 0, deterministic
equivalence, and Agent suites against its compiled WASM and D1 binding. The
individual smoke commands target a running development or deployed instance
through `BIM_REVIEW_SITE_URL`.

The browser review surface also supports multi-file IFC selection and
multi-sample runs. Those batches intentionally reuse the existing single-file
review route sequentially, keep a separate history entry per successful file,
and expose an aggregate `bim-review-batch-quick-check/v1` JSON/Markdown payload
for triage. See `tests/batch-quick-check.test.mjs` and the product decision log
for the partial-failure and retention boundaries.

## Sites bindings

`.openai/hosting.json` requests:

```json
{
  "d1": "DB",
  "r2": null
}
```

The build copies that declaration and generated Drizzle migrations into
`dist/.openai/` for Sites packaging.

## Phase 0 evidence

The decision record and reproducible result are documented in
[`docs/technical/SITES_PHASE_0_FEASIBILITY.md`](../../docs/technical/SITES_PHASE_0_FEASIBILITY.md).
The typed loop, canonical-link policy, privacy boundary, endpoints, and test
matrix are documented in
[`docs/technical/SITES_AGENT_RUNTIME.md`](../../docs/technical/SITES_AGENT_RUNTIME.md).
The D1 chunking, opaque-token authorization, exports, deletion, and remaining
scheduled-cleanup release gate are documented in
[`docs/technical/SITES_RUN_STORAGE.md`](../../docs/technical/SITES_RUN_STORAGE.md).
Sample rate windows, active-run leases, the upload kill switch, request IDs,
and bounded multipart reading are documented in
[`docs/technical/SITES_ADMISSION_CONTROLS.md`](../../docs/technical/SITES_ADMISSION_CONTROLS.md).
Release verification and runtime admission boundaries are documented in
[`docs/technical/SITES_ADMISSION_CONTROLS.md`](../../docs/technical/SITES_ADMISSION_CONTROLS.md).
