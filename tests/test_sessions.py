from __future__ import annotations

import sqlite3
from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from bim_review_agent.infrastructure.memory import (
    MAX_EPISODES_PER_SESSION,
    MAX_RECALLED_EPISODES,
    MAX_SESSIONS_PER_SCOPE,
    EpisodeMode,
    EpisodeWrite,
    SessionCreate,
    SQLiteMemoryStore,
)

_STARTED_AT = datetime(2026, 8, 9, 12, 0, tzinfo=UTC)


def _episode(
    session_id: str,
    index: int,
    *,
    with_review: bool = True,
) -> EpisodeWrite:
    counts = (
        {
            "pass_count": 5,
            "fail_count": 1,
            "review_count": 3,
            "reviewed_entities": 4,
        }
        if with_review
        else {}
    )
    return EpisodeWrite(
        session_id=session_id,
        agent_run_id=f"agent-run-{index}",
        linked_review_run_id=f"review-run-{index}" if with_review else None,
        source_sha256=f"{index:064x}",
        objective_sha256=f"{index + 100:064x}",
        agent_id="bim-review-manager",
        provider_id="scripted",
        model_id="deterministic-script-v1",
        connector_ids=("local-bim",),
        state="COMPLETED",
        stop_reason="FINAL_OUTPUT",
        mode=EpisodeMode.FULL_REVIEW if with_review else EpisodeMode.INVENTORY_ONLY,
        memory_read_count=1,
        delegation_count=0,
        created_at=_STARTED_AT + timedelta(seconds=index),
        **counts,
    )


def test_session_and_episode_persist_across_store_instances(tmp_path) -> None:
    path = tmp_path / "memory.sqlite3"
    first_store = SQLiteMemoryStore(path)
    session = first_store.create_session(SessionCreate(user_id="user-a", project_id="project-a"))
    episode = first_store.record_episode(_episode(session.session_id, 1))

    second_store = SQLiteMemoryStore(path)
    persisted_session = second_store.get_session(session.session_id)
    persisted_episodes = second_store.list_episodes(session.session_id)

    assert persisted_session is not None
    assert persisted_session.episode_count == 1
    assert persisted_session.last_episode_id == episode.episode_id
    assert [record.episode_id for record in persisted_episodes] == [episode.episode_id]
    assert persisted_episodes[0].source_sha256 == f"{1:064x}"


def test_episode_recall_is_newest_first_bounded_and_records_provenance(tmp_path) -> None:
    store = SQLiteMemoryStore(tmp_path / "memory.sqlite3")
    session = store.create_session(SessionCreate())
    written = [store.record_episode(_episode(session.session_id, index)) for index in range(5)]

    recalled = store.recall_episodes(session.session_id)
    persisted = {record.episode_id: record for record in store.list_episodes(session.session_id)}

    assert len(recalled) == MAX_RECALLED_EPISODES
    assert [record.episode_id for record in recalled] == [
        written[4].episode_id,
        written[3].episode_id,
        written[2].episode_id,
    ]
    assert all(record.recall_count == 1 for record in recalled)
    assert all(record.last_recalled_at is not None for record in recalled)
    assert all(persisted[record.episode_id].recall_count == 1 for record in recalled)
    assert persisted[written[0].episode_id].recall_count == 0


def test_episode_retention_evicts_only_summaries_beyond_the_cap(tmp_path) -> None:
    store = SQLiteMemoryStore(tmp_path / "memory.sqlite3")
    session = store.create_session(SessionCreate())

    for index in range(MAX_EPISODES_PER_SESSION + 3):
        store.record_episode(_episode(session.session_id, index))

    remaining = store.list_episodes(session.session_id)

    assert len(remaining) == MAX_EPISODES_PER_SESSION
    assert [record.agent_run_id for record in remaining] == [
        f"agent-run-{index}" for index in range(MAX_EPISODES_PER_SESSION + 2, 2, -1)
    ]
    assert store.get_session(session.session_id).episode_count == MAX_EPISODES_PER_SESSION  # type: ignore[union-attr]


def test_session_retention_is_scoped_and_forget_cascades_to_episodes(tmp_path) -> None:
    store = SQLiteMemoryStore(tmp_path / "memory.sqlite3")
    first = store.create_session(SessionCreate(user_id="user-a", project_id="project-a"))
    store.record_episode(_episode(first.session_id, 1))
    for _ in range(MAX_SESSIONS_PER_SCOPE):
        store.create_session(SessionCreate(user_id="user-a", project_id="project-a"))
    other_scope = store.create_session(SessionCreate(user_id="user-a", project_id="project-b"))

    scoped = store.list_sessions(user_id="user-a", project_id="project-a")

    assert len(scoped) == MAX_SESSIONS_PER_SCOPE
    assert first.session_id not in {session.session_id for session in scoped}
    assert store.get_session(first.session_id) is None
    assert store.list_episodes(first.session_id) == []
    assert store.get_session(other_scope.session_id) is not None
    assert store.forget_session(other_scope.session_id) is True
    assert store.forget_session(other_scope.session_id) is False
    assert store.get_session(other_scope.session_id) is None


def test_episode_schema_and_database_exclude_raw_private_content(tmp_path) -> None:
    path = tmp_path / "memory.sqlite3"
    store = SQLiteMemoryStore(path)
    session = store.create_session(SessionCreate())
    store.record_episode(_episode(session.session_id, 1, with_review=False))

    private_markers = (
        "private-objective-marker",
        "sensitive-model-name.ifc",
        "private-final-response-marker",
        "private-finding-detail-marker",
    )
    database_bytes = path.read_bytes()
    with sqlite3.connect(path) as connection:
        columns = {
            row[1] for row in connection.execute("PRAGMA table_info(agent_episodes)").fetchall()
        }

    assert all(marker.encode() not in database_bytes for marker in private_markers)
    assert {
        "objective",
        "filename",
        "final_response",
        "findings",
        "ifc_bytes",
    }.isdisjoint(columns)
    assert {"source_sha256", "objective_sha256", "pass_count", "mode"} <= columns


def test_episode_review_counts_must_be_complete() -> None:
    with pytest.raises(ValidationError, match="supplied together"):
        EpisodeWrite(
            **{
                **_episode("session-1", 1, with_review=False).model_dump(),
                "pass_count": 1,
            }
        )
