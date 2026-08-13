"""Typed, policy-filtered tool registration and dispatch."""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, ValidationError

from bim_review_agent.application.agent.schemas import AgentStopReason, ToolDescriptor, ToolEffect

ToolHandler = Callable[[BaseModel, Any], BaseModel | dict[str, Any]]


class ToolDispatchError(RuntimeError):
    def __init__(self, reason: AgentStopReason, message: str) -> None:
        super().__init__(message)
        self.reason = reason


@dataclass(frozen=True, slots=True)
class RegisteredTool:
    descriptor: ToolDescriptor
    input_model: type[BaseModel]
    output_model: type[BaseModel]
    handler: ToolHandler


class ToolRegistry:
    """Own tool schemas and handlers; expose only an Agent's allowlisted catalogue."""

    def __init__(self) -> None:
        self._tools: dict[str, RegisteredTool] = {}

    def register(
        self,
        *,
        name: str,
        version: str,
        description: str,
        effect: ToolEffect,
        input_model: type[BaseModel],
        output_model: type[BaseModel],
        handler: ToolHandler,
    ) -> None:
        if name in self._tools:
            raise ValueError(f"Tool already registered: {name}")
        descriptor = ToolDescriptor(
            name=name,
            version=version,
            description=description,
            effect=effect,
            input_schema=input_model.model_json_schema(),
            output_schema=output_model.model_json_schema(),
        )
        self._tools[name] = RegisteredTool(
            descriptor=descriptor,
            input_model=input_model,
            output_model=output_model,
            handler=handler,
        )

    def contains(self, name: str) -> bool:
        return name in self._tools

    def catalogue(self, allowed_tools: Iterable[str]) -> tuple[ToolDescriptor, ...]:
        allowed = set(allowed_tools)
        return tuple(
            registered.descriptor
            for name, registered in sorted(self._tools.items())
            if name in allowed
        )

    def execute(self, name: str, arguments: dict[str, Any], context: Any) -> dict[str, Any]:
        registered = self._tools.get(name)
        if registered is None:
            raise ToolDispatchError(
                AgentStopReason.TOOL_NOT_FOUND,
                f"Requested tool is not registered: {name}",
            )
        try:
            validated_input = registered.input_model.model_validate(arguments)
        except ValidationError as exc:
            raise ToolDispatchError(
                AgentStopReason.TOOL_INPUT_INVALID,
                f"Input for tool {name} does not match its declared schema.",
            ) from exc

        try:
            raw_output = registered.handler(validated_input, context)
        except ToolDispatchError:
            raise
        except Exception as exc:
            raise ToolDispatchError(
                AgentStopReason.TOOL_EXECUTION_FAILED,
                f"Tool {name} failed during execution.",
            ) from exc

        try:
            validated_output = registered.output_model.model_validate(raw_output)
        except ValidationError as exc:
            raise ToolDispatchError(
                AgentStopReason.TOOL_OUTPUT_INVALID,
                f"Output from tool {name} does not match its declared schema.",
            ) from exc
        return validated_output.model_dump(mode="json")
