"""Bundled, synthetic IFC sample catalogue."""

from __future__ import annotations

import json
from importlib import resources

from pydantic import BaseModel, ConfigDict

from bim_review_agent.domain.errors import ReviewInputError


class SampleInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    filename: str
    title: str
    description: str
    expected: str


def list_samples() -> list[SampleInfo]:
    path = resources.files("bim_review_agent").joinpath("assets/samples/catalog.json")
    raw = json.loads(path.read_text(encoding="utf-8"))
    return [SampleInfo.model_validate(item) for item in raw]


def load_sample(sample_id: str) -> tuple[SampleInfo, bytes]:
    match = next((item for item in list_samples() if item.id == sample_id), None)
    if match is None:
        raise ReviewInputError(
            code="sample_not_found",
            message="The requested bundled sample does not exist.",
            recovery="Refresh the workspace and choose a sample from the current catalogue.",
            status_code=404,
        )
    path = resources.files("bim_review_agent").joinpath(f"assets/samples/{match.filename}")
    return match, path.read_bytes()
