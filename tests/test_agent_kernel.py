from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel

from bim_review_agent.application.agent import (
    AgentDefinition,
    AgentEventType,
    AgentRunState,
    AgentStopReason,
    DelegateAction,
    DelegationTask,
    FinalAction,
    RecalledEpisode,
    RecalledMemory,
    SpecialistResult,
    ToolCallAction,
    ToolEffect,
    ToolRegistry,
    run_agent,
)
from bim_review_agent.infrastructure.providers import ScriptedModelProvider


class EmptyInput(BaseModel):
    pass


class CountOutput(BaseModel):
    count: int


def _definition(*, allowed_tools: tuple[str, ...] = ("count_items",), max_steps: int = 4):
    return AgentDefinition(
        agent_id="test-manager",
        name="Test manager",
        version="1.0",
        instructions="Use observations and return a bounded result.",
        allowed_tools=allowed_tools,
        max_steps=max_steps,
        max_tool_calls=3,
    )


def _registry(handler=None) -> ToolRegistry:
    registry = ToolRegistry()
    registry.register(
        name="count_items",
        version="1.0",
        description="Count relevant items in the current test context.",
        effect=ToolEffect.PURE_READ,
        input_model=EmptyInput,
        output_model=CountOutput,
        handler=handler or (lambda _arguments, context: {"count": context["count"]}),
    )
    return registry


def test_tool_observation_changes_the_scripted_providers_next_action() -> None:
    seen_observation_counts: list[int] = []

    def script(request):
        seen_observation_counts.append(len(request.observations))
        if not request.observations:
            return ToolCallAction(
                tool_name="count_items",
                purpose="Inspect the available evidence before answering.",
            )
        count = request.observations[-1].output["count"]
        return FinalAction(message=f"Observed {count} items.", data={"count": count})

    run = run_agent(
        definition=_definition(),
        objective="Count the relevant items.",
        provider=ScriptedModelProvider(script),
        registry=_registry(),
        tool_context={"count": 3},
    )

    assert seen_observation_counts == [0, 1]
    assert run.state is AgentRunState.COMPLETED
    assert run.stop_reason is AgentStopReason.FINAL_OUTPUT
    assert run.step_count == 2
    assert run.tool_call_count == 1
    assert run.final_response is not None
    assert run.final_response.data == {"count": 3}
    assert [event.type for event in run.events].count(AgentEventType.TOOL_COMPLETED) == 1


def test_policy_denies_a_tool_even_when_the_provider_requests_it() -> None:
    def script(_request):
        return ToolCallAction(
            tool_name="count_items",
            purpose="Attempt an unavailable capability.",
        )

    run = run_agent(
        definition=_definition(allowed_tools=()),
        objective="Try a blocked tool.",
        provider=ScriptedModelProvider(script),
        registry=_registry(),
    )

    assert run.state is AgentRunState.FAILED
    assert run.stop_reason is AgentStopReason.TOOL_NOT_ALLOWED
    assert run.tool_call_count == 0
    assert run.events[-1].type is AgentEventType.RUN_FAILED


def test_invalid_tool_input_fails_closed_with_a_typed_reason() -> None:
    class RequiredInput(BaseModel):
        value: int

    registry = ToolRegistry()
    registry.register(
        name="requires_value",
        version="1.0",
        description="Require a typed integer.",
        effect=ToolEffect.DETERMINISTIC_COMPUTE,
        input_model=RequiredInput,
        output_model=CountOutput,
        handler=lambda arguments, _context: {"count": arguments.value},
    )

    run = run_agent(
        definition=_definition(allowed_tools=("requires_value",)),
        objective="Call a tool with malformed input.",
        provider=ScriptedModelProvider(
            lambda _request: ToolCallAction(
                tool_name="requires_value",
                arguments={"unexpected": True},
                purpose="Exercise schema validation.",
            )
        ),
        registry=registry,
    )

    assert run.state is AgentRunState.FAILED
    assert run.stop_reason is AgentStopReason.TOOL_INPUT_INVALID
    assert run.events[-2].type is AgentEventType.TOOL_FAILED


def test_repeated_tool_requests_stop_at_the_step_budget() -> None:
    run = run_agent(
        definition=_definition(max_steps=2),
        objective="Keep inspecting forever.",
        provider=ScriptedModelProvider(
            lambda _request: ToolCallAction(
                tool_name="count_items",
                purpose="Repeat the same bounded observation.",
            )
        ),
        registry=_registry(),
        tool_context={"count": 1},
    )

    assert run.state is AgentRunState.BUDGET_EXHAUSTED
    assert run.stop_reason is AgentStopReason.STEP_BUDGET_EXHAUSTED
    assert run.step_count == 2
    assert run.tool_call_count == 2
    assert run.events[-1].type is AgentEventType.RUN_BUDGET_EXHAUSTED


