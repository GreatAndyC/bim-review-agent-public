# Security and Data Handling

## Prototype scope

BIM Review Agent v0.1 is a local assessment prototype, not a hardened multi-user service. Do not expose it directly to the public internet or use it to process production models without a separate deployment and security review.

## Current safeguards

- Uploaded filenames are reduced to a basename and are not used as filesystem paths.
- Extension, size, STEP header, and parser validity are checked before a successful review is created.
- Uploads are read into bounded local process memory; the application does not persist model files.
- Completed review and Agent runs are held in a bounded in-memory store and disappear after process restart.
- SQLite persists only allowlisted language/review-mode preferences with exact user/project scope plus bounded, redacted session episodes. Raw IFC bytes, filenames, objective/final-response text, finding bodies, arbitrary claims, and credentials are rejected from durable memory.
- A newly created memory database is restricted to the current operating-system user where the platform supports POSIX file modes. The path defaults to `~/.bim-review-agent/memory.sqlite3` and can be changed with `BIM_REVIEW_MEMORY_DB`.
- Memory correction preserves a supersession link, while explicit forget hard-deletes the selected record so it cannot be recalled.
- Session retention is capped at 20 sessions per exact user/project scope and 20 episodes per session; one run recalls at most the newest three episodes. Creating a clean session recalls none, and forgetting a session hard-deletes its episodes through a database cascade.
- Episode records contain only source/objective SHA-256 fingerprints, run references, Agent/Provider/Connector IDs, terminal state/mode, aggregate review counts, timestamps, and recall provenance. Hashes support equality correlation; they are identifiers, not encryption or proof that the original text cannot be guessed.
- Multi-Agent specialists receive bounded objectives and role-specific tool contexts rather than the parent transcript. Each specialist has one allowed tool and no nested-delegation budget.
- The Evidence Critic receives only a completed `ReviewRun`; manager events and child provider requests never contain raw IFC STEP bytes.
- Deterministic review requires no external AI service, API key, analytics, or telemetry.
- The only automatic Provider route is local `scripted`; `openai-responses` and `openrouter` are disabled by default and require server-side opt-in plus explicit per-request selection.
- Provider credentials are read from the process environment only when a remote action is requested. Credential values are not retained in Provider descriptors, model payloads, memories, events, downloads, or Git.
- Model onboarding and the workspace never render a credential input. Browser storage retains only onboarding completion plus selected Provider/model IDs.
- OpenRouter accepts only a `model_id` from the current validated ten-model catalogue. Reading the current snapshot is network-free; explicit refresh validates all ten entries before replacement and leaves the previous snapshot active on failure.
- Optional external adapters accept HTTPS endpoints plus loopback HTTP for local compatible services, reject credential-bearing/query URLs, cap response size and timeout, and convert only registered function calls into typed kernel actions.
- OpenAI requests remote storage off. OpenRouter requires parameter-compatible routing, denies provider data collection, and requires a ZDR-capable route. These request controls reduce exposure but do not guarantee confidentiality across every upstream operator or jurisdiction.
- A remote final action may link only a canonical `ReviewRun` ID already produced by a deterministic tool or specialist. Model prose and arbitrary data cannot create or change a verdict.
- Connector selection is separate from Provider selection. Only the bundled, network-free `local-bim` Connector is available; its three capabilities are filtered into each Agent's existing tool allowlist and recorded in parent/child traces.
- `external-http` is explicitly `DISALLOWED`, and `mcp-server` is explicitly `DISABLED`. Neither entry owns a handler, endpoint, credential reference, or network execution path. The model cannot register arbitrary endpoints or change these states.
- The parser never executes embedded scripts, macros, applications, or external references.
- BCF archive paths are generated from UUIDs; uploaded filenames appear only as XML-escaped content and cannot select ZIP paths.
- `.env` files, runtime uploads, generated reports, WPS lock files, and the local source archive under `docs/source/private/` are excluded from Git.

## Known limitations

- The application has no authentication, authorization, rate limiting, malware scanning, or production isolation.
- Memory limits reduce accidental misuse but are not a complete denial-of-service defence.
- IfcOpenShell processes complex untrusted model syntax; keep dependencies current and isolate any future hosted deployment.
- JSON, audit-report, and BCF downloads remain available only while the local process retains the run ID.
- The local memory/session API has no user authentication; scope IDs organize a single-user demo and are not tenant security boundaries. A caller with local API access can list or forget records.
- Explicit use of an external Provider sends the current objective, recalled allowlisted preferences, recalled redacted episode summaries, and safe structured tool/specialist observations to that configured service. Review the selected model/provider's retention, subprocessors, jurisdiction, and pricing terms before using confidential project data; `store: false`, `data_collection: deny`, and ZDR routing are request settings, not substitutes for that review.
- External inference adapters have been tested with injected fake transports only; live endpoint behaviour, redirects, availability, cost, rate limits, and model quality have not been security- or performance-validated. The public OpenRouter model-catalogue refresh was exercised separately and is not an inference test.
- OpenRouter's `top-weekly` order is volatile popularity metadata, not a security, privacy, quality, or cost recommendation. The bundled dated snapshot can become stale until an operator explicitly refreshes it.
- Connector health is static metadata in this local slice, not an active network probe. Any future HTTP, MCP, Revit, or common-data-environment adapter requires a separate threat model, typed schema, destination allowlist, credential policy, timeout/size limit, and explicit approval path.
- Exported JSON, PDF prints, and BCF packages can contain model identifiers and evidence; handle them with the same confidentiality as the source IFC.

## Reporting a vulnerability

Use GitHub's private vulnerability-reporting channel if it is enabled for the repository. Do not attach confidential IFC models, credentials, or personal data to a public issue. Include the affected version, minimal synthetic reproduction steps, and observed impact.
