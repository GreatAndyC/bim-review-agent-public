"""Convert redacted session episodes into provider-safe working context."""

from __future__ import annotations

from bim_review_agent.application.agent.schemas import RecalledEpisode
from bim_review_agent.infrastructure.memory.sqlite import SQLiteMemoryStore


def recall_session_episodes(
    memory_store: SQLiteMemoryStore | None,
    *,
    session_id: str | None,
) -> tuple[RecalledEpisode, ...]:
    if memory_store is None or session_id is None:
        return ()
    records = memory_store.recall_episodes(session_id)
    return tuple(
        RecalledEpisode(
            episode_id=record.episode_id,
            agent_run_id=record.agent_run_id,
            linked_review_run_id=record.linked_review_run_id,
            source_sha256=record.source_sha256,
            objective_sha256=record.objective_sha256,
            mode=record.mode,
            state=record.state,
            stop_reason=record.stop_reason,
            pass_count=record.pass_count,
            fail_count=record.fail_count,
            review_count=record.review_count,
            reviewed_entities=record.reviewed_entities,
            created_at=record.created_at,
        )
        for record in records
    )
