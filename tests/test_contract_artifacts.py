from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_generated_cross_runtime_contracts_are_current() -> None:
    completed = subprocess.run(
        [sys.executable, str(ROOT / "scripts/generate_contracts.py"), "--check"],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr


def test_golden_manifest_covers_every_bundled_sample() -> None:
    manifest = json.loads((ROOT / "contracts/manifest.json").read_text(encoding="utf-8"))
    catalogue = json.loads(
        (ROOT / "src/bim_review_agent/assets/samples/catalog.json").read_text(encoding="utf-8")
    )

    assert manifest["contract_version"] == "1.0.0"
    assert manifest["review_contract"] == "ReviewRun/v1"
    assert manifest["reference_runtime"] == "python-ifcopenshell"
    assert {item["id"] for item in manifest["samples"]} == {item["id"] for item in catalogue}

    for item in manifest["samples"]:
        golden = json.loads((ROOT / "contracts" / item["golden_path"]).read_text())
        assert golden["source"]["sha256"] == item["source_sha256"]
        assert golden["summary"] == item["summary"]
        assert "run_id" not in golden
        assert "started_at" not in golden
        assert "completed_at" not in golden
        assert "duration_ms" not in golden
        assert all(finding["explanation"] for finding in golden["findings"])
