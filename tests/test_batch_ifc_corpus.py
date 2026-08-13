from __future__ import annotations

from bim_review_agent.application.review_service import review_ifc_bytes
from bim_review_agent.domain.ifc import validate_ifc_bytes
from bim_review_agent.domain.samples import list_samples, load_sample


def _batch_inputs() -> list[tuple[str, bytes]]:
    return [(sample.filename, load_sample(sample.id)[1]) for sample in list_samples()]


BATCH_INPUTS = _batch_inputs()


def test_batch_corpus_runs_every_public_ifc_input_deterministically() -> None:
    """The public batch contract is reproducible across all bundled samples."""

    for filename, content in BATCH_INPUTS:
        validation = validate_ifc_bytes(content)
        assert validation.passed is True
        first = review_ifc_bytes(filename, content)
        second = review_ifc_bytes(filename, content)

        assert first.deterministic_payload() == second.deterministic_payload()
        assert first.source.filename == filename
        assert first.summary.total_findings == (
            first.summary.pass_count + first.summary.fail_count + first.summary.review_count
        )


def test_batch_corpus_includes_a_synthetic_model_with_multiple_doors() -> None:
    sample, content = load_sample("mixed_review")
    run = review_ifc_bytes(sample.filename, content, profile_id="cn-fire-55037-2022")

    assert run.inventory.entity_counts.get("IfcDoor", 0) == 4
    assert run.inventory.total_entities > run.inventory.entity_counts["IfcDoor"]
    assert run.summary.total_findings > 0


def test_batch_corpus_scales_to_repeated_model_runs_without_cross_contamination() -> None:
    """Repeated independent reviews must not accumulate state between files."""

    baseline = {
        filename: review_ifc_bytes(filename, content).deterministic_payload()
        for filename, content in BATCH_INPUTS
    }

    for _ in range(10):
        for filename, content in BATCH_INPUTS:
            repeated = review_ifc_bytes(filename, content)
            assert repeated.deterministic_payload() == baseline[filename]
            assert repeated.summary.total_findings >= 0
