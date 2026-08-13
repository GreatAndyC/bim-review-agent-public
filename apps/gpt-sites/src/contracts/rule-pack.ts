import type { AuthorityType } from "./review";

export type InfoField =
  | "name"
  | "fire_rating"
  | "fire_exit"
  | "clear_width"
  | "occupant_capacity";

export type InfoRequirementConfig = {
  key: string;
  label: string;
  field: InfoField;
  applicability: "all_doors" | "confirmed_exit_doors";
  source_path: string;
  missing_status: "REVIEW";
};

export type EgressWidthRow = {
  min_occupants: number;
  max_occupants: number | null;
  min_each_exit_door_mm: number | null;
  min_exit_doors?: number | null;
  min_total_exit_door_width_mm?: number | null;
  min_total_exit_route_width_mm?: number | null;
  min_each_exit_route_mm?: number | null;
};

export type RulePack = {
  id: string;
  version: string;
  title: string;
  authority: {
    type: AuthorityType;
    source_title: string;
    jurisdiction: string;
    clause: string | null;
    limitation: string;
    source_url?: string | null;
    source_landing_page?: string | null;
    source_edition?: string | null;
    source_retrieved_on?: string | null;
  };
  info: {
    id: "INFO-001";
    title: string;
    category: string;
    version: string;
    enabled: boolean;
    requirements: InfoRequirementConfig[];
  };
  egress: {
    id: string;
    title: string;
    category: string;
    version: string;
    enabled: boolean;
    threshold?: {
      value: number;
      unit: "mm";
      operator: ">=";
    };
    rows?: EgressWidthRow[];
    selection_field?: "occupant_capacity";
    clause_or_table?: string;
    missing_evidence_outcome?: string;
    contradiction_tolerance_mm: number;
    proxy_policy: "review";
  };
};
