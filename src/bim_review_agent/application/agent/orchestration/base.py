"""Scheduler interface kept independent from any domain-specific specialist."""

from __future__ import annotations

from typing import Any, Protocol

from bim_review_agent.application.agent.schemas import DelegationTask, SpecialistResult


class AgentScheduler(Protocol):
    def contains(self, specialist_id: str) -> bool:
        """Return whether a specialist is registered and available."""

        ...

    def delegate(
        self,
        *,
        parent_run_id: str,
        tasks: tuple[DelegationTask, ...],
        parent_context: Any,
    ) -> tuple[SpecialistResult, ...]:
        """Execute bounded tasks and return one public result for each task."""

        ...
