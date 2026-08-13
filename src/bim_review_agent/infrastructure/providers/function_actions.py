"""Shared function-action contract for external model provider adapters."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from pydantic import Field, ValidationError

from bim_review_agent.application.agent.schemas import (
    AgentAction,
    DelegateAction,
    DelegationTask,
    FinalAction,
    ProviderRequest,
    ToolCallAction,
)
from bim_review_agent.domain.models import StrictModel
from bim_review_agent.infrastructure.providers.base import ProviderError

FINAL_FUNCTION = "finalize_agent_response"
DELEGATE_PREFIX = "delegate__"


class FinalResponseArguments(StrictModel):
    message: str = Field(min_length=1, max_length=4000)
    linked_review_run_id: str | None = Field(default=None, max_length=100)


class DelegationArguments(StrictModel):
    objective: str = Field(min_length=1, max_length=1000)
    input: dict[str, Any] = Field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class FunctionCall:
    name: str
    arguments: str
    call_id: str | None = None


def function_definitions(request: ProviderRequest) -> list[dict[str, Any]]:
    """Build vendor-neutral function definitions for one Provider request."""

    functions = [
        {
            "name": tool.name,
            "description": tool.description,
            "parameters": tool.input_schema,
        }
        for tool in request.tools
    ]
    for specialist_id in request.agent.allowed_specialists:
        functions.append(
            {
                "name": f"{DELEGATE_PREFIX}{specialist_id}",
                "description": (
                    f"Delegate one bounded task to registered specialist {specialist_id}."
                ),
                "parameters": DelegationArguments.model_json_schema(),
            }
        )
    functions.append(
        {
            "name": FINAL_FUNCTION,
            "description": "Return the final public response and optional canonical review ID.",
            "parameters": FinalResponseArguments.model_json_schema(),
        }
    )
    return functions


def _arguments(call: FunctionCall) -> dict[str, Any]:
    try:
        decoded = json.loads(call.arguments)
    except json.JSONDecodeError as exc:
        raise ProviderError("The external provider returned invalid function arguments.") from exc
    if not isinstance(decoded, dict):
        raise ProviderError("The external provider function arguments must be an object.")
    return decoded


def _linked_review_ids(request: ProviderRequest) -> set[str]:
    return {
        review_id
        for review_id in (
            *(observation.output.get("review_run_id") for observation in request.observations),
            *(result.linked_review_run_id for result in request.specialist_results),
        )
        if isinstance(review_id, str)
    }


def action_from_function_calls(
    calls: list[FunctionCall],
    request: ProviderRequest,
) -> AgentAction:
    """Validate normalized function calls into exactly one kernel action."""

    if not calls:
        raise ProviderError("The external provider returned no structured Agent action.")

    if all(call.name.startswith(DELEGATE_PREFIX) for call in calls):
        tasks: list[DelegationTask] = []
        for index, call in enumerate(calls):
            specialist_id = call.name.removeprefix(DELEGATE_PREFIX)
            if specialist_id not in request.agent.allowed_specialists:
                raise ProviderError("The external provider requested an unknown specialist.")
            try:
                arguments = DelegationArguments.model_validate(_arguments(call))
            except ValidationError as exc:
                raise ProviderError(
                    "The external provider returned invalid delegation arguments."
                ) from exc
            tasks.append(
                DelegationTask(
                    task_id=call.call_id or f"delegation-{index + 1}",
                    specialist_id=specialist_id,
                    objective=arguments.objective,
                    input=arguments.input,
                )
            )
        try:
            return DelegateAction(
                tasks=tuple(tasks),
                purpose="The selected model requested bounded specialist delegation.",
            )
        except ValidationError as exc:
            raise ProviderError(
                "The external provider returned an invalid delegation set."
            ) from exc

    if len(calls) != 1:
        raise ProviderError("The external provider returned incompatible mixed actions.")

    call = calls[0]
    arguments = _arguments(call)
    if call.name == FINAL_FUNCTION:
        try:
            final = FinalResponseArguments.model_validate(arguments)
        except ValidationError as exc:
            raise ProviderError(
                "The external provider returned an invalid final response."
            ) from exc
        if (
            final.linked_review_run_id is not None
            and final.linked_review_run_id not in _linked_review_ids(request)
        ):
            raise ProviderError(
                "The external provider referenced a review run that no tool or specialist created."
            )
        return FinalAction(
            message=final.message,
            data={"source": "model_provider", "verdict_authority": False},
            linked_review_run_id=final.linked_review_run_id,
        )

    allowed_tool_names = {tool.name for tool in request.tools}
    if call.name not in allowed_tool_names:
        raise ProviderError("The external provider requested an unknown tool.")
    return ToolCallAction(
        tool_name=call.name,
        arguments=arguments,
        purpose=f"The selected model requested registered tool {call.name}.",
    )


__all__ = [
    "DELEGATE_PREFIX",
    "FINAL_FUNCTION",
    "FunctionCall",
    "action_from_function_calls",
    "function_definitions",
]
