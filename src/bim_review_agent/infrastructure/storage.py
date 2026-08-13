"""Bounded in-memory storage for local demonstration runs."""

from __future__ import annotations

from collections import OrderedDict
from threading import Lock
from typing import Generic, Protocol, TypeVar

from bim_review_agent.application.agent.schemas import AgentRun
from bim_review_agent.domain.models import ReviewRun
from bim_review_agent.infrastructure.config import settings


class StoredRun(Protocol):
    run_id: str


StoredRunType = TypeVar("StoredRunType", bound=StoredRun)


class RunStore(Generic[StoredRunType]):
    def __init__(self, limit: int = settings.run_limit) -> None:
        self._limit = limit
        self._runs: OrderedDict[str, StoredRunType] = OrderedDict()
        self._lock = Lock()

    def put(self, run: StoredRunType) -> None:
        with self._lock:
            self._runs[run.run_id] = run
            self._runs.move_to_end(run.run_id)
            while len(self._runs) > self._limit:
                self._runs.popitem(last=False)

    def get(self, run_id: str) -> StoredRunType | None:
        with self._lock:
            run = self._runs.get(run_id)
            if run is not None:
                self._runs.move_to_end(run_id)
            return run

    def clear(self) -> None:
        with self._lock:
            self._runs.clear()


run_store: RunStore[ReviewRun] = RunStore()
agent_run_store: RunStore[AgentRun] = RunStore()
