"""Budgeted model → tool → observation Agent loop."""

from __future__ import annotations

import time
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from pydantic import TypeAdapter, ValidationError

from bim_review_agent.application.agent.orchestration import AgentScheduler
from bim_review_agent.application.agent.registry import ToolDispatchError, ToolRegistry
from bim_review_agent.application.agent.schemas import (
    AgentAction,
    AgentDefinition,
    AgentEvent,
    AgentEventType,
    AgentFinalResponse,
    AgentRun,
    AgentRunState,
    AgentStopReason,
    DelegateAction,
    FinalAction,
    ProviderRequest,
    RecalledEpisode,
    RecalledMemory,
    SpecialistResult,
    ToolCallAction,
    ToolObservation,
)
from bim_review_agent.infrastructure.providers.base import ModelProvider

_ACTION_ADAPTER = TypeAdapter(AgentAction)
_SPECIALIST_RESULTS_ADAPTER = TypeAdapter(tuple[SpecialistResult, ...])


def _event(
    events: list[AgentEvent],
    event_type: AgentEventType,
    actor: str,
    summary: str,
    data: dict[str, Any] | None = None,
) -> None:
    events.append(
        AgentEvent(
            event_id=str(uuid4()),
            sequence=len(events) + 1,
            occurred_at=datetime.now(UTC),
            type=event_type,
            actor=actor,
            summary=summary,
            data=data or {},
        )
    )


def _finish(
    *,
    run_id: str,
    objective: str,
    definition: AgentDefinition,
    provider: ModelProvider,
    state: AgentRunState,
    stop_reason: AgentStopReason,
    started_at: datetime,
    started_clock: float,
    step_count: int,
    tool_call_count: int,
    events: list[AgentEvent],
    final_action: FinalAction | None = None,
) -> AgentRun:
    completed_at = datetime.now(UTC)
    duration_ms = max(0, round((time.perf_counter() - started_clock) * 1000))
    memory_read_ids = [
        memory["memory_id"]
        for event in events
        if event.type is AgentEventType.MEMORY_RECALLED
        for memory in event.data.get("memories", [])
        if isinstance(memory, dict) and isinstance(memory.get("memory_id"), str)
    ]
    delegation_count = sum(
        len(event.data.get("tasks", []))
        for event in events
        if event.type is AgentEventType.AGENT_DELEGATED
    )
    delegated_run_ids = [
        event.data["child_run_id"]
        for event in events
        if event.type in {AgentEventType.AGENT_COMPLETED, AgentEventType.AGENT_FAILED}
        and isinstance(event.data.get("child_run_id"), str)
    ]
    connector_ids = [
        connector_id
        for event in events
        if event.type is AgentEventType.CONNECTOR_SELECTED
        for connector_id in event.data.get("connector_ids", [])
        if isinstance(connector_id, str)
    ]
    session_id = next(
        (
            event.data["session_id"]
            for event in events
            if event.type is AgentEventType.SESSION_SELECTED
            and isinstance(event.data.get("session_id"), str)
        ),
        None,
    )
    episode_read_ids = [
        episode["episode_id"]
        for event in events
        if event.type is AgentEventType.EPISODE_RECALLED
        for episode in event.data.get("episodes", [])
        if isinstance(episode, dict) and isinstance(episode.get("episode_id"), str)
    ]
    return AgentRun(
        run_id=run_id,
        objective=objective,
        agent_id=definition.agent_id,
        agent_version=definition.version,
        provider_id=provider.provider_id,
        model_id=provider.model_id,
        connector_ids=connector_ids,
        session_id=session_id,
        state=state,
        stop_reason=stop_reason,
        started_at=started_at,
        completed_at=completed_at,
        duration_ms=duration_ms,
        step_count=step_count,
        tool_call_count=tool_call_count,
        max_steps=definition.max_steps,
        max_tool_calls=definition.max_tool_calls,
        delegation_count=delegation_count,
        max_delegations=definition.max_delegations,
        max_parallel_children=definition.max_parallel_children,
        delegated_run_ids=delegated_run_ids,
        events=events,
        memory_read_ids=memory_read_ids,
        episode_read_ids=episode_read_ids,
        final_response=(
            AgentFinalResponse(message=final_action.message, data=final_action.data)
            if final_action is not None
            else None
        ),
        linked_review_run_id=(
            final_action.linked_review_run_id if final_action is not None else None
        ),
    )


