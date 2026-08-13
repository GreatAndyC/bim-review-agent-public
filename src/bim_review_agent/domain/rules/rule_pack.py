"""Typed, versioned rule-pack loading."""

from __future__ import annotations

from importlib import resources
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field

from bim_review_agent.domain.models import AuthorityType


class RuleConfigModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AuthorityConfig(RuleConfigModel):
    type: AuthorityType
    source_title: str
    jurisdiction: str
    clause: str | None = None
    limitation: str
    source_url: str | None = None
    source_landing_page: str | None = None
    source_edition: str | None = None
    source_retrieved_on: str | None = None


class InfoRequirementConfig(RuleConfigModel):
    key: str
    label: str
    field: Literal["name", "fire_rating", "fire_exit", "clear_width", "occupant_capacity"]
    applicability: Literal["all_doors", "confirmed_exit_doors"]
    source_path: str
    missing_status: Literal["REVIEW"] = "REVIEW"


class InfoRuleConfig(RuleConfigModel):
    id: Literal["INFO-001"]
    title: str
    category: str
    version: str
    enabled: bool = True
    requirements: list[InfoRequirementConfig]


class ThresholdConfig(RuleConfigModel):
    value: float = Field(gt=0)
    unit: Literal["mm"] = "mm"
    operator: Literal[">="] = ">="


class EgressRuleConfig(RuleConfigModel):
    id: Literal["EGRESS-001"]
    title: str
    category: str
    version: str
    enabled: bool = True
    threshold: ThresholdConfig
    contradiction_tolerance_mm: float = Field(default=5.0, ge=0)
    proxy_policy: Literal["review"] = "review"


class RulePackConfig(RuleConfigModel):
    id: str
    version: str
    title: str
    authority: AuthorityConfig
    info: InfoRuleConfig
    egress: EgressRuleConfig


def _load_demo_rule_pack() -> RulePackConfig:
    rule_path = resources.files("bim_review_agent").joinpath("assets/rules/demo_hku.yaml")
    raw = yaml.safe_load(rule_path.read_text(encoding="utf-8"))
    return RulePackConfig.model_validate(raw)


def _load_mainland_fire_rule_pack() -> RulePackConfig:
    rule_path = resources.files("bim_review_agent").joinpath("assets/rules/cn_fire_55037_2022.yaml")
    raw = yaml.safe_load(rule_path.read_text(encoding="utf-8"))
    return RulePackConfig.model_validate(raw)


def load_rule_pack(profile_id: str = "demo_hku") -> RulePackConfig:
    """Load the deterministic information contract for an executable profile.

    The Hong Kong width rule has a richer source-profile model because Table B2
    is a lookup table.  The common RulePack still owns INFO-001 so its findings
    carry the same official source authority as the width findings.
    """

    demo_pack = _load_demo_rule_pack()
    if profile_id == "demo_hku":
        return demo_pack
    if profile_id == "cn-fire-55037-2022":
        return _load_mainland_fire_rule_pack()
    if profile_id != "hk-fire-safety-2011-2024":
        raise ValueError(f"Unsupported review profile: {profile_id}")

    from bim_review_agent.domain.regulations.hong_kong import load_hong_kong_profile

    profile = load_hong_kong_profile()
    source = profile.source
    return demo_pack.model_copy(
        update={
            "id": profile.id,
            "version": profile.version,
            "title": profile.title,
            "authority": AuthorityConfig(
                type=AuthorityType.AUTHORITATIVE_STANDARD,
                source_title=f"{source.title} ({source.edition} Edition)",
                jurisdiction="Hong Kong",
                clause="Clause B7.1; Table B2; Note 2",
                limitation=source.notes,
                source_url=source.url,
                source_landing_page=source.landing_page,
                source_edition=source.edition,
                source_retrieved_on=source.retrieved_on,
            ),
            "info": InfoRuleConfig(
                id="INFO-001",
                title="Required evidence for exit-door pre-check",
                category="Hong Kong fire safety / information quality",
                version=profile.version,
                enabled=True,
                requirements=[
                    InfoRequirementConfig.model_validate(item.model_dump())
                    for item in profile.information_requirements
                ],
            ),
        }
    )
