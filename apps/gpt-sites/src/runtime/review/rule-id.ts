const RULE_PACK_DISPLAY_PREFIXES: Readonly<Record<string, string>> = {
  "hku-demo-2026": "HKU-DEMO",
  "hk-fire-safety-2011-2024": "HK-FS",
  "cn-fire-55037-2022": "CN-FS",
};

/**
 * Keeps the executable rule ID stable while qualifying generic IDs for people
 * reading a report across multiple rule packs.
 */
export function displayRuleId(ruleId: string, rulePackId?: string | null): string {
  const prefix = rulePackId ? RULE_PACK_DISPLAY_PREFIXES[rulePackId] : undefined;
  if (!prefix || ruleId.startsWith(`${prefix}-`) || !/^[A-Z]+-\d+$/.test(ruleId)) return ruleId;
  return `${prefix}-${ruleId}`;
}
