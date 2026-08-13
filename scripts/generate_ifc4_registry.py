"""Generate the local IFC4.0.2.1 schema/property-set comparison registry.

The registry is derived from the pinned IfcOpenShell IFC4 reflection and its
IFC4 ADD2 property-set template corpus. It is a decoder/index for the review
engine, not a replacement for the EXPRESS validator. Re-run this script only
when the pinned schema/runtime source changes and review the generated hash.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import ifcopenshell
from ifcopenshell import ifcopenshell_wrapper as wrapper

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "src/bim_review_agent/assets/schema/ifc4.0.2.1.registry.json"
PSET_SOURCE = (
    Path(ifcopenshell.__file__).resolve().parent / "util" / "schema" / "Pset_IFC4_ADD2.ifc"
)


def _kind(declaration: Any) -> str:
    if declaration.as_entity() is not None:
        return "entity"
    if declaration.as_type_declaration() is not None:
        return "defined_type"
    if declaration.as_enumeration_type() is not None:
        return "enumeration"
    if declaration.as_select_type() is not None:
        return "select"
    return "unknown"


def _type_descriptor(value: Any) -> dict[str, Any]:
    if isinstance(value, wrapper.aggregation_type):
        return {
            "kind": "aggregation",
            "aggregation": value.type_of_aggregation_string(),
            "lower": value.bound1(),
            "upper": None if value.bound2() == -1 else value.bound2(),
            "element": _type_descriptor(value.type_of_element()),
        }
    if isinstance(value, wrapper.named_type):
        return {
            "kind": "named",
            "name": value.declared_type().name(),
            "declared": _type_descriptor(value.declared_type()),
        }
    if isinstance(value, wrapper.simple_type):
        return {"kind": "simple", "name": value.declared_type()}
    if isinstance(value, wrapper.entity):
        return {"kind": "entity", "name": value.name()}
    if isinstance(value, wrapper.type_declaration):
        return {
            "kind": "defined_type",
            "name": value.name(),
            "declared": _type_descriptor(value.declared_type()),
        }
    if isinstance(value, wrapper.enumeration_type):
        return {
            "kind": "enumeration",
            "name": value.name(),
            "items": list(value.enumeration_items()),
        }
    if isinstance(value, wrapper.select_type):
        return {
            "kind": "select",
            "name": value.name(),
            "members": [_declaration_reference(item) for item in value.select_list()],
        }
    raise TypeError(f"Unsupported IFC type reflection: {type(value).__name__}")


def _declaration_reference(declaration: Any) -> dict[str, str]:
    return {"kind": _kind(declaration), "name": declaration.name()}


def _attribute(attribute: Any, index: int) -> dict[str, Any]:
    return {
        "index": index,
        "name": attribute.name(),
        "optional": bool(attribute.optional()),
        "type": _type_descriptor(attribute.type_of_attribute()),
    }


def _inverse(attribute: Any) -> dict[str, Any]:
    return {
        "name": attribute.name(),
        "entity": attribute.entity_reference().name(),
        "attribute": attribute.attribute_reference().name(),
        "aggregation": attribute.type_of_aggregation_string() or None,
        "lower": attribute.bound1(),
        "upper": None if attribute.bound2() == -1 else attribute.bound2(),
    }


def _entity_record(entity: Any) -> dict[str, Any]:
    direct = tuple(entity.attributes())
    effective = tuple(entity.all_attributes())
    return {
        "name": entity.name(),
        "abstract": bool(entity.is_abstract()),
        "supertype": entity.supertype().name() if entity.supertype() else None,
        "subtypes": sorted(item.name() for item in entity.subtypes()),
        "direct_attributes": [_attribute(item, index) for index, item in enumerate(direct)],
        "effective_attributes": [_attribute(item, index) for index, item in enumerate(effective)],
        "derived": [bool(item) for item in entity.derived()],
        "inverse_attributes": [_inverse(item) for item in entity.all_inverse_attributes()],
    }


def _declaration_record(declaration: Any) -> dict[str, Any]:
    kind = _kind(declaration)
    if kind == "entity":
        return _entity_record(declaration.as_entity())
    if kind == "defined_type":
        return {
            "name": declaration.name(),
            "declared": _type_descriptor(declaration.as_type_declaration().declared_type()),
        }
    if kind == "enumeration":
        return {
            "name": declaration.name(),
            "items": list(declaration.as_enumeration_type().enumeration_items()),
        }
    if kind == "select":
        return {
            "name": declaration.name(),
            "members": [
                _declaration_reference(item) for item in declaration.as_select_type().select_list()
            ],
        }
    raise TypeError(f"Unsupported IFC declaration: {declaration.name()}")


def _property_set_registry() -> dict[str, Any]:
    model = ifcopenshell.open(str(PSET_SOURCE))
    sets: dict[str, Any] = {}
    for template in model.by_type("IfcPropertySetTemplate"):
        name = str(template.Name)
        properties: list[dict[str, Any]] = []
        for prop in template.HasPropertyTemplates or ():
            item: dict[str, Any] = {
                "name": str(prop.Name),
                "template_type": str(prop.TemplateType),
                "primary_measure_type": getattr(prop, "PrimaryMeasureType", None),
                "description": getattr(prop, "Description", None),
            }
            enumerators = getattr(prop, "Enumerators", None)
            if enumerators is not None:
                item["enumerators"] = [
                    str(value.wrappedValue) for value in (enumerators.EnumerationValues or ())
                ]
            properties.append(item)
        sets[name] = {
            "template_type": str(template.TemplateType),
            "applicable_entity": getattr(template, "ApplicableEntity", None),
            "description": getattr(template, "Description", None),
            "properties": properties,
        }
    return dict(sorted(sets.items()))


def build_registry() -> dict[str, Any]:
    schema = wrapper.schema_by_name("IFC4")
    declarations = list(schema.declarations())
    entities = [item for item in declarations if _kind(item) == "entity"]
    defined_types = [item for item in declarations if _kind(item) == "defined_type"]
    enumerations = [item for item in declarations if _kind(item) == "enumeration"]
    selects = [item for item in declarations if _kind(item) == "select"]
    entity_records = {item.name(): _entity_record(item.as_entity()) for item in entities}
    direct_names = sorted(
        {
            attribute["name"]
            for entity in entity_records.values()
            for attribute in entity["direct_attributes"]
        }
    )
    property_sets = _property_set_registry()
    registry = {
        "registry_version": "1.0.0",
        "schema_id": "IFC4",
        "release": "IFC4.0.2.1",
        "physical_schema_names": ["IFC4"],
        "source": {
            "publisher": "buildingSMART / IfcOpenShell reflection",
            "schema_url": "https://technical.buildingsmart.org/standards/ifc/ifc-schema-specifications/",
            "release_notes_url": "https://technical.buildingsmart.org/standards/ifc/ifc-schema-specifications/ifc-release-notes/",
            "ifcopenshell_version": getattr(ifcopenshell, "__version__", "unknown"),
            # Keep generated metadata portable; do not embed the generator's
            # local virtual-environment path in a public artifact.
            "property_set_source": "ifcopenshell/util/schema/Pset_IFC4_ADD2.ifc",
        },
        "declarations": {
            "entities": entity_records,
            "defined_types": {item.name(): _declaration_record(item) for item in defined_types},
            "enumerations": {item.name(): _declaration_record(item) for item in enumerations},
            "select_types": {item.name(): _declaration_record(item) for item in selects},
        },
        "property_sets": property_sets,
        "validation": {
            "attribute_and_inverse_executor": "ifcopenshell.validate.validate",
            "express_executor": "ifcopenshell.express.rule_executor",
            "requires_express_rules": True,
            "coverage_note": (
                "The registry stores declarations and property-set templates; executable "
                "EXPRESS constraints are delegated to the pinned validator and must be "
                "reported in the validation coverage manifest."
            ),
        },
        "derived_indexes": {
            "entity_names": sorted(item.name() for item in entities),
            "defined_type_names": sorted(item.name() for item in defined_types),
            "enumeration_names": sorted(item.name() for item in enumerations),
            "select_names": sorted(item.name() for item in selects),
            "unique_direct_attribute_names": direct_names,
            "property_set_names": sorted(property_sets),
        },
        "statistics": {
            "entity_types": len(entities),
            "defined_types": len(defined_types),
            "enumerations": len(enumerations),
            "select_types": len(selects),
            "schema_declarations": len(declarations),
            "direct_attribute_slots": sum(
                len(entity["direct_attributes"]) for entity in entity_records.values()
            ),
            "unique_direct_attribute_names": len(direct_names),
            "effective_attribute_slots": sum(
                len(entity["effective_attributes"]) for entity in entity_records.values()
            ),
            "inverse_attribute_slots": sum(
                len(entity["inverse_attributes"]) for entity in entity_records.values()
            ),
            "property_set_templates": len(property_sets),
        },
    }
    return registry


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    registry = build_registry()
    content = json.dumps(registry, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(content, encoding="utf-8")
    digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
    try:
        display_path = str(args.output.relative_to(ROOT))
    except ValueError:
        display_path = str(args.output)
    print(f"Wrote {display_path} ({len(content.encode('utf-8'))} bytes, sha256={digest[:16]}...)")
    print(json.dumps(registry["statistics"], ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
