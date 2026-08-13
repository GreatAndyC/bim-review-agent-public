"""EGRESS-001: transparent exit-door clear-width comparison."""

from __future__ import annotations

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
    normalize_length_mm,
    observation_from_fact,
    rule_evidence,
)
from bim_review_agent.domain.rules.rule_pack import RulePackConfig


def _exit_signal_observation(door: DoorFacts, *, contradictory: bool = False) -> Observation:
    if not door.fire_exit.is_missing:
        observation = observation_from_fact(
            label="Exit classification",
            fact=door.fire_exit,
            normalized_value=explicit_bool(door.fire_exit.value),
        )
        if contradictory:
            return observation.model_copy(
                update={
                    "reliability": Reliability.CONTRADICTORY,
                    "note": "The explicit value conflicts with exit-related naming metadata.",
                }
            )
        return observation
    return Observation(
        label="Exit classification candidate",
        raw_value=door.entity.name or door.entity.object_type,
        normalized_value=None,
        source_path="IfcDoor.Name / IfcDoor.ObjectType",
        reliability=Reliability.DERIVED,
        note="Exit-related text is only a candidate signal; explicit classification is required.",
    )


def _width_observations(door: DoorFacts) -> tuple[list[Observation], list[float]]:
    observations: list[Observation] = []
    normalized_explicit: list[float] = []
    for fact in door.explicit_widths:
        normalized = (
            normalize_length_mm(fact.value, door.length_to_metre_scale)
            if door.length_unit_known
            else None
        )
        if normalized is not None:
            normalized_explicit.append(normalized)
        observations.append(
            observation_from_fact(
                label="Reported clear width",
                fact=fact,
                normalized_value=normalized,
                unit="mm" if normalized is not None else None,
            )
        )
    if not door.overall_width.is_missing:
        observations.append(
            observation_from_fact(
                label="Nominal overall width (proxy)",
                fact=door.overall_width,
                normalized_value=(
                    normalize_length_mm(door.overall_width.value, door.length_to_metre_scale)
                    if door.length_unit_known
                    else None
                ),
                unit="mm" if door.length_unit_known else None,
            )
        )
    if not observations:
        missing_fact = Fact(
            value=None,
            source_path="Pset_BIMReview.ClearWidth",
            reliability=Reliability.MISSING,
            note="No clear-width property or nominal OverallWidth was available.",
        )
        observations.append(observation_from_fact(label="Clear width", fact=missing_fact))
    return observations, normalized_explicit


def _review_finding(
    *,
    door: DoorFacts,
    pack: RulePackConfig,
    applicability: str,
    message: str,
    recommendation: str,
    observations: list[Observation],
    signal: Observation,
    key: str,
) -> Finding:
    config = pack.egress
    return Finding(
        finding_id=finding_id(config.id, door.entity.global_id, key),
        rule_id=config.id,
        rule_title=config.title,
        category=config.category,
        status=FindingStatus.REVIEW,
        severity=Severity.WARNING,
        entity=door.entity,
        applicability=applicability,
        message=message,
        recommendation=recommendation,
        model_evidence=ModelEvidence(
            applicability_signal=signal,
            observations=observations,
        ),
        rule_evidence=rule_evidence(
            pack=pack,
            rule_id=config.id,
            title=config.title,
            version=config.version,
            parameters={
                "operator": config.threshold.operator,
                "minimum": config.threshold.value,
                "unit": config.threshold.unit,
                "proxy_policy": config.proxy_policy,
                "contradiction_tolerance_mm": config.contradiction_tolerance_mm,
            },
        ),
    )


