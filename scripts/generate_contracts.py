"""Generate cross-runtime schemas, rule data, and deterministic golden reviews."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from bim_review_agent.application.agent.schemas import AgentRun
from bim_review_agent.application.review_service import review_ifc_bytes
from bim_review_agent.domain.models import ReviewRun
from bim_review_agent.domain.rules.rule_pack import RulePackConfig, load_rule_pack
from bim_review_agent.domain.samples import list_samples, load_sample

ROOT = Path(__file__).resolve().parents[1]
CONTRACT_ROOT = ROOT / "contracts"
SCHEMA_ROOT = CONTRACT_ROOT / "schemas"
RULE_ROOT = CONTRACT_ROOT / "rules"
GOLDEN_ROOT = CONTRACT_ROOT / "golden"


def _json_text(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def _schema(model: type[Any], *, schema_id: str) -> dict[str, Any]:
    value = model.model_json_schema(ref_template="#/$defs/{model}")
    return {"$id": schema_id, **value}


def build_outputs() -> dict[Path, str]:
    packs = {
        "hku-demo-2026": load_rule_pack(),
        "cn-fire-55037-2022": load_rule_pack("cn-fire-55037-2022"),
    }
    pack = packs["hku-demo-2026"]
    outputs = {
        SCHEMA_ROOT / "review-run.v1.schema.json": _json_text(
            _schema(ReviewRun, schema_id="urn:bim-review-agent:review-run:v1")
        ),
        SCHEMA_ROOT / "agent-run.v1.schema.json": _json_text(
            _schema(AgentRun, schema_id="urn:bim-review-agent:agent-run:v1")
        ),
        SCHEMA_ROOT / "rule-pack.v1.schema.json": _json_text(
            _schema(RulePackConfig, schema_id="urn:bim-review-agent:rule-pack:v1")
        ),
        RULE_ROOT / "hku-demo-2026.v1.0.0.json": _json_text(pack.model_dump(mode="json")),
        RULE_ROOT / "cn-fire-55037-2022.v1.0.0.json": _json_text(
            packs["cn-fire-55037-2022"].model_dump(mode="json")
        ),
    }

    manifest_samples: list[dict[str, Any]] = []
    for sample in sorted(list_samples(), key=lambda item: item.id):
        _, content = load_sample(sample.id)
        run = review_ifc_bytes(sample.filename, content)
        golden_name = f"{sample.id}.review.json"
        payload = run.deterministic_payload()
        outputs[GOLDEN_ROOT / golden_name] = _json_text(payload)
        manifest_samples.append(
            {
                "id": sample.id,
                "filename": sample.filename,
                "source_sha256": payload["source"]["sha256"],
                "golden_path": f"golden/{golden_name}",
                "summary": payload["summary"],
            }
        )

    outputs[CONTRACT_ROOT / "manifest.json"] = _json_text(
        {
            "contract_version": "1.0.0",
            "reference_runtime": "python-ifcopenshell",
            "review_contract": "ReviewRun/v1",
            "agent_contract": "AgentRun/v1",
            "rule_pack_id": pack.id,
            "rule_pack_version": pack.version,
            "samples": manifest_samples,
        }
    )
    return outputs


def _check(outputs: dict[Path, str]) -> int:
    errors: list[str] = []
    for path, expected in outputs.items():
        if not path.exists():
            errors.append(f"missing: {path.relative_to(ROOT)}")
            continue
        if path.read_text(encoding="utf-8") != expected:
            errors.append(f"stale: {path.relative_to(ROOT)}")

    expected_golden = {
        path.resolve() for path in outputs if path.parent.resolve() == GOLDEN_ROOT.resolve()
    }
    if GOLDEN_ROOT.exists():
        for path in GOLDEN_ROOT.glob("*.review.json"):
            if path.resolve() not in expected_golden:
                errors.append(f"unexpected: {path.relative_to(ROOT)}")

    if errors:
        print("Contract artifacts are not synchronized:")
        for error in errors:
            print(f"- {error}")
        print("Run `uv run python scripts/generate_contracts.py` to regenerate them.")
        return 1

    print(f"Verified {len(outputs)} generated contract artifacts.")
    return 0


def _write(outputs: dict[Path, str]) -> None:
    for path, content in outputs.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    print(f"Wrote {len(outputs)} contract artifacts under {CONTRACT_ROOT.relative_to(ROOT)}.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail when checked-in contract artifacts differ from the Python authority",
    )
    arguments = parser.parse_args()
    outputs = build_outputs()
    if arguments.check:
        return _check(outputs)
    _write(outputs)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
