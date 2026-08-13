import type {
  JsonObject,
  ToolDescriptor,
} from "../../contracts/agent";
import type { ReviewRun } from "../../contracts/review";
import {
  extractModel,
  type ExtractedModel,
} from "../ifc/extractor";
import { reviewValidatedUpload } from "../review/reviewer";
import type { ValidatedUpload } from "../upload/validation";
import { ToolRegistry } from "./registry";

export type BimReviewToolContext = {
  upload: ValidatedUpload;
  profile_id: import("../review/rule-pack").ReviewProfileId;
  extracted_model: ExtractedModel | null;
  review_run: ReviewRun | null;
};

const EMPTY_OBJECT_SCHEMA: JsonObject = {
  type: "object",
  additionalProperties: false,
};

const INSPECT_INPUT_SCHEMA: JsonObject = {
  type: "object",
  additionalProperties: false,
  properties: {
    include_entity_counts: { type: "boolean", default: true },
  },
};

const INSPECT_OUTPUT_SCHEMA: JsonObject = {
  type: "object",
  additionalProperties: false,
  required: [
    "schema_name",
    "length_unit",
    "length_unit_known",
    "total_entities",
    "door_count",
    "entity_counts",
  ],
  properties: {
    schema_name: { type: "string" },
    length_unit: { type: "string" },
    length_unit_known: { type: "boolean" },
    total_entities: { type: "integer", minimum: 0 },
    door_count: { type: "integer", minimum: 0 },
    entity_counts: {
      type: "object",
      additionalProperties: { type: "integer", minimum: 0 },
    },
  },
};

const REVIEW_OUTPUT_SCHEMA: JsonObject = {
  type: "object",
  additionalProperties: false,
  required: [
    "review_run_id",
    "rule_pack_id",
    "rule_pack_version",
    "total_findings",
    "pass_count",
    "fail_count",
    "review_count",
    "reviewed_entities",
  ],
  properties: {
    review_run_id: { type: "string" },
    rule_pack_id: { type: "string" },
    rule_pack_version: { type: "string" },
    total_findings: { type: "integer", minimum: 0 },
    pass_count: { type: "integer", minimum: 0 },
    fail_count: { type: "integer", minimum: 0 },
    review_count: { type: "integer", minimum: 0 },
    reviewed_entities: { type: "integer", minimum: 0 },
  },
};

const CRITIQUE_OUTPUT_SCHEMA: JsonObject = {
  type: "object",
  additionalProperties: false,
  required: [
    "review_run_id",
    "total_findings",
    "actionable_findings",
    "findings_with_model_evidence",
    "findings_with_rule_evidence",
    "findings_with_explanations",
    "unresolved_review_findings",
    "unsupported_actionable_finding_ids",
    "authority_types",
    "concerns",
  ],
  properties: {
    review_run_id: { type: "string" },
    total_findings: { type: "integer", minimum: 0 },
    actionable_findings: { type: "integer", minimum: 0 },
    findings_with_model_evidence: { type: "integer", minimum: 0 },
    findings_with_rule_evidence: { type: "integer", minimum: 0 },
    findings_with_explanations: { type: "integer", minimum: 0 },
    unresolved_review_findings: { type: "integer", minimum: 0 },
    unsupported_actionable_finding_ids: {
      type: "array",
      items: { type: "string" },
    },
    authority_types: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
  },
};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function validateEmpty(value: unknown): JsonObject {
  const item = object(value);
  if (!item || Object.keys(item).length !== 0) throw new Error("Expected no input.");
  return {};
}

function validateInspectInput(value: unknown): JsonObject {
  const item = object(value);
  if (!item || !exactKeys(item, ["include_entity_counts"])) {
    throw new Error("Invalid inspection input.");
  }
  const includeCounts = item.include_entity_counts ?? true;
  if (typeof includeCounts !== "boolean") throw new Error("Invalid inspection input.");
  return { include_entity_counts: includeCounts };
}

