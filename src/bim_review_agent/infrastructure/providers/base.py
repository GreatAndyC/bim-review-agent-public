"""Provider-independent interface used by the Agent kernel."""

from __future__ import annotations

from typing import Protocol

from bim_review_agent.application.agent.schemas import AgentAction, ProviderRequest


class ProviderError(RuntimeError):
    """A public-safe provider failure."""


class ModelProvider(Protocol):
    provider_id: str
    model_id: str

    def next_action(self, request: ProviderRequest) -> AgentAction:
        """Return one structured action without executing it."""

        ...
