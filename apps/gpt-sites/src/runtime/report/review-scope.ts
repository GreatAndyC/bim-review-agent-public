import type { ReviewRun } from "@/src/contracts/review";

export type ReviewScopeStatus = "EVALUATED" | "NOT_APPLICABLE";
export type ReviewScopeReason = "no_applicable_doors" | "no_enabled_rules" | null;

export type ReviewScope = {
  status: ReviewScopeStatus;
  reason: ReviewScopeReason;
  door_count: number;
  enabled_rule_count: number | null;
};

/**
 * Distinguish a clean evaluated run from a run that never had an applicable
 * object or executable rule. A numeric 0/0/0/0 summary alone cannot make that
 * distinction for a reviewer.
 */
export function getReviewScope(review: ReviewRun): ReviewScope {
  const doorCount = review.inventory.entity_counts.IfcDoor ?? 0;
  const planStage = review.trace.find((stage) => stage.key === "plan");
  const plannedRules = planStage?.data.enabled_rules;
  const enabledRuleCount = Array.isArray(plannedRules) ? plannedRules.length : null;
  const noApplicableDoors = doorCount === 0;
  const noEnabledRules = enabledRuleCount === 0;

  return {
    status:
      review.summary.total_findings === 0 && (noApplicableDoors || noEnabledRules)
        ? "NOT_APPLICABLE"
        : "EVALUATED",
    reason: noApplicableDoors ? "no_applicable_doors" : noEnabledRules ? "no_enabled_rules" : null,
    door_count: doorCount,
    enabled_rule_count: enabledRuleCount,
  };
}