function validateInspectOutput(value: unknown): JsonObject {
  const item = object(value);
  const required = [
    "schema_name",
    "length_unit",
    "length_unit_known",
    "total_entities",
    "door_count",
    "entity_counts",
  ];
  const entityCounts = object(item?.entity_counts);
  if (
    !item ||
    !required.every((key) => Object.hasOwn(item, key)) ||
    !exactKeys(item, required) ||
    typeof item.schema_name !== "string" ||
    typeof item.length_unit !== "string" ||
    typeof item.length_unit_known !== "boolean" ||
    !count(item.total_entities) ||
    !count(item.door_count) ||
    !entityCounts ||
    !Object.values(entityCounts).every(count)
  ) {
    throw new Error("Invalid inspection output.");
  }
  return item as JsonObject;
}

function validateReviewOutput(value: unknown): JsonObject {
  const item = object(value);
  const required = [
    "review_run_id",
    "rule_pack_id",
    "rule_pack_version",
    "total_findings",
    "pass_count",
    "fail_count",
    "review_count",
    "reviewed_entities",
  ];
  if (
    !item ||
    !required.every((key) => Object.hasOwn(item, key)) ||
    !exactKeys(item, required) ||
    !["review_run_id", "rule_pack_id", "rule_pack_version"].every(
      (key) => typeof item[key] === "string" && item[key].length > 0,
    ) ||
    ![
      "total_findings",
      "pass_count",
      "fail_count",
      "review_count",
      "reviewed_entities",
    ].every((key) => count(item[key]))
  ) {
    throw new Error("Invalid review output.");
  }
  return item as JsonObject;
}

function validateCritiqueOutput(value: unknown): JsonObject {
  const item = object(value);
  const required = [
    "review_run_id",
    "total_findings",
    "actionable_findings",
    "findings_with_model_evidence",
    "findings_with_rule_evidence",
    "findings_with_explanations",
    "unresolved_review_findings",
    "unsupported_actionable_finding_ids",
    "authority_types",
    "concerns",
  ];
  if (
    !item ||
    !required.every((key) => Object.hasOwn(item, key)) ||
    !exactKeys(item, required) ||
    typeof item.review_run_id !== "string" ||
    ![
      "total_findings",
      "actionable_findings",
      "findings_with_model_evidence",
      "findings_with_rule_evidence",
      "findings_with_explanations",
      "unresolved_review_findings",
    ].every((key) => count(item[key])) ||
    !stringArray(item.unsupported_actionable_finding_ids) ||
    !stringArray(item.authority_types) ||
    !stringArray(item.concerns)
  ) {
    throw new Error("Invalid evidence critique output.");
  }
  return item as JsonObject;
}

async function inspectModel(
  input: JsonObject,
  context: BimReviewToolContext,
): Promise<JsonObject> {
  context.extracted_model ??= await extractModel(context.upload.bytes);
  return {
    schema_name: context.extracted_model.inventory.schema_name,
    length_unit: context.extracted_model.inventory.length_unit,
    length_unit_known: context.extracted_model.inventory.length_unit_known,
    total_entities: context.extracted_model.inventory.total_entities,
    door_count: context.extracted_model.doors.length,
    entity_counts:
      input.include_entity_counts === true
        ? context.extracted_model.inventory.entity_counts
        : {},
  };
}

async function runDeterministicReview(
  _input: JsonObject,
  context: BimReviewToolContext,
): Promise<JsonObject> {
  const run = await reviewValidatedUpload(
    context.upload,
    context.extracted_model ?? undefined,
    context.profile_id,
  );
  context.review_run = run;
  return {
    review_run_id: run.run_id,
    rule_pack_id: run.rule_pack_id,
    rule_pack_version: run.rule_pack_version,
    total_findings: run.summary.total_findings,
    pass_count: run.summary.pass_count,
    fail_count: run.summary.fail_count,
    review_count: run.summary.review_count,
    reviewed_entities: run.summary.reviewed_entities,
  };
}

