"""Hong Kong fire-safety source profile used by the first regulatory slice."""

from __future__ import annotations

from importlib import resources

from pydantic import BaseModel, ConfigDict, Field


class HongKongWidthRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    min_occupants: int = Field(ge=1)
    max_occupants: int | None = Field(default=None, ge=1)
    min_exit_doors: int | None = Field(default=None, ge=1)
    min_total_exit_door_width_mm: int | None = Field(default=None, ge=1)
    min_total_exit_route_width_mm: int | None = Field(default=None, ge=1)
    min_each_exit_door_mm: int | None = Field(default=None, ge=1)
    min_each_exit_route_mm: int | None = Field(default=None, ge=1)


class HongKongRule(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    version: str
    title: str
    part: str
    clause_or_table: str
    missing_evidence_outcome: str
    input_paths: dict[str, list[str]]
    rows: list[HongKongWidthRow]


class HongKongInformationRequirement(BaseModel):
    """Evidence fields needed before the Table B2 pre-check can be trusted."""

    model_config = ConfigDict(extra="forbid")

    key: str
    label: str
    field: str
    applicability: str
    source_path: str
    missing_status: str = "REVIEW"


class HongKongSource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    edition: str
    publisher: str
    url: str
    landing_page: str
    retrieved_on: str
    table: str
    notes: str


class HongKongRulePack(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    version: str
    title: str
    jurisdiction: str
    authority: str
    source: HongKongSource
    information_requirements: list[HongKongInformationRequirement] = Field(default_factory=list)
    rules: list[HongKongRule]

    @property
    def door_width_rule(self) -> HongKongRule:
        return next(rule for rule in self.rules if rule.id == "HK-FS-B2-DOOR-WIDTH")

    def width_row(self, occupant_capacity: int) -> HongKongWidthRow | None:
        for row in self.door_width_rule.rows:
            if occupant_capacity < row.min_occupants:
                continue
            if row.max_occupants is None or occupant_capacity <= row.max_occupants:
                return row
        return None


def load_hong_kong_profile() -> HongKongRulePack:
    path = resources.files("bim_review_agent").joinpath(
        "assets/rules/hk_fire_safety_2011_2024.json"
    )
    return HongKongRulePack.model_validate_json(path.read_text(encoding="utf-8"))
