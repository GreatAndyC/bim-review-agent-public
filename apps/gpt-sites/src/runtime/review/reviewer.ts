import type {
  DeterministicReviewPayload,
  Finding,
  FindingStatus,
  ReviewRun,
  RunSummary,
} from "@/src/contracts/review";
import { extractModel } from "@/src/runtime/ifc/extractor";
import type { ExtractedModel } from "@/src/runtime/ifc/extractor";
import type { ValidatedUpload } from "@/src/runtime/upload/validation";
import { evaluateEgress001 } from "./egress-001";
import { attachExplanations } from "./explainer";
import { evaluateInfo001 } from "./info-001";
import {
  DEFAULT_REVIEW_PROFILE_ID,
  isReviewProfileId,
  loadRulePack,
  type ReviewProfileId,
} from "./rule-pack";

export { DEFAULT_REVIEW_PROFILE_ID } from "./rule-pack";
export type { ReviewProfileId } from "./rule-pack";

export class ReviewProfileError extends Error {
  constructor(readonly profileId: string) {
    super(`Unsupported review profile: ${profileId}`);
    this.name = "ReviewProfileError";
  }
}

export function requestedReviewProfile(value: string | null | undefined): ReviewProfileId {
  const candidate = value?.trim() || DEFAULT_REVIEW_PROFILE_ID;
  if (!isReviewProfileId(candidate)) {
    throw new ReviewProfileError(candidate);
  }
  return candidate;
}

const STATUS_PRIORITY: Record<FindingStatus, number> = {
  FAIL: 0,
  REVIEW: 1,
  PASS: 2,
};

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function sortFindings(findings: Finding[]): Finding[] {
  return findings.sort((left, right) => {
    const status = STATUS_PRIORITY[left.status] - STATUS_PRIORITY[right.status];
    if (status !== 0) return status;
    const rule = compareText(left.rule_id, right.rule_id);
    if (rule !== 0) return rule;
    const entity = compareText(left.entity.name ?? "", right.entity.name ?? "");
    if (entity !== 0) return entity;
    return compareText(left.finding_id, right.finding_id);
  });
}

function summarize(findings: Finding[]): RunSummary {
  return {
    total_findings: findings.length,
    pass_count: findings.filter((finding) => finding.status === "PASS").length,
    fail_count: findings.filter((finding) => finding.status === "FAIL").length,
    review_count: findings.filter((finding) => finding.status === "REVIEW").length,
    reviewed_entities: new Set(
      findings.map((finding) => finding.entity.global_id),
    ).size,
  };
}

export async function reviewValidatedUpload(
  upload: ValidatedUpload,
  previouslyExtracted?: ExtractedModel,
  profileId: ReviewProfileId = DEFAULT_REVIEW_PROFILE_ID,
): Promise<ReviewRun> {
  const startedAt = new Date();
  const startedClock = performance.now();
  const trace: ReviewRun["trace"] = [
    {
      order: 1,
      key: "validate",
      label: "Validate input",
      status: "COMPLETED",
      detail: "Extension, size, STEP header, and schema declaration accepted.",
      data: {
        size_bytes: upload.bytes.byteLength,
        sha256_prefix: upload.sha256.slice(0, 12),
      },
    },
  ];

  const extracted = previouslyExtracted ?? (await extractModel(upload.bytes));
  trace.push({
    order: 2,
    key: "inventory",
    label: "Inventory model",
    status: "COMPLETED",
    detail: `Read ${extracted.inventory.total_entities} IFC records and ${extracted.doors.length} door elements.`,
    data: {
      schema: extracted.inventory.schema_name,
      length_unit: extracted.inventory.length_unit,
      door_count: extracted.doors.length,
    },
  });

  const pack = loadRulePack(profileId);
  const enabledRules = [
    ...(pack.info.enabled ? [pack.info.id] : []),
    ...(pack.egress.enabled ? [pack.egress.id] : []),
  ];
  trace.push({
    order: 3,
    key: "plan",
    label: "Plan checks",
    status: "COMPLETED",
    detail: `Planned ${enabledRules.length} deterministic rules from ${pack.id}.`,
    data: {
      enabled_rules: enabledRules,
      rule_pack_version: pack.version,
    },
  });

  let findings = sortFindings([
    ...(await evaluateInfo001(extracted, pack)),
    ...(await evaluateEgress001(extracted, pack)),
  ]);
  const preExplanationSummary = summarize(findings);
  trace.push({
    order: 4,
    key: "execute",
    label: "Execute rules",
    status: "COMPLETED",
    detail: `Produced ${findings.length} findings using deterministic rule code.`,
    data: {
      pass: preExplanationSummary.pass_count,
      fail: preExplanationSummary.fail_count,
      review: preExplanationSummary.review_count,
    },
  });

  findings = attachExplanations(findings);
  trace.push({
    order: 5,
    key: "report",
    label: "Assemble evidence",
    status: "COMPLETED",
    detail: "Bound model evidence, rule evidence, and deterministic explanations.",
    data: {
      external_ai_calls: 0,
      report_contract: "ReviewRun/v1",
    },
  });

  const completedAt = new Date();
  return {
    run_id: crypto.randomUUID(),
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    duration_ms: Math.max(1, Math.round(performance.now() - startedClock)),
    source: {
      filename: upload.safeFilename,
      size_bytes: upload.bytes.byteLength,
      sha256: upload.sha256,
    },
    rule_pack_id: pack.id,
    rule_pack_version: pack.version,
    inventory: extracted.inventory,
    trace,
    findings,
    summary: summarize(findings),
  };
}

export function deterministicReviewPayload(
  run: ReviewRun,
): DeterministicReviewPayload {
  return {
    source: run.source,
    rule_pack_id: run.rule_pack_id,
    rule_pack_version: run.rule_pack_version,
    inventory: run.inventory,
    trace: run.trace,
    findings: run.findings,
    summary: run.summary,
  };
}
