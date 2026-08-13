# GPT Sites Phase 0 Feasibility Decision

| Field | Value |
|---|---|
| Decision date | 2026-08-09 |
| Status | Passed locally in the Sites-compatible Workerd runtime |
| Outcome | Site-native TypeScript/WebAssembly port; no external BIM backend |
| Application | `apps/gpt-sites` |
| Reference implementation | Existing Python/IfcOpenShell application |

## Decision

The GPT Sites delivery track will use a Site-native TypeScript runtime with
`web-ifc` WebAssembly for IFC parsing and D1 for bounded, expiring run
metadata. It will not deploy the existing Python/IfcOpenShell server unchanged,
and it will not hide that server behind the Site as a separately operated BIM
backend.

This is the PRD's allowed Site-native port outcome. Deterministic rule behavior
must still be proven against golden projections from the Python reference
before this track can replace it for an end user.

## What was proved

The following checks ran inside the vinext development server backed by
Cloudflare Workerd rather than in a conventional Node-only server:

1. `GET /api/health` initialized the statically imported `web-ifc` module and
   returned `200` with parser status `available`.
2. `POST /api/probes/upload` accepted one real `.ifc`, enforced the then-current
   20 MiB boundary and STEP header, generated SHA-256, and retained no raw bytes.
3. `POST /api/probes/ifc-parse` parsed the checked-in `clean.ifc` fixture as
   `IFC4`, with 24 total entities and 2 doors.
4. A non-IFC payload renamed to `.ifc` returned typed
   `invalid_step_header` recovery guidance.
5. `POST /api/probes/storage` created, read, deleted, and verified deletion of
   a temporary D1 row.
6. The health contract reports `externalBimBackend: false` and
   `externalInferenceRequired: false`.

Run the same gate with:

```bash
cd apps/gpt-sites
npm run dev
# in another terminal
npm run smoke:phase0
```

## Compatibility finding

Workers accept WebAssembly modules imported at build time, but do not permit
`WebAssembly.instantiateStreaming()` or compilation from uploaded/fetched WASM
bytes. `web-ifc` normally selects a Node build when `nodejs_compat` exposes
`process`, then its browser build normally fetches and compiles
`web-ifc.wasm` dynamically. Neither default is valid for this deployment.

The adapter therefore:

- aliases the package root to `web-ifc-api.js` so the browser API is selected;
- statically imports `web-ifc.wasm?module` as `WebAssembly.Module`;
- injects Emscripten's `instantiateWasm` hook so Workerd instantiates that
  precompiled module;
- supplies the Worker marker expected by the generated browser glue; and
- fails the build if a future `web-ifc` release changes either patched
  bootstrap marker.

This behavior follows Cloudflare's official documentation for
[non-JavaScript modules](https://developers.cloudflare.com/workers/vite-plugin/reference/non-javascript-modules/)
and [WASM in Workers](https://developers.cloudflare.com/workers/runtime-apis/webassembly/javascript/).

## Storage decision

D1 is sufficient for the MVP's bounded anonymous run metadata and serialized
derived results. The parser can operate on the request's in-memory bytes, so R2
is not required for the core path and remains unbound. Raw IFC bytes must be
dropped after parsing and must never enter D1, logs, Agent messages, analytics,
or public events.

The current upload policy is 50 MiB per IFC file. This decision can be revisited
only if measured 50 MiB production runs cannot finish within the platform's
request and memory limits. Adding R2 would require
an explicit lifecycle policy and verified deletion, not an incidental upload
archive.

## Post-Phase 0 status

Phase 0 proved platform feasibility rather than product completion. The
subsequent implementation has now completed:

- golden, field-level deterministic equivalence for all five checked-in IFC
  fixtures and one real multipart upload;
- the two initial rules, evidence contracts, and canonical JSON serializer;
- a typed Agent action/observation loop with strict schemas, allowlisted tools,
  and fail-closed budgets;
- token-authorized anonymous result retrieval, JSON export, early deletion,
  exact-time expiry, active-run leases, and an upload kill switch;
- a responsive three-language review workspace, public trace, evidence drill
  down, filters, privacy notice, and printable report; and
- production builds and compiled-Worker regression tests in CI.

The Site remains a private release candidate until the production deployment
passes signed-out access, twenty consecutive real-file journeys, 5/20 MiB p95
measurements, and verified unattended physical deletion of expired D1 rows.
Site-native BCF ZIP generation is also not implemented; it remains a recorded
format-compatibility gap rather than an implied deliverable. The runtime
admission boundaries are documented in
[`SITES_ADMISSION_CONTROLS.md`](SITES_ADMISSION_CONTROLS.md).
