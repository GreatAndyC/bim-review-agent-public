from __future__ import annotations

import ifcopenshell
import pytest
from ifcopenshell.api import pset, root

from bim_review_agent.application.review_service import review_ifc_bytes
from bim_review_agent.domain.models import FindingStatus, Reliability
from bim_review_agent.domain.samples import list_samples, load_sample

EXPECTED_COUNTS = {
    "mixed_review": (8, 1, 4),
    "narrow_exit": (3, 1, 0),
    "proxy_width": (3, 0, 1),
    "missing_information": (2, 0, 2),
    "clean": (6, 0, 0),
}


def review_sample(sample_id: str):
    sample, content = load_sample(sample_id)
    return review_ifc_bytes(sample.filename, content)


@pytest.mark.parametrize(("sample_id", "expected"), EXPECTED_COUNTS.items())
def test_sample_outcome_counts_match_catalogue(
    sample_id: str, expected: tuple[int, int, int]
) -> None:
    run = review_sample(sample_id)
    assert (run.summary.pass_count, run.summary.fail_count, run.summary.review_count) == expected


def test_catalogue_expectations_match_executable_results() -> None:
    for sample in list_samples():
        run = review_sample(sample.id)
        actual = []
        if run.summary.pass_count:
            actual.append(f"{run.summary.pass_count} PASS")
        if run.summary.fail_count:
            actual.append(f"{run.summary.fail_count} FAIL")
        if run.summary.review_count:
            actual.append(f"{run.summary.review_count} REVIEW")
        assert " · ".join(actual) == sample.expected


def test_clean_sample_has_no_actionable_findings() -> None:
    run = review_sample("clean")
    assert all(finding.status is FindingStatus.PASS for finding in run.findings)


def test_fail_and_review_findings_always_include_dual_evidence() -> None:
    run = review_sample("mixed_review")
    actionable = [finding for finding in run.findings if finding.status is not FindingStatus.PASS]
    assert actionable
    for finding in actionable:
        assert finding.model_evidence.observations
        assert finding.rule_evidence.rule_id == finding.rule_id
        assert finding.rule_evidence.version
        assert finding.rule_evidence.limitation
        assert finding.recommendation
        assert finding.explanation is not None
        assert finding.status.value in {"FAIL", "REVIEW"}


def test_nominal_overall_width_is_review_not_clear_width_pass() -> None:
    run = review_sample("proxy_width")
    finding = next(item for item in run.findings if item.rule_id == "EGRESS-001")
    assert finding.status is FindingStatus.REVIEW
    assert "proxy" in finding.message.lower()
    assert any(
        observation.reliability is Reliability.PROXY
        and observation.source_path == "IfcDoor.OverallWidth"
        for observation in finding.model_evidence.observations
    )


def test_narrow_exit_retains_raw_and_normalized_measurement() -> None:
    run = review_sample("narrow_exit")
    finding = next(item for item in run.findings if item.rule_id == "EGRESS-001")
    width = next(
        observation
        for observation in finding.model_evidence.observations
        if observation.label == "Reported clear width"
    )
    assert finding.status is FindingStatus.FAIL
    assert width.raw_value == pytest.approx(820)
    assert width.normalized_value == pytest.approx(820)
    assert width.unit == "mm"
    assert finding.rule_evidence.parameters["minimum"] == 900


def test_missing_information_is_review_not_failure() -> None:
    run = review_sample("missing_information")
    missing = [item for item in run.findings if item.rule_id == "INFO-001"]
    assert len(missing) == 3
    assert sum(item.status is FindingStatus.REVIEW for item in missing) == 2
    assert any(
        item.status is FindingStatus.PASS
        and item.model_evidence.observations[0].source_path == "Pset_DoorCommon.FireExit"
        for item in missing
    )


def test_information_rule_checks_every_door_and_explicitly_classifies_exit_status() -> None:
    run = review_sample("clean")
    info_findings = [item for item in run.findings if item.rule_id == "INFO-001"]

    assert len(info_findings) == 5
    assert {item.entity.name for item in info_findings} == {
        "Lobby Exit D-01",
        "Meeting Room Door D-02",
    }
    exit_findings = [
        item
        for item in info_findings
        if item.model_evidence.observations[0].source_path == "Pset_DoorCommon.FireExit"
    ]
    assert len(exit_findings) == 2
    assert all(item.status is FindingStatus.PASS for item in exit_findings)


def test_ambiguous_exit_name_does_not_force_width_verdict() -> None:
    run = review_sample("mixed_review")
    finding = next(
        item
        for item in run.findings
        if item.rule_id == "EGRESS-001" and item.entity.name == "Emergency Exit Candidate D-12"
    )
    assert finding.status is FindingStatus.REVIEW
    assert "cannot be confirmed" in finding.message
    assert finding.model_evidence.applicability_signal is not None
    assert finding.model_evidence.applicability_signal.reliability is Reliability.DERIVED


def test_repeated_reviews_have_equivalent_deterministic_payloads() -> None:
    sample, content = load_sample("mixed_review")
    first = review_ifc_bytes(sample.filename, content)
    second = review_ifc_bytes(sample.filename, content)
    assert first.run_id != second.run_id
    assert first.deterministic_payload() == second.deterministic_payload()


def test_missing_project_length_unit_routes_width_to_review() -> None:
    model = ifcopenshell.file(schema="IFC4")
    root.create_entity(model, ifc_class="IfcProject", name="Unitless project")
    door = root.create_entity(model, ifc_class="IfcDoor", name="Unitless Exit")
    common = pset.add_pset(model, product=door, name="Pset_DoorCommon")
    pset.edit_pset(
        model,
        pset=common,
        properties={"FireExit": True, "FireRating": "60min"},
    )
    review = pset.add_pset(model, product=door, name="Pset_BIMReview")
    pset.edit_pset(
        model,
        pset=review,
        properties={"ClearWidth": model.createIfcLengthMeasure(950)},
    )

    run = review_ifc_bytes("unitless.ifc", model.to_string().encode())
    finding = next(item for item in run.findings if item.rule_id == "EGRESS-001")
    assert run.inventory.length_unit == "unknown"
    assert run.inventory.length_unit_known is False
    assert finding.status is FindingStatus.REVIEW
    assert "length unit" in finding.message
