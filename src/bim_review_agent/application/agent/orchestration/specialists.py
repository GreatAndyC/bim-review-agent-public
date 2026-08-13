"""Narrow BIM specialist definitions and deterministic provider policies."""

from __future__ import annotations

from collections.abc import Callable

from bim_review_agent.application.agent.schemas import (
    AgentAction,
    AgentDefinition,
    FinalAction,
    ProviderRequest,
    ToolCallAction,
    ToolObservation,
)

MODEL_INSPECTOR = AgentDefinition(
    agent_id="model-inspector",
    name="Model Inspector",
    version="1.0",
    instructions=(
        "Inspect only safe IFC schema, unit, and inventory facts. Do not assign a rule verdict, "
        "write memory, or delegate work."
    ),
    allowed_tools=("inspect_model",),
    max_steps=2,
    max_tool_calls=1,
)

RULE_REVIEW_SPECIALIST = AgentDefinition(
    agent_id="rule-review-specialist",
    name="Rule Review Specialist",
    version="1.0",
    instructions=(
        "Invoke only the deterministic BIM review tool and return its canonical summary. "
        "Do not invent, edit, or reinterpret any verdict. Do not delegate work."
    ),
    allowed_tools=("run_deterministic_review",),
    max_steps=2,
    max_tool_calls=1,
)

EVIDENCE_CRITIC = AgentDefinition(
    agent_id="evidence-critic",
    name="Evidence Critic",
    version="1.0",
    instructions=(
        "Challenge evidence completeness and unresolved uncertainty in one completed ReviewRun. "
        "Remain read-only, preserve every verdict, and do not delegate work."
    ),
    allowed_tools=("critique_review_evidence",),
    max_steps=2,
    max_tool_calls=1,
)

BIM_SPECIALISTS = {
    definition.agent_id: definition
    for definition in (MODEL_INSPECTOR, RULE_REVIEW_SPECIALIST, EVIDENCE_CRITIC)
}


def _observation(request: ProviderRequest, tool_name: str) -> ToolObservation | None:
    return next(
        (item for item in reversed(request.observations) if item.tool_name == tool_name),
        None,
    )


def model_inspector_script(request: ProviderRequest) -> AgentAction:
    observation = _observation(request, "inspect_model")
    if observation is None:
        return ToolCallAction(
            tool_name="inspect_model",
            arguments={"include_entity_counts": True},
            purpose="Inspect safe IFC metadata for the manager's bounded model-inventory task.",
        )
    output = observation.output
    return FinalAction(
        message=(
            f"Inspected {output['total_entities']} IFC records, including "
            f"{output['door_count']} doors."
        ),
        data={"inventory": output},
    )


def rule_review_specialist_script(request: ProviderRequest) -> AgentAction:
    observation = _observation(request, "run_deterministic_review")
    if observation is None:
        return ToolCallAction(
            tool_name="run_deterministic_review",
            purpose="Execute the enabled deterministic rule pack without changing its verdicts.",
        )
    output = observation.output
    return FinalAction(
        message=(
            f"Deterministic review produced {output['total_findings']} findings: "
            f"{output['pass_count']} PASS, {output['fail_count']} FAIL, and "
            f"{output['review_count']} REVIEW."
        ),
        data={
            "summary": {
                "total_findings": output["total_findings"],
                "pass_count": output["pass_count"],
                "fail_count": output["fail_count"],
                "review_count": output["review_count"],
                "reviewed_entities": output["reviewed_entities"],
            },
            "rule_pack_id": output["rule_pack_id"],
            "rule_pack_version": output["rule_pack_version"],
        },
        linked_review_run_id=output["review_run_id"],
    )


def evidence_critic_script(request: ProviderRequest) -> AgentAction:
    observation = _observation(request, "critique_review_evidence")
    if observation is None:
        return ToolCallAction(
            tool_name="critique_review_evidence",
            purpose="Challenge evidence completeness and surface unresolved human review work.",
        )
    output = observation.output
    return FinalAction(
        message=(
            f"Evidence critique found {len(output['unsupported_actionable_finding_ids'])} "
            f"unsupported actionable findings and {output['unresolved_review_findings']} "
            "unresolved REVIEW findings."
        ),
        data={"critique": output},
        linked_review_run_id=output["review_run_id"],
    )


SPECIALIST_SCRIPTS: dict[str, Callable[[ProviderRequest], AgentAction]] = {
    MODEL_INSPECTOR.agent_id: model_inspector_script,
    RULE_REVIEW_SPECIALIST.agent_id: rule_review_specialist_script,
    EVIDENCE_CRITIC.agent_id: evidence_critic_script,
}
