"""Manager-owned BIM review using three isolated specialist Agents."""

from __future__ import annotations

from bim_review_agent.application.agent.bim_review import DEFAULT_AGENT_OBJECTIVE
from bim_review_agent.application.agent.intent import (
    localized_text,
    objective_requests_inventory,
    requests_inventory_by_default,
)
from bim_review_agent.application.agent.kernel import run_agent
from bim_review_agent.application.agent.orchestration.bim import BimSpecialistScheduler
from bim_review_agent.application.agent.orchestration.specialists import (
    EVIDENCE_CRITIC,
    MODEL_INSPECTOR,
    RULE_REVIEW_SPECIALIST,
)
from bim_review_agent.application.agent.registry import ToolRegistry
from bim_review_agent.application.agent.schemas import (
    AgentAction,
    AgentDefinition,
    AgentRun,
    AgentRunState,
    DelegateAction,
    DelegationTask,
    FinalAction,
    ProviderRequest,
    SpecialistResult,
)
from bim_review_agent.application.tools import BimReviewToolContext
from bim_review_agent.domain.models import ReviewRun
from bim_review_agent.infrastructure.connectors import DEFAULT_CONNECTOR_IDS
from bim_review_agent.infrastructure.memory import (
    SQLiteMemoryStore,
    recall_preferences,
    recall_session_episodes,
)
from bim_review_agent.infrastructure.providers import ModelProvider, ScriptedModelProvider

BIM_MULTI_AGENT_MANAGER = AgentDefinition(
    agent_id="bim-review-manager-multi",
    name="BIM Review Manager (Multi-Agent)",
    version="1.0",
    instructions=(
        "Own the final response and delegate only to registered BIM specialists. Keep child "
        "contexts isolated, preserve deterministic verdicts, and report specialist failures."
    ),
    allowed_specialists=(
        MODEL_INSPECTOR.agent_id,
        RULE_REVIEW_SPECIALIST.agent_id,
        EVIDENCE_CRITIC.agent_id,
    ),
    max_steps=4,
    max_tool_calls=0,
    max_delegations=3,
    max_parallel_children=2,
)


def _result(request: ProviderRequest, specialist_id: str) -> SpecialistResult | None:
    return next(
        (result for result in request.specialist_results if result.specialist_id == specialist_id),
        None,
    )


def _inventory_mode(request: ProviderRequest) -> bool:
    return objective_requests_inventory(request.objective) or requests_inventory_by_default(
        request,
        default_objective=DEFAULT_AGENT_OBJECTIVE,
    )


def _failed_specialists(request: ProviderRequest) -> list[SpecialistResult]:
    return [
        result
        for result in request.specialist_results
        if result.state is not AgentRunState.COMPLETED
    ]


