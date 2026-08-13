# ADR-2026-08-13: Retire the Python Web Compatibility Surface

## Status

Accepted and implemented.

## Context

The repository now has a React/Vinext Site-native product under
`apps/gpt-sites`. It owns the browser workbench, IFC upload path, typed Agent
runtime, result storage, exports, and browser verification. The Python package
remains useful as the deterministic reference evaluator, contract generator,
and local CLI.

The earlier Python package also contained a second browser surface: a FastAPI
application with Jinja templates, static JavaScript/CSS, and an ASGI `serve`
command. Maintaining both browser surfaces duplicated interaction state and
made the installation story ambiguous. The Python web surface was not required
by the current Site runtime or by the reference CLI.

## Decision

Remove the Python web compatibility surface and its web-only dependencies:

- delete `src/bim_review_agent/interfaces/web.py`;
- delete `src/bim_review_agent/interfaces/web_assets/`;
- delete the FastAPI/httpx/Jinja/Uvicorn API and i18n tests;
- remove the `serve` CLI command and the old host/port environment variables;
- remove FastAPI, Jinja2, python-multipart, Uvicorn, and httpx from Python
  dependencies and regenerate `uv.lock`;
- keep the Python package as CLI/reference-only;
- keep the Site-native runtime as the primary browser product;
- keep historical ADRs and evaluation records as historical documents, with
  their date and scope made explicit rather than rewriting the project record.

The Python CLI has two supported commands:

```text
bim-review-agent review <ifc-file> [--profile ...] [--output ...]
bim-review-agent validate-schema <ifc-file> [--output ...]
```

## Consequences

Positive consequences:

- one documented browser installation path (`apps/gpt-sites`);
- no stale Python HTTP server dependencies in the reference package;
- lower maintenance cost and fewer opportunities for UI/contract drift;
- the distinction between the primary product and the reference evaluator is
  explicit in the root README and architecture maps.

Trade-offs:

- Python users no longer get a local browser UI from `uv sync`;
- the Site path remains the place to test upload, browser interaction, D1
  retention, and Workerd behavior;
- older scripts that invoke `bim-review-agent serve` or import `interfaces.web`
  must migrate to the Site app or the CLI.

## Verification

The retirement is considered complete when all of the following remain true:

1. `uv lock` and `uv build` succeed without the removed web dependencies.
2. Python lint, formatting, and tests pass.
3. Site typecheck, lint, and the existing Worker test suite pass.
4. Current documentation points to the CLI or Site runtime rather than a
   deleted Python web file.
5. Historical documents that mention FastAPI/Jinja are clearly date-scoped and
   are not used as the current installation guide.