def test_tool_output_is_validated_before_becoming_an_observation() -> None:
    def invalid_handler(_arguments: BaseModel, _context: Any) -> dict[str, str]:
        return {"wrong": "shape"}

    run = run_agent(
        definition=_definition(),
        objective="Reject invalid tool output.",
        provider=ScriptedModelProvider(
            lambda _request: ToolCallAction(
                tool_name="count_items",
                purpose="Exercise output validation.",
            )
        ),
        registry=_registry(handler=invalid_handler),
    )

    assert run.state is AgentRunState.FAILED
    assert run.stop_reason is AgentStopReason.TOOL_OUTPUT_INVALID
    assert not any(event.type is AgentEventType.TOOL_COMPLETED for event in run.events)


def test_unexpected_provider_exception_becomes_a_public_safe_failed_run() -> None:
    class BrokenProvider:
        provider_id = "broken"
        model_id = "broken-v1"

        def next_action(self, _request):
            raise RuntimeError("private provider detail")

    run = run_agent(
        definition=_definition(),
        objective="Handle a provider failure safely.",
        provider=BrokenProvider(),
        registry=_registry(),
    )

    assert run.state is AgentRunState.FAILED
    assert run.stop_reason is AgentStopReason.PROVIDER_ERROR
    assert "private provider detail" not in run.events[-1].summary


def test_scoped_memory_reaches_the_provider_with_a_public_provenance_event() -> None:
    memory = RecalledMemory(
        memory_id="memory-1",
        key="explanation_language",
        value="zh-CN",
        scope_type="USER",
        scope_id="local-user",
        created_at=datetime.now(UTC),
    )

    def script(request):
        assert request.memories == (memory,)
        return FinalAction(message="已读取偏好。")

    run = run_agent(
        definition=_definition(),
        objective="Use a scoped preference.",
        provider=ScriptedModelProvider(script),
        registry=_registry(),
        recalled_memories=(memory,),
    )

    memory_event = next(
        event for event in run.events if event.type is AgentEventType.MEMORY_RECALLED
    )
    assert run.memory_read_ids == ["memory-1"]
    assert memory_event.data["memories"][0]["scope_id"] == "local-user"


def test_redacted_session_episode_reaches_each_provider_step_with_public_provenance() -> None:
    episode = RecalledEpisode(
        episode_id="episode-1",
        agent_run_id="prior-run-1",
        linked_review_run_id="prior-review-1",
        source_sha256="a" * 64,
        objective_sha256="b" * 64,
        mode="full_review",
        state="COMPLETED",
        stop_reason="FINAL_OUTPUT",
        pass_count=5,
        fail_count=1,
        review_count=3,
        reviewed_entities=4,
        created_at=datetime.now(UTC),
    )
    seen_episode_sets: list[tuple[RecalledEpisode, ...]] = []

    def script(request):
        seen_episode_sets.append(request.episodes)
        if not request.observations:
            return ToolCallAction(
                tool_name="count_items",
                purpose="Inspect current evidence before comparing with the redacted prior run.",
            )
        return FinalAction(message="Used bounded prior-run context.")

    run = run_agent(
        definition=_definition(),
        objective="Use safe session context.",
        provider=ScriptedModelProvider(script),
        registry=_registry(),
        tool_context={"count": 3},
        recalled_episodes=(episode,),
        session_id="session-1",
    )

    session_event = next(
        event for event in run.events if event.type is AgentEventType.SESSION_SELECTED
    )
    episode_event = next(
        event for event in run.events if event.type is AgentEventType.EPISODE_RECALLED
    )
    assert seen_episode_sets == [(episode,), (episode,)]
    assert run.session_id == "session-1"
    assert run.episode_read_ids == ["episode-1"]
    assert session_event.data == {"session_id": "session-1", "recalled_episode_count": 1}
    assert episode_event.data["episodes"][0]["objective_sha256"] == "b" * 64


class RecordingScheduler:
    def __init__(self) -> None:
        self.received_tasks: tuple[DelegationTask, ...] = ()

    def contains(self, specialist_id: str) -> bool:
        return specialist_id == "evidence-specialist"

    def delegate(self, *, parent_run_id, tasks, parent_context):
        self.received_tasks = tasks
        assert parent_run_id
        assert parent_context == {"safe": "context"}
        return tuple(
            SpecialistResult(
                task_id=task.task_id,
                specialist_id=task.specialist_id,
                child_run_id=f"child-{task.task_id}",
                state=AgentRunState.COMPLETED,
                stop_reason=AgentStopReason.FINAL_OUTPUT,
                message="Specialist result",
                data={"supported": True},
            )
            for task in tasks
        )


