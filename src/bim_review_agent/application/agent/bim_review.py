"""First goal-driven Agent vertical slice over the deterministic BIM kernel."""

from __future__ import annotations

from bim_review_agent.application.agent.intent import (
    localized_text,
    objective_requests_inventory,
    requests_inventory_by_default,
)
from bim_review_agent.application.agent.kernel import run_agent
from bim_review_agent.application.agent.schemas import (
    AgentAction,
    AgentDefinition,
    AgentRun,
    FinalAction,
    ProviderRequest,
    ToolCallAction,
    ToolObservation,
)
from bim_review_agent.application.tools import BimReviewToolContext, build_bim_tool_registry
from bim_review_agent.domain.models import ReviewRun
from bim_review_agent.infrastructure.connectors import DEFAULT_CONNECTOR_IDS
from bim_review_agent.infrastructure.memory import (
    SQLiteMemoryStore,
    recall_preferences,
    recall_session_episodes,
)
from bim_review_agent.infrastructure.providers import (
    ModelProvider,
    ProviderError,
    ScriptedModelProvider,
)

DEFAULT_AGENT_OBJECTIVE = (
    "Inspect the IFC model, run the enabled BIM review rules, and summarize the evidence-backed "
    "result without changing any deterministic verdict."
)

BIM_REVIEW_MANAGER = AgentDefinition(
    agent_id="bim-review-manager",
    name="BIM Review Manager",
    version="1.0",
    instructions=(
        "Inspect model evidence before requesting review. Use only the exposed tools. "
        "Treat tool observations as the source of model and verdict facts. Never invent or edit "
        "PASS, FAIL, REVIEW, rule thresholds, source properties, or authority labels."
    ),
    allowed_tools=("inspect_model", "run_deterministic_review"),
    max_steps=5,
    max_tool_calls=2,
)


def _latest_observation(
    request: ProviderRequest,
    tool_name: str,
) -> ToolObservation | None:
    return next(
        (
            observation
            for observation in reversed(request.observations)
            if observation.tool_name == tool_name
        ),
        None,
    )


def bim_review_script(request: ProviderRequest) -> AgentAction:
    """Deterministic policy that exercises the same action contract as a live model."""

    inspection = _latest_observation(request, "inspect_model")
    review = _latest_observation(request, "run_deterministic_review")

    if inspection is None:
        return ToolCallAction(
            tool_name="inspect_model",
            arguments={"include_entity_counts": True},
            purpose="Inspect IFC schema, units, and relevant entity counts before choosing work.",
        )

    if objective_requests_inventory(request.objective) or requests_inventory_by_default(
        request,
        default_objective=DEFAULT_AGENT_OBJECTIVE,
    ):
        output = inspection.output
        return FinalAction(
            message=localized_text(
                request,
                en=(
                    f"Inspected {output['filename']}: {output['total_entities']} IFC records, "
                    f"including {output['door_count']} doors. No rule verdicts were requested."
                ),
                zh_cn=(
                    f"已检查 {output['filename']}: 共 {output['total_entities']} 条 IFC 记录, "
                    f"其中包含 {output['door_count']} 个门构件; 本次未请求规则判定。"
                ),
                zh_hant=(
                    f"已檢查 {output['filename']}: 共 {output['total_entities']} 條 IFC 記錄, "
                    f"其中包含 {output['door_count']} 個門構件; 本次未請求規則判定。"
                ),
            ),
            data={
                "mode": "inventory_only",
                "inventory": output,
                "recalled_memory_ids": [memory.memory_id for memory in request.memories],
                "recalled_episode_ids": [episode.episode_id for episode in request.episodes],
            },
        )

    if inspection.output["door_count"] == 0:
        return FinalAction(
            message=localized_text(
                request,
                en=(
                    "The IFC inspection found no door elements, so the enabled door-review "
                    "tools are not applicable and no verdicts were created."
                ),
                zh_cn="IFC 检查未发现门构件, 因此门审查工具不适用, 本次没有生成任何判定。",
                zh_hant="IFC 檢查未發現門構件, 因此門審查工具不適用, 本次沒有產生任何判定。",
            ),
            data={
                "mode": "no_applicable_entities",
                "inventory": inspection.output,
                "recalled_memory_ids": [memory.memory_id for memory in request.memories],
                "recalled_episode_ids": [episode.episode_id for episode in request.episodes],
            },
        )

    if review is None:
        door_count = inspection.output["door_count"]
        return ToolCallAction(
            tool_name="run_deterministic_review",
            purpose=(
                f"Run the enabled deterministic rules after inspection found {door_count} doors."
            ),
        )

    output = review.output
    if not isinstance(output.get("review_run_id"), str):
        raise ProviderError("The review observation did not include a canonical run reference.")
    return FinalAction(
        message=localized_text(
            request,
            en=(
                f"Completed {output['total_findings']} evidence-backed findings: "
                f"{output['pass_count']} PASS, {output['fail_count']} FAIL, and "
                f"{output['review_count']} REVIEW."
            ),
            zh_cn=(
                f"已完成 {output['total_findings']} 条有证据支撑的发现: "
                f"{output['pass_count']} 条 PASS、{output['fail_count']} 条 FAIL、"
                f"{output['review_count']} 条 REVIEW。"
            ),
            zh_hant=(
                f"已完成 {output['total_findings']} 條有證據支持的發現: "
                f"{output['pass_count']} 條 PASS、{output['fail_count']} 條 FAIL、"
                f"{output['review_count']} 條 REVIEW。"
            ),
        ),
        data={
            "mode": "full_review",
            "summary": {
                "total_findings": output["total_findings"],
                "pass_count": output["pass_count"],
                "fail_count": output["fail_count"],
                "review_count": output["review_count"],
                "reviewed_entities": output["reviewed_entities"],
            },
            "rule_pack_id": output["rule_pack_id"],
            "rule_pack_version": output["rule_pack_version"],
            "recalled_memory_ids": [memory.memory_id for memory in request.memories],
            "recalled_episode_ids": [episode.episode_id for episode in request.episodes],
        },
        linked_review_run_id=output["review_run_id"],
    )


def run_bim_review_agent(
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
) -> tuple[AgentRun, ReviewRun | None]:
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
    run = run_agent(
        definition=BIM_REVIEW_MANAGER,
        objective=normalized_objective,
        provider=provider or ScriptedModelProvider(bim_review_script),
        registry=build_bim_tool_registry(connector_capabilities),
        tool_context=context,
        recalled_memories=recalled_memories,
        recalled_episodes=recalled_episodes,
        connector_ids=connector_ids,
        session_id=session_id,
    )
    return run, context.review_run
