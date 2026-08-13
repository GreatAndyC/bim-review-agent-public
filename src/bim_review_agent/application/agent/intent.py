"""Shared, bounded objective and preference interpretation for offline providers."""

from __future__ import annotations

from bim_review_agent.application.agent.schemas import ProviderRequest
from bim_review_agent.infrastructure.memory import MemoryKey

_INVENTORY_ONLY_MARKERS = (
    "inventory only",
    "inspect only",
    "model overview",
    "schema only",
    "只盘点",
    "只查看模型",
    "模型概览",
)


def objective_requests_inventory(objective: str) -> bool:
    normalized = objective.casefold()
    return any(marker in normalized for marker in _INVENTORY_ONLY_MARKERS)


def memory_value(request: ProviderRequest, key: MemoryKey) -> str | None:
    memory = next((item for item in request.memories if item.key == key), None)
    return memory.value if memory is not None else None


def use_chinese(request: ProviderRequest) -> bool:
    return memory_value(request, MemoryKey.EXPLANATION_LANGUAGE) in {"zh-CN", "zh-Hant"}


def localized_text(
    request: ProviderRequest,
    *,
    en: str,
    zh_cn: str,
    zh_hant: str,
) -> str:
    """Select bounded scripted prose without changing any deterministic facts."""

    language = memory_value(request, MemoryKey.EXPLANATION_LANGUAGE)
    if language == "zh-Hant":
        return zh_hant
    if language == "zh-CN":
        return zh_cn
    return en


def requests_inventory_by_default(
    request: ProviderRequest,
    *,
    default_objective: str,
) -> bool:
    return (
        request.objective == default_objective
        and memory_value(request, MemoryKey.DEFAULT_REVIEW_MODE) == "inventory_only"
    )
