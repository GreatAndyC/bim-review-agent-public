# Sites anonymous admission controls

## Decision

The hosted MVP uses a random browser-generated anonymous session identifier as
an admission key. The raw identifier is sent only in the
`X-BIM-Review-Session` request header, is hashed with SHA-256 before D1 use,
and is not added to `AgentRun`, `ReviewRun`, logs, exports, or analytics.

This identifier is not identity, authentication, or a durable user account. It
exists only to put a defensible resource boundary around the public anonymous
entry point.

## Enforced policy

| Control | Candidate value | Enforcement |
|---|---:|---|
| Sample starts | No anonymous-session count limit | Each sample still acquires the active-review lease before parsing or Agent execution |
| Real upload starts | No anonymous-session count limit | Each file still passes the 50 MiB file bound, bounded multipart parsing, IFC validation, parser/runtime safeguards, and the active-review lease |
| Active reviews | 1 per anonymous session | D1 lease acquired before parsing or Agent execution |
| Stale lease | 2 minutes | Expired leases are reconciled on the next admission request |
| Real-upload kill switch | Enabled unless explicitly disabled | `BIM_REVIEW_UPLOADS_ENABLED=false` blocks uploads but leaves samples available |

Lease acquisition is a conditional D1 write, so two Worker isolates cannot
both treat the same current session as unused. A lease is released in a route
`finally` block. If release itself fails after a completed review, the
successful result is preserved and the lease expires at its fixed deadline.

Legacy sample rate-window rows from older deployments and expired leases are
deleted during later admission requests. No raw IP address, browser
fingerprint, IFC filename, content hash, objective, or model fact is used as
an admission key.

## API contract

Every review-creation request must send a random 16–80 character value:

```http
X-BIM-Review-Session: local-demo-session-0123456789
```

The browser creates and reuses this value automatically. Direct API clients
must provide their own random value. Retrieval, JSON export, and deletion keep
using the separate high-entropy run access token; the admission identifier
does not grant access to any retained result.

Typed error responses include:

- `detail.code`, `detail.message`, and `detail.recovery`;
- `detail.request_id` plus the matching `X-Request-ID` header;
- `Retry-After` for rate, active-lease, and upload-disable responses; and
- `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`.

## Upload body bound

Multipart requests are read through a bounded stream before `FormData`
decoding. A declared body above 51 MiB is rejected before reading. A chunked
body is cancelled when the 50 MiB file budget plus 1 MiB bounded multipart
overhead is exceeded. The decoded file then receives the independent exact
50 MiB file-size check, extension check, and IFC STEP header check.

## Operational boundary

This application-level policy protects normal anonymous use and accidental
duplicate work. Neither sample starts nor real IFC upload count is capped per
anonymous session; operational protection comes from the per-file/request
bounds, parser/runtime limits, the active-review lease, and the deployment
kill switch. A client can reset its random identifier, so this is not a
substitute for platform-level DDoS protection, account quotas, or a future
managed rate-limit service.