def _evaluate_door(door: DoorFacts, pack: RulePackConfig) -> Finding | None:
    config = pack.egress
    explicit_exit = explicit_bool(door.fire_exit.value)
    contradictory = explicit_exit is False and door.name_exit_candidate
    ambiguous = explicit_exit is None and door.name_exit_candidate

    if explicit_exit is not True and not contradictory and not ambiguous:
        return None

    observations, widths = _width_observations(door)
    signal = _exit_signal_observation(door, contradictory=contradictory)
    entity_name = door.entity.name or "Unnamed door"

    if contradictory:
        return _review_finding(
            door=door,
            pack=pack,
            applicability="Exit applicability is contradictory and requires human confirmation.",
            message=(
                f"{entity_name} is explicitly marked as not an exit, but its naming metadata "
                "suggests an exit function."
            ),
            recommendation=(
                "Resolve the classification conflict before using this door in an egress check."
            ),
            observations=observations,
            signal=signal,
            key="classification-contradiction",
        )

    if ambiguous:
        return _review_finding(
            door=door,
            pack=pack,
            applicability="Exit-related naming is present, but explicit exit classification is missing.",
            message=f"{entity_name} may be an exit door, but applicability cannot be confirmed.",
            recommendation=(
                "Confirm the door function and populate Pset_DoorCommon.FireExit before relying "
                "on the width result."
            ),
            observations=observations,
            signal=signal,
            key="classification-ambiguous",
        )

    if len(widths) > 1 and max(widths) - min(widths) > config.contradiction_tolerance_mm:
        contradiction_observations = [
            item.model_copy(
                update={
                    "reliability": Reliability.CONTRADICTORY,
                    "note": "Multiple explicit clear-width values disagree beyond tolerance.",
                }
            )
            if item.label == "Reported clear width"
            else item
            for item in observations
        ]
        return _review_finding(
            door=door,
            pack=pack,
            applicability="Confirmed exit door; width evidence is contradictory.",
            message=f"{entity_name} has conflicting reported clear-width values.",
            recommendation="Verify the authoritative clear opening and remove the conflicting value.",
            observations=contradiction_observations,
            signal=signal,
            key="width-contradiction",
        )

    if not widths:
        has_proxy = not door.overall_width.is_missing
        if door.explicit_widths and not door.length_unit_known:
            message = (
                f"{entity_name} reports a clear-width value, but the IFC project length unit "
                "is unavailable."
            )
            recommendation = (
                "Assign a project LENGTHUNIT or an explicit property unit, then rerun the review."
            )
        elif has_proxy:
            message = (
                f"{entity_name} only reports OverallWidth, which is a proxy for clear opening."
            )
            recommendation = (
                "Measure or export the actual clear opening to Pset_BIMReview.ClearWidth; keep the "
                "nominal OverallWidth as supporting evidence only."
            )
        else:
            message = f"{entity_name} has no usable clear-width evidence."
            recommendation = (
                "Populate a verified clear-opening width in the model and rerun the review."
            )
        return _review_finding(
            door=door,
            pack=pack,
            applicability="Confirmed exit door; width evidence is insufficient for comparison.",
            message=message,
            recommendation=recommendation,
            observations=observations,
            signal=signal,
            key="width-insufficient",
        )

    width_mm = widths[0]
    passed = width_mm >= config.threshold.value
    status = FindingStatus.PASS if passed else FindingStatus.FAIL
    entity_name = door.entity.name or "Unnamed door"
    operator_text = "meets" if passed else "is below"
    if pack.id == "cn-fire-55037-2022":
        message = (
            f"{entity_name} reports {width_mm:g} mm clear width, which {operator_text} the "
            "GB 55037-2022 Clause 7.1.4(1) minimum of "
            f"{config.threshold.value:g} mm."
        )
        recommendation = (
            "No width action is indicated by this configured comparison; retain the verified "
            "clear-opening evidence."
            if passed
            else (
                f"Increase the verified clear opening to at least {config.threshold.value:g} mm, "
                "or confirm an approved design solution with a qualified code reviewer."
            )
        )
    else:
        message = (
            f"{entity_name} reports {width_mm:g} mm clear width, which {operator_text} the "
            f"{config.threshold.value:g} mm demo threshold."
        )
        recommendation = (
            "No width action is required under this demo rule; retain the source measurement."
            if passed
            else "Coordinate a wider clear opening or confirm an approved exception with the reviewer."
        )
    return Finding(
        finding_id=finding_id(config.id, door.entity.global_id, "clear-width"),
        rule_id=config.id,
        rule_title=config.title,
        category=config.category,
        status=status,
        severity=Severity.INFO if passed else Severity.ERROR,
        entity=door.entity,
        applicability="Confirmed exit door via explicit model property.",
        message=message,
        recommendation=recommendation,
        model_evidence=ModelEvidence(
            applicability_signal=signal,
            observations=observations,
        ),
        rule_evidence=rule_evidence(
            pack=pack,
            rule_id=config.id,
            title=config.title,
            version=config.version,
            parameters={
                "operator": config.threshold.operator,
                "minimum": config.threshold.value,
                "unit": config.threshold.unit,
                "observed_clear_width_mm": width_mm,
                "source_policy": "explicit_clear_width_only",
            },
        ),
    )


def evaluate_egress_001(model: ExtractedModel, pack: RulePackConfig) -> list[Finding]:
    if not pack.egress.enabled:
        return []
    return [finding for door in model.doors if (finding := _evaluate_door(door, pack))]
