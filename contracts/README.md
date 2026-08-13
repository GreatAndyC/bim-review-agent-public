# Cross-runtime contracts

This directory is the versioned boundary between the authoritative
Python/IfcOpenShell implementation and the Site-native TypeScript/WebAssembly
port.

It contains:

- `schemas/`: JSON Schemas emitted from the strict Pydantic public models;
- `rules/`: the validated JSON form of the bundled executable rule packs;
- `golden/`: one deterministic `ReviewRun` projection for every checked-in IFC
  sample; and
- `manifest.json`: contract versions, source hashes, golden paths, and expected
  summaries.

The golden projections exclude only `run_id`, timestamps, and `duration_ms`.
They deliberately retain source metadata, inventory, ordered trace stages,
findings, status/severity, model evidence, rule evidence, explanations, and the
computed summary. This makes a cross-runtime test sensitive to decision drift,
not merely to aggregate counts.

The Python implementation remains the generation authority during this MVP.
Regenerate after an intentional contract or rule change:

```bash
uv run python scripts/generate_contracts.py
```

Verify that checked-in artifacts have not drifted:

```bash
uv run python scripts/generate_contracts.py --check
```

Do not edit generated JSON by hand. An intentional semantic change requires a
reviewed Python change, regenerated artifacts, an explicit contract/rule
version decision, and matching tests in every runtime.