def _manager_definition(**updates) -> AgentDefinition:
    values = {
        "agent_id": "manager",
        "name": "Manager",
        "version": "1.0",
        "instructions": "Delegate only bounded evidence work.",
        "allowed_specialists": ("evidence-specialist",),
        "max_steps": 3,
        "max_tool_calls": 0,
        "max_delegations": 2,
        "max_parallel_children": 2,
    }
    values.update(updates)
    return AgentDefinition(**values)


def test_manager_delegates_and_receives_a_structured_specialist_result() -> None:
    scheduler = RecordingScheduler()

    def script(request):
        if not request.specialist_results:
            return DelegateAction(
                tasks=(
                    DelegationTask(
                        task_id="evidence-1",
                        specialist_id="evidence-specialist",
                        objective="Check evidence completeness.",
                        input={"review_run_id": "review-1"},
                    ),
                ),
                purpose="Ask a read-only specialist to challenge the evidence.",
            )
        result = request.specialist_results[0]
        return FinalAction(message="Synthesized specialist result.", data=result.data)

    run = run_agent(
        definition=_manager_definition(),
        objective="Review with one specialist.",
        provider=ScriptedModelProvider(script),
        registry=ToolRegistry(),
        tool_context={"safe": "context"},
        scheduler=scheduler,
    )

    assert [task.task_id for task in scheduler.received_tasks] == ["evidence-1"]
    assert run.state is AgentRunState.COMPLETED
    assert run.delegation_count == 1
    assert run.delegated_run_ids == ["child-evidence-1"]
    assert run.final_response is not None
    assert run.final_response.data == {"supported": True}
    assert any(event.type is AgentEventType.AGENT_DELEGATED for event in run.events)
    assert any(event.type is AgentEventType.AGENT_COMPLETED for event in run.events)


def test_manager_cannot_delegate_to_an_unallowlisted_specialist() -> None:
    run = run_agent(
        definition=_manager_definition(),
        objective="Attempt an unauthorized delegation.",
        provider=ScriptedModelProvider(
            lambda _request: DelegateAction(
                tasks=(
                    DelegationTask(
                        task_id="blocked-1",
                        specialist_id="unknown-specialist",
                        objective="Do something outside policy.",
                    ),
                ),
                purpose="Exercise specialist policy.",
            )
        ),
        registry=ToolRegistry(),
        scheduler=RecordingScheduler(),
    )

    assert run.state is AgentRunState.FAILED
    assert run.stop_reason is AgentStopReason.SPECIALIST_NOT_ALLOWED
    assert run.delegation_count == 0


def test_parallel_delegation_request_cannot_exceed_the_agent_limit() -> None:
    tasks = tuple(
        DelegationTask(
            task_id=f"task-{index}",
            specialist_id="evidence-specialist",
            objective="Bounded work.",
        )
        for index in range(2)
    )
    run = run_agent(
        definition=_manager_definition(max_parallel_children=1),
        objective="Attempt excessive parallelism.",
        provider=ScriptedModelProvider(
            lambda _request: DelegateAction(
                tasks=tasks,
                purpose="Exercise the concurrency budget.",
            )
        ),
        registry=ToolRegistry(),
        scheduler=RecordingScheduler(),
    )

    assert run.state is AgentRunState.BUDGET_EXHAUSTED
    assert run.stop_reason is AgentStopReason.DELEGATION_BUDGET_EXHAUSTED
    assert not any(event.type is AgentEventType.AGENT_DELEGATED for event in run.events)


def test_mismatched_specialist_result_set_fails_closed() -> None:
    class MismatchedScheduler(RecordingScheduler):
        def delegate(self, *, parent_run_id, tasks, parent_context):
            return ()

    run = run_agent(
        definition=_manager_definition(),
        objective="Reject incomplete specialist output.",
        provider=ScriptedModelProvider(
            lambda _request: DelegateAction(
                tasks=(
                    DelegationTask(
                        task_id="expected",
                        specialist_id="evidence-specialist",
                        objective="Return one result.",
                    ),
                ),
                purpose="Exercise result validation.",
            )
        ),
        registry=ToolRegistry(),
        scheduler=MismatchedScheduler(),
    )

    assert run.state is AgentRunState.FAILED
    assert run.stop_reason is AgentStopReason.INVALID_SPECIALIST_RESULT
