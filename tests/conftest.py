from __future__ import annotations

import pytest

from bim_review_agent.infrastructure.storage import agent_run_store, run_store


@pytest.fixture(autouse=True)
def clear_local_stores() -> None:
    run_store.clear()
    agent_run_store.clear()


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"
