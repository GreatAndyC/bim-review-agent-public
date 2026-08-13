from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from bim_review_agent.application.review_service import review_ifc_bytes
from bim_review_agent.domain.ifc import validate_ifc_bytes

ROOT = Path(__file__).resolve().parents[1]
ISSUE_DIR = ROOT / "tests" / "fixtures" / "real_ifc" / "generated_issues"
ISSUE_MANIFEST = json.loads((ISSUE_DIR / "manifest.json").read_text(encoding="utf-8"))
ISSUE_ENTRIES = ISSUE_MANIFEST["files"]


@pytest.mark.parametrize(
    "entry",
    ISSUE_ENTRIES,
    ids=[entry["issue_id"] for entry in ISSUE_ENTRIES],
)
def test_generated_issue_corpus_matches_expected_rule_outcome(entry: dict[str, object]) -> None:
    """Every public IFC fixture is generated, pinned, and checked deterministically."""

    path = ROOT / str(entry["path"])
    content = path.read_bytes()

    assert hashlib.sha256(content).hexdigest() == entry["sha256"]
    validation = validate_ifc_bytes(content)
    assert validation.passed is True

    first = review_ifc_bytes(path.name, content, profile_id=str(entry["profile_id"]))
    second = review_ifc_bytes(path.name, content, profile_id=str(entry["profile_id"]))
    assert first.deterministic_payload() == second.deterministic_payload()
    assert first.inventory.entity_counts.get("IfcDoor", 0) == entry["door_count"]
    assert first.summary.total_findings == (
        first.summary.pass_count + first.summary.fail_count + first.summary.review_count
    )
    assert first.summary.model_dump() == entry["review_summary"]

    if entry["expected_outcome"] == "NO_FINDINGS":
        assert first.summary.total_findings == 0
    elif entry["expected_outcome"] == "FAIL":
        assert first.summary.fail_count > 0
    else:
        assert first.summary.review_count > 0


def test_generated_issue_corpus_includes_the_zero_door_case_explicitly() -> None:
    zero_door = next(entry for entry in ISSUE_ENTRIES if entry["issue_type"] == "zero_doors")
    assert zero_door["door_count"] == 0
    assert zero_door["expected_outcome"] == "NO_FINDINGS"
    assert zero_door["observed_outcome"] == "NO_FINDINGS"
