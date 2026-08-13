from __future__ import annotations

import json
from pathlib import Path

import ifcopenshell
from ifcopenshell.api import root

from bim_review_agent.domain.ifc import validate_ifc_bytes, validate_model
from bim_review_agent.domain.samples import load_sample

ROOT = Path(__file__).resolve().parents[1]


def test_local_ifc4_registry_preserves_schema_dimensions() -> None:
    registry = json.loads(
        (ROOT / "src/bim_review_agent/assets/schema/ifc4.0.2.1.registry.json").read_text(
            encoding="utf-8"
        )
    )
    assert registry["schema_id"] == "IFC4"
    assert registry["release"] == "IFC4.0.2.1"
    assert registry["statistics"] == {
        "defined_types": 130,
        "direct_attribute_slots": 1491,
        "effective_attribute_slots": 5264,
        "entity_types": 776,
        "enumerations": 207,
        "inverse_attribute_slots": 6337,
        "property_set_templates": 513,
        "schema_declarations": 1173,
        "select_types": 60,
        "unique_direct_attribute_names": 854,
    }
    assert "IfcWall" in registry["declarations"]["entities"]
    assert "Pset_DoorCommon" in registry["property_sets"]
    assert "FireExit" in {
        item["name"] for item in registry["property_sets"]["Pset_DoorCommon"]["properties"]
    }
    assert "ClearWidth" not in {
        item["name"] for item in registry["property_sets"]["Pset_DoorCommon"]["properties"]
    }


def test_clean_fixture_passes_ifc4_schema_validation() -> None:
    sample, content = load_sample("clean")
    result = validate_ifc_bytes(content)
    assert sample.filename.endswith(".ifc")
    assert result.passed is True
    assert result.status == "PASS"
    assert result.physical_schema == "IFC4"
    assert result.target_release == "IFC4.0.2.1"
    assert result.coverage["express_rules"] is True


def test_duplicate_global_id_is_reported_as_schema_evidence() -> None:
    model = ifcopenshell.file(schema="IFC4")
    project = root.create_entity(model, ifc_class="IfcProject", name="Project")
    door = root.create_entity(model, ifc_class="IfcDoor", name="Door")
    door.GlobalId = project.GlobalId

    result = validate_model(model)

    assert result.passed is False
    assert any(issue.entity_id == door.id() for issue in result.issues)
    assert any(issue.code == "IFC-SCHEMA-GLOBALID" for issue in result.issues)


def test_schema_release_mismatch_blocks_validation() -> None:
    model = ifcopenshell.file(schema="IFC4")
    result = validate_model(
        model,
        content=b"FILE_SCHEMA(('IFC4X3_ADD2'));",
    )
    assert result.passed is False
    assert result.issues[0].code == "IFC-SCHEMA-UNSUPPORTED-RELEASE"
    assert result.coverage["blocked_by_release"] is True
