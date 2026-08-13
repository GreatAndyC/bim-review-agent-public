"""Deterministic, text-only BCF 2.1 issue-package export."""

from __future__ import annotations

import io
import json
from datetime import UTC, datetime
from typing import Any
from uuid import NAMESPACE_URL, uuid5
from xml.etree import ElementTree as ET
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from bim_review_agent.domain.models import Finding, FindingStatus, Observation, ReviewRun

BCF_VERSION = "2.1"
BCF_AUTHOR = "bim-review-agent@local"
ACTIONABLE_STATUSES = {FindingStatus.FAIL, FindingStatus.REVIEW}


class NoActionableFindingsError(ValueError):
    """Raised when a run has no FAIL or REVIEW finding to export as an issue."""


def _bcf_datetime(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _display_value(value: Any) -> str:
    if value is None or value == "":
        return "Not available"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (dict, list, tuple)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    return str(value)


def _observation_line(item: Observation) -> str:
    value = item.normalized_value if item.normalized_value is not None else item.raw_value
    display = _display_value(value)
    if item.normalized_value is not None and item.unit:
        display = f"{display} {item.unit}"
    line = (
        f"- {item.label}: {display} [{item.reliability.value}] "
        f"(source: {item.source_path}; raw: {_display_value(item.raw_value)})"
    )
    return f"{line}\n  Note: {item.note}" if item.note else line


def _description(run: ReviewRun, finding: Finding) -> str:
    observations = []
    if finding.model_evidence.applicability_signal is not None:
        observations.append(finding.model_evidence.applicability_signal)
    observations.extend(finding.model_evidence.observations)
    observation_text = "\n".join(_observation_line(item) for item in observations)
    parameters = "\n".join(
        f"- {key}: {_display_value(value)}"
        for key, value in finding.rule_evidence.parameters.items()
    )
    element_name = finding.entity.name or "Unnamed element"
    storey = f"\nStorey: {finding.entity.storey}" if finding.entity.storey else ""
    boundary = (
        finding.explanation.boundary
        if finding.explanation is not None
        else "Deterministic result; professional review remains required."
    )
    return (
        f"BIM Review Agent finding: {finding.finding_id}\n"
        f"Outcome: {finding.status.value}\n"
        f"Severity: {finding.severity.value}\n"
        f"Rule: {finding.rule_id} @ {finding.rule_evidence.version}\n\n"
        f"Element: {element_name}\n"
        f"IFC class: {finding.entity.ifc_class}\n"
        f"IFC GlobalId: {finding.entity.global_id}{storey}\n\n"
        f"Decision\n{finding.message}\n\n"
        f"Applicability\n{finding.applicability}\n\n"
        f"Model evidence\n{observation_text}\n\n"
        f"Rule evidence\n"
        f"Authority: {finding.rule_evidence.authority.value}\n"
        f"Source: {finding.rule_evidence.source_title}\n"
        f"Jurisdiction: {finding.rule_evidence.jurisdiction}\n"
        f"Clause: {finding.rule_evidence.clause or 'Not assigned — demo rule'}\n"
        f"Parameters:\n{parameters}\n"
        f"Limitation: {finding.rule_evidence.limitation}\n\n"
        f"Recommended next step\n{finding.recommendation}\n\n"
        f"Decision boundary\n{boundary}\n\n"
        "Export boundary\nText-only BCF topic; no viewpoint or snapshot was generated because "
        "the review run contains no trusted camera or geometry context.\n\n"
        f"Source run: {run.run_id}\n"
        f"Source file: {run.source.filename}\n"
        f"Source SHA-256: {run.source.sha256}\n"
        f"Rule pack: {run.rule_pack_id} @ {run.rule_pack_version}"
    )


def _version_xml() -> bytes:
    root = ET.Element("Version", {"VersionId": BCF_VERSION})
    ET.SubElement(root, "DetailedVersion").text = BCF_VERSION
    return _xml_bytes(root)


def _markup_xml(run: ReviewRun, finding: Finding, topic_guid: str, index: int) -> bytes:
    root = ET.Element("Markup")
    header = ET.SubElement(root, "Header")
    source_file = ET.SubElement(header, "File", {"isExternal": "true"})
    ET.SubElement(source_file, "Filename").text = run.source.filename

    topic = ET.SubElement(
        root,
        "Topic",
        {"Guid": topic_guid, "TopicType": "Issue", "TopicStatus": "Open"},
    )
    element_name = finding.entity.name or "Unnamed element"
    ET.SubElement(topic, "Title").text = (
        f"[{finding.status.value}] {finding.rule_id} · {element_name}"
    )[:128]
    ET.SubElement(topic, "Priority").text = (
        "High" if finding.status is FindingStatus.FAIL else "Normal"
    )
    ET.SubElement(topic, "Index").text = str(index)
    for label in (finding.status.value, finding.rule_id, finding.entity.ifc_class):
        ET.SubElement(topic, "Labels").text = label
    ET.SubElement(topic, "CreationDate").text = _bcf_datetime(run.completed_at)
    ET.SubElement(topic, "CreationAuthor").text = BCF_AUTHOR
    ET.SubElement(topic, "Description").text = _description(run, finding)
    return _xml_bytes(root)


def _xml_bytes(root: ET.Element) -> bytes:
    tree = ET.ElementTree(root)
    ET.indent(tree, space="  ")
    buffer = io.BytesIO()
    tree.write(buffer, encoding="utf-8", xml_declaration=True, short_empty_elements=True)
    return buffer.getvalue()


def _zip_info(path: str, completed_at: datetime) -> ZipInfo:
    timestamp = completed_at.astimezone(UTC)
    safe_year = max(timestamp.year, 1980)
    info = ZipInfo(
        path,
        date_time=(
            safe_year,
            timestamp.month,
            timestamp.day,
            timestamp.hour,
            timestamp.minute,
            timestamp.second,
        ),
    )
    info.compress_type = ZIP_DEFLATED
    info.create_system = 3
    info.external_attr = 0o644 << 16
    return info


def build_bcfzip(run: ReviewRun) -> bytes:
    """Build a deterministic BCF 2.1 package for FAIL and REVIEW findings.

    The current evidence contract has no trustworthy camera or geometry context, so the
    package intentionally contains textual topics without fabricated viewpoints.
    """

    actionable = [item for item in run.findings if item.status in ACTIONABLE_STATUSES]
    if not actionable:
        raise NoActionableFindingsError("The review run has no FAIL or REVIEW findings.")

    run_namespace = uuid5(NAMESPACE_URL, f"bim-review-agent:run:{run.run_id}")
    output = io.BytesIO()
    with ZipFile(output, mode="w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
        archive.writestr(_zip_info("bcf.version", run.completed_at), _version_xml())
        for index, finding in enumerate(actionable, start=1):
            topic_guid = str(uuid5(run_namespace, finding.finding_id)).upper()
            path = f"{topic_guid}/markup.bcf"
            archive.writestr(
                _zip_info(path, run.completed_at),
                _markup_xml(run, finding, topic_guid, index),
            )
    return output.getvalue()
