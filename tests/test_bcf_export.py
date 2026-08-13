from __future__ import annotations

import io
from collections import Counter
from uuid import UUID
from xml.etree import ElementTree as ET
from zipfile import ZipFile

import pytest

from bim_review_agent.application.review_service import review_ifc_bytes
from bim_review_agent.domain.exports import BCF_VERSION, NoActionableFindingsError, build_bcfzip
from bim_review_agent.domain.samples import load_sample


def review_sample(sample_id: str):
    sample, content = load_sample(sample_id)
    return review_ifc_bytes(sample.filename, content)


def test_bcfzip_contains_deterministic_actionable_topics_with_full_evidence() -> None:
    run = review_sample("mixed_review")
    first = build_bcfzip(run)
    second = build_bcfzip(run)

    assert first == second
    with ZipFile(io.BytesIO(first)) as archive:
        assert archive.testzip() is None
        names = archive.namelist()
        assert names[0] == "bcf.version"
        topic_paths = [name for name in names if name.endswith("/markup.bcf")]
        assert len(topic_paths) == run.summary.fail_count + run.summary.review_count == 5

        version = ET.fromstring(archive.read("bcf.version"))
        assert version.tag == "Version"
        assert version.attrib["VersionId"] == BCF_VERSION
        assert version.findtext("DetailedVersion") == BCF_VERSION

        statuses = []
        descriptions = []
        for expected_index, path in enumerate(topic_paths, start=1):
            folder_guid = path.split("/", maxsplit=1)[0]
            UUID(folder_guid)
            markup = ET.fromstring(archive.read(path))
            assert markup.tag == "Markup"
            assert markup.findtext("Header/File/Filename") == run.source.filename
            assert markup.find("Header/File/Date") is None

            topic = markup.find("Topic")
            assert topic is not None
            assert topic.attrib == {
                "Guid": folder_guid,
                "TopicType": "Issue",
                "TopicStatus": "Open",
            }
            assert topic.findtext("Title")
            assert topic.findtext("Index") == str(expected_index)
            assert topic.findtext("CreationDate").endswith("Z")
            assert topic.findtext("CreationAuthor") == "bim-review-agent@local"
            labels = [item.text for item in topic.findall("Labels")]
            statuses.append(next(item for item in labels if item in {"FAIL", "REVIEW"}))
            description = topic.findtext("Description") or ""
            descriptions.append(description)
            assert "IFC GlobalId:" in description
            assert "Model evidence" in description
            assert "Rule evidence" in description
            assert "Recommended next step" in description
            assert "Decision boundary" in description
            assert "Text-only BCF topic" in description
            assert run.run_id in description

    assert Counter(statuses) == {"FAIL": 1, "REVIEW": 4}
    assert all("Lobby Exit D-10" not in description for description in descriptions)


def test_bcf_xml_escapes_untrusted_source_filename_and_keeps_safe_archive_paths() -> None:
    run = review_sample("narrow_exit").model_copy(deep=True)
    run.source.filename = 'unsafe <model> & "review".ifc'

    with ZipFile(io.BytesIO(build_bcfzip(run))) as archive:
        for path in archive.namelist():
            assert not path.startswith(("/", "../"))
            assert "/../" not in path
        markup_path = next(name for name in archive.namelist() if name.endswith("/markup.bcf"))
        markup = ET.fromstring(archive.read(markup_path))

    assert markup.findtext("Header/File/Filename") == run.source.filename


def test_bcf_export_rejects_all_pass_run() -> None:
    with pytest.raises(NoActionableFindingsError, match="no FAIL or REVIEW"):
        build_bcfzip(review_sample("clean"))
