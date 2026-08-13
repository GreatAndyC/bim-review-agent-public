"""SQLite implementation of scoped preference memory."""

from __future__ import annotations

import json
import os
import sqlite3
from collections.abc import Sequence
from contextlib import suppress
from datetime import UTC, datetime
from pathlib import Path
from threading import RLock
from uuid import uuid4

from bim_review_agent.infrastructure.memory.schemas import (
    AgentSessionRecord,
    EpisodeRecord,
    EpisodeWrite,
    MemoryRecord,
    MemoryScope,
    MemorySensitivity,
    MemoryType,
    MemoryWrite,
    SessionCreate,
)

MAX_SESSIONS_PER_SCOPE = 20
MAX_EPISODES_PER_SESSION = 20
MAX_RECALLED_EPISODES = 3

_SCHEMA = """
CREATE TABLE IF NOT EXISTS memories (
    memory_id TEXT PRIMARY KEY,
    memory_type TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    scope_type TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    source_run_id TEXT,
    creator TEXT NOT NULL,
    confidence REAL NOT NULL,
    verification TEXT NOT NULL,
    sensitivity TEXT NOT NULL,
    retention_policy TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    expires_at TEXT,
    supersedes_memory_id TEXT,
    active INTEGER NOT NULL CHECK (active IN (0, 1))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_memory_per_scope_key
ON memories(scope_type, scope_id, key)
WHERE active = 1;
CREATE INDEX IF NOT EXISTS memories_scope_lookup
ON memories(scope_type, scope_id, active, key);
CREATE TABLE IF NOT EXISTS agent_sessions (
    session_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    retention_policy TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_sessions_scope_lookup
ON agent_sessions(user_id, project_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS agent_episodes (
    episode_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES agent_sessions(session_id) ON DELETE CASCADE,
    agent_run_id TEXT NOT NULL UNIQUE,
    linked_review_run_id TEXT,
    source_sha256 TEXT NOT NULL,
    objective_sha256 TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    connector_ids_json TEXT NOT NULL,
    state TEXT NOT NULL,
    stop_reason TEXT NOT NULL,
    mode TEXT NOT NULL,
    pass_count INTEGER,
    fail_count INTEGER,
    review_count INTEGER,
    reviewed_entities INTEGER,
    memory_read_count INTEGER NOT NULL,
    delegation_count INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    last_recalled_at TEXT,
    recall_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS agent_episodes_session_lookup
ON agent_episodes(session_id, created_at DESC);
PRAGMA user_version = 2;
"""


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _parse_datetime(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


def _row_to_record(row: sqlite3.Row) -> MemoryRecord:
    return MemoryRecord(
        memory_id=row["memory_id"],
        memory_type=row["memory_type"],
        key=row["key"],
        value=row["value"],
        scope={"scope_type": row["scope_type"], "scope_id": row["scope_id"]},
        source_run_id=row["source_run_id"],
        creator=row["creator"],
        confidence=row["confidence"],
        verification=row["verification"],
        sensitivity=row["sensitivity"],
        retention_policy=row["retention_policy"],
        created_at=_parse_datetime(row["created_at"]),
        last_used_at=_parse_datetime(row["last_used_at"]),
        expires_at=_parse_datetime(row["expires_at"]),
        supersedes_memory_id=row["supersedes_memory_id"],
        active=bool(row["active"]),
    )


def _row_to_session(row: sqlite3.Row) -> AgentSessionRecord:
    return AgentSessionRecord(
        session_id=row["session_id"],
        user_id=row["user_id"],
        project_id=row["project_id"],
        created_at=_parse_datetime(row["created_at"]),
        updated_at=_parse_datetime(row["updated_at"]),
        episode_count=row["episode_count"],
        last_episode_id=row["last_episode_id"],
        last_episode_at=_parse_datetime(row["last_episode_at"]),
        retention_policy=row["retention_policy"],
    )


def _row_to_episode(row: sqlite3.Row) -> EpisodeRecord:
    connector_ids = json.loads(row["connector_ids_json"])
    if not isinstance(connector_ids, list) or not all(
        isinstance(connector_id, str) for connector_id in connector_ids
    ):
        raise RuntimeError("Stored episode connector IDs are invalid.")
    return EpisodeRecord(
        episode_id=row["episode_id"],
        session_id=row["session_id"],
        agent_run_id=row["agent_run_id"],
        linked_review_run_id=row["linked_review_run_id"],
        source_sha256=row["source_sha256"],
        objective_sha256=row["objective_sha256"],
        agent_id=row["agent_id"],
        provider_id=row["provider_id"],
        model_id=row["model_id"],
        connector_ids=tuple(connector_ids),
        state=row["state"],
        stop_reason=row["stop_reason"],
        mode=row["mode"],
        pass_count=row["pass_count"],
        fail_count=row["fail_count"],
        review_count=row["review_count"],
        reviewed_entities=row["reviewed_entities"],
        memory_read_count=row["memory_read_count"],
        delegation_count=row["delegation_count"],
        created_at=_parse_datetime(row["created_at"]),
        last_recalled_at=_parse_datetime(row["last_recalled_at"]),
        recall_count=row["recall_count"],
    )


_SESSION_SELECT = """
SELECT
    session.*,
    COUNT(episode.episode_id) AS episode_count,
    (
        SELECT latest.episode_id
        FROM agent_episodes AS latest
        WHERE latest.session_id = session.session_id
        ORDER BY latest.created_at DESC, latest.episode_id DESC
        LIMIT 1
    ) AS last_episode_id,
    MAX(episode.created_at) AS last_episode_at
FROM agent_sessions AS session
LEFT JOIN agent_episodes AS episode ON episode.session_id = session.session_id
"""


class SQLiteMemoryStore:
    """Persist allowlisted preferences and redacted episodes, never raw IFC or credentials."""

    def __init__(self, database_path: Path) -> None:
        self.database_path = database_path
        self._initialized = False
        self._lock = RLock()

    def _connect(self) -> sqlite3.Connection:
        self._ensure_initialized()
        connection = sqlite3.connect(self.database_path, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def _ensure_initialized(self) -> None:
        if self._initialized:
            return
        with self._lock:
            if self._initialized:
                return
            self.database_path.parent.mkdir(parents=True, exist_ok=True)
            existed = self.database_path.exists()
            connection = sqlite3.connect(self.database_path, timeout=5)
            try:
                connection.execute("PRAGMA foreign_keys = ON")
                connection.executescript(_SCHEMA)
                connection.commit()
            finally:
                connection.close()
            if not existed:
                with suppress(OSError):
                    os.chmod(self.database_path, 0o600)
            self._initialized = True

    def remember(self, write: MemoryWrite) -> MemoryRecord:
        """Create or correct one active preference within an exact scope."""

        with self._lock, self._connect() as connection:
            current_row = connection.execute(
                """
                SELECT * FROM memories
                WHERE scope_type = ? AND scope_id = ? AND key = ? AND active = 1
                """,
                (write.scope.scope_type, write.scope.scope_id, write.key),
            ).fetchone()
            if current_row is not None and current_row["value"] == write.value:
                return _row_to_record(current_row)

            now = _utc_now()
            supersedes = current_row["memory_id"] if current_row is not None else None
            if current_row is not None:
                connection.execute(
                    "UPDATE memories SET active = 0 WHERE memory_id = ?",
                    (supersedes,),
                )

            memory_id = str(uuid4())
            connection.execute(
                """
                INSERT INTO memories (
                    memory_id, memory_type, key, value, scope_type, scope_id,
                    source_run_id, creator, confidence, verification, sensitivity,
                    retention_policy, created_at, last_used_at, expires_at,
                    supersedes_memory_id, active
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 1)
                """,
                (
                    memory_id,
                    MemoryType.SEMANTIC,
                    write.key,
                    write.value,
                    write.scope.scope_type,
                    write.scope.scope_id,
                    write.source_run_id,
                    write.creator,
                    write.confidence,
                    write.verification,
                    MemorySensitivity.USER_PREFERENCE,
                    "until_forgotten",
                    now.isoformat(),
                    supersedes,
                ),
            )
            row = connection.execute(
                "SELECT * FROM memories WHERE memory_id = ?",
                (memory_id,),
            ).fetchone()
            if row is None:  # Defensive invariant; INSERT and SELECT share one transaction.
                raise RuntimeError("Memory insert did not produce a readable record.")
            return _row_to_record(row)

    def recall(self, scopes: Sequence[MemoryScope]) -> list[MemoryRecord]:
        """Recall active records; later, more-specific scopes override earlier ones by key."""

        if not scopes:
            return []
        with self._lock, self._connect() as connection:
            selected: dict[str, sqlite3.Row] = {}
            now = _utc_now()
            for scope in scopes:
                rows = connection.execute(
                    """
                    SELECT * FROM memories
                    WHERE scope_type = ? AND scope_id = ? AND active = 1
                      AND (expires_at IS NULL OR expires_at > ?)
                    ORDER BY created_at ASC
                    """,
                    (scope.scope_type, scope.scope_id, now.isoformat()),
                ).fetchall()
                for row in rows:
                    selected[row["key"]] = row

            memory_ids = [row["memory_id"] for row in selected.values()]
            if memory_ids:
                placeholders = ",".join("?" for _ in memory_ids)
                connection.execute(
                    f"UPDATE memories SET last_used_at = ? WHERE memory_id IN ({placeholders})",
                    (now.isoformat(), *memory_ids),
                )
            return [
                _row_to_record(row).model_copy(update={"last_used_at": now})
                for _, row in sorted(selected.items())
            ]

    def list_records(
        self,
        *,
        scope: MemoryScope | None = None,
        include_inactive: bool = False,
    ) -> list[MemoryRecord]:
        conditions: list[str] = []
        parameters: list[str | int] = []
        if scope is not None:
            conditions.extend(("scope_type = ?", "scope_id = ?"))
            parameters.extend((scope.scope_type, scope.scope_id))
        if not include_inactive:
            conditions.append("active = 1")
        where = f" WHERE {' AND '.join(conditions)}" if conditions else ""
        with self._lock, self._connect() as connection:
            rows = connection.execute(
                f"SELECT * FROM memories{where} ORDER BY created_at DESC",
                parameters,
            ).fetchall()
            return [_row_to_record(row) for row in rows]

    def forget(self, memory_id: str) -> bool:
        """Hard-delete one record so it can no longer be recalled."""

        with self._lock, self._connect() as connection:
            cursor = connection.execute(
                "DELETE FROM memories WHERE memory_id = ?",
                (memory_id,),
            )
            return cursor.rowcount > 0

    def create_session(self, request: SessionCreate) -> AgentSessionRecord:
        """Create one scoped session and evict only summaries beyond the documented cap."""

        with self._lock, self._connect() as connection:
            now = _utc_now()
            session_id = str(uuid4())
            connection.execute(
                """
                INSERT INTO agent_sessions (
                    session_id, user_id, project_id, created_at, updated_at, retention_policy
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    session_id,
                    request.user_id,
                    request.project_id,
                    now.isoformat(),
                    now.isoformat(),
                    (
                        f"latest_{MAX_EPISODES_PER_SESSION}_redacted_episodes;"
                        f"latest_{MAX_SESSIONS_PER_SCOPE}_sessions_per_scope"
                    ),
                ),
            )
            connection.execute(
                """
                DELETE FROM agent_sessions
                WHERE session_id IN (
                    SELECT session_id
                    FROM agent_sessions
                    WHERE user_id = ? AND project_id = ?
                    ORDER BY updated_at DESC, session_id DESC
                    LIMIT -1 OFFSET ?
                )
                """,
                (request.user_id, request.project_id, MAX_SESSIONS_PER_SCOPE),
            )
            row = connection.execute(
                f"{_SESSION_SELECT} WHERE session.session_id = ? GROUP BY session.session_id",
                (session_id,),
            ).fetchone()
            if row is None:
                raise RuntimeError("Session insert did not produce a readable record.")
            return _row_to_session(row)

    def get_session(self, session_id: str) -> AgentSessionRecord | None:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                f"{_SESSION_SELECT} WHERE session.session_id = ? GROUP BY session.session_id",
                (session_id,),
            ).fetchone()
            return _row_to_session(row) if row is not None else None

    def list_sessions(
        self,
        *,
        user_id: str,
        project_id: str,
        limit: int = MAX_SESSIONS_PER_SCOPE,
    ) -> list[AgentSessionRecord]:
        if limit <= 0 or limit > MAX_SESSIONS_PER_SCOPE:
            raise ValueError(f"Session list limit must be between 1 and {MAX_SESSIONS_PER_SCOPE}.")
        with self._lock, self._connect() as connection:
            rows = connection.execute(
                f"""
                {_SESSION_SELECT}
                WHERE session.user_id = ? AND session.project_id = ?
                GROUP BY session.session_id
                ORDER BY session.updated_at DESC, session.session_id DESC
                LIMIT ?
                """,
                (user_id, project_id, limit),
            ).fetchall()
            return [_row_to_session(row) for row in rows]

    def record_episode(self, write: EpisodeWrite) -> EpisodeRecord:
        """Persist one redacted terminal run summary and never its IFC bytes or prose."""

        with self._lock, self._connect() as connection:
            existing = connection.execute(
                "SELECT * FROM agent_episodes WHERE agent_run_id = ?",
                (write.agent_run_id,),
            ).fetchone()
            if existing is not None:
                return _row_to_episode(existing)
            session = connection.execute(
                "SELECT session_id FROM agent_sessions WHERE session_id = ?",
                (write.session_id,),
            ).fetchone()
            if session is None:
                raise LookupError("Cannot record an episode for an unknown session.")

            episode_id = str(uuid4())
            connection.execute(
                """
                INSERT INTO agent_episodes (
                    episode_id, session_id, agent_run_id, linked_review_run_id,
                    source_sha256, objective_sha256, agent_id, provider_id, model_id,
                    connector_ids_json, state, stop_reason, mode, pass_count, fail_count,
                    review_count, reviewed_entities, memory_read_count, delegation_count,
                    created_at, last_recalled_at, recall_count
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0)
                """,
                (
                    episode_id,
                    write.session_id,
                    write.agent_run_id,
                    write.linked_review_run_id,
                    write.source_sha256,
                    write.objective_sha256,
                    write.agent_id,
                    write.provider_id,
                    write.model_id,
                    json.dumps(list(write.connector_ids), separators=(",", ":")),
                    write.state,
                    write.stop_reason,
                    write.mode,
                    write.pass_count,
                    write.fail_count,
                    write.review_count,
                    write.reviewed_entities,
                    write.memory_read_count,
                    write.delegation_count,
                    write.created_at.isoformat(),
                ),
            )
            connection.execute(
                "UPDATE agent_sessions SET updated_at = ? WHERE session_id = ?",
                (_utc_now().isoformat(), write.session_id),
            )
            connection.execute(
                """
                DELETE FROM agent_episodes
                WHERE episode_id IN (
                    SELECT episode_id
                    FROM agent_episodes
                    WHERE session_id = ?
                    ORDER BY created_at DESC, episode_id DESC
                    LIMIT -1 OFFSET ?
                )
                """,
                (write.session_id, MAX_EPISODES_PER_SESSION),
            )
            row = connection.execute(
                "SELECT * FROM agent_episodes WHERE episode_id = ?",
                (episode_id,),
            ).fetchone()
            if row is None:
                raise RuntimeError("Episode insert did not produce a readable record.")
            return _row_to_episode(row)

    def list_episodes(
        self,
        session_id: str,
        *,
        limit: int = MAX_EPISODES_PER_SESSION,
    ) -> list[EpisodeRecord]:
        if limit <= 0 or limit > MAX_EPISODES_PER_SESSION:
            raise ValueError(
                f"Episode list limit must be between 1 and {MAX_EPISODES_PER_SESSION}."
            )
        with self._lock, self._connect() as connection:
            rows = connection.execute(
                """
                SELECT * FROM agent_episodes
                WHERE session_id = ?
                ORDER BY created_at DESC, episode_id DESC
                LIMIT ?
                """,
                (session_id, limit),
            ).fetchall()
            return [_row_to_episode(row) for row in rows]

    def recall_episodes(
        self,
        session_id: str,
        *,
        limit: int = MAX_RECALLED_EPISODES,
    ) -> list[EpisodeRecord]:
        """Recall only the newest bounded redacted summaries and update recall provenance."""

        if limit <= 0 or limit > MAX_RECALLED_EPISODES:
            raise ValueError(f"Episode recall limit must be between 1 and {MAX_RECALLED_EPISODES}.")
        with self._lock, self._connect() as connection:
            rows = connection.execute(
                """
                SELECT * FROM agent_episodes
                WHERE session_id = ?
                ORDER BY created_at DESC, episode_id DESC
                LIMIT ?
                """,
                (session_id, limit),
            ).fetchall()
            if not rows:
                return []
            now = _utc_now()
            episode_ids = [row["episode_id"] for row in rows]
            placeholders = ",".join("?" for _ in episode_ids)
            connection.execute(
                f"""
                UPDATE agent_episodes
                SET last_recalled_at = ?, recall_count = recall_count + 1
                WHERE episode_id IN ({placeholders})
                """,
                (now.isoformat(), *episode_ids),
            )
            return [
                _row_to_episode(row).model_copy(
                    update={
                        "last_recalled_at": now,
                        "recall_count": row["recall_count"] + 1,
                    }
                )
                for row in rows
            ]

    def forget_session(self, session_id: str) -> bool:
        """Hard-delete one session and its redacted episodes through a foreign-key cascade."""

        with self._lock, self._connect() as connection:
            cursor = connection.execute(
                "DELETE FROM agent_sessions WHERE session_id = ?",
                (session_id,),
            )
            return cursor.rowcount > 0
