import demoRulePackJson from "../../../../../contracts/rules/hku-demo-2026.v1.0.0.json" with {
  type: "json",
};
import hongKongRulePackJson from "../../../../../contracts/rules/hk-fire-safety-2011-2024.v1.0.0.json" with {
  type: "json",
};
import mainlandChinaRulePackJson from "../../../../../contracts/rules/cn-fire-55037-2022.v1.0.0.json" with {
  type: "json",
};
import type { RulePack } from "@/src/contracts/rule-pack";

export const DEFAULT_REVIEW_PROFILE_ID = "hku-demo-2026" as const;
export const EXECUTABLE_REVIEW_PROFILE_IDS = [
  "hku-demo-2026",
  "hk-fire-safety-2011-2024",
  "cn-fire-55037-2022",
] as const;
export type ReviewProfileId = (typeof EXECUTABLE_REVIEW_PROFILE_IDS)[number];

function validateRulePack(value: unknown, expectedId: ReviewProfileId): RulePack {
  const pack = value as Partial<RulePack>;
  const hasFixedThreshold = Boolean(pack.egress?.threshold);
  const hasTableRows = Array.isArray(pack.egress?.rows) && pack.egress.rows.length > 0;
  if (
    pack.id !== expectedId ||
    !pack.version ||
    !pack.info ||
    pack.info.id !== "INFO-001" ||
    !pack.egress ||
    !pack.egress.id ||
    !pack.egress.version ||
    (!hasFixedThreshold && !hasTableRows) ||
    (hasFixedThreshold &&
      (pack.egress.threshold?.operator !== ">=" ||
        pack.egress.threshold.unit !== "mm" ||
        pack.egress.threshold.value <= 0)) ||
    !Array.isArray(pack.info.requirements) ||
    pack.info.requirements.length === 0
  ) {
    throw new Error(`The bundled rule pack ${expectedId} failed its v1 contract.`);
  }
  return pack as RulePack;
}

const RULE_PACKS: Record<ReviewProfileId, RulePack> = {
  "hku-demo-2026": validateRulePack(demoRulePackJson, "hku-demo-2026"),
  "hk-fire-safety-2011-2024": validateRulePack(
    hongKongRulePackJson,
    "hk-fire-safety-2011-2024",
  ),
  "cn-fire-55037-2022": validateRulePack(
    mainlandChinaRulePackJson,
    "cn-fire-55037-2022",
  ),
};

export function isReviewProfileId(value: string): value is ReviewProfileId {
  return (EXECUTABLE_REVIEW_PROFILE_IDS as readonly string[]).includes(value);
}

export function loadRulePack(
  profileId: ReviewProfileId = DEFAULT_REVIEW_PROFILE_ID,
): RulePack {
  return RULE_PACKS[profileId];
}
