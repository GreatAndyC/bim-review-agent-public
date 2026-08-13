"""Public contracts for model actions, tools, events, and Agent runs."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import Field, model_validator

from bim_review_agent.domain.models import StrictModel


class AgentRunState(StrEnum):
    CREATED = "CREATED"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    BUDGET_EXHAUSTED = "BUDGET_EXHAUSTED"
    CANCELLED = "CANCELLED"


class AgentStopReason(StrEnum):
    FINAL_OUTPUT = "FINAL_OUTPUT"
    STEP_BUDGET_EXHAUSTED = "STEP_BUDGET_EXHAUSTED"
    TOOL_BUDGET_EXHAUSTED = "TOOL_BUDGET_EXHAUSTED"
    PROVIDER_ERROR = "PROVIDER_ERROR"
    INVALID_PROVIDER_ACTION = "INVALID_PROVIDER_ACTION"
    TOOL_NOT_ALLOWED = "TOOL_NOT_ALLOWED"
    TOOL_NOT_FOUND = "TOOL_NOT_FOUND"
    TOOL_INPUT_INVALID = "TOOL_INPUT_INVALID"
    TOOL_OUTPUT_INVALID = "TOOL_OUTPUT_INVALID"
    TOOL_EXECUTION_FAILED = "TOOL_EXECUTION_FAILED"
    DELEGATION_BUDGET_EXHAUSTED = "DELEGATION_BUDGET_EXHAUSTED"
    DELEGATION_UNAVAILABLE = "DELEGATION_UNAVAILABLE"
    SPECIALIST_NOT_ALLOWED = "SPECIALIST_NOT_ALLOWED"
    SPECIALIST_NOT_FOUND = "SPECIALIST_NOT_FOUND"
    SPECIALIST_EXECUTION_FAILED = "SPECIALIST_EXECUTION_FAILED"
    INVALID_SPECIALIST_RESULT = "INVALID_SPECIALIST_RESULT"


class AgentEventType(StrEnum):
    RUN_STARTED = "run.started"
    SESSION_SELECTED = "session.selected"
    MEMORY_RECALLED = "memory.recalled"
    EPISODE_RECALLED = "episode.recalled"
    PROVIDER_SELECTED = "provider.selected"
    CONNECTOR_SELECTED = "connector.selected"
    TOOL_DISCOVERED = "tool.discovered"
    PROVIDER_REQUESTED = "provider.requested"
    TOOL_REQUESTED = "tool.requested"
    TOOL_COMPLETED = "tool.completed"
    TOOL_FAILED = "tool.failed"
    AGENT_DELEGATED = "agent.delegated"
    AGENT_COMPLETED = "agent.completed"
    AGENT_FAILED = "agent.failed"
    RUN_COMPLETED = "run.completed"
    RUN_FAILED = "run.failed"
    RUN_BUDGET_EXHAUSTED = "run.budget_exhausted"


class ToolEffect(StrEnum):
    PURE_READ = "PURE_READ"
    DETERMINISTIC_COMPUTE = "DETERMINISTIC_COMPUTE"
    LOCAL_STATE_WRITE = "LOCAL_STATE_WRITE"
    EXTERNAL_READ = "EXTERNAL_READ"
    EXTERNAL_WRITE = "EXTERNAL_WRITE"


class ToolDescriptor(StrictModel):
    name: str
    version: str
    description: str
    effect: ToolEffect
    input_schema: dict[str, Any]
    output_schema: dict[str, Any]


class AgentDefinition(StrictModel):
    agent_id: str
    name: str
    version: str
    instructions: str
    allowed_tools: tuple[str, ...] = ()
    allowed_specialists: tuple[str, ...] = ()
    max_steps: int = Field(default=8, ge=1, le=100)
    max_tool_calls: int = Field(default=6, ge=0, le=100)
    max_delegations: int = Field(default=0, ge=0, le=20)
    max_parallel_children: int = Field(default=1, ge=1, le=8)


class ToolObservation(StrictModel):
    call_id: str
    tool_name: str
    output: dict[str, Any]


class RecalledMemory(StrictModel):
    memory_id: str
    key: str
    value: str
    scope_type: str
    scope_id: str
    source_run_id: str | None = None
    created_at: datetime


class RecalledEpisode(StrictModel):
    episode_id: str
    agent_run_id: str
    linked_review_run_id: str | None = None
    source_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    objective_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    mode: str
    state: str
    stop_reason: str
    pass_count: int | None = Field(default=None, ge=0)
    fail_count: int | None = Field(default=None, ge=0)
    review_count: int | None = Field(default=None, ge=0)
    reviewed_entities: int | None = Field(default=None, ge=0)
    created_at: datetime


class SpecialistResult(StrictModel):
    task_id: str
    specialist_id: str
    child_run_id: str
    state: AgentRunState
    stop_reason: AgentStopReason
    message: str | None = None
    data: dict[str, Any] = Field(default_factory=dict)
    linked_review_run_id: str | None = None


class ProviderRequest(StrictModel):
    run_id: str
    objective: str
    step: int = Field(ge=1)
    agent: AgentDefinition
    tools: tuple[ToolDescriptor, ...]
    observations: tuple[ToolObservation, ...]
    memories: tuple[RecalledMemory, ...] = ()
    episodes: tuple[RecalledEpisode, ...] = ()
    specialist_results: tuple[SpecialistResult, ...] = ()


class ToolCallAction(StrictModel):
    type: Literal["tool_call"] = "tool_call"
    tool_name: str
    arguments: dict[str, Any] = Field(default_factory=dict)
    purpose: str


class DelegationTask(StrictModel):
    task_id: str
    specialist_id: str
    objective: str
    input: dict[str, Any] = Field(default_factory=dict)


class DelegateAction(StrictModel):
    type: Literal["delegate"] = "delegate"
    tasks: tuple[DelegationTask, ...] = Field(min_length=1, max_length=8)
    purpose: str

    @model_validator(mode="after")
    def require_unique_task_ids(self) -> DelegateAction:
        task_ids = [task.task_id for task in self.tasks]
        if len(task_ids) != len(set(task_ids)):
            raise ValueError("Delegated task IDs must be unique within one action.")
        return self


class FinalAction(StrictModel):
    type: Literal["final"] = "final"
    message: str
    data: dict[str, Any] = Field(default_factory=dict)
    linked_review_run_id: str | None = None


AgentAction = Annotated[
    ToolCallAction | DelegateAction | FinalAction,
    Field(discriminator="type"),
]


class AgentEvent(StrictModel):
    event_id: str
    sequence: int = Field(ge=1)
    occurred_at: datetime
    type: AgentEventType
    actor: str
    summary: str
    data: dict[str, Any] = Field(default_factory=dict)


class AgentFinalResponse(StrictModel):
    message: str
    data: dict[str, Any] = Field(default_factory=dict)


class AgentRun(StrictModel):
    run_id: str
    objective: str
    agent_id: str
    agent_version: str
    provider_id: str
    model_id: str
    connector_ids: list[str] = Field(default_factory=list)
    session_id: str | None = None
    episode_id: str | None = None
    state: AgentRunState
    stop_reason: AgentStopReason
    started_at: datetime
    completed_at: datetime
    duration_ms: int = Field(ge=0)
    step_count: int = Field(ge=0)
    tool_call_count: int = Field(ge=0)
    max_steps: int = Field(ge=1)
    max_tool_calls: int = Field(ge=0)
    delegation_count: int = Field(default=0, ge=0)
    max_delegations: int = Field(default=0, ge=0)
    max_parallel_children: int = Field(default=1, ge=1)
    delegated_run_ids: list[str] = Field(default_factory=list)
    events: list[AgentEvent]
    memory_read_ids: list[str] = Field(default_factory=list)
    episode_read_ids: list[str] = Field(default_factory=list)
    final_response: AgentFinalResponse | None = None
    linked_review_run_id: str | None = None
