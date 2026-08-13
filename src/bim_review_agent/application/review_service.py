"""Observable review orchestration around deterministic tools."""

from __future__ import annotations

import hashlib
import time
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from bim_review_agent.application.explainer import attach_explanations
from bim_review_agent.domain.errors import ReviewInputError
from bim_review_agent.domain.ifc import extract_model, validate_ifc_bytes
from bim_review_agent.domain.models import (
    FindingStatus,
    ReviewRun,
    RunStage,
    SourceFile,
    StageStatus,
)
from bim_review_agent.domain.regulations import load_hong_kong_profile
from bim_review_agent.domain.regulations.hong_kong_rules import evaluate_hong_kong_door_width
from bim_review_agent.domain.rules import evaluate_egress_001, evaluate_info_001, load_rule_pack
from bim_review_agent.infrastructure.config import settings


def _safe_filename(filename: str | None) -> str:
    candidate = Path(filename or "model.ifc").name.strip()
    return candidate or "model.ifc"


def validate_upload(filename: str | None, content: bytes) -> str:
    safe_name = _safe_filename(filename)
    if Path(safe_name).suffix.casefold() != ".ifc":
        raise ReviewInputError(
            code="unsupported_file_type",
            message="This prototype accepts IFC STEP files with the .ifc extension.",
            recovery="Choose an .ifc export or run one of the bundled samples.",
            status_code=400,
        )
    if not content:
        raise ReviewInputError(
            code="empty_file",
            message="The selected IFC file is empty.",
            recovery="Select a non-empty IFC export and try again.",
            status_code=422,
        )
    if len(content) > settings.max_upload_bytes:
        raise ReviewInputError(
            code="file_too_large",
            message=(
                f"The file is larger than the {settings.max_upload_mb} MB local prototype limit."
            ),
            recovery="Export a smaller coordination model or remove non-essential geometry.",
            status_code=413,
        )
    header = content[:4096].decode("latin-1", errors="ignore").lstrip("\ufeff\x00\t\r\n ")
    if not header.startswith("ISO-10303-21;") or "FILE_SCHEMA" not in header:
        raise ReviewInputError(
            code="invalid_step_header",
            message="The file does not contain the expected IFC STEP header and schema declaration.",
            recovery="Re-export as an IFC STEP file instead of renaming another format to .ifc.",
            status_code=422,
        )
    return safe_name


def review_ifc_bytes(
    filename: str | None,
    content: bytes,
    *,
    profile_id: str = "demo_hku",
) -> ReviewRun:
    started_clock = time.perf_counter()
    started_at = datetime.now(UTC)
    safe_name = validate_upload(filename, content)
    digest = hashlib.sha256(content).hexdigest()
    trace: list[RunStage] = [
        RunStage(
            order=1,
            key="validate",
            label="Validate input",
            status=StageStatus.COMPLETED,
            detail="Extension, size, STEP header, and schema declaration accepted.",
            data={"size_bytes": len(content), "sha256_prefix": digest[:12]},
        )
    ]

    extracted = extract_model(content)
    schema_result = validate_ifc_bytes(content)
    if not schema_result.passed:
        first_issue = schema_result.issues[0]
        raise ReviewInputError(
            code="ifc_schema_invalid",
            message=(
                f"The IFC parsed successfully but failed the {schema_result.target_release} "
                f"schema validation: {first_issue.code}."
            ),
            recovery=(
                "Run `bim-review-agent validate-schema` to inspect the complete schema evidence, "
                "repair the IFC export, and submit it again."
            ),
            status_code=422,
        )
    trace.append(
        RunStage(
            order=2,
            key="inventory",
            label="Inventory model",
            status=StageStatus.COMPLETED,
            detail=(
                f"Read {extracted.inventory.total_entities} IFC records and "
                f"{len(extracted.doors)} door elements."
            ),
            data={
                "schema": extracted.inventory.schema_name,
                "length_unit": extracted.inventory.length_unit,
                "door_count": len(extracted.doors),
            },
        )
    )

    if profile_id not in {
        "demo_hku",
        "hk-fire-safety-2011-2024",
        "cn-fire-55037-2022",
    }:
        raise ReviewInputError(
            code="unsupported_review_profile",
            message=f"The review profile {profile_id!r} is not available in this runtime.",
            recovery=("Choose demo_hku, hk-fire-safety-2011-2024, or cn-fire-55037-2022."),
            status_code=422,
        )

    pack = load_rule_pack(profile_id)
    hong_kong_pack = load_hong_kong_profile() if profile_id == "hk-fire-safety-2011-2024" else None
    enabled_rules = [
        rule_id
        for rule_id, enabled in (
            (pack.info.id, pack.info.enabled),
            (
                hong_kong_pack.door_width_rule.id if hong_kong_pack is not None else pack.egress.id,
                hong_kong_pack is not None or pack.egress.enabled,
            ),
        )
        if enabled
    ]
    active_pack_id = hong_kong_pack.id if hong_kong_pack is not None else pack.id
    active_pack_version = hong_kong_pack.version if hong_kong_pack is not None else pack.version
    plan_data = {
        "enabled_rules": enabled_rules,
        "rule_pack_version": active_pack_version,
    }
    if profile_id != "demo_hku":
        plan_data["profile_id"] = profile_id
    trace.append(
        RunStage(
            order=3,
            key="plan",
            label="Plan checks",
            status=StageStatus.COMPLETED,
            detail=f"Planned {len(enabled_rules)} deterministic rules from {active_pack_id}.",
            data=plan_data,
        )
    )

    findings = [
        *evaluate_info_001(extracted, pack),
        *(
            evaluate_hong_kong_door_width(extracted, hong_kong_pack)
            if hong_kong_pack is not None
            else evaluate_egress_001(extracted, pack)
        ),
    ]
    priority = {
        FindingStatus.FAIL: 0,
        FindingStatus.REVIEW: 1,
        FindingStatus.PASS: 2,
    }
    findings.sort(
        key=lambda item: (
            priority[item.status],
            item.rule_id,
            item.entity.name or "",
            item.finding_id,
        )
    )
    trace.append(
        RunStage(
            order=4,
            key="execute",
            label="Execute rules",
            status=StageStatus.COMPLETED,
            detail=f"Produced {len(findings)} findings using deterministic rule code.",
            data={
                "pass": sum(item.status is FindingStatus.PASS for item in findings),
                "fail": sum(item.status is FindingStatus.FAIL for item in findings),
                "review": sum(item.status is FindingStatus.REVIEW for item in findings),
            },
        )
    )

    findings = attach_explanations(findings)
    trace.append(
        RunStage(
            order=5,
            key="report",
            label="Assemble evidence",
            status=StageStatus.COMPLETED,
            detail="Bound model evidence, rule evidence, and deterministic explanations.",
            data={"external_ai_calls": 0, "report_contract": "ReviewRun/v1"},
        )
    )
    completed_at = datetime.now(UTC)
    duration_ms = max(1, round((time.perf_counter() - started_clock) * 1000))
    return ReviewRun(
        run_id=str(uuid4()),
        started_at=started_at,
        completed_at=completed_at,
        duration_ms=duration_ms,
        source=SourceFile(filename=safe_name, size_bytes=len(content), sha256=digest),
        rule_pack_id=active_pack_id,
        rule_pack_version=active_pack_version,
        inventory=extracted.inventory,
        trace=trace,
        findings=findings,
    )
