from __future__ import annotations

import ifcopenshell
from ifcopenshell.api import pset

from bim_review_agent.application.review_service import review_ifc_bytes
from bim_review_agent.domain.models import FindingStatus
from bim_review_agent.domain.rules import load_rule_pack
from bim_review_agent.domain.samples import load_sample


def test_mainland_profile_loads_gb_55037_clause_7_1_4_rule_pack() -> None:
    pack = load_rule_pack("cn-fire-55037-2022")

    assert pack.id == "cn-fire-55037-2022"
    assert pack.version == "1.0.0"
    assert pack.authority.clause == "7.1.4(1)"
    assert pack.authority.type.value == "AUTHORITATIVE_STANDARD"
    assert pack.egress.threshold.value == 800
    assert pack.egress.threshold.unit == "mm"


def _with_clear_width(content: bytes, clear_width_mm: float) -> bytes:
    model = ifcopenshell.file.from_string(content.decode("utf-8"))
    door = model.by_type("IfcDoor")[0]
    for relation in getattr(door, "IsDefinedBy", ()):
        if not relation.is_a("IfcRelDefinesByProperties"):
            continue
        definition = relation.RelatingPropertyDefinition
        if not definition.is_a("IfcPropertySet") or definition.Name != "Pset_BIMReview":
            continue
        pset.edit_pset(
            model,
            pset=definition,
            properties={"ClearWidth": model.createIfcLengthMeasure(clear_width_mm)},
        )
        break
    return model.to_string().encode("utf-8")


def test_mainland_profile_passes_820_mm_against_800_mm_minimum() -> None:
    sample, content = load_sample("narrow_exit")
    run = review_ifc_bytes(
        sample.filename,
        content,
        profile_id="cn-fire-55037-2022",
    )

    finding = next(item for item in run.findings if item.rule_id == "EGRESS-001")
    assert run.rule_pack_id == "cn-fire-55037-2022"
    assert run.rule_pack_version == "1.0.0"
    assert finding.status is FindingStatus.PASS
    assert finding.rule_evidence.authority.value == "AUTHORITATIVE_STANDARD"
    assert finding.rule_evidence.clause == "7.1.4(1)"
    assert finding.rule_evidence.parameters["minimum"] == 800
    assert finding.rule_evidence.parameters["observed_clear_width_mm"] == 820
    assert "GB 55037-2022 Clause 7.1.4(1)" in finding.message


def test_mainland_profile_fails_verified_width_below_800_mm() -> None:
    sample, content = load_sample("narrow_exit")
    run = review_ifc_bytes(
        sample.filename,
        _with_clear_width(content, 780),
        profile_id="cn-fire-55037-2022",
    )

    finding = next(item for item in run.findings if item.rule_id == "EGRESS-001")
    assert finding.status is FindingStatus.FAIL
    assert finding.rule_evidence.parameters["observed_clear_width_mm"] == 780
    assert "at least 800 mm" in finding.recommendation


def test_mainland_profile_keeps_overall_width_as_review_only() -> None:
    sample, content = load_sample("proxy_width")
    run = review_ifc_bytes(
        sample.filename,
        content,
        profile_id="cn-fire-55037-2022",
    )

    finding = next(item for item in run.findings if item.rule_id == "EGRESS-001")
    assert finding.status is FindingStatus.REVIEW
    assert "proxy" in finding.message.lower()
    assert finding.rule_evidence.parameters["minimum"] == 800
