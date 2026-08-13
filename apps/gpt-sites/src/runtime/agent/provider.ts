import type {
  AgentAction,
  FinalAction,
  JsonObject,
  ProviderRequest,
  ToolObservation,
} from "../../contracts/agent";
import type { ModelProvider } from "./kernel";

export const DEFAULT_AGENT_OBJECTIVE =
  "Inspect the IFC model, run the enabled BIM review rules, critique evidence completeness, and summarize the canonical result without changing any deterministic verdict.";

const INVENTORY_MARKERS = [
  "inventory only",
  "inspect only",
  "model overview",
  "schema only",
  "只盘点",
  "只查看模型",
  "模型概览",
  "只檢查模型",
] as const;

const REVIEW_MARKERS = [
  "review",
  "check",
  "audit",
  "inspect",
  "ifc",
  "door",
  "exit",
  "egress",
  "rule",
  "模型",
  "审查",
  "審查",
  "审核",
  "檢查",
  "检查",
  "门",
  "門",
  "出口",
  "疏散",
] as const;

function latestObservation(
  request: ProviderRequest,
  toolName: string,
): ToolObservation | null {
  return (
    [...request.observations]
      .reverse()
      .find((observation) => observation.tool_name === toolName) ?? null
  );
}

function numberField(output: JsonObject, key: string): number {
  const value = output[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Observation field ${key} is invalid.`);
  }
  return value;
}

function stringField(output: JsonObject, key: string): string {
  const value = output[key];
  if (typeof value !== "string" || !value) {
    throw new Error(`Observation field ${key} is invalid.`);
  }
  return value;
}

function isInventoryOnly(objective: string): boolean {
  const normalized = objective.toLocaleLowerCase("en-US");
  return INVENTORY_MARKERS.some((marker) => normalized.includes(marker));
}

function isSupportedObjective(objective: string): boolean {
  if (objective === DEFAULT_AGENT_OBJECTIVE) return true;
  const normalized = objective.toLocaleLowerCase("en-US");
  return REVIEW_MARKERS.some((marker) => normalized.includes(marker));
}

function inventoryFinal(inspection: ToolObservation): FinalAction {
  const total = numberField(inspection.output, "total_entities");
  const doors = numberField(inspection.output, "door_count");
  return {
    type: "final",
    message: `Inspected the IFC model: ${total} records, including ${doors} door elements. No rule verdicts were requested.`,
    data: {
      mode: "inventory_only",
      inventory: inspection.output,
    },
    linked_review_run_id: null,
  };
}

function unsupportedFinal(inspection: ToolObservation): FinalAction {
  return {
    type: "final",
    message:
      "The requested objective is outside this MVP's bounded IFC door-information and egress-review scope. The model was inspected, but no unsupported verdict was invented.",
    data: {
      mode: "unsupported_scope",
      supported_rules: [
        "INFO-001",
        "EGRESS-001",
        "HK-FS-B2-DOOR-WIDTH",
        "GB 55037-2022 7.1.4(1)",
      ],
      inventory: inspection.output,
    },
    linked_review_run_id: null,
  };
}

export function bimReviewScript(request: ProviderRequest): AgentAction {
  const inspection = latestObservation(request, "inspect_ifc_model");
  const review = latestObservation(request, "run_deterministic_review");
  const critique = latestObservation(request, "critique_review_evidence");

  if (!inspection) {
    return {
      type: "tool_call",
      tool_name: "inspect_ifc_model",
      arguments: { include_entity_counts: true },
      purpose:
        "Inspect bounded IFC schema, unit, and entity-count evidence before selecting the next allowed action.",
    };
  }
  if (isInventoryOnly(request.objective)) return inventoryFinal(inspection);
  if (!isSupportedObjective(request.objective)) return unsupportedFinal(inspection);

  if (!review) {
    const doorCount = numberField(inspection.output, "door_count");
    return {
      type: "tool_call",
      tool_name: "run_deterministic_review",
      arguments: {},
      purpose: `Run the enabled deterministic rules after inspection found ${doorCount} door elements.`,
    };
  }
  if (!critique) {
    return {
      type: "tool_call",
      tool_name: "critique_review_evidence",
      arguments: {},
      purpose:
        "Check the canonical findings for evidence completeness and unresolved REVIEW states without changing any verdict.",
    };
  }

  const reviewId = stringField(review.output, "review_run_id");
  if (stringField(critique.output, "review_run_id") !== reviewId) {
    throw new Error("Evidence critique refers to a different ReviewRun.");
  }
  const total = numberField(review.output, "total_findings");
  const pass = numberField(review.output, "pass_count");
  const fail = numberField(review.output, "fail_count");
  const needsReview = numberField(review.output, "review_count");
  const concerns = critique.output.concerns;
  if (!Array.isArray(concerns) || !concerns.every((item) => typeof item === "string")) {
    throw new Error("Evidence critique concerns are invalid.");
  }
  return {
    type: "final",
    message:
      `Completed ${total} evidence-backed findings: ${pass} PASS, ${fail} FAIL, and ${needsReview} REVIEW. ` +
      "REVIEW items require human investigation; these deterministic pre-checks are not statutory certification.",
    data: {
      mode: "full_review",
      summary: {
        total_findings: total,
        pass_count: pass,
        fail_count: fail,
        review_count: needsReview,
        reviewed_entities: numberField(review.output, "reviewed_entities"),
      },
      rule_pack_id: stringField(review.output, "rule_pack_id"),
      rule_pack_version: stringField(review.output, "rule_pack_version"),
      evidence_critique: {
        actionable_findings: numberField(critique.output, "actionable_findings"),
        unresolved_review_findings: numberField(
          critique.output,
          "unresolved_review_findings",
        ),
        concerns,
      },
    },
    linked_review_run_id: reviewId,
  };
}

export class ScriptedBimProvider implements ModelProvider {
  readonly provider_id = "scripted";
  readonly model_id = "deterministic-site-script-v1";

  nextAction(request: ProviderRequest): AgentAction {
    return bimReviewScript(request);
  }
}
