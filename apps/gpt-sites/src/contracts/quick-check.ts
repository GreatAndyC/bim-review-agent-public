import type {
  FindingStatus,
  JsonValue,
  ReviewRun,
  Severity,
  SourceFile,
} from "./review";

export type QuickCheckLocale = "en" | "zh-CN" | "zh-Hant";

export type QuickCheckMeasurement = {
  actual: number;
  required: number;
  difference: number;
  operator: string;
  unit: string;
};

export type QuickCheckEvidence = {
  label: string;
  value: string;
  source_path: string;
  reliability: string;
};

export type QuickCheckReference = {
  rule_id: string;
  display_rule_id: string;
  version: string;
  source_title: string;
  jurisdiction: string;
  clause: string | null;
  source_url: string | null;
  parameters: Record<string, JsonValue>;
};

export type QuickCheckEntity = {
  name: string;
  ifc_class: string;
  global_id: string;
  storey: string | null;
};

export type QuickCheckCheck = {
  finding_id: string;
  status: Exclude<FindingStatus, "PASS">;
  status_label: string;
  severity: Severity;
  rule_id: string;
  display_rule_id: string;
  title: string;
  category: string;
  entity: QuickCheckEntity;
  summary: string;
  recommendation: string;
  measurement: QuickCheckMeasurement | null;
  evidence: QuickCheckEvidence[];
  reference: QuickCheckReference;
};

export type QuickCheckScope = {
  status: "EVALUATED" | "NOT_APPLICABLE";
  reason: "no_applicable_doors" | "no_enabled_rules" | null;
  label: string;
  detail: string;
};

export type QuickCheckReport = {
  format: "bim-review-quick-check/v1";
  locale: QuickCheckLocale;
  generated_at: string;
  generated_from: {
    run_id: string;
    completed_at: string;
  };
  source: SourceFile;
  model: {
    schema: string;
    length_unit: string;
    total_entities: number;
    reviewed_entities: number;
  };
  rule_pack: {
    id: string;
    version: string;
  };
  summary: {
    total_findings: number;
    pass: number;
    fail: number;
    review: number;
    actionable: number;
  };
  scope: QuickCheckScope;
  checks: QuickCheckCheck[];
  limitation: string;
};

export type QuickCheckSourceRun = ReviewRun;