def _fail(
    *,
    reason: AgentStopReason,
    message: str,
    run_id: str,
    objective: str,
    definition: AgentDefinition,
    provider: ModelProvider,
    started_at: datetime,
    started_clock: float,
    step_count: int,
    tool_call_count: int,
    events: list[AgentEvent],
) -> AgentRun:
    _event(events, AgentEventType.RUN_FAILED, "agent-kernel", message, {"reason": reason})
    return _finish(
        run_id=run_id,
        objective=objective,
        definition=definition,
        provider=provider,
        state=AgentRunState.FAILED,
        stop_reason=reason,
        started_at=started_at,
        started_clock=started_clock,
        step_count=step_count,
        tool_call_count=tool_call_count,
        events=events,
    )


def _budget_exhausted(
    *,
    reason: AgentStopReason,
    message: str,
    run_id: str,
    objective: str,
    definition: AgentDefinition,
    provider: ModelProvider,
    started_at: datetime,
    started_clock: float,
    step_count: int,
    tool_call_count: int,
    events: list[AgentEvent],
) -> AgentRun:
    _event(
        events,
        AgentEventType.RUN_BUDGET_EXHAUSTED,
        "agent-kernel",
        message,
        {"reason": reason},
    )
    return _finish(
        run_id=run_id,
        objective=objective,
        definition=definition,
        provider=provider,
        state=AgentRunState.BUDGET_EXHAUSTED,
        stop_reason=reason,
        started_at=started_at,
        started_clock=started_clock,
        step_count=step_count,
        tool_call_count=tool_call_count,
        events=events,
    )


