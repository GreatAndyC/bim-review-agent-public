export type FindingStatus = "PASS" | "FAIL" | "REVIEW";
export type Severity = "INFO" | "WARNING" | "ERROR";
export type Reliability =
  | "EXPLICIT"
  | "DERIVED"
  | "PROXY"
  | "MISSING"
  | "CONTRADICTORY";
export type StageStatus = "COMPLETED" | "FAILED" | "SKIPPED";
export type AuthorityType =
  | "DEMO_PROJECT_RULE"
  | "PROJECT_REQUIREMENT"
  | "AUTHORITATIVE_STANDARD";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type EntityRef = {
  ifc_class: string;
  global_id: string;
  name: string | null;
  object_type: string | null;
  tag: string | null;
  storey: string | null;
};

export type Observation = {
  label: string;
  raw_value: JsonValue;
  normalized_value: number | string | boolean | null;
  unit: string | null;
  source_path: string;
  reliability: Reliability;
  note: string | null;
};

export type ModelEvidence = {
  applicability_signal: Observation | null;
  observations: Observation[];
};

export type RuleEvidence = {
  rule_id: string;
  title: string;
  version: string;
  authority: AuthorityType;
  source_title: string;
  jurisdiction: string;
  clause: string | null;
  parameters: Record<string, JsonValue>;
  limitation: string;
};

export type Explanation = {
  summary: string;
  why_it_matters: string;
  next_step: string;
  boundary: string;
};

export type Finding = {
  finding_id: string;
  rule_id: string;
  rule_title: string;
  category: string;
  status: FindingStatus;
  severity: Severity;
  entity: EntityRef;
  applicability: string;
  message: string;
  recommendation: string;
  model_evidence: ModelEvidence;
  rule_evidence: RuleEvidence;
  explanation: Explanation | null;
};

export type ModelInventory = {
  schema_name: string;
  length_unit: string;
  length_unit_known: boolean;
  length_to_metre_scale: number;
  total_entities: number;
  entity_counts: Record<string, number>;
};

export type SourceFile = {
  filename: string;
  size_bytes: number;
  sha256: string;
};

export type RunStage = {
  order: number;
  key: string;
  label: string;
  status: StageStatus;
  detail: string;
  data: Record<string, JsonValue>;
};

export type RunSummary = {
  total_findings: number;
  pass_count: number;
  fail_count: number;
  review_count: number;
  reviewed_entities: number;
};

export type ReviewRun = {
  run_id: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  source: SourceFile;
  rule_pack_id: string;
  rule_pack_version: string;
  inventory: ModelInventory;
  trace: RunStage[];
  findings: Finding[];
  summary: RunSummary;
};

export type DeterministicReviewPayload = Omit<
  ReviewRun,
  "run_id" | "started_at" | "completed_at" | "duration_ms"
>;
