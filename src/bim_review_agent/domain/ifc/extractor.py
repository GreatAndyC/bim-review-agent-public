"""Extract IFC facts with provenance; never assign compliance outcomes here."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

import ifcopenshell
from ifcopenshell.util import element as element_util
from ifcopenshell.util import unit as unit_util

from bim_review_agent.domain.errors import ReviewInputError
from bim_review_agent.domain.models import EntityRef, ModelInventory, Reliability


@dataclass(frozen=True, slots=True)
class Fact:
    value: Any
    source_path: str
    reliability: Reliability
    note: str | None = None

    @property
    def is_missing(self) -> bool:
        return self.value is None or (isinstance(self.value, str) and not self.value.strip())


@dataclass(frozen=True, slots=True)
class DoorFacts:
    entity: EntityRef
    name: Fact
    fire_exit: Fact
    fire_rating: Fact
    explicit_widths: tuple[Fact, ...]
    overall_width: Fact
    occupant_capacity: Fact
    name_exit_candidate: bool
    length_to_metre_scale: float
    length_unit: str
    length_unit_known: bool


@dataclass(frozen=True, slots=True)
class ExtractedModel:
    inventory: ModelInventory
    doors: tuple[DoorFacts, ...]


_EXIT_PATTERN = re.compile(r"\b(exit|emergency|egress)\b", re.IGNORECASE)


def _decode_step(content: bytes) -> str:
    try:
        return content.decode("utf-8-sig")
    except UnicodeDecodeError:
        # IFC STEP files are commonly ASCII-compatible. Latin-1 preserves every byte
        # without guessing or executing any external reference.
        return content.decode("latin-1")


def _value_from_pset(
    psets: dict[str, dict[str, Any]],
    pset_name: str,
    property_name: str,
) -> tuple[Any, str] | None:
    for actual_pset_name, properties in psets.items():
        if actual_pset_name.casefold() != pset_name.casefold():
            continue
        for actual_property_name, value in properties.items():
            if actual_property_name == "id":
                continue
            if actual_property_name.casefold() == property_name.casefold():
                return value, f"{actual_pset_name}.{actual_property_name}"
    return None


def _first_property(
    psets: dict[str, dict[str, Any]],
    paths: tuple[tuple[str, str], ...],
    *,
    missing_path: str,
) -> Fact:
    for pset_name, property_name in paths:
        result = _value_from_pset(psets, pset_name, property_name)
        if result is not None:
            value, actual_path = result
            return Fact(value=value, source_path=actual_path, reliability=Reliability.EXPLICIT)
    return Fact(value=None, source_path=missing_path, reliability=Reliability.MISSING)


def _storey_name(product: Any) -> str | None:
    try:
        container = element_util.get_container(product)
    except (AttributeError, RuntimeError):
        return None
    if container is None:
        return None
    name = getattr(container, "Name", None)
    return str(name) if name else None


def _entity_ref(door: Any) -> EntityRef:
    return EntityRef(
        ifc_class=door.is_a(),
        global_id=str(getattr(door, "GlobalId", None) or f"ifc-id-{door.id()}"),
        name=getattr(door, "Name", None),
        object_type=getattr(door, "ObjectType", None),
        tag=getattr(door, "Tag", None),
        storey=_storey_name(door),
    )


def _extract_door(
    door: Any, length_scale: float, length_unit: str, length_unit_known: bool
) -> DoorFacts:
    psets = element_util.get_psets(door, psets_only=True)
    name_value = getattr(door, "Name", None)
    name = Fact(
        value=name_value,
        source_path="IfcDoor.Name",
        reliability=Reliability.EXPLICIT if name_value else Reliability.MISSING,
    )
    fire_exit = _first_property(
        psets,
        (
            ("Pset_DoorCommon", "FireExit"),
            ("Pset_BIMReview", "IsExit"),
        ),
        missing_path="Pset_DoorCommon.FireExit",
    )
    fire_rating = _first_property(
        psets,
        (("Pset_DoorCommon", "FireRating"),),
        missing_path="Pset_DoorCommon.FireRating",
    )
    occupant_capacity = _first_property(
        psets,
        (("Pset_BIMReview", "OccupantCapacity"),),
        missing_path="Pset_BIMReview.OccupantCapacity",
    )

    explicit_widths: list[Fact] = []
    for pset_name, property_name in (
        ("Pset_BIMReview", "ClearWidth"),
        ("Pset_DoorCommon", "ClearWidth"),
    ):
        result = _value_from_pset(psets, pset_name, property_name)
        if result is not None:
            value, actual_path = result
            explicit_widths.append(
                Fact(
                    value=value,
                    source_path=actual_path,
                    reliability=Reliability.EXPLICIT,
                    note="Reported clear-opening width in project length units.",
                )
            )

    overall_value = getattr(door, "OverallWidth", None)
    overall_width = Fact(
        value=overall_value,
        source_path="IfcDoor.OverallWidth",
        reliability=Reliability.PROXY if overall_value is not None else Reliability.MISSING,
        note=(
            "OverallWidth is a nominal door width and is not silently treated as clear opening."
            if overall_value is not None
            else None
        ),
    )
    candidate_text = " ".join(
        value
        for value in (name_value, getattr(door, "ObjectType", None), getattr(door, "Tag", None))
        if isinstance(value, str)
    )
    return DoorFacts(
        entity=_entity_ref(door),
        name=name,
        fire_exit=fire_exit,
        fire_rating=fire_rating,
        explicit_widths=tuple(explicit_widths),
        overall_width=overall_width,
        occupant_capacity=occupant_capacity,
        name_exit_candidate=bool(_EXIT_PATTERN.search(candidate_text)),
        length_to_metre_scale=length_scale,
        length_unit=length_unit,
        length_unit_known=length_unit_known,
    )


def extract_model(content: bytes) -> ExtractedModel:
    """Parse an IFC STEP payload and return normalized facts with provenance."""

    try:
        model = ifcopenshell.file.from_string(_decode_step(content))
    except Exception as exc:  # IfcOpenShell exposes parser faults as several runtime types.
        raise ReviewInputError(
            code="invalid_ifc",
            message="IfcOpenShell could not parse this file as a valid IFC STEP model.",
            recovery="Re-export the model as IFC2X3 or IFC4, or run one of the bundled samples.",
            status_code=422,
        ) from exc

    try:
        length_scale = float(unit_util.calculate_unit_scale(model))
    except (AttributeError, RuntimeError, TypeError, ValueError):
        length_scale = 1.0

    try:
        length_unit_entity = unit_util.get_project_unit(model, "LENGTHUNIT")
        length_unit_known = length_unit_entity is not None
        length_unit = (
            unit_util.get_unit_symbol(length_unit_entity)
            if length_unit_entity is not None
            else "unknown"
        )
    except (AttributeError, RuntimeError, TypeError):
        length_unit = "unknown"
        length_unit_known = False

    count_classes = (
        "IfcProject",
        "IfcSite",
        "IfcBuilding",
        "IfcBuildingStorey",
        "IfcSpace",
        "IfcDoor",
        "IfcWall",
        "IfcSlab",
        "IfcBeam",
    )
    entity_counts = {name: len(model.by_type(name)) for name in count_classes}
    inventory = ModelInventory(
        schema_name=str(model.schema),
        length_unit=str(length_unit),
        length_unit_known=length_unit_known,
        length_to_metre_scale=length_scale,
        total_entities=len(list(model)),
        entity_counts=entity_counts,
    )
    doors = tuple(
        _extract_door(door, length_scale, str(length_unit), length_unit_known)
        for door in sorted(model.by_type("IfcDoor"), key=lambda item: item.id())
    )
    return ExtractedModel(inventory=inventory, doors=doors)
