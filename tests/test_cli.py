from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

from bim_review_agent.domain.samples import load_sample
from bim_review_agent.interfaces import cli


def sample_path(tmp_path: Path, sample_id: str = "mixed_review") -> Path:
    sample, content = load_sample(sample_id)
    path = tmp_path / sample.filename
    path.write_bytes(content)
    return path


def test_cli_review_prints_canonical_json(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    path = sample_path(tmp_path)
    monkeypatch.setattr(sys, "argv", ["bim-review-agent", "review", str(path)])

    cli.main()

    payload = json.loads(capsys.readouterr().out)
    assert payload["source"]["filename"] == "mixed_review.ifc"
    assert payload["summary"]["fail_count"] == 1


def test_cli_review_writes_requested_output(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = sample_path(tmp_path, "clean")
    output = tmp_path / "run.json"
    monkeypatch.setattr(
        sys,
        "argv",
        ["bim-review-agent", "review", str(path), "--output", str(output)],
    )

    cli.main()

    payload = json.loads(output.read_text(encoding="utf-8"))
    assert payload["summary"]["pass_count"] == 6
    assert payload["summary"]["fail_count"] == 0


def test_cli_without_command_prints_help(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(sys, "argv", ["bim-review-agent"])

    cli.main()

    output = capsys.readouterr().out
    assert "review" in output
    assert "validate-schema" in output


def test_cli_validate_schema_prints_json(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    path = sample_path(tmp_path, "clean")
    monkeypatch.setattr(sys, "argv", ["bim-review-agent", "validate-schema", str(path)])

    cli.main()

    payload = json.loads(capsys.readouterr().out)
    assert payload["physical_schema"] == "IFC4"
    assert payload["passed"] is True
