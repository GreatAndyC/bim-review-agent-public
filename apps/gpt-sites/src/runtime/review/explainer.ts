import type { Explanation, Finding } from "@/src/contracts/review";

const BOUNDARY =
  "This explanation restates deterministic evidence. It does not change the finding, certify compliance, or replace professional review.";

export function explainFinding(finding: Finding): Explanation {
  let whyItMatters: string;
  if (finding.status === "FAIL") {
    whyItMatters =
      "The available explicit evidence is sufficient for comparison and does not satisfy the configured project rule.";
  } else if (finding.status === "REVIEW") {
    whyItMatters =
      "The model evidence is missing, ambiguous, contradictory, or only a proxy, so a defensible pass/fail decision would overstate certainty.";
  } else {
    whyItMatters =
      "The available explicit evidence satisfies this configured project rule for the specific element checked.";
  }

  return {
    summary: finding.message,
    why_it_matters: whyItMatters,
    next_step: finding.recommendation,
    boundary: BOUNDARY,
  };
}

export function attachExplanations(findings: Finding[]): Finding[] {
  return findings.map((finding) => ({
    ...finding,
    explanation: explainFinding(finding),
  }));
}
