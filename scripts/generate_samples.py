"""Generate small, synthetic IFC4 fixtures for the demo and automated tests."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from pathlib import Path

import ifcopenshell
from ifcopenshell.api import aggregate, pset, root, spatial, unit

PROJECT_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = PROJECT_ROOT / "src/bim_review_agent/assets/samples"


@dataclass(frozen=True, slots=True)
class DoorSpec:
    key: str
    name: str | None
    fire_exit: bool | None
    fire_rating: str | None = None
    occupant_capacity: int | None = None
    clear_width_mm: float | None = None
    overall_width_mm: float | None = None
    object_type: str | None = None
    tag: str | None = None


def _stable_guid(sample_id: str, key: str) -> str:
    value = uuid.uuid5(uuid.NAMESPACE_URL, f"bim-review-agent/{sample_id}/{key}")
    return ifcopenshell.guid.compress(value.hex)


def _set_stable_root_guids(model: ifcopenshell.file, sample_id: str) -> None:
    for index, entity in enumerate(model.by_type("IfcRoot"), start=1):
        name = getattr(entity, "Name", None) or "unnamed"
        entity.GlobalId = _stable_guid(sample_id, f"{index}:{entity.is_a()}:{name}")


def _sort_unordered_ifc_collections(model: ifcopenshell.file) -> None:
    """Stabilize IFC SET-valued attributes that APIs may assemble via Python sets."""

    for relation in model.by_type("IfcRelContainedInSpatialStructure"):
        relation.RelatedElements = tuple(
            sorted(relation.RelatedElements, key=lambda item: item.id())
        )
    for relation in model.by_type("IfcRelAggregates"):
        relation.RelatedObjects = tuple(sorted(relation.RelatedObjects, key=lambda item: item.id()))
    for relation in model.by_type("IfcRelDefinesByProperties"):
        relation.RelatedObjects = tuple(sorted(relation.RelatedObjects, key=lambda item: item.id()))
    for property_set in model.by_type("IfcPropertySet"):
        property_set.HasProperties = tuple(
            sorted(property_set.HasProperties, key=lambda item: (item.Name or "", item.id()))
        )
    for assignment in model.by_type("IfcUnitAssignment"):
        assignment.Units = tuple(sorted(assignment.Units, key=lambda item: item.id()))


def build_model(sample_id: str, title: str, doors: list[DoorSpec]) -> ifcopenshell.file:
    model = ifcopenshell.file(schema="IFC4")
    project = root.create_entity(model, ifc_class="IfcProject", name=f"{title} Project")
    site = root.create_entity(model, ifc_class="IfcSite", name="Demo Site")
    building = root.create_entity(model, ifc_class="IfcBuilding", name="Demo Building")
    storey = root.create_entity(model, ifc_class="IfcBuildingStorey", name="Level 01")
    aggregate.assign_object(model, products=[site], relating_object=project)
    aggregate.assign_object(model, products=[building], relating_object=site)
    aggregate.assign_object(model, products=[storey], relating_object=building)
    unit.assign_unit(model)  # Millimetres, square metres, and cubic metres for test clarity.

    created_doors = []
    for spec in doors:
        door = root.create_entity(model, ifc_class="IfcDoor", name=spec.name)
        door.Tag = spec.tag or spec.key
        door.ObjectType = spec.object_type
        door.OverallHeight = 2100.0
        door.OverallWidth = spec.overall_width_mm

        common_properties = {}
        if spec.fire_exit is not None:
            common_properties["FireExit"] = spec.fire_exit
        if spec.fire_rating is not None:
            common_properties["FireRating"] = spec.fire_rating
        if common_properties:
            common = pset.add_pset(model, product=door, name="Pset_DoorCommon")
            pset.edit_pset(model, pset=common, properties=common_properties)

        review_property_values = {}
        if spec.clear_width_mm is not None:
            review_property_values["ClearWidth"] = model.createIfcLengthMeasure(spec.clear_width_mm)
        if spec.occupant_capacity is not None:
            review_property_values["OccupantCapacity"] = spec.occupant_capacity
        if review_property_values:
            review_pset = pset.add_pset(model, product=door, name="Pset_BIMReview")
            pset.edit_pset(
                model,
                pset=review_pset,
                properties=review_property_values,
            )
        created_doors.append(door)

    spatial.assign_container(model, products=created_doors, relating_structure=storey)
    _sort_unordered_ifc_collections(model)
    _set_stable_root_guids(model, sample_id)

    model.header.file_description.description = ("ViewDefinition [ReferenceView]",)
    model.header.file_name.name = f"{sample_id}.ifc"
    model.header.file_name.time_stamp = "2026-08-09T00:00:00"
    model.header.file_name.author = ("BIM Review Agent",)
    model.header.file_name.organization = ("Synthetic assessment fixtures",)
    model.header.file_name.preprocessor_version = "IfcOpenShell 0.8.5"
    model.header.file_name.originating_system = "BIM Review Agent sample generator"
    model.header.file_name.authorization = "Synthetic data — no project information"
    return model


SAMPLES: dict[str, tuple[str, list[DoorSpec]]] = {
    "clean": (
        "Clean Review",
        [
            DoorSpec(
                key="D-01",
                name="Lobby Exit D-01",
                fire_exit=True,
                fire_rating="60min",
                occupant_capacity=31,
                clear_width_mm=950,
                overall_width_mm=1000,
                object_type="Single swing fire exit",
            ),
            DoorSpec(
                key="D-02",
                name="Meeting Room Door D-02",
                fire_exit=False,
                overall_width_mm=900,
                object_type="Internal door",
            ),
        ],
    ),
    "narrow_exit": (
        "Narrow Exit",
        [
            DoorSpec(
                key="D-03",
                name="Service Exit D-03",
                fire_exit=True,
                fire_rating="60min",
                occupant_capacity=31,
                clear_width_mm=820,
                overall_width_mm=900,
                object_type="Single swing fire exit",
            )
        ],
    ),
    "missing_information": (
        "Missing Information",
        [
            DoorSpec(
                key="D-04",
                name=None,
                fire_exit=True,
                fire_rating=None,
                occupant_capacity=31,
                clear_width_mm=950,
                overall_width_mm=1000,
                object_type="Single swing fire exit",
            )
        ],
    ),
    "proxy_width": (
        "Proxy Width",
        [
            DoorSpec(
                key="D-05",
                name="East Exit D-05",
                fire_exit=True,
                fire_rating="60min",
                occupant_capacity=31,
                clear_width_mm=None,
                overall_width_mm=950,
                object_type="Single swing fire exit",
            )
        ],
    ),
    "mixed_review": (
        "Mixed Review",
        [
            DoorSpec(
                key="D-10",
                name="Lobby Exit D-10",
                fire_exit=True,
                fire_rating="60min",
                occupant_capacity=31,
                clear_width_mm=950,
                overall_width_mm=1000,
                object_type="Single swing fire exit",
            ),
            DoorSpec(
                key="D-11",
                name="Service Exit D-11",
                fire_exit=True,
                fire_rating=None,
                occupant_capacity=31,
                clear_width_mm=820,
                overall_width_mm=900,
                object_type="Single swing fire exit",
            ),
            DoorSpec(
                key="D-12",
                name="Emergency Exit Candidate D-12",
                fire_exit=None,
                clear_width_mm=None,
                overall_width_mm=930,
                object_type="Door awaiting classification",
            ),
            DoorSpec(
                key="D-13",
                name=None,
                fire_exit=False,
                overall_width_mm=850,
                object_type="Internal door",
            ),
        ],
    ),
}


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for sample_id, (title, doors) in SAMPLES.items():
        model = build_model(sample_id, title, doors)
        output_path = OUTPUT_DIR / f"{sample_id}.ifc"
        output_path.write_text(model.to_string(), encoding="utf-8")
        print(f"generated {output_path.relative_to(PROJECT_ROOT)}")


if __name__ == "__main__":
    main()
