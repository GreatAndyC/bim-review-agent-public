from __future__ import annotations

import ifcopenshell
from ifcopenshell.api import pset

from bim_review_agent.application.review_service import review_ifc_bytes
from bim_review_agent.domain.models import FindingStatus
from bim_review_agent.domain.regulations import load_hong_kong_profile
from bim_review_agent.domain.samples import load_sample


def _with_occupant_capacity(content: bytes, capacity: int | None) -> bytes:
    model = ifcopenshell.file.from_string(content.decode("utf-8"))
    door = model.by_type("IfcDoor")[0]
    if capacity is not None:
        review_pset = pset.add_pset(model, product=door, name="Pset_BIMReview")
        pset.edit_pset(
            model,
            pset=review_pset,
            properties={"OccupantCapacity": capacity},
        )
    else:
        for relation in list(getattr(door, "IsDefinedBy", ())):
            if not relation.is_a("IfcRelDefinesByProperties"):
                continue
            definition = relation.RelatingPropertyDefinition
            if not definition.is_a("IfcPropertySet") or definition.Name != "Pset_BIMReview":
                continue
            definition.HasProperties = tuple(
                item for item in definition.HasProperties if item.Name != "OccupantCapacity"
            )
    return model.to_string().encode("utf-8")


def test_hong_kong_profile_uses_table_b2_row_instead_of_demo_threshold() -> None:
    _, content = load_sample("narrow_exit")
    run = review_ifc_bytes(
        "narrow_exit.ifc",
        _with_occupant_capacity(content, 31),
        profile_id="hk-fire-safety-2011-2024",
    )

    finding = next(item for item in run.findings if item.rule_id == "HK-FS-B2-DOOR-WIDTH")
    assert run.rule_pack_id == "hk-fire-safety-2011-2024"
    assert finding.status is FindingStatus.FAIL
    assert finding.rule_evidence.authority.value == "AUTHORITATIVE_STANDARD"
    assert finding.rule_evidence.parameters["minimum_clear_width_mm"] == 850
    assert finding.rule_evidence.parameters["source_edition"] == "2024"
    assert finding.rule_evidence.clause == "Table B2; Note 2"


def test_hong_kong_profile_returns_review_when_occupancy_is_missing() -> None:
    _, content = load_sample("clean")
    run = review_ifc_bytes(
        "clean.ifc",
        _with_occupant_capacity(content, None),
        profile_id="hk-fire-safety-2011-2024",
    )

    finding = next(item for item in run.findings if item.rule_id == "HK-FS-B2-DOOR-WIDTH")
    assert finding.status is FindingStatus.REVIEW
    assert finding.rule_evidence.parameters["missing_evidence_outcome"] == "CANNOT_EVALUATE"
    assert "occupant capacity" in finding.message


def test_hong_kong_profile_contains_all_machine_checkable_table_rows() -> None:
    profile = load_hong_kong_profile()
    assert profile.width_row(4).min_each_exit_door_mm == 750
    assert profile.width_row(31).min_each_exit_door_mm == 850
    assert profile.width_row(2001).min_each_exit_door_mm == 1500
    assert profile.width_row(2251).min_exit_doors == 10
    assert profile.width_row(2251).min_total_exit_door_width_mm == 15000
    assert profile.width_row(3001).min_each_exit_door_mm is None
