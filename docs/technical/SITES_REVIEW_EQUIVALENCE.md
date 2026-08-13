# Site-native deterministic review equivalence

| Field | Value |
|---|---|
| Verification date | 2026-08-09 |
| Site review kernel | TypeScript + `web-ifc` 0.0.77 WebAssembly |
| Reference kernel | Python + IfcOpenShell 0.8.5 |
| Contract | `ReviewRun/v1` |
| Rule pack | `hku-demo-2026` 1.0.0 |
| Result | Full deterministic payload equivalence passed |

## Scope

The Site-native kernel now performs the complete deterministic path inside the
Workerd deployment:

```text
validated IFC bytes
  → web-ifc fact extraction with source paths
  → project-unit normalization
  → INFO-001
  → EGRESS-001
  → deterministic ordering
  → dual evidence
  → bounded explanations
  → ReviewRun/v1
```

The extractor inventories the same nine IFC classes as the Python authority,
resolves occurrence and inherited type property sets, retains actual property
names in source paths, resolves the spatial container used as `storey`, and
distinguishes explicit clear width from nominal `OverallWidth` proxy evidence.
Rule verdicts are not assigned in the parser.

## Equivalence definition

The gate compares parsed JSON objects after removing only these volatile run
fields:

- `run_id`;
- `started_at`;
- `completed_at`; and
- `duration_ms`.

Everything else must deep-equal the Python golden: source filename/size/hash,
rule-pack identity, inventory, trace stages and data, finding order and IDs,
status, severity, entity references, applicability, messages,
recommendations, every model observation, reliability, normalized value and
unit, rule authority/parameters/limitation, deterministic explanation, and
summary.

## Verified inputs

The production Worker artifact passes all five checked-in samples:

- `clean`;
- `missing_information`;
- `mixed_review`;
- `narrow_exit`; and
- `proxy_width`.

The same gate also posts `mixed_review.ifc` through the real multipart user
upload route and matches the same golden. Two repeated sample reviews receive
different run IDs while retaining identical deterministic payloads. An unknown
sample fails with typed `sample_not_found` guidance.

## Reproduction

From `apps/gpt-sites`:

```bash
npm test
```

The command builds the production artifact, verifies server-rendered HTML,
starts that exact artifact under Wrangler/Workerd on an isolated available
port, and runs both the Phase 0 runtime probe and full golden equivalence suite.

For an already running development or deployed Site:

```bash
BIM_REVIEW_SITE_URL=http://localhost:3000 npm run smoke:equivalence
```

The golden authority and regeneration boundary are documented in
[`contracts/README.md`](../../contracts/README.md).
