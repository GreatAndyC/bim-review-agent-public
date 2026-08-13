"""Contracts for deliberately narrow, user-controllable Agent memory."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import Field, model_validator

from bim_review_agent.domain.models import StrictModel


class MemoryType(StrEnum):
    SEMANTIC = "SEMANTIC"


class MemoryScopeType(StrEnum):
    USER = "USER"
    PROJECT = "PROJECT"


class MemoryKey(StrEnum):
    EXPLANATION_LANGUAGE = "explanation_language"
    DEFAULT_REVIEW_MODE = "default_review_mode"


class MemoryCreator(StrEnum):
    USER = "USER"
    AGENT = "AGENT"
    SYSTEM = "SYSTEM"


class MemoryVerification(StrEnum):
    USER_CONFIRMED = "USER_CONFIRMED"


class MemorySensitivity(StrEnum):
    USER_PREFERENCE = "USER_PREFERENCE"


class EpisodeMode(StrEnum):
    FULL_REVIEW = "full_review"
    MULTI_AGENT_REVIEW = "multi_agent_review"
    INVENTORY_ONLY = "inventory_only"
    NO_APPLICABLE_ENTITIES = "no_applicable_entities"
    SPECIALIST_FAILURE = "specialist_failure"
    TERMINAL_FAILURE = "terminal_failure"
    PROVIDER_DEFINED = "provider_defined"


class MemoryScope(StrictModel):
    scope_type: MemoryScopeType
    scope_id: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_.:-]+$")


class MemoryWrite(StrictModel):
    key: MemoryKey
    value: str = Field(min_length=1, max_length=80)
    scope: MemoryScope
    source_run_id: str | None = Field(default=None, max_length=100)
    creator: MemoryCreator = MemoryCreator.USER
    confidence: float = Field(default=1.0, ge=0, le=1)
    verification: MemoryVerification = MemoryVerification.USER_CONFIRMED

    @model_validator(mode="after")
    def validate_allowed_value(self) -> MemoryWrite:
        allowed = {
            MemoryKey.EXPLANATION_LANGUAGE: {"en", "zh-CN", "zh-Hant"},
            MemoryKey.DEFAULT_REVIEW_MODE: {"full_review", "inventory_only"},
        }
        if self.value not in allowed[self.key]:
            options = ", ".join(sorted(allowed[self.key]))
            raise ValueError(f"Unsupported value for {self.key}: choose one of {options}.")
        return self


class MemoryRecord(StrictModel):
    memory_id: str
    memory_type: MemoryType
    key: MemoryKey
    value: str
    scope: MemoryScope
    source_run_id: str | None = None
    creator: MemoryCreator
    confidence: float = Field(ge=0, le=1)
    verification: MemoryVerification
    sensitivity: MemorySensitivity
    retention_policy: str
    created_at: datetime
    last_used_at: datetime | None = None
    expires_at: datetime | None = None
    supersedes_memory_id: str | None = None
    active: bool


class SessionCreate(StrictModel):
    user_id: str = Field(
        default="local-user",
        min_length=1,
        max_length=100,
        pattern=r"^[A-Za-z0-9_.:-]+$",
    )
    project_id: str = Field(
        default="demo-project",
        min_length=1,
        max_length=100,
        pattern=r"^[A-Za-z0-9_.:-]+$",
    )


class AgentSessionRecord(StrictModel):
    session_id: str
    user_id: str
    project_id: str
    created_at: datetime
    updated_at: datetime
    episode_count: int = Field(ge=0)
    last_episode_id: str | None = None
    last_episode_at: datetime | None = None
    retention_policy: str


class EpisodeWrite(StrictModel):
    session_id: str
    agent_run_id: str
    linked_review_run_id: str | None = None
    source_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    objective_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    agent_id: str = Field(min_length=1, max_length=100)
    provider_id: str = Field(min_length=1, max_length=100)
    model_id: str = Field(min_length=1, max_length=200)
    connector_ids: tuple[str, ...] = Field(default_factory=tuple, max_length=8)
    state: str = Field(min_length=1, max_length=40, pattern=r"^[A-Z_]+$")
    stop_reason: str = Field(min_length=1, max_length=80, pattern=r"^[A-Z_]+$")
    mode: EpisodeMode
    pass_count: int | None = Field(default=None, ge=0)
    fail_count: int | None = Field(default=None, ge=0)
    review_count: int | None = Field(default=None, ge=0)
    reviewed_entities: int | None = Field(default=None, ge=0)
    memory_read_count: int = Field(default=0, ge=0)
    delegation_count: int = Field(default=0, ge=0)
    created_at: datetime

    @model_validator(mode="after")
    def require_complete_review_summary(self) -> EpisodeWrite:
        counts = (
            self.pass_count,
            self.fail_count,
            self.review_count,
            self.reviewed_entities,
        )
        if any(value is not None for value in counts) and not all(
            value is not None for value in counts
        ):
            raise ValueError("Episode review counts must be supplied together or omitted.")
        return self


class EpisodeRecord(EpisodeWrite):
    episode_id: str
    last_recalled_at: datetime | None = None
    recall_count: int = Field(default=0, ge=0)


class AgentSessionDetail(StrictModel):
    session: AgentSessionRecord
    episodes: list[EpisodeRecord]