def run_agent(
    *,
    definition: AgentDefinition,
    objective: str,
    provider: ModelProvider,
    registry: ToolRegistry,
    tool_context: Any = None,
    recalled_memories: tuple[RecalledMemory, ...] = (),
    recalled_episodes: tuple[RecalledEpisode, ...] = (),
    scheduler: AgentScheduler | None = None,
    connector_ids: tuple[str, ...] = (),
    session_id: str | None = None,
) -> AgentRun:
    """Run one bounded Agent trajectory and return its complete public trace."""

    run_id = str(uuid4())
    started_at = datetime.now(UTC)
    started_clock = time.perf_counter()
    events: list[AgentEvent] = []
    observations: list[ToolObservation] = []
    specialist_results: list[SpecialistResult] = []
    tool_call_count = 0
    catalogue = registry.catalogue(definition.allowed_tools)

    _event(
        events,
        AgentEventType.RUN_STARTED,
        definition.agent_id,
        "Agent run started with explicit step and tool-call budgets.",
        {"max_steps": definition.max_steps, "max_tool_calls": definition.max_tool_calls},
    )
    if session_id is not None:
        _event(
            events,
            AgentEventType.SESSION_SELECTED,
            "session-store",
            "Selected one scoped Agent session for this run.",
            {
                "session_id": session_id,
                "recalled_episode_count": len(recalled_episodes),
            },
        )
    if recalled_memories:
        _event(
            events,
            AgentEventType.MEMORY_RECALLED,
            "memory-store",
            f"Recalled {len(recalled_memories)} scoped, user-controlled memories.",
            {"memories": [memory.model_dump(mode="json") for memory in recalled_memories]},
        )
    if recalled_episodes:
        _event(
            events,
            AgentEventType.EPISODE_RECALLED,
            "session-store",
            f"Recalled {len(recalled_episodes)} bounded, redacted prior-run episodes.",
            {"episodes": [episode.model_dump(mode="json") for episode in recalled_episodes]},
        )
    _event(
        events,
        AgentEventType.PROVIDER_SELECTED,
        "agent-kernel",
        f"Selected provider {provider.provider_id} and model {provider.model_id}.",
        {"provider_id": provider.provider_id, "model_id": provider.model_id},
    )
    if connector_ids:
        _event(
            events,
            AgentEventType.CONNECTOR_SELECTED,
            "agent-kernel",
            f"Selected {len(connector_ids)} policy-approved connector sources.",
            {"connector_ids": list(connector_ids)},
        )
    _event(
        events,
        AgentEventType.TOOL_DISCOVERED,
        "agent-kernel",
        f"Exposed {len(catalogue)} policy-approved tools to the Agent.",
        {"tools": [tool.name for tool in catalogue]},
    )

    for step_count in range(1, definition.max_steps + 1):
        _event(
            events,
            AgentEventType.PROVIDER_REQUESTED,
            definition.agent_id,
            f"Requested structured action for step {step_count}.",
            {"step": step_count, "observation_count": len(observations)},
        )
        request = ProviderRequest(
            run_id=run_id,
            objective=objective,
            step=step_count,
            agent=definition,
            tools=catalogue,
            observations=tuple(observations),
            memories=recalled_memories,
            episodes=recalled_episodes,
            specialist_results=tuple(specialist_results),
        )
        try:
            raw_action = provider.next_action(request)
        except Exception:  # Provider adapters are an untrusted runtime boundary.
            return _fail(
                reason=AgentStopReason.PROVIDER_ERROR,
                message="The selected model provider could not return a valid action.",
                run_id=run_id,
                objective=objective,
                definition=definition,
                provider=provider,
                started_at=started_at,
                started_clock=started_clock,
                step_count=step_count,
                tool_call_count=tool_call_count,
                events=events,
            )

        try:
            action = _ACTION_ADAPTER.validate_python(raw_action)
        except ValidationError:
            return _fail(
                reason=AgentStopReason.INVALID_PROVIDER_ACTION,
                message="The model provider returned an action outside the declared contract.",
                run_id=run_id,
                objective=objective,
                definition=definition,
                provider=provider,
                started_at=started_at,
                started_clock=started_clock,
                step_count=step_count,
                tool_call_count=tool_call_count,
                events=events,
            )

        if isinstance(action, FinalAction):
            _event(
                events,
                AgentEventType.RUN_COMPLETED,
                definition.agent_id,
                "Agent returned a contract-valid final response.",
                {"reason": AgentStopReason.FINAL_OUTPUT},
            )
            return _finish(
                run_id=run_id,
                objective=objective,
                definition=definition,
                provider=provider,
                state=AgentRunState.COMPLETED,
                stop_reason=AgentStopReason.FINAL_OUTPUT,
                started_at=started_at,
                started_clock=started_clock,
                step_count=step_count,
                tool_call_count=tool_call_count,
                events=events,
                final_action=action,
            )

        if isinstance(action, DelegateAction):
            requested_count = len(action.tasks)
            current_count = len(specialist_results)
            if requested_count > definition.max_parallel_children:
                return _budget_exhausted(
                    reason=AgentStopReason.DELEGATION_BUDGET_EXHAUSTED,
                    message="Delegation request exceeds the Agent's parallel-child limit.",
                    run_id=run_id,
                    objective=objective,
                    definition=definition,
                    provider=provider,
                    started_at=started_at,
                    started_clock=started_clock,
                    step_count=step_count,
                    tool_call_count=tool_call_count,
                    events=events,
                )
            if current_count + requested_count > definition.max_delegations:
                return _budget_exhausted(
                    reason=AgentStopReason.DELEGATION_BUDGET_EXHAUSTED,
                    message="Delegation request exceeds the Agent's total specialist budget.",
                    run_id=run_id,
                    objective=objective,
                    definition=definition,
                    provider=provider,
                    started_at=started_at,
                    started_clock=started_clock,
                    step_count=step_count,
                    tool_call_count=tool_call_count,
                    events=events,
                )
            if scheduler is None:
                return _fail(
                    reason=AgentStopReason.DELEGATION_UNAVAILABLE,
                    message="This Agent run has no configured specialist scheduler.",
                    run_id=run_id,
                    objective=objective,
                    definition=definition,
                    provider=provider,
                    started_at=started_at,
                    started_clock=started_clock,
                    step_count=step_count,
                    tool_call_count=tool_call_count,
                    events=events,
                )
            for task in action.tasks:
                if task.specialist_id not in definition.allowed_specialists:
                    return _fail(
                        reason=AgentStopReason.SPECIALIST_NOT_ALLOWED,
                        message=f"Agent policy does not allow specialist {task.specialist_id}.",
                        run_id=run_id,
                        objective=objective,
                        definition=definition,
                        provider=provider,
                        started_at=started_at,
                        started_clock=started_clock,
                        step_count=step_count,
                        tool_call_count=tool_call_count,
                        events=events,
                    )
                if not scheduler.contains(task.specialist_id):
                    return _fail(
                        reason=AgentStopReason.SPECIALIST_NOT_FOUND,
                        message=f"Requested specialist is not registered: {task.specialist_id}",
                        run_id=run_id,
                        objective=objective,
                        definition=definition,
                        provider=provider,
                        started_at=started_at,
                        started_clock=started_clock,
                        step_count=step_count,
                        tool_call_count=tool_call_count,
                        events=events,
                    )

            _event(
                events,
                AgentEventType.AGENT_DELEGATED,
                definition.agent_id,
                action.purpose,
                {
                    "tasks": [task.model_dump(mode="json") for task in action.tasks],
                    "parallel_limit": definition.max_parallel_children,
                },
            )
            try:
                raw_results = scheduler.delegate(
                    parent_run_id=run_id,
                    tasks=action.tasks,
                    parent_context=tool_context,
                )
                results = _SPECIALIST_RESULTS_ADAPTER.validate_python(raw_results)
            except Exception:  # Scheduler implementations are an untrusted boundary.
                return _fail(
                    reason=AgentStopReason.SPECIALIST_EXECUTION_FAILED,
                    message="The specialist scheduler could not complete the delegated tasks.",
                    run_id=run_id,
                    objective=objective,
                    definition=definition,
                    provider=provider,
                    started_at=started_at,
                    started_clock=started_clock,
                    step_count=step_count,
                    tool_call_count=tool_call_count,
                    events=events,
                )

            expected_task_ids = {task.task_id for task in action.tasks}
            returned_task_ids = {result.task_id for result in results}
            expected_specialists = {task.task_id: task.specialist_id for task in action.tasks}
            specialist_mismatch = any(
                expected_specialists.get(result.task_id) != result.specialist_id
                for result in results
            )
            if (
                len(results) != len(action.tasks)
                or returned_task_ids != expected_task_ids
                or specialist_mismatch
            ):
                return _fail(
                    reason=AgentStopReason.INVALID_SPECIALIST_RESULT,
                    message="The specialist scheduler returned an incomplete or mismatched result set.",
                    run_id=run_id,
                    objective=objective,
                    definition=definition,
                    provider=provider,
                    started_at=started_at,
                    started_clock=started_clock,
                    step_count=step_count,
                    tool_call_count=tool_call_count,
                    events=events,
                )

            for result in results:
                specialist_results.append(result)
                completed = result.state is AgentRunState.COMPLETED
                _event(
                    events,
                    (AgentEventType.AGENT_COMPLETED if completed else AgentEventType.AGENT_FAILED),
                    result.specialist_id,
                    (
                        f"Specialist {result.specialist_id} completed its bounded task."
                        if completed
                        else f"Specialist {result.specialist_id} ended without success."
                    ),
                    result.model_dump(mode="json"),
                )
            continue

        if not isinstance(action, ToolCallAction):
            return _fail(
                reason=AgentStopReason.INVALID_PROVIDER_ACTION,
                message="The model provider returned an unsupported action type.",
                run_id=run_id,
                objective=objective,
                definition=definition,
                provider=provider,
                started_at=started_at,
                started_clock=started_clock,
                step_count=step_count,
                tool_call_count=tool_call_count,
                events=events,
            )

        if tool_call_count >= definition.max_tool_calls:
            _event(
                events,
                AgentEventType.RUN_BUDGET_EXHAUSTED,
                "agent-kernel",
                "Agent stopped before exceeding its tool-call budget.",
                {"reason": AgentStopReason.TOOL_BUDGET_EXHAUSTED},
            )
            return _finish(
                run_id=run_id,
                objective=objective,
                definition=definition,
                provider=provider,
                state=AgentRunState.BUDGET_EXHAUSTED,
                stop_reason=AgentStopReason.TOOL_BUDGET_EXHAUSTED,
                started_at=started_at,
                started_clock=started_clock,
                step_count=step_count,
                tool_call_count=tool_call_count,
                events=events,
            )

        if action.tool_name not in definition.allowed_tools:
            return _fail(
                reason=AgentStopReason.TOOL_NOT_ALLOWED,
                message=f"Agent policy does not allow tool {action.tool_name}.",
                run_id=run_id,
                objective=objective,
                definition=definition,
                provider=provider,
                started_at=started_at,
                started_clock=started_clock,
                step_count=step_count,
                tool_call_count=tool_call_count,
                events=events,
            )
        if not registry.contains(action.tool_name):
            return _fail(
                reason=AgentStopReason.TOOL_NOT_FOUND,
                message=f"Requested tool is not registered: {action.tool_name}",
                run_id=run_id,
                objective=objective,
                definition=definition,
                provider=provider,
                started_at=started_at,
                started_clock=started_clock,
                step_count=step_count,
                tool_call_count=tool_call_count,
                events=events,
            )

        call_id = str(uuid4())
        tool_call_count += 1
        _event(
            events,
            AgentEventType.TOOL_REQUESTED,
            definition.agent_id,
            action.purpose,
            {"call_id": call_id, "tool_name": action.tool_name},
        )
        try:
            output = registry.execute(action.tool_name, action.arguments, tool_context)
        except ToolDispatchError as exc:
            _event(
                events,
                AgentEventType.TOOL_FAILED,
                action.tool_name,
                str(exc),
                {"call_id": call_id, "reason": exc.reason},
            )
            return _fail(
                reason=exc.reason,
                message=str(exc),
                run_id=run_id,
                objective=objective,
                definition=definition,
                provider=provider,
                started_at=started_at,
                started_clock=started_clock,
                step_count=step_count,
                tool_call_count=tool_call_count,
                events=events,
            )

        observation = ToolObservation(
            call_id=call_id,
            tool_name=action.tool_name,
            output=output,
        )
        observations.append(observation)
        _event(
            events,
            AgentEventType.TOOL_COMPLETED,
            action.tool_name,
            f"Tool {action.tool_name} returned a schema-valid observation.",
            {"call_id": call_id, "tool_name": action.tool_name, "output": output},
        )

    _event(
        events,
        AgentEventType.RUN_BUDGET_EXHAUSTED,
        "agent-kernel",
        "Agent stopped after reaching its step budget.",
        {"reason": AgentStopReason.STEP_BUDGET_EXHAUSTED},
    )
    return _finish(
        run_id=run_id,
        objective=objective,
        definition=definition,
        provider=provider,
        state=AgentRunState.BUDGET_EXHAUSTED,
        stop_reason=AgentStopReason.STEP_BUDGET_EXHAUSTED,
        started_at=started_at,
        started_clock=started_clock,
        step_count=definition.max_steps,
        tool_call_count=tool_call_count,
        events=events,
    )
