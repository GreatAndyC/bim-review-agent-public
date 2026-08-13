"""Runtime configuration with conservative local-demo defaults."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _positive_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return value if value > 0 else default


def _enabled(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().casefold() in {"1", "true", "yes", "on"}


def _memory_db_path() -> Path:
    configured = os.getenv("BIM_REVIEW_MEMORY_DB")
    if configured:
        return Path(configured).expanduser()
    return Path.home() / ".bim-review-agent" / "memory.sqlite3"


@dataclass(frozen=True, slots=True)
class Settings:
    max_upload_bytes: int = _positive_int("BIM_REVIEW_MAX_UPLOAD_MB", 50) * 1024 * 1024
    run_limit: int = _positive_int("BIM_REVIEW_RUN_LIMIT", 20)
    memory_db_path: Path = field(default_factory=_memory_db_path)
    external_provider_enabled: bool = field(
        default_factory=lambda: _enabled("BIM_REVIEW_EXTERNAL_PROVIDER_ENABLED")
    )
    external_provider_base_url: str = field(
        default_factory=lambda: os.getenv(
            "BIM_REVIEW_EXTERNAL_PROVIDER_BASE_URL",
            "https://api.openai.com/v1",
        )
    )
    external_provider_model: str = field(
        default_factory=lambda: os.getenv("BIM_REVIEW_EXTERNAL_PROVIDER_MODEL", "")
    )
    external_provider_timeout_seconds: int = field(
        default_factory=lambda: _positive_int("BIM_REVIEW_EXTERNAL_PROVIDER_TIMEOUT_SECONDS", 30)
    )
    openrouter_enabled: bool = field(
        default_factory=lambda: _enabled("BIM_REVIEW_OPENROUTER_ENABLED")
    )
    openrouter_base_url: str = field(
        default_factory=lambda: os.getenv(
            "BIM_REVIEW_OPENROUTER_BASE_URL",
            "https://openrouter.ai/api/v1",
        )
    )
    openrouter_timeout_seconds: int = field(
        default_factory=lambda: _positive_int("BIM_REVIEW_OPENROUTER_TIMEOUT_SECONDS", 30)
    )
    openrouter_catalogue_timeout_seconds: int = field(
        default_factory=lambda: _positive_int(
            "BIM_REVIEW_OPENROUTER_CATALOGUE_TIMEOUT_SECONDS",
            10,
        )
    )

    @property
    def max_upload_mb(self) -> int:
        return self.max_upload_bytes // (1024 * 1024)


settings = Settings()
