"""Canonical public contracts for review runs and findings."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, computed_field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class FindingStatus(StrEnum):
    PASS = "PASS"
    FAIL = "FAIL"
    REVIEW = "REVIEW"


class Severity(StrEnum):
    INFO = "INFO"
    WARNING = "WARNING"
    ERROR = "ERROR"


class Reliability(StrEnum):
    EXPLICIT = "EXPLICIT"
    DERIVED = "DERIVED"
    PROXY = "PROXY"
    MISSING = "MISSING"
    CONTRADICTORY = "CONTRADICTORY"


class StageStatus(StrEnum):
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"


class AuthorityType(StrEnum):
    DEMO_PROJECT_RULE = "DEMO_PROJECT_RULE"
    PROJECT_REQUIREMENT = "PROJECT_REQUIREMENT"
    AUTHORITATIVE_STANDARD = "AUTHORITATIVE_STANDARD"


class EntityRef(StrictModel):
    ifc_class: str
    global_id: str
    name: str | None = None
    object_type: str | None = None
    tag: str | None = None
    storey: str | None = None


class Observation(StrictModel):
    label: str
    raw_value: Any = None
    normalized_value: float | str | bool | None = None
    unit: str | None = None
    source_path: str
    reliability: Reliability
    note: str | None = None


class ModelEvidence(StrictModel):
    applicability_signal: Observation | None = None
    observations: list[Observation] = Field(default_factory=list)


class RuleEvidence(StrictModel):
    rule_id: str
    title: str
    version: str
    authority: AuthorityType
    source_title: str
    jurisdiction: str
    clause: str | None = None
    parameters: dict[str, Any] = Field(default_factory=dict)
    limitation: str


class Explanation(StrictModel):
    summary: str
    why_it_matters: str
    next_step: str
    boundary: str


class Finding(StrictModel):
    finding_id: str
    rule_id: str
    rule_title: str
    category: str
    status: FindingStatus
    severity: Severity
    entity: EntityRef
    applicability: str
    message: str
    recommendation: str
    model_evidence: ModelEvidence
    rule_evidence: RuleEvidence
    explanation: Explanation | None = None


class ModelInventory(StrictModel):
    schema_name: str
    length_unit: str
    length_unit_known: bool
    length_to_metre_scale: float
    total_entities: int
    entity_counts: dict[str, int]


class SourceFile(StrictModel):
    filename: str
    size_bytes: int
    sha256: str


class RunStage(StrictModel):
    order: int
    key: str
    label: str
    status: StageStatus
    detail: str
    data: dict[str, Any] = Field(default_factory=dict)


class RunSummary(StrictModel):
    total_findings: int
    pass_count: int
    fail_count: int
    review_count: int
    reviewed_entities: int


class ReviewRun(StrictModel):
    run_id: str
    started_at: datetime
    completed_at: datetime
    duration_ms: int
    source: SourceFile
    rule_pack_id: str
    rule_pack_version: str
    inventory: ModelInventory
    trace: list[RunStage]
    findings: list[Finding]

    @computed_field
    @property
    def summary(self) -> RunSummary:
        return RunSummary(
            total_findings=len(self.findings),
            pass_count=sum(item.status is FindingStatus.PASS for item in self.findings),
            fail_count=sum(item.status is FindingStatus.FAIL for item in self.findings),
            review_count=sum(item.status is FindingStatus.REVIEW for item in self.findings),
            reviewed_entities=len({item.entity.global_id for item in self.findings}),
        )

    def deterministic_payload(self) -> dict[str, Any]:
        """Return the review data that must remain stable across repeated runs."""

        return self.model_dump(
            mode="json",
            exclude={"run_id", "started_at", "completed_at", "duration_ms"},
        )
