"""Typed BIM tools that preserve the deterministic verdict boundary."""

from __future__ import annotations

import hashlib
from collections.abc import Collection
from dataclasses import dataclass

from bim_review_agent.application.agent import ToolEffect, ToolRegistry
from bim_review_agent.application.review_service import review_ifc_bytes, validate_upload
from bim_review_agent.domain.ifc import extract_model
from bim_review_agent.domain.models import FindingStatus, ReviewRun, StrictModel


@dataclass(slots=True)
class BimReviewToolContext:
    filename: str
    content: bytes
    review_run: ReviewRun | None = None


@dataclass(frozen=True, slots=True)
class EvidenceReviewContext:
    review_run: ReviewRun


class InspectModelInput(StrictModel):
    include_entity_counts: bool = True


class InspectModelOutput(StrictModel):
    filename: str
    sha256_prefix: str
    schema_name: str
    length_unit: str
    length_unit_known: bool
    total_entities: int
    door_count: int
    entity_counts: dict[str, int]


class RunDeterministicReviewInput(StrictModel):
    pass


class RunDeterministicReviewOutput(StrictModel):
    review_run_id: str
    rule_pack_id: str
    rule_pack_version: str
    total_findings: int
    pass_count: int
    fail_count: int
    review_count: int
    reviewed_entities: int


class CritiqueReviewEvidenceInput(StrictModel):
    pass


class CritiqueReviewEvidenceOutput(StrictModel):
    review_run_id: str
    total_findings: int
    actionable_findings: int
    findings_with_model_evidence: int
    findings_with_rule_evidence: int
    findings_with_explanations: int
    unresolved_review_findings: int
    unsupported_actionable_finding_ids: list[str]
    authority_types: list[str]
    concerns: list[str]


def _require_context(context: object) -> BimReviewToolContext:
    if not isinstance(context, BimReviewToolContext):
        raise TypeError("BIM tools require a BimReviewToolContext.")
    return context


def _inspect_model(
    arguments: InspectModelInput,
    context: object,
) -> InspectModelOutput:
    tool_context = _require_context(context)
    safe_name = validate_upload(tool_context.filename, tool_context.content)
    extracted = extract_model(tool_context.content)
    return InspectModelOutput(
        filename=safe_name,
        sha256_prefix=hashlib.sha256(tool_context.content).hexdigest()[:12],
        schema_name=extracted.inventory.schema_name,
        length_unit=extracted.inventory.length_unit,
        length_unit_known=extracted.inventory.length_unit_known,
        total_entities=extracted.inventory.total_entities,
        door_count=len(extracted.doors),
        entity_counts=(
            extracted.inventory.entity_counts if arguments.include_entity_counts else {}
        ),
    )


def _run_deterministic_review(
    _arguments: RunDeterministicReviewInput,
    context: object,
) -> RunDeterministicReviewOutput:
    tool_context = _require_context(context)
    review_run = review_ifc_bytes(tool_context.filename, tool_context.content)
    tool_context.review_run = review_run
    return RunDeterministicReviewOutput(
        review_run_id=review_run.run_id,
        rule_pack_id=review_run.rule_pack_id,
        rule_pack_version=review_run.rule_pack_version,
        total_findings=review_run.summary.total_findings,
        pass_count=review_run.summary.pass_count,
        fail_count=review_run.summary.fail_count,
        review_count=review_run.summary.review_count,
        reviewed_entities=review_run.summary.reviewed_entities,
    )


def _critique_review_evidence(
    _arguments: CritiqueReviewEvidenceInput,
    context: object,
) -> CritiqueReviewEvidenceOutput:
    if not isinstance(context, EvidenceReviewContext):
        raise TypeError("Evidence critic requires an EvidenceReviewContext.")
    run = context.review_run
    actionable = [finding for finding in run.findings if finding.status is not FindingStatus.PASS]
    with_model_evidence = [
        finding
        for finding in run.findings
        if finding.model_evidence.observations
        or finding.model_evidence.applicability_signal is not None
    ]
    with_rule_evidence = [
        finding
        for finding in run.findings
        if finding.rule_evidence.rule_id == finding.rule_id
        and bool(finding.rule_evidence.version)
        and bool(finding.rule_evidence.limitation)
    ]
    with_explanations = [finding for finding in run.findings if finding.explanation is not None]
    unsupported = [
        finding.finding_id
        for finding in actionable
        if finding not in with_model_evidence or finding not in with_rule_evidence
    ]
    unresolved = sum(finding.status is FindingStatus.REVIEW for finding in run.findings)
    authority_types = sorted({finding.rule_evidence.authority for finding in run.findings})
    concerns: list[str] = []
    if unresolved:
        concerns.append(
            f"{unresolved} findings remain REVIEW and require human evidence resolution."
        )
    if unsupported:
        concerns.append(
            f"{len(unsupported)} actionable findings lack complete model or rule evidence."
        )
    if authority_types == ["DEMO_PROJECT_RULE"]:
        concerns.append(
            "All enabled rules use DEMO_PROJECT_RULE authority and are not statutory certification."
        )
    return CritiqueReviewEvidenceOutput(
        review_run_id=run.run_id,
        total_findings=len(run.findings),
        actionable_findings=len(actionable),
        findings_with_model_evidence=len(with_model_evidence),
        findings_with_rule_evidence=len(with_rule_evidence),
        findings_with_explanations=len(with_explanations),
        unresolved_review_findings=unresolved,
        unsupported_actionable_finding_ids=unsupported,
        authority_types=authority_types,
        concerns=concerns,
    )


def build_bim_tool_registry(
    allowed_capabilities: Collection[str] | None = None,
) -> ToolRegistry:
    allowed = set(allowed_capabilities) if allowed_capabilities is not None else None
    registry = ToolRegistry()
    if allowed is None or "inspect_model" in allowed:
        registry.register(
            name="inspect_model",
            version="1.0",
            description=(
                "Validate the current IFC and return safe schema, unit, entity-count, and "
                "door-count observations. This tool never assigns a compliance verdict."
            ),
            effect=ToolEffect.PURE_READ,
            input_model=InspectModelInput,
            output_model=InspectModelOutput,
            handler=_inspect_model,
        )
    if allowed is None or "run_deterministic_review" in allowed:
        registry.register(
            name="run_deterministic_review",
            version="1.0",
            description=(
                "Run the enabled versioned BIM rules and return a summary linked to the canonical "
                "ReviewRun. Only this deterministic tool may create PASS, FAIL, or REVIEW findings."
            ),
            effect=ToolEffect.DETERMINISTIC_COMPUTE,
            input_model=RunDeterministicReviewInput,
            output_model=RunDeterministicReviewOutput,
            handler=_run_deterministic_review,
        )
    return registry


def build_evidence_critic_registry(
    allowed_capabilities: Collection[str] | None = None,
) -> ToolRegistry:
    allowed = set(allowed_capabilities) if allowed_capabilities is not None else None
    registry = ToolRegistry()
    if allowed is None or "critique_review_evidence" in allowed:
        registry.register(
            name="critique_review_evidence",
            version="1.0",
            description=(
                "Read one completed ReviewRun and report evidence completeness, unresolved REVIEW "
                "findings, authority labels, and limitations without changing any verdict."
            ),
            effect=ToolEffect.PURE_READ,
            input_model=CritiqueReviewEvidenceInput,
            output_model=CritiqueReviewEvidenceOutput,
            handler=_critique_review_evidence,
        )
    return registry
