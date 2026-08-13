from __future__ import annotations

import pytest

from bim_review_agent.application.review_service import validate_upload
from bim_review_agent.domain.errors import ReviewInputError
from bim_review_agent.domain.samples import load_sample
from bim_review_agent.infrastructure.config import settings


def test_uploaded_path_is_reduced_to_basename() -> None:
    _, content = load_sample("clean")
    assert validate_upload("../../private/clean.ifc", content) == "clean.ifc"


def test_upload_limit_is_checked_before_ifc_parse() -> None:
    oversized = b"x" * (settings.max_upload_bytes + 1)
    with pytest.raises(ReviewInputError) as captured:
        validate_upload("large.ifc", oversized)
    assert captured.value.code == "file_too_large"
    assert captured.value.status_code == 413
