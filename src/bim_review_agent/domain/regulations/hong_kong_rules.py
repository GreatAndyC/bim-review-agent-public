"""Deterministic Hong Kong Table B2 door-width evaluation."""

from __future__ import annotations

import math
from typing import Any

from bim_review_agent.domain.ifc import DoorFacts, ExtractedModel
from bim_review_agent.domain.models import (
    AuthorityType,
    Finding,
    FindingStatus,
    ModelEvidence,
    Observation,
    Reliability,
    RuleEvidence,
    Severity,
)
from bim_review_agent.domain.regulations.hong_kong import HongKongRulePack
from bim_review_agent.domain.rules.common import explicit_bool, finding_id, observation_from_fact


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number > 0 else None


def _evidence(pack: HongKongRulePack, *, parameters: dict[str, Any]) -> RuleEvidence:
    rule = pack.door_width_rule
    return RuleEvidence(
        rule_id=rule.id,
        title=rule.title,
        version=rule.version,
        authority=AuthorityType.AUTHORITATIVE_STANDARD,
        source_title=(
            f"{pack.source.title} ({pack.source.edition} Edition) — {rule.clause_or_table}"
        ),
        jurisdiction="Hong Kong",
        clause=rule.clause_or_table,
        parameters={
            **parameters,
            "source_url": pack.source.url,
            "source_landing_page": pack.source.landing_page,
            "source_edition": pack.source.edition,
            "source_retrieved_on": pack.source.retrieved_on,
            "missing_evidence_outcome": rule.missing_evidence_outcome,
        },
        limitation=pack.source.notes,
    )


def _missing_finding(
    door: DoorFacts,
    pack: HongKongRulePack,
    *,
    message: str,
    recommendation: str,
    observations: list[Observation],
    key: str,
    reason: str,
) -> Finding:
    rule = pack.door_width_rule
    return Finding(
        finding_id=finding_id(rule.id, door.entity.global_id, key),
        rule_id=rule.id,
        rule_title=rule.title,
        category="Hong Kong fire safety / means of escape",
        status=FindingStatus.REVIEW,
        severity=Severity.WARNING,
        entity=door.entity,
        applicability="Confirmed exit door; Table B2 applicability requires additional model evidence.",
        message=message,
        recommendation=recommendation,
        model_evidence=ModelEvidence(
            applicability_signal=observation_from_fact(
                label="Exit classification",
                fact=door.fire_exit,
                normalized_value=explicit_bool(door.fire_exit.value),
            ),
            observations=observations,
        ),
        rule_evidence=_evidence(
            pack,
            parameters={
                "outcome_reason": reason,
                "measurement_definition": "least clear width between vertical door-frame members",
            },
        ),
    )


def _evaluate_door(door: DoorFacts, pack: HongKongRulePack) -> Finding | None:
    if explicit_bool(door.fire_exit.value) is not True:
        return None

    observations: list[Observation] = [
        observation_from_fact(
            label="Occupant capacity",
            fact=door.occupant_capacity,
            normalized_value=_number(door.occupant_capacity.value),
        )
    ]
    widths: list[float] = []
    for fact in door.explicit_widths:
        normalized = (
            _number(fact.value) * door.length_to_metre_scale * 1000.0
            if door.length_unit_known and _number(fact.value) is not None
            else None
        )
        if normalized is not None:
            widths.append(round(normalized, 3))
        observations.append(
            observation_from_fact(
                label="Reported clear width",
                fact=fact,
                normalized_value=round(normalized, 3) if normalized is not None else None,
                unit="mm" if normalized is not None else None,
            )
        )
    if not widths:
        observations.append(
            Observation(
                label="Clear width evidence",
                raw_value=None,
                normalized_value=None,
                unit=None,
                source_path="Pset_BIMReview.ClearWidth",
                reliability=Reliability.MISSING,
                note="OverallWidth is not accepted as clear-opening evidence for this rule.",
            )
        )

    capacity = _number(door.occupant_capacity.value)
    if capacity is None or capacity != int(capacity):
        return _missing_finding(
            door,
            pack,
            message=(
                f"{door.entity.name or 'Unnamed door'} cannot be evaluated against Hong Kong "
                "Table B2 because occupant capacity is missing or invalid."
            ),
            recommendation=(
                "Provide a verified occupant capacity and its room/storey mapping, then rerun "
                "the Hong Kong fire-safety profile."
            ),
            observations=observations,
            key="occupant-capacity-missing",
            reason="occupant_capacity_missing_or_invalid",
        )

    row = pack.width_row(int(capacity))
    if row is None or row.min_each_exit_door_mm is None:
        return _missing_finding(
            door,
            pack,
            message=(
                f"{door.entity.name or 'Unnamed door'} is outside the directly machine-checkable "
                "Table B2 range or requires Building Authority determination."
            ),
            recommendation="Escalate the case to a qualified Hong Kong code reviewer.",
            observations=observations,
            key="table-row-not-machine-checkable",
            reason="table_row_requires_authority_or_engineering_judgement",
        )

    if not widths or not door.length_unit_known:
        return _missing_finding(
            door,
            pack,
            message=(
                f"{door.entity.name or 'Unnamed door'} has insufficient clear-width or unit "
                "evidence for the Table B2 comparison."
            ),
            recommendation=(
                "Provide a measured clear opening and a project LENGTHUNIT; nominal OverallWidth "
                "alone is not sufficient."
            ),
            observations=observations,
            key="clear-width-missing",
            reason="clear_width_or_project_unit_missing",
        )

    width_mm = widths[0]
    minimum = row.min_each_exit_door_mm
    passed = width_mm >= minimum
    rule = pack.door_width_rule
    return Finding(
        finding_id=finding_id(rule.id, door.entity.global_id, "clear-width"),
        rule_id=rule.id,
        rule_title=rule.title,
        category="Hong Kong fire safety / means of escape",
        status=FindingStatus.PASS if passed else FindingStatus.FAIL,
        severity=Severity.INFO if passed else Severity.ERROR,
        entity=door.entity,
        applicability=(
            "Confirmed exit door; occupant capacity selects the applicable Table B2 row."
        ),
        message=(
            f"{door.entity.name or 'Unnamed door'} reports {width_mm:g} mm clear width; "
            f"the Table B2 minimum for {int(capacity)} occupants is {minimum:g} mm."
        ),
        recommendation=(
            "No action is indicated by this automated comparison; retain the measured evidence."
            if passed
            else "Coordinate a compliant clear opening or confirm an approved design solution with the code reviewer."
        ),
        model_evidence=ModelEvidence(
            applicability_signal=observation_from_fact(
                label="Exit classification",
                fact=door.fire_exit,
                normalized_value=explicit_bool(door.fire_exit.value),
            ),
            observations=observations,
        ),
        rule_evidence=_evidence(
            pack,
            parameters={
                "occupant_capacity": int(capacity),
                "selected_range": {
                    "min": row.min_occupants,
                    "max": row.max_occupants,
                },
                "minimum_clear_width_mm": minimum,
                "observed_clear_width_mm": width_mm,
                "operator": ">=",
                "measurement_definition": "least clear width between vertical door-frame members",
            },
        ),
    )


def evaluate_hong_kong_door_width(
    model: ExtractedModel,
    pack: HongKongRulePack,
) -> list[Finding]:
    """Evaluate explicit exit doors against the source Table B2 rows."""

    return [finding for door in model.doors if (finding := _evaluate_door(door, pack)) is not None]
