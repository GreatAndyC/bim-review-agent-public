"""Bounded deterministic explanations for completed findings."""

from __future__ import annotations

from bim_review_agent.domain.models import Explanation, Finding, FindingStatus

_BOUNDARY = (
    "This explanation restates deterministic evidence. It does not change the finding, "
    "certify compliance, or replace professional review."
)


def explain_finding(finding: Finding) -> Explanation:
    if finding.status is FindingStatus.FAIL:
        why = (
            "The available explicit evidence is sufficient for comparison and does not satisfy "
            "the configured project rule."
        )
    elif finding.status is FindingStatus.REVIEW:
        why = (
            "The model evidence is missing, ambiguous, contradictory, or only a proxy, so a "
            "defensible pass/fail decision would overstate certainty."
        )
    else:
        why = (
            "The available explicit evidence satisfies this configured project rule for the "
            "specific element checked."
        )
    return Explanation(
        summary=finding.message,
        why_it_matters=why,
        next_step=finding.recommendation,
        boundary=_BOUNDARY,
    )


def attach_explanations(findings: list[Finding]) -> list[Finding]:
    return [item.model_copy(update={"explanation": explain_finding(item)}) for item in findings]
