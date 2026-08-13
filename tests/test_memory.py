from __future__ import annotations

import pytest
from pydantic import ValidationError

from bim_review_agent.infrastructure.memory import (
    MemoryKey,
    MemoryScope,
    MemoryScopeType,
    MemoryWrite,
    SQLiteMemoryStore,
)


def _write(
    key: MemoryKey,
    value: str,
    *,
    scope_type: MemoryScopeType = MemoryScopeType.USER,
    scope_id: str = "local-user",
) -> MemoryWrite:
    return MemoryWrite(
        key=key,
        value=value,
        scope=MemoryScope(scope_type=scope_type, scope_id=scope_id),
    )


def test_memory_persists_across_store_instances(tmp_path) -> None:
    path = tmp_path / "memory.sqlite3"
    first_store = SQLiteMemoryStore(path)
    created = first_store.remember(_write(MemoryKey.EXPLANATION_LANGUAGE, "zh-CN"))

    second_store = SQLiteMemoryStore(path)
    recalled = second_store.recall(
        [MemoryScope(scope_type=MemoryScopeType.USER, scope_id="local-user")]
    )

    assert [record.memory_id for record in recalled] == [created.memory_id]
    assert recalled[0].value == "zh-CN"
    assert recalled[0].last_used_at is not None
    assert path.stat().st_mode & 0o777 == 0o600


def test_traditional_chinese_is_an_allowlisted_explanation_language() -> None:
    write = _write(MemoryKey.EXPLANATION_LANGUAGE, "zh-Hant")

    assert write.value == "zh-Hant"


def test_correction_supersedes_the_old_value_without_reactivating_it(tmp_path) -> None:
    store = SQLiteMemoryStore(tmp_path / "memory.sqlite3")
    original = store.remember(_write(MemoryKey.DEFAULT_REVIEW_MODE, "inventory_only"))
    corrected = store.remember(_write(MemoryKey.DEFAULT_REVIEW_MODE, "full_review"))

    active = store.list_records()
    history = store.list_records(include_inactive=True)

    assert corrected.supersedes_memory_id == original.memory_id
    assert [(record.value, record.active) for record in active] == [("full_review", True)]
    assert {(record.value, record.active) for record in history} == {
        ("inventory_only", False),
        ("full_review", True),
    }


def test_project_scope_overrides_user_scope_for_the_same_key(tmp_path) -> None:
    store = SQLiteMemoryStore(tmp_path / "memory.sqlite3")
    store.remember(_write(MemoryKey.DEFAULT_REVIEW_MODE, "full_review"))
    project_record = store.remember(
        _write(
            MemoryKey.DEFAULT_REVIEW_MODE,
            "inventory_only",
            scope_type=MemoryScopeType.PROJECT,
            scope_id="project-a",
        )
    )

    recalled = store.recall(
        [
            MemoryScope(scope_type=MemoryScopeType.USER, scope_id="local-user"),
            MemoryScope(scope_type=MemoryScopeType.PROJECT, scope_id="project-a"),
        ]
    )

    assert [(record.memory_id, record.value) for record in recalled] == [
        (project_record.memory_id, "inventory_only")
    ]


def test_forget_hard_deletes_memory_and_does_not_revive_superseded_value(tmp_path) -> None:
    store = SQLiteMemoryStore(tmp_path / "memory.sqlite3")
    old = store.remember(_write(MemoryKey.EXPLANATION_LANGUAGE, "en"))
    current = store.remember(_write(MemoryKey.EXPLANATION_LANGUAGE, "zh-CN"))

    assert store.forget(current.memory_id) is True
    assert store.forget(current.memory_id) is False
    assert store.recall([MemoryScope(scope_type=MemoryScopeType.USER, scope_id="local-user")]) == []
    assert store.list_records(include_inactive=True)[0].memory_id == old.memory_id
    assert store.list_records(include_inactive=True)[0].active is False


@pytest.mark.parametrize(
    ("key", "value"),
    [
        (MemoryKey.EXPLANATION_LANGUAGE, "api-key-value"),
        (MemoryKey.DEFAULT_REVIEW_MODE, "delete_everything"),
    ],
)
def test_memory_values_are_allowlisted_instead_of_accepting_arbitrary_text(
    key: MemoryKey,
    value: str,
) -> None:
    with pytest.raises(ValidationError):
        _write(key, value)
