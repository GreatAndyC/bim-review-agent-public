"""Deterministic provider for trajectory tests and offline demonstrations."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from bim_review_agent.application.agent.schemas import AgentAction, ProviderRequest
from bim_review_agent.infrastructure.providers.base import ProviderError

Script = Callable[[ProviderRequest], AgentAction]


@dataclass(frozen=True, slots=True)
class ScriptedModelProvider:
    """Execute a checked-in decision script through the real provider contract."""

    script: Script
    provider_id: str = "scripted"
    model_id: str = "deterministic-script-v1"

    def next_action(self, request: ProviderRequest) -> AgentAction:
        try:
            return self.script(request)
        except ProviderError:
            raise
        except Exception as exc:
            raise ProviderError("The scripted provider could not produce an action.") from exc
