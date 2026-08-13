"""Concurrent, context-filtered scheduler for the bounded BIM specialist team."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

from bim_review_agent.application.agent.kernel import run_agent
from bim_review_agent.application.agent.orchestration.specialists import (
    BIM_SPECIALISTS,
    EVIDENCE_CRITIC,
    MODEL_INSPECTOR,
    RULE_REVIEW_SPECIALIST,
    SPECIALIST_SCRIPTS,
)
from bim_review_agent.application.agent.registry import ToolRegistry
from bim_review_agent.application.agent.schemas import AgentRun, DelegationTask, SpecialistResult
from bim_review_agent.application.tools import (
    BimReviewToolContext,
    EvidenceReviewContext,
    build_bim_tool_registry,
    build_evidence_critic_registry,
)
from bim_review_agent.domain.models import ReviewRun
from bim_review_agent.infrastructure.connectors import DEFAULT_CONNECTOR_IDS
from bim_review_agent.infrastructure.providers import ScriptedModelProvider


@dataclass(frozen=True, slots=True)
class _ChildExecution:
    task: DelegationTask
    run: AgentRun
    review_run: ReviewRun | None = None


class BimSpecialistScheduler:
    """Run at most two independent specialists concurrently with minimum context."""

    def __init__(
        self,
        *,
        max_workers: int = 2,
        connector_ids: tuple[str, ...] = DEFAULT_CONNECTOR_IDS,
        connector_capabilities: frozenset[str] | None = None,
    ) -> None:
        if max_workers < 1 or max_workers > 2:
            raise ValueError("BIM specialist concurrency must stay between one and two.")
        self.max_workers = max_workers
        self.connector_ids = connector_ids
        self.connector_capabilities = connector_capabilities
        self.child_runs: list[AgentRun] = []

    def contains(self, specialist_id: str) -> bool:
        return specialist_id in BIM_SPECIALISTS

    def _tool_registry(self, specialist_id: str) -> ToolRegistry:
        if specialist_id in {MODEL_INSPECTOR.agent_id, RULE_REVIEW_SPECIALIST.agent_id}:
            return build_bim_tool_registry(self.connector_capabilities)
        if specialist_id == EVIDENCE_CRITIC.agent_id:
            return build_evidence_critic_registry(self.connector_capabilities)
        raise ValueError(f"Unknown BIM specialist: {specialist_id}")

    def _execute_task(
        self,
        task: DelegationTask,
        parent_context: BimReviewToolContext,
    ) -> _ChildExecution:
        definition = BIM_SPECIALISTS[task.specialist_id]
        if task.specialist_id == EVIDENCE_CRITIC.agent_id:
            if parent_context.review_run is None:
                raise ValueError("Evidence Critic requires a completed deterministic review.")
            requested_run_id = task.input.get("review_run_id")
            if requested_run_id != parent_context.review_run.run_id:
                raise ValueError("Evidence Critic task does not reference the current ReviewRun.")
            tool_context: object = EvidenceReviewContext(parent_context.review_run)
        else:
            tool_context = BimReviewToolContext(
                filename=parent_context.filename,
                content=parent_context.content,
            )

        run = run_agent(
            definition=definition,
            objective=task.objective,
            provider=ScriptedModelProvider(SPECIALIST_SCRIPTS[task.specialist_id]),
            registry=self._tool_registry(task.specialist_id),
            tool_context=tool_context,
            connector_ids=self.connector_ids,
        )
        review_run = (
            tool_context.review_run if isinstance(tool_context, BimReviewToolContext) else None
        )
        return _ChildExecution(task=task, run=run, review_run=review_run)

    def delegate(
        self,
        *,
        parent_run_id: str,
        tasks: tuple[DelegationTask, ...],
        parent_context: object,
    ) -> tuple[SpecialistResult, ...]:
        if not parent_run_id:
            raise ValueError("A parent run ID is required for specialist delegation.")
        if not isinstance(parent_context, BimReviewToolContext):
            raise TypeError("BIM specialist scheduler requires a BimReviewToolContext.")
        if len(tasks) > self.max_workers:
            raise ValueError("Delegation batch exceeds the configured worker count.")

        with ThreadPoolExecutor(
            max_workers=min(self.max_workers, len(tasks)),
            thread_name_prefix="bim-specialist",
        ) as executor:
            futures = [executor.submit(self._execute_task, task, parent_context) for task in tasks]
            executions = [future.result() for future in futures]

        results: list[SpecialistResult] = []
        for execution in executions:
            self.child_runs.append(execution.run)
            if execution.review_run is not None:
                if (
                    parent_context.review_run is not None
                    and parent_context.review_run.run_id != execution.review_run.run_id
                ):
                    raise RuntimeError("Two specialists produced conflicting ReviewRun objects.")
                parent_context.review_run = execution.review_run
            final_response = execution.run.final_response
            results.append(
                SpecialistResult(
                    task_id=execution.task.task_id,
                    specialist_id=execution.task.specialist_id,
                    child_run_id=execution.run.run_id,
                    state=execution.run.state,
                    stop_reason=execution.run.stop_reason,
                    message=final_response.message if final_response is not None else None,
                    data=final_response.data if final_response is not None else {},
                    linked_review_run_id=execution.run.linked_review_run_id,
                )
            )
        return tuple(results)
