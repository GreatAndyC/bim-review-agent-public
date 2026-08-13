# BCF 2.1 Export Contract

## Purpose

The BCF export turns an already-computed `ReviewRun` into a coordination artifact without introducing another decision path. It exports only `FAIL` and `REVIEW` findings. `PASS` remains available in the canonical JSON and audit report but does not become an open issue.

The implementation follows buildingSMART's file-based [BCF-XML repository](https://github.com/buildingSMART/BCF-XML), the official [BCF 2.1 markup schema](https://github.com/buildingSMART/BCF-XML/blob/release_2_1/Schemas/markup.xsd), [version schema](https://github.com/buildingSMART/BCF-XML/blob/release_2_1/Schemas/version.xsd), and [minimum-information test case](https://github.com/buildingSMART/BCF-XML/tree/release_2_1/Test%20Cases/v2.1/Markup/MinimumInformation).

## Package layout

```text
bim-review-<run-id>.bcfzip
├── bcf.version
├── <topic-guid>/
│   └── markup.bcf
└── <topic-guid>/
    └── markup.bcf
```

The root `bcf.version` declares `VersionId="2.1"`. Every actionable finding receives one RFC 4122 UUID topic folder and one `markup.bcf`. Topic GUIDs are deterministic UUIDv5 values derived from the run ID and stable finding ID.

## Finding-to-topic mapping

| Review field | BCF representation |
|---|---|
| `finding_id` | Description and deterministic topic-GUID seed |
| `FAIL` / `REVIEW` | Title prefix and topic label |
| Rule ID | Title, label, and description |
| Entity name/class/GlobalId/storey | Description; class is also a label |
| Model observations | Description with value, reliability, source path, raw value, and note |
| Rule evidence | Description with version, authority, source, jurisdiction, clause, parameters, and limitation |
| Recommendation/boundary | Description sections |
| Run identity/source SHA-256 | Description traceability footer |

`FAIL` maps to `High` priority and `REVIEW` to `Normal`. Both are open topics of type `Issue`; downstream coordinators decide assignment and lifecycle.

## Deliberate viewpoint omission

BCF viewpoints are optional in the 2.1 markup schema. The current review contract knows element GlobalIds and property evidence but does not extract a trustworthy camera, bounding box, or geometric selection state. The exporter therefore emits textual topics without `Viewpoints`, `.bcfv`, or snapshots. Generating an arbitrary camera would create false spatial evidence.

A future viewpoint feature must start with tested geometry extraction and coordinate handling. It must not retrofit invented coordinates into existing findings.

## Determinism and safety

- repeated export of the same retained run produces byte-for-byte identical output;
- archive timestamps are fixed to the run completion time;
- ZIP paths contain only generated UUIDs and fixed filenames, never uploaded filenames;
- source/model text is serialized through the XML library so reserved characters are escaped;
- all-pass runs return a controlled `422 no_actionable_findings` response; and
- export performs no network or AI call and cannot change a finding status.

## Compatibility boundary

The automated suite verifies the official minimum package shape and parses every generated XML document back into expected topic content. Cross-import into named commercial BCF clients has not yet been measured, so the repository does not claim a product-specific compatibility matrix.
