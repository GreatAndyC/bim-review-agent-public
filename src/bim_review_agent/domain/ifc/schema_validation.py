"""IFC schema validation with explicit coverage and object-level evidence."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from functools import lru_cache
from importlib import resources
from typing import Any

import ifcopenshell
from ifcopenshell import validate as ifc_validate

IFC_RELEASES = {
    "IFC4": "IFC4.0.2.1",
    "IFC4_ADD2": "IFC4.0.2.1",
}
_SCHEMA_RE = re.compile(r"FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'", re.IGNORECASE)
_INSTANCE_RE = re.compile(r"#(\d+)\s*=\s*([A-Za-z0-9_]+)", re.IGNORECASE)


@dataclass(frozen=True, slots=True)
class SchemaIssue:
    """A normalized validator observation safe to expose in a report."""

    code: str
    message: str
    level: str = "ERROR"
    entity_id: int | None = None
    ifc_class: str | None = None
    attribute: str | None = None
    details: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "level": self.level,
            "entity_id": self.entity_id,
            "ifc_class": self.ifc_class,
            "attribute": self.attribute,
            "details": self.details,
        }


@dataclass(frozen=True, slots=True)
class SchemaValidationResult:
    """Result of the physical/schema validation stage.

    `passed` means the selected validator found no schema errors. It does not
    mean that a building complies with a jurisdiction rule.
    """

    physical_schema: str
    target_release: str
    passed: bool
    issues: tuple[SchemaIssue, ...]
    coverage: dict[str, Any]

    @property
    def status(self) -> str:
        return "PASS" if self.passed else "FAIL"

    def as_dict(self) -> dict[str, Any]:
        return {
            "physical_schema": self.physical_schema,
            "target_release": self.target_release,
            "status": self.status,
            "passed": self.passed,
            "issue_count": len(self.issues),
            "issues": [issue.as_dict() for issue in self.issues],
            "coverage": self.coverage,
        }


def declared_schema(content: bytes) -> str | None:
    """Return the physical STEP schema token without invoking a parser."""

    header = content[:16_384].decode("latin-1", errors="ignore")
    match = _SCHEMA_RE.search(header)
    return match.group(1).strip().upper() if match else None


@lru_cache(maxsize=1)
def load_ifc4_registry() -> dict[str, Any]:
    """Load the generated local IFC4.0.2.1 comparison registry once per process."""

    path = resources.files("bim_review_agent").joinpath("assets/schema/ifc4.0.2.1.registry.json")
    return json.loads(path.read_text(encoding="utf-8"))


def _instance_context(value: Any) -> tuple[int | None, str | None, str | None]:
    if isinstance(value, ifcopenshell.entity_instance):
        try:
            return value.id(), value.is_a(), str(value)
        except Exception:
            return None, None, None
    if isinstance(value, str):
        match = _INSTANCE_RE.search(value)
        if match:
            return int(match.group(1)), match.group(2), value
        return None, None, value
    return None, None, None


def _issue_code(message: str, attribute: str | None) -> str:
    normalized = f"{message} {attribute or ''}".casefold()
    if "not optional" in normalized:
        return "IFC-SCHEMA-REQUIRED"
    if "invalid attribute value" in normalized or "not valid" in normalized:
        return "IFC-SCHEMA-TYPE"
    if "inverse" in normalized:
        return "IFC-SCHEMA-INVERSE"
    if "globalid" in normalized or "guid" in normalized:
        return "IFC-SCHEMA-GLOBALID"
    if "abstract" in normalized:
        return "IFC-SCHEMA-ABSTRACT"
    if "unique" in normalized:
        return "IFC-SCHEMA-UNIQUE"
    if "where" in normalized or "rule" in normalized:
        return "IFC-SCHEMA-EXPRESS"
    return "IFC-SCHEMA-VALIDATION"


def validate_model(
    model: ifcopenshell.file,
    *,
    content: bytes | None = None,
    target_release: str = "IFC4.0.2.1",
) -> SchemaValidationResult:
    """Run IfcOpenShell's structural/type/inverse/EXPRESS validator.

    The wrapper adds release gating and stable issue normalization. It is
    intentionally separate from information and regulatory rules: a schema
    PASS is only a statement about the model representation.
    """

    physical_schema = (declared_schema(content) if content is not None else None) or str(
        getattr(model, "schema_identifier", None) or model.schema
    ).upper()
    issues: list[SchemaIssue] = []

    resolved_release = IFC_RELEASES.get(physical_schema, physical_schema)
    if resolved_release != target_release:
        issues.append(
            SchemaIssue(
                code="IFC-SCHEMA-UNSUPPORTED-RELEASE",
                message=(
                    f"Physical IFC schema {physical_schema} is not the selected "
                    f"target release {target_release}."
                ),
                details={
                    "physical_schema": physical_schema,
                    "target_release": target_release,
                },
            )
        )
        return SchemaValidationResult(
            physical_schema=physical_schema,
            target_release=target_release,
            passed=False,
            issues=tuple(issues),
            coverage={
                "physical_syntax": content is not None,
                "declaration_and_attribute_types": False,
                "inverse_cardinality": False,
                "globalid_and_application_uniqueness": False,
                "express_rules": False,
                "blocked_by_release": True,
            },
        )

    logger = ifc_validate.json_logger()
    registry = load_ifc4_registry()
    if registry.get("release") != target_release:
        issues.append(
            SchemaIssue(
                code="IFC-SCHEMA-REGISTRY-MISMATCH",
                message=(
                    "The local schema registry release does not match the selected "
                    f"target release {target_release}."
                ),
                details={"registry_release": registry.get("release")},
            )
        )
    try:
        ifc_validate.validate(model, logger, express_rules=True)
    except Exception as exc:
        issues.append(
            SchemaIssue(
                code="IFC-SCHEMA-VALIDATOR-ERROR",
                message=f"The schema validator could not complete: {type(exc).__name__}: {exc}",
            )
        )

    for statement in logger.statements:
        message = str(statement.get("message") or "Schema validation error")
        entity_id, ifc_class, entity_text = _instance_context(statement.get("instance"))
        attribute = statement.get("attribute")
        details: dict[str, Any] = {}
        if entity_text is not None:
            details["entity"] = entity_text
        issues.append(
            SchemaIssue(
                code=_issue_code(message, str(attribute) if attribute else None),
                message=message,
                level=str(statement.get("level") or "ERROR").upper(),
                entity_id=entity_id,
                ifc_class=ifc_class,
                attribute=str(attribute) if attribute else None,
                details=details,
            )
        )

    statistics = registry.get("statistics", {})
    return SchemaValidationResult(
        physical_schema=physical_schema,
        target_release=target_release,
        passed=not issues,
        issues=tuple(issues),
        coverage={
            "physical_syntax": content is not None,
            "declaration_and_attribute_types": True,
            "inverse_cardinality": True,
            "globalid_and_application_uniqueness": True,
            "express_rules": True,
            "validator": "ifcopenshell.validate.validate",
            "local_registry_release": registry.get("release"),
            "local_registry_statistics": statistics,
        },
    )


def validate_ifc_bytes(
    content: bytes,
    *,
    target_release: str = "IFC4.0.2.1",
) -> SchemaValidationResult:
    """Parse and validate IFC bytes, preserving a typed result on failures."""

    try:
        model = ifcopenshell.file.from_string(content.decode("utf-8-sig"))
    except UnicodeDecodeError:
        model = ifcopenshell.file.from_string(content.decode("latin-1"))
    return validate_model(model, content=content, target_release=target_release)