function critiqueReviewEvidence(
  _input: JsonObject,
  context: BimReviewToolContext,
): JsonObject {
  const run = context.review_run;
  if (!run) throw new Error("Evidence critique requires a canonical ReviewRun.");
  const actionable = run.findings.filter((finding) => finding.status !== "PASS");
  const withModelEvidence = run.findings.filter(
    (finding) =>
      finding.model_evidence.observations.length > 0 ||
      finding.model_evidence.applicability_signal !== null,
  );
  const withRuleEvidence = run.findings.filter(
    (finding) =>
      finding.rule_evidence.rule_id === finding.rule_id &&
      Boolean(finding.rule_evidence.version) &&
      Boolean(finding.rule_evidence.limitation),
  );
  const withExplanations = run.findings.filter(
    (finding) => finding.explanation !== null,
  );
  const supportedIds = new Set(
    withModelEvidence
      .filter((finding) => withRuleEvidence.includes(finding))
      .map((finding) => finding.finding_id),
  );
  const unsupported = actionable
    .filter((finding) => !supportedIds.has(finding.finding_id))
    .map((finding) => finding.finding_id);
  const unresolved = run.findings.filter(
    (finding) => finding.status === "REVIEW",
  ).length;
  const authorityTypes = Array.from(
    new Set(run.findings.map((finding) => finding.rule_evidence.authority)),
  ).sort();
  const concerns: string[] = [];
  if (unresolved > 0) {
    concerns.push(
      `${unresolved} findings remain REVIEW and require human evidence resolution.`,
    );
  }
  if (unsupported.length > 0) {
    concerns.push(
      `${unsupported.length} actionable findings lack complete model or rule evidence.`,
    );
  }
  if (
    authorityTypes.length === 1 &&
    authorityTypes[0] === "DEMO_PROJECT_RULE"
  ) {
    concerns.push(
      "All enabled rules use DEMO_PROJECT_RULE authority and are not statutory certification.",
    );
  }
  return {
    review_run_id: run.run_id,
    total_findings: run.findings.length,
    actionable_findings: actionable.length,
    findings_with_model_evidence: withModelEvidence.length,
    findings_with_rule_evidence: withRuleEvidence.length,
    findings_with_explanations: withExplanations.length,
    unresolved_review_findings: unresolved,
    unsupported_actionable_finding_ids: unsupported,
    authority_types: authorityTypes,
    concerns,
  };
}

export function buildBimToolRegistry(): ToolRegistry<BimReviewToolContext> {
  const registry = new ToolRegistry<BimReviewToolContext>();
  registry.register({
    descriptor: {
      name: "inspect_ifc_model",
      version: "1.0",
      description:
        "Return bounded IFC schema, unit, entity-count, and door-count observations without assigning a verdict.",
      effect: "PURE_READ",
      input_schema: INSPECT_INPUT_SCHEMA,
      output_schema: INSPECT_OUTPUT_SCHEMA,
    },
    validate_input: validateInspectInput,
    validate_output: validateInspectOutput,
    handler: inspectModel,
  });
  registry.register({
    descriptor: {
      name: "run_deterministic_review",
      version: "1.0",
      description:
        "Run the versioned BIM rules and return a summary linked to the only canonical ReviewRun.",
      effect: "DETERMINISTIC_COMPUTE",
      input_schema: EMPTY_OBJECT_SCHEMA,
      output_schema: REVIEW_OUTPUT_SCHEMA,
    },
    validate_input: validateEmpty,
    validate_output: validateReviewOutput,
    handler: runDeterministicReview,
    canonical_review_output_key: "review_run_id",
  });
  registry.register({
    descriptor: {
      name: "critique_review_evidence",
      version: "1.0",
      description:
        "Read the canonical ReviewRun and report bounded evidence-completeness concerns without changing findings.",
      effect: "PURE_READ",
      input_schema: EMPTY_OBJECT_SCHEMA,
      output_schema: CRITIQUE_OUTPUT_SCHEMA,
    },
    validate_input: validateEmpty,
    validate_output: validateCritiqueOutput,
    handler: critiqueReviewEvidence,
    public_observation: (output) => ({
      review_run_id: output.review_run_id,
      total_findings: output.total_findings,
      actionable_findings: output.actionable_findings,
      unresolved_review_findings: output.unresolved_review_findings,
      concerns: output.concerns,
    }),
  });
  return registry;
}

export function bimToolCatalogue(): ToolDescriptor[] {
  return buildBimToolRegistry().catalogue([
    "inspect_ifc_model",
    "run_deterministic_review",
    "critique_review_evidence",
  ]);
}
