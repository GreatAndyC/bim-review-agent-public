# Anonymous Sites run storage and export boundary

| Field | Value |
|---|---|
| Verification date | 2026-08-12 |
| Store | GPT Sites D1 binding (`DB`) |
| Raw IFC persistence | None; request memory only |
| Derived run expiry | Exactly 24 hours for authorization/retrieval |
| Early deletion | Token-authorized hard delete |
| Required export | Canonical `ReviewRun/v1` JSON plus concise Quick Check JSON/Markdown/print surface |
| Public-release status | Functional; unattended physical-expiry reconciliation remains a release gate |

Anonymous creation admission is a separate concern from retained-run
authorization. Its D1 sample-admission windows, active-run leases, and operational upload
switch are documented in
[Sites anonymous admission controls](SITES_ADMISSION_CONTROLS.md).

## Stored data

One anonymous run stores only bounded derived data and lookup metadata:

- the public `AgentRun/v1`;
- the canonical `ReviewRun/v1`, when the objective creates verdicts;
- Agent and ReviewRun IDs;
- safe filename, source hash, byte size, IFC schema, and rule-pack identity;
- terminal state and created/expiry/access timestamps; and
- a SHA-256 hash of an opaque 256-bit access token.

The raw IFC byte array is never inserted into D1 or R2. It remains in the
request-scoped tool context and becomes unreachable when the response
completes. R2 remains unbound in `.openai/hosting.json`.

## Why documents are chunked

Cloudflare's current [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
set a 2,000,000-byte maximum for a string, BLOB, or table row. A useful review
can exceed one row even when the source IFC is within 50 MiB, so the Runtime
does not place two unbounded JSON strings in the metadata row.

`run_documents` stores ordered `agent` and `review` chunks under a composite
primary key. Each chunk is at most 250,000 UTF-16 code units, keeping its
worst-case UTF-8 representation below the D1 row ceiling. The Runtime permits
at most 40 chunks per document and 8 MiB across one Agent/Review result. This
also keeps one save below D1's free-plan per-invocation query budget. A larger
derived result fails with typed `result_too_large` guidance instead of silently
truncating findings or claiming persistence.

Readback requires contiguous chunk indexes, recognized document kinds, bounded
size, valid JSON, matching row/document IDs, and agreement between the Agent's
canonical link and retained ReviewRun. A mismatch returns
`stored_run_corrupt`; it is never treated as a successful result.

## Anonymous authorization

Creation returns one random 43-character base64url token representing 256 bits
of entropy. D1 stores only its SHA-256 hash. Subsequent reads and deletion
require either:

```http
Authorization: Bearer <access-token>
```

or:

```http
X-Run-Token: <access-token>
```

Tokens are deliberately rejected in URL query parameters, so normal access
logs, browser history, referrers, and copied download URLs do not receive the
credential. Missing credentials return `401`; a wrong token, unknown ID,
expired run, and already-deleted run share the same `404 run_not_found`
response to avoid disclosing run existence. Every private response carries
`Cache-Control: private, no-store`.

The token is returned only in the creation envelope, not inside `AgentRun`,
`ReviewRun`, public events, retrieved bodies, or exports.

## Routes

| Route | Authorization | Result |
|---|---|---|
| `GET /api/agent-runs/{agent_run_id}` | Run token | Retained public AgentRun and expiry |
| `GET /api/reviews/{review_run_id}` | Run token | Canonical ReviewRun |
| `GET /api/reviews/{review_run_id}.json` | Run token | Pretty JSON attachment |
| `GET /api/reviews/{review_run_id}.quick-check.json` | Run token | Concise localized Quick Check JSON attachment |
| `GET /api/reviews/{review_run_id}.quick-check.md` | Run token | Concise localized Quick Check Markdown attachment |
| `DELETE /api/runs/{agent_run_id}` | Run token | Immediate hard deletion of metadata and document chunks |

The creation response includes these paths without embedding the token. The
canonical JSON endpoint remains token-authorized. The React workbench's
primary engineering handoff is a Quick Check generated from the already
retrieved canonical result, so its JSON and Markdown downloads still work when
the anonymous server copy reaches its 24-hour expiry. Browser code creates a
local download rather than placing the token in an anchor URL.

The print action uses a separate concise Quick Check print surface. It contains
the source hash, rule-pack identity, PASS/FAIL/REVIEW counts, only actionable
FAIL/REVIEW checks, measured values, evidence paths, source clause, and a short
recommendation. The full evidence-first report and public Agent trace remain a
web-only inspection surface. The print CSS is intentionally not a dump of the
full findings page.

## Browser history boundary

The `审查运行` navigation item is now labeled **History**. The React workbench
saves the derived `StoredAgentReviewResult` and its access envelope in an
IndexedDB store named `bim-review-agent-history-v1`. It does **not** save the
raw IFC bytes. History is explicitly labeled “Saved on this device”; it is not
an account-backed, cross-device archive and it is not a substitute for server
retention. The access token expires with the anonymous server run and is never
placed in a URL.

This gives the current anonymous product a useful long-lived local workflow:
users can reopen a completed result and regenerate Quick Check JSON/Markdown
after the 24-hour server retention window. It does not yet provide shared
project history, organization permissions, server-side search, or cross-device
recovery. Those require an authenticated workspace identity, a D1 run index,
durable artifact storage such as R2, retention/deletion jobs, and an explicit
privacy policy. The public repository boundary treats that hosted
archive as a later release, rather than claiming that browser IndexedDB is a
multi-user history service.

## Expiry and the remaining release gate

Authorization stops accepting a run at its exact `expires_at` time. Every
create, read, and delete operation first hard-deletes expired document chunks
and metadata, so ordinary traffic reconciles physical storage continuously.
Early user deletion is immediate and verified by a failed subsequent read.

The current Sites artifact has no verified scheduled trigger. If no storage
request occurs after a run expires, D1 may physically retain the already
inaccessible derived row beyond 24 hours. Therefore the implementation does
**not** yet claim the PRD's unconditional 24-hour physical deletion guarantee.
Public real-file release remains blocked until a deployed Sites candidate proves
one of these mechanisms:

1. a platform-supported scheduled cleanup trigger;
2. an equivalent storage TTL facility; or
3. a documented product decision changing the physical-retention promise.

This limitation concerns derived result records. Raw IFC remains memory-only
and has no delayed cleanup dependency.

## Verification

The production Workerd integration suite verifies:

- token-authorized Agent retrieval;
- token-authorized ReviewRun retrieval;
- full JSON attachment equivalence;
- `private, no-store` caching;
- missing-token and wrong-token denial;
- token absence from retrieved bodies;
- immediate hard deletion; and
- `404` after deletion.

The same suite still deep-compares every retained canonical result with the
Python golden and performs no external inference call.