def multi_agent_review_script(request: ProviderRequest) -> AgentAction:
    inspector = _result(request, MODEL_INSPECTOR.agent_id)
    reviewer = _result(request, RULE_REVIEW_SPECIALIST.agent_id)
    critic = _result(request, EVIDENCE_CRITIC.agent_id)

    if inspector is None:
        tasks = [
            DelegationTask(
                task_id="inspect-model",
                specialist_id=MODEL_INSPECTOR.agent_id,
                objective="Inspect safe IFC schema, unit, and entity-inventory evidence.",
            )
        ]
        if not _inventory_mode(request):
            tasks.append(
                DelegationTask(
                    task_id="run-rules",
                    specialist_id=RULE_REVIEW_SPECIALIST.agent_id,
                    objective=(
                        "Execute the enabled deterministic BIM rules and return the canonical "
                        "review summary without editing verdicts."
                    ),
                )
            )
        return DelegateAction(
            tasks=tuple(tasks),
            purpose=(
                "Delegate independent model inspection and rule execution with isolated tools."
                if len(tasks) == 2
                else "Delegate the requested inventory-only inspection."
            ),
        )

    failures = _failed_specialists(request)
    if failures:
        return FinalAction(
            message="One or more BIM specialists ended without success; no success was inferred.",
            data={
                "mode": "specialist_failure",
                "failed_specialists": [
                    {
                        "specialist_id": failure.specialist_id,
                        "child_run_id": failure.child_run_id,
                        "stop_reason": failure.stop_reason,
                    }
                    for failure in failures
                ],
                "recalled_episode_ids": [episode.episode_id for episode in request.episodes],
            },
        )

    if _inventory_mode(request):
        inventory = inspector.data["inventory"]
        return FinalAction(
            message=localized_text(
                request,
                en=(
                    f"Multi-Agent inspection read {inventory['total_entities']} IFC records, "
                    f"including {inventory['door_count']} doors; no rule verdicts were requested."
                ),
                zh_cn=(
                    f"多 Agent 检查了 {inventory['total_entities']} 条 IFC 记录, "
                    f"其中有 {inventory['door_count']} 个门构件; 本次未生成规则判定。"
                ),
                zh_hant=(
                    f"多 Agent 檢查了 {inventory['total_entities']} 條 IFC 記錄, "
                    f"其中有 {inventory['door_count']} 個門構件; 本次未產生規則判定。"
                ),
            ),
            data={
                "mode": "inventory_only",
                "inventory": inventory,
                "specialist_run_ids": [inspector.child_run_id],
                "recalled_episode_ids": [episode.episode_id for episode in request.episodes],
            },
        )

    if reviewer is None:
        return FinalAction(
            message="The Rule Review Specialist did not return a result.",
            data={"mode": "specialist_failure"},
        )

    if critic is None:
        if reviewer.linked_review_run_id is None:
            return FinalAction(
                message="The rule specialist returned no canonical ReviewRun reference.",
                data={"mode": "specialist_failure"},
            )
        return DelegateAction(
            tasks=(
                DelegationTask(
                    task_id="critique-evidence",
                    specialist_id=EVIDENCE_CRITIC.agent_id,
                    objective=(
                        "Read the completed ReviewRun and challenge evidence completeness, "
                        "uncertainty, and authority limitations without changing verdicts."
                    ),
                    input={"review_run_id": reviewer.linked_review_run_id},
                ),
            ),
            purpose="Ask a read-only critic to challenge the deterministic review evidence.",
        )

    summary = reviewer.data["summary"]
    critique = critic.data["critique"]
    return FinalAction(
        message=localized_text(
            request,
            en=(
                f"Multi-Agent review completed {summary['total_findings']} findings: "
                f"{summary['pass_count']} PASS, {summary['fail_count']} FAIL, and "
                f"{summary['review_count']} REVIEW. Evidence critique found "
                f"{len(critique['unsupported_actionable_finding_ids'])} unsupported actionable "
                "findings."
            ),
            zh_cn=(
                f"多 Agent 审查完成 {summary['total_findings']} 条发现: "
                f"{summary['pass_count']} 条 PASS、{summary['fail_count']} 条 FAIL、"
                f"{summary['review_count']} 条 REVIEW; 证据复核发现 "
                f"{len(critique['unsupported_actionable_finding_ids'])} 条无充分支撑的可执行发现。"
            ),
            zh_hant=(
                f"多 Agent 審查完成 {summary['total_findings']} 條發現: "
                f"{summary['pass_count']} 條 PASS、{summary['fail_count']} 條 FAIL、"
                f"{summary['review_count']} 條 REVIEW; 證據覆核發現 "
                f"{len(critique['unsupported_actionable_finding_ids'])} 條缺乏充分支持的可執行發現。"
            ),
        ),
        data={
            "mode": "multi_agent_review",
            "summary": summary,
            "inventory": inspector.data["inventory"],
            "critique": critique,
            "specialist_run_ids": [
                inspector.child_run_id,
                reviewer.child_run_id,
                critic.child_run_id,
            ],
            "recalled_memory_ids": [memory.memory_id for memory in request.memories],
            "recalled_episode_ids": [episode.episode_id for episode in request.episodes],
        },
        linked_review_run_id=reviewer.linked_review_run_id,
    )


def run_bim_multi_agent_review(
    filename: str,
    content: bytes,
    *,
    objective: str = DEFAULT_AGENT_OBJECTIVE,
    memory_store: SQLiteMemoryStore | None = None,
    user_id: str = "local-user",
    project_id: str = "demo-project",
    provider: ModelProvider | None = None,
    connector_ids: tuple[str, ...] = DEFAULT_CONNECTOR_IDS,
    connector_capabilities: frozenset[str] | None = None,
    session_id: str | None = None,
) -> tuple[AgentRun, tuple[AgentRun, ...], ReviewRun | None]:
    normalized_objective = objective.strip() or DEFAULT_AGENT_OBJECTIVE
    recalled_memories = recall_preferences(
        memory_store,
        user_id=user_id,
        project_id=project_id,
    )
    recalled_episodes = recall_session_episodes(
        memory_store,
        session_id=session_id,
    )
    context = BimReviewToolContext(filename=filename, content=content)
    scheduler = BimSpecialistScheduler(
        max_workers=2,
        connector_ids=connector_ids,
        connector_capabilities=connector_capabilities,
    )
    manager_run = run_agent(
        definition=BIM_MULTI_AGENT_MANAGER,
        objective=normalized_objective,
        provider=provider or ScriptedModelProvider(multi_agent_review_script),
        registry=ToolRegistry(),
        tool_context=context,
        recalled_memories=recalled_memories,
        recalled_episodes=recalled_episodes,
        scheduler=scheduler,
        connector_ids=connector_ids,
        session_id=session_id,
    )
    return manager_run, tuple(scheduler.child_runs), context.review_run
