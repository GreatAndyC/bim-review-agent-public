import type { RulePack } from "@/src/contracts/rule-pack";
import type {
  JsonValue,
  Observation,
  RuleEvidence,
} from "@/src/contracts/review";
import type { Fact } from "@/src/runtime/ifc/extractor";

export async function findingId(
  ruleId: string,
  globalId: string,
  checkKey: string,
): Promise<string> {
  const payload = new TextEncoder().encode(`${ruleId}|${globalId}|${checkKey}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", payload));
  const prefix = Array.from(digest.subarray(0, 6), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${ruleId.toLocaleLowerCase("en-US")}-${prefix}`;
}

export function normalizeLengthMm(
  value: JsonValue,
  lengthToMetreScale: number,
): number | null {
  if (typeof value === "boolean" || value === null) return null;
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.round(numeric * lengthToMetreScale * 1_000_000) / 1_000;
}

export function observationFromFact({
  label,
  fact,
  normalizedValue = null,
  unit = null,
}: {
  label: string;
  fact: Fact;
  normalizedValue?: number | string | boolean | null;
  unit?: string | null;
}): Observation {
  return {
    label,
    raw_value: fact.value,
    normalized_value: normalizedValue,
    unit,
    source_path: fact.sourcePath,
    reliability: fact.reliability,
    note: fact.note,
  };
}

export function ruleEvidence({
  pack,
  ruleId,
  title,
  version,
  parameters,
}: {
  pack: RulePack;
  ruleId: string;
  title: string;
  version: string;
  parameters: Record<string, JsonValue>;
}): RuleEvidence {
  const evidenceParameters: Record<string, JsonValue> = { ...parameters };
  const sourceMetadata = {
    source_url: pack.authority.source_url,
    source_landing_page: pack.authority.source_landing_page,
    source_edition: pack.authority.source_edition,
    source_retrieved_on: pack.authority.source_retrieved_on,
  } as const;
  for (const [key, value] of Object.entries(sourceMetadata)) {
    if (typeof value === "string" && value) evidenceParameters[key] = value;
  }
  return {
    rule_id: ruleId,
    title,
    version,
    authority: pack.authority.type,
    source_title: pack.authority.source_title,
    jurisdiction: pack.authority.jurisdiction,
    clause: pack.authority.clause,
    parameters: evidenceParameters,
    limitation: pack.authority.limitation,
  };
}

export function explicitBool(value: JsonValue): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && (value === 0 || value === 1)) {
    return Boolean(value);
  }
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLocaleLowerCase("en-US");
  if (["true", "yes", "y", "1"].includes(normalized)) return true;
  if (["false", "no", "n", "0"].includes(normalized)) return false;
  return null;
}

export function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}
