"""INFO-001: configured information completeness for IFC doors."""

from __future__ import annotations

from typing import Any

from bim_review_agent.domain.ifc import DoorFacts, ExtractedModel, Fact
from bim_review_agent.domain.models import (
    Finding,
    FindingStatus,
    ModelEvidence,
    Observation,
    Reliability,
    Severity,
)
from bim_review_agent.domain.rules.common import (
    explicit_bool,
    finding_id,
    observation_from_fact,
    rule_evidence,
)
from bim_review_agent.domain.rules.rule_pack import RulePackConfig


def _applicability_observation(door: DoorFacts) -> Observation:
    return observation_from_fact(
        label="Exit classification",
        fact=door.fire_exit,
        normalized_value=explicit_bool(door.fire_exit.value),
    )


def _missing_fact(source_path: str) -> Fact:
    return Fact(value=None, source_path=source_path, reliability=Reliability.MISSING)


def _fact_for_requirement(door: DoorFacts, field: str, source_path: str) -> Fact:
    if field == "name":
        return door.name
    if field == "fire_rating":
        return door.fire_rating
    if field == "fire_exit":
        return door.fire_exit
    if field == "clear_width":
        return door.explicit_widths[0] if door.explicit_widths else _missing_fact(source_path)
    if field == "occupant_capacity":
        return door.occupant_capacity
    raise ValueError(f"Unsupported INFO-001 field: {field}")


def _usable_fact(fact: Fact, field: str) -> bool:
    if fact.is_missing:
        return False
    if field == "fire_exit":
        return explicit_bool(fact.value) is not None
    if field in {"name", "fire_rating"}:
        return isinstance(fact.value, str) and bool(fact.value.strip())
    if field in {"clear_width", "occupant_capacity"}:
        if isinstance(fact.value, bool):
            return False
        try:
            value = float(fact.value)
        except (TypeError, ValueError):
            return False
        if value <= 0:
            return False
        return field != "occupant_capacity" or value.is_integer()
    return True


def _normalized_value(fact: Fact, field: str) -> Any:
    if field == "fire_exit":
        return explicit_bool(fact.value)
    if field in {"clear_width", "occupant_capacity"} and not isinstance(fact.value, bool):
        try:
            number = float(fact.value)
        except (TypeError, ValueError):
            return None
        return int(number) if number.is_integer() else number
    return str(fact.value).strip() if not fact.is_missing else None


def evaluate_info_001(model: ExtractedModel, pack: RulePackConfig) -> list[Finding]:
    config = pack.info
    if not config.enabled:
        return []

    findings: list[Finding] = []
    for door in model.doors:
        for requirement in config.requirements:
            applicability_signal: Observation | None = None
            if requirement.applicability == "confirmed_exit_doors":
                if explicit_bool(door.fire_exit.value) is not True:
                    continue
                applicability = "Confirmed exit door via explicit model property."
                applicability_signal = _applicability_observation(door)
            else:
                applicability = (
                    "Applies to every IfcDoor so the review can establish whether exit rules apply."
                    if requirement.field == "fire_exit"
                    else (
                        "Applies to every IfcDoor in the information-readiness profile."
                        if pack.id != "hku-demo-2026"
                        else "Applies to every IfcDoor in the demo project rule pack."
                    )
                )

            fact = _fact_for_requirement(door, requirement.field, requirement.source_path)
            present = _usable_fact(fact, requirement.field)
            status = FindingStatus.PASS if present else FindingStatus.REVIEW
            severity = Severity.INFO if present else Severity.WARNING
            entity_name = door.entity.name or "Unnamed door"
            explicit_exit = explicit_bool(fact.value)
            if present and requirement.field == "fire_exit":
                message = (
                    f"{entity_name} is explicitly classified as an exit door."
                    if explicit_exit
                    else f"{entity_name} is explicitly classified as a non-exit door."
                )
                recommendation = "No action is required for this classification field."
            elif present:
                message = f"{requirement.label} is present for {entity_name}."
                recommendation = "No action is required for this configured information field."
            elif requirement.field == "fire_exit":
                message = f"{entity_name} has no explicit exit classification."
                recommendation = (
                    "Set Pset_DoorCommon.FireExit to TRUE or FALSE from the documented design intent; "
                    "do not infer it from the element name."
                )
            elif requirement.field == "fire_rating":
                message = (
                    f"{entity_name} is a confirmed exit door but has no usable FireRating evidence."
                )
                recommendation = (
                    "Confirm the applicable fire-resistance classification and populate "
                    "Pset_DoorCommon.FireRating; do not infer it from the element name."
                )
            else:
                message = f"{requirement.label} is missing or invalid for {entity_name}."
                recommendation = (
                    f"Confirm the intended value and populate {requirement.source_path}; "
                    "do not infer it from the element name."
                )

            findings.append(
                Finding(
                    finding_id=finding_id(config.id, door.entity.global_id, requirement.key),
                    rule_id=config.id,
                    rule_title=config.title,
                    category=config.category,
                    status=status,
                    severity=severity,
                    entity=door.entity,
                    applicability=applicability,
                    message=message,
                    recommendation=recommendation,
                    model_evidence=ModelEvidence(
                        applicability_signal=applicability_signal,
                        observations=[
                            observation_from_fact(
                                label=requirement.label,
                                fact=fact,
                                normalized_value=_normalized_value(fact, requirement.field),
                            )
                        ],
                    ),
                    rule_evidence=rule_evidence(
                        pack=pack,
                        rule_id=config.id,
                        title=config.title,
                        version=config.version,
                        parameters={
                            "requirement_key": requirement.key,
                            "required_field": requirement.source_path,
                            "applicability": requirement.applicability,
                            "missing_outcome": requirement.missing_status,
                        },
                    ),
                )
            )
    return findings
