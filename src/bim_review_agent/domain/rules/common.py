"""Shared deterministic rule helpers."""

from __future__ import annotations

import hashlib
import math
from typing import Any

from bim_review_agent.domain.ifc import Fact
from bim_review_agent.domain.models import Observation, RuleEvidence
from bim_review_agent.domain.rules.rule_pack import RulePackConfig


def finding_id(rule_id: str, global_id: str, check_key: str) -> str:
    payload = f"{rule_id}|{global_id}|{check_key}".encode()
    digest = hashlib.sha256(payload).hexdigest()[:12]
    return f"{rule_id.lower()}-{digest}"


def normalize_length_mm(value: Any, length_to_metre_scale: float) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(numeric) or numeric <= 0:
        return None
    return round(numeric * length_to_metre_scale * 1000.0, 3)


def observation_from_fact(
    *,
    label: str,
    fact: Fact,
    normalized_value: float | str | bool | None = None,
    unit: str | None = None,
) -> Observation:
    return Observation(
        label=label,
        raw_value=fact.value,
        normalized_value=normalized_value,
        unit=unit,
        source_path=fact.source_path,
        reliability=fact.reliability,
        note=fact.note,
    )


def rule_evidence(
    *,
    pack: RulePackConfig,
    rule_id: str,
    title: str,
    version: str,
    parameters: dict[str, Any],
) -> RuleEvidence:
    authority = pack.authority
    evidence_parameters = dict(parameters)
    for key in (
        "source_url",
        "source_landing_page",
        "source_edition",
        "source_retrieved_on",
    ):
        value = getattr(authority, key)
        if value is not None:
            evidence_parameters[key] = value
    return RuleEvidence(
        rule_id=rule_id,
        title=title,
        version=version,
        authority=authority.type,
        source_title=authority.source_title,
        jurisdiction=authority.jurisdiction,
        clause=authority.clause,
        parameters=evidence_parameters,
        limitation=authority.limitation,
    )


def explicit_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and value in {0, 1}:
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().casefold()
        if normalized in {"true", "yes", "y", "1"}:
            return True
        if normalized in {"false", "no", "n", "0"}:
            return False
    return None
