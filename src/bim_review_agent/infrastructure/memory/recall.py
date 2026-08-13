"""Convert stored scoped preferences into provider-safe memory context."""

from __future__ import annotations

from bim_review_agent.application.agent.schemas import RecalledMemory
from bim_review_agent.infrastructure.memory.schemas import MemoryScope, MemoryScopeType
from bim_review_agent.infrastructure.memory.sqlite import SQLiteMemoryStore


def recall_preferences(
    memory_store: SQLiteMemoryStore | None,
    *,
    user_id: str,
    project_id: str,
) -> tuple[RecalledMemory, ...]:
    if memory_store is None:
        return ()
    records = memory_store.recall(
        [
            MemoryScope(scope_type=MemoryScopeType.USER, scope_id=user_id),
            MemoryScope(scope_type=MemoryScopeType.PROJECT, scope_id=project_id),
        ]
    )
    return tuple(
        RecalledMemory(
            memory_id=record.memory_id,
            key=record.key,
            value=record.value,
            scope_type=record.scope.scope_type,
            scope_id=record.scope.scope_id,
            source_run_id=record.source_run_id,
            created_at=record.created_at,
        )
        for record in records
    )
