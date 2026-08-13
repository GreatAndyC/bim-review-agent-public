import type { EgressWidthRow, RulePack } from "@/src/contracts/rule-pack";
import type {
  Finding,
  JsonValue,
  ModelEvidence,
  Observation,
} from "@/src/contracts/review";
import {
  factIsMissing,
  type DoorFacts,
  type ExtractedModel,
  type Fact,
} from "@/src/runtime/ifc/extractor";
import {
  explicitBool,
  findingId,
  formatNumber,
  normalizeLengthMm,
  observationFromFact,
  ruleEvidence,
} from "./common";

function positiveNumber(value: JsonValue): number | null {
  if (typeof value === "boolean" || value === null) return null;
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(number) && number > 0 ? number : null;
}

function tableRowForCapacity(
  pack: RulePack,
  occupantCapacity: number,
): EgressWidthRow | null {
  for (const row of pack.egress.rows ?? []) {
    if (occupantCapacity < row.min_occupants) continue;
    if (row.max_occupants === null || occupantCapacity <= row.max_occupants) {
      return row;
    }
  }
  return null;
}

function ruleParameters(
  pack: RulePack,
  extra: Record<string, JsonValue> = {},
  includePolicy = false,
): Record<string, JsonValue> {
  const config = pack.egress;
  const parameters: Record<string, JsonValue> = { ...extra };
  if (includePolicy) {
    parameters.proxy_policy = config.proxy_policy;
    parameters.contradiction_tolerance_mm = config.contradiction_tolerance_mm;
  }
  if (config.threshold) {
    parameters.operator = config.threshold.operator;
    parameters.minimum = config.threshold.value;
    parameters.unit = config.threshold.unit;
  }
  if (config.selection_field) parameters.selection_field = config.selection_field;
  if (config.clause_or_table) parameters.clause_or_table = config.clause_or_table;
  if (config.missing_evidence_outcome) {
    parameters.missing_evidence_outcome = config.missing_evidence_outcome;
  }
  return parameters;
}

function exitSignalObservation(
  door: DoorFacts,
  contradictory = false,
): Observation {
  if (!factIsMissing(door.fireExit)) {
    const observation = observationFromFact({
      label: "Exit classification",
      fact: door.fireExit,
      normalizedValue: explicitBool(door.fireExit.value),
    });
    return contradictory
      ? {
          ...observation,
          reliability: "CONTRADICTORY",
          note: "The explicit value conflicts with exit-related naming metadata.",
        }
      : observation;
  }
  return {
    label: "Exit classification candidate",
    raw_value: door.entity.name ?? door.entity.object_type,
    normalized_value: null,
    source_path: "IfcDoor.Name / IfcDoor.ObjectType",
    reliability: "DERIVED",
    note: "Exit-related text is only a candidate signal; explicit classification is required.",
    unit: null,
  };
}

function widthEvidence(door: DoorFacts): {
  observations: Observation[];
  normalizedExplicit: number[];
} {
  const observations: Observation[] = [];
  const normalizedExplicit: number[] = [];
  for (const fact of door.explicitWidths) {
    const normalized = door.lengthUnitKnown
      ? normalizeLengthMm(fact.value, door.lengthToMetreScale)
      : null;
    if (normalized !== null) normalizedExplicit.push(normalized);
    observations.push(
      observationFromFact({
        label: "Reported clear width",
        fact,
        normalizedValue: normalized,
        unit: normalized === null ? null : "mm",
      }),
    );
  }
  if (!factIsMissing(door.overallWidth)) {
    const normalized = door.lengthUnitKnown
      ? normalizeLengthMm(door.overallWidth.value, door.lengthToMetreScale)
      : null;
    observations.push(
      observationFromFact({
        label: "Nominal overall width (proxy)",
        fact: door.overallWidth,
        normalizedValue: normalized,
        unit: door.lengthUnitKnown ? "mm" : null,
      }),
    );
  }
  if (observations.length === 0) {
    const missingFact: Fact = {
      value: null,
      sourcePath: "Pset_BIMReview.ClearWidth",
      reliability: "MISSING",
      note: "No clear-width property or nominal OverallWidth was available.",
    };
    observations.push(
      observationFromFact({ label: "Clear width", fact: missingFact }),
    );
  }
  return { observations, normalizedExplicit };
}

async function reviewFinding({
  door,
  pack,
  applicability,
  message,
  recommendation,
  observations,
  signal,
  key,
  parameters = {},
}: {
  door: DoorFacts;
  pack: RulePack;
  applicability: string;
  message: string;
  recommendation: string;
  observations: Observation[];
  signal: Observation;
  key: string;
  parameters?: Record<string, JsonValue>;
}): Promise<Finding> {
  const config = pack.egress;
  return {
    finding_id: await findingId(config.id, door.entity.global_id, key),
    rule_id: config.id,
    rule_title: config.title,
    category: config.category,
    status: "REVIEW",
    severity: "WARNING",
    entity: door.entity,
    applicability,
    message,
    recommendation,
    model_evidence: {
      applicability_signal: signal,
      observations,
    },
    rule_evidence: ruleEvidence({
      pack,
      ruleId: config.id,
      title: config.title,
      version: config.version,
      parameters: ruleParameters(pack, parameters, true),
    }),
    explanation: null,
  };
}

async function evaluateDoor(
  door: DoorFacts,
  pack: RulePack,
): Promise<Finding | null> {
  const config = pack.egress;
  const explicitExit = explicitBool(door.fireExit.value);
  const contradictory = explicitExit === false && door.nameExitCandidate;
  const ambiguous = explicitExit === null && door.nameExitCandidate;
  if (explicitExit !== true && !contradictory && !ambiguous) return null;

  const { observations: widthObservations, normalizedExplicit: widths } =
    widthEvidence(door);
  const isTableBased = Boolean(config.rows?.length);
  const observations = [...widthObservations];
  const signal = exitSignalObservation(door, contradictory);
  const entityName = door.entity.name ?? "Unnamed door";

  let occupantCapacity: number | null = null;
  let selectedRow: EgressWidthRow | null = null;
  if (isTableBased) {
    occupantCapacity = positiveNumber(door.occupantCapacity.value);
    observations.unshift(
      observationFromFact({
        label: "Occupant capacity",
        fact: door.occupantCapacity,
        normalizedValue: occupantCapacity,
      }),
    );
  }

  if (contradictory) {
    return reviewFinding({
      door,
      pack,
      applicability:
        "Exit applicability is contradictory and requires human confirmation.",
      message: `${entityName} is explicitly marked as not an exit, but its naming metadata suggests an exit function.`,
      recommendation:
        "Resolve the classification conflict before using this door in an egress check.",
      observations,
      signal,
      key: "classification-contradiction",
    });
  }
  if (ambiguous) {
    return reviewFinding({
      door,
      pack,
      applicability:
        "Exit-related naming is present, but explicit exit classification is missing.",
      message: `${entityName} may be an exit door, but applicability cannot be confirmed.`,
      recommendation:
        "Confirm the door function and populate Pset_DoorCommon.FireExit before relying on the width result.",
      observations,
      signal,
      key: "classification-ambiguous",
    });
  }

  if (isTableBased && (occupantCapacity === null || !Number.isInteger(occupantCapacity))) {
    return reviewFinding({
      door,
      pack,
      applicability:
        "Confirmed exit door; Table B2 applicability requires occupant capacity evidence.",
      message: `${entityName} cannot be evaluated against Hong Kong Table B2 because occupant capacity is missing or invalid.`,
      recommendation:
        "Provide a verified occupant capacity and its room/storey mapping, then rerun the Hong Kong fire-safety profile.",
      observations,
      signal,
      key: "occupant-capacity-missing",
      parameters: { outcome_reason: "occupant_capacity_missing_or_invalid" },
    });
  }

  if (isTableBased && occupantCapacity !== null) {
    selectedRow = tableRowForCapacity(pack, occupantCapacity);
    if (!selectedRow || selectedRow.min_each_exit_door_mm === null) {
      return reviewFinding({
        door,
        pack,
        applicability:
          "Confirmed exit door; the selected Table B2 row requires authority or engineering judgement.",
        message: `${entityName} is outside the directly machine-checkable Table B2 range or requires Building Authority determination.`,
        recommendation: "Escalate the case to a qualified Hong Kong code reviewer.",
        observations,
        signal,
        key: "table-row-not-machine-checkable",
        parameters: {
          outcome_reason: "table_row_requires_authority_or_engineering_judgement",
          occupant_capacity: occupantCapacity,
        },
      });
    }
  }

  if (
    widths.length > 1 &&
    Math.max(...widths) - Math.min(...widths) >
      config.contradiction_tolerance_mm
  ) {
    const contradictoryObservations = observations.map((observation) =>
      observation.label === "Reported clear width"
        ? {
            ...observation,
            reliability: "CONTRADICTORY" as const,
            note: "Multiple explicit clear-width values disagree beyond tolerance.",
          }
        : observation,
    );
    return reviewFinding({
      door,
      pack,
      applicability: "Confirmed exit door; width evidence is contradictory.",
      message: `${entityName} has conflicting reported clear-width values.`,
      recommendation:
        "Verify the authoritative clear opening and remove the conflicting value.",
      observations: contradictoryObservations,
      signal,
      key: "width-contradiction",
    });
  }

  if (widths.length === 0) {
    const hasProxy = !factIsMissing(door.overallWidth);
    let message: string;
    let recommendation: string;
    if (door.explicitWidths.length > 0 && !door.lengthUnitKnown) {
      message = `${entityName} reports a clear-width value, but the IFC project length unit is unavailable.`;
      recommendation =
        "Assign a project LENGTHUNIT or an explicit property unit, then rerun the review.";
    } else if (hasProxy) {
      message = `${entityName} only reports OverallWidth, which is a proxy for clear opening.`;
      recommendation =
        "Measure or export the actual clear opening to Pset_BIMReview.ClearWidth; keep the nominal OverallWidth as supporting evidence only.";
    } else {
      message = `${entityName} has no usable clear-width evidence.`;
      recommendation =
        "Populate a verified clear-opening width in the model and rerun the review.";
    }
    return reviewFinding({
      door,
      pack,
      applicability: isTableBased
        ? "Confirmed exit door; clear-width evidence is insufficient for the Table B2 comparison."
        : "Confirmed exit door; width evidence is insufficient for comparison.",
      message,
      recommendation,
      observations,
      signal,
      key: "width-insufficient",
    });
  }

  const minimum = isTableBased
    ? selectedRow?.min_each_exit_door_mm ?? null
    : config.threshold?.value ?? null;
  if (minimum === null) {
    return reviewFinding({
      door,
      pack,
      applicability: "Confirmed exit door; no machine-checkable width threshold is available.",
      message: `${entityName} cannot be compared because the selected rule row has no executable minimum.`,
      recommendation: "Escalate the case to a qualified code reviewer.",
      observations,
      signal,
      key: "threshold-missing",
    });
  }

  const widthMm = widths[0];
  const passed = widthMm >= minimum;
  const isMainlandChinaProfile = pack.id === "cn-fire-55037-2022";
  const message = isTableBased
    ? `${entityName} reports ${formatNumber(widthMm)} mm clear width; the Table B2 minimum for ${occupantCapacity} occupants is ${formatNumber(minimum)} mm.`
    : isMainlandChinaProfile
      ? `${entityName} reports ${formatNumber(widthMm)} mm clear width, which ${passed ? "meets" : "is below"} the GB 55037-2022 Clause 7.1.4(1) minimum of ${formatNumber(minimum)} mm.`
      : `${entityName} reports ${formatNumber(widthMm)} mm clear width, which ${passed ? "meets" : "is below"} the ${formatNumber(minimum)} mm demo threshold.`;
  const recommendation = isTableBased
    ? passed
      ? "No action is indicated by this automated comparison; retain the measured evidence."
      : "Coordinate a compliant clear opening or confirm an approved design solution with the code reviewer."
    : isMainlandChinaProfile
      ? passed
        ? "No width action is indicated by this configured comparison; retain the verified clear-opening evidence."
        : `Increase the verified clear opening to at least ${formatNumber(minimum)} mm, or confirm an approved design solution with a qualified code reviewer.`
      : passed
        ? "No width action is required under this demo rule; retain the source measurement."
        : "Coordinate a wider clear opening or confirm an approved exception with the reviewer.";
  const modelEvidence: ModelEvidence = {
    applicability_signal: signal,
    observations,
  };
  const parameters: Record<string, JsonValue> = {
    operator: ">=",
    minimum: minimum,
    unit: "mm",
    observed_clear_width_mm: widthMm,
    source_policy: "explicit_clear_width_only",
  };
  if (isTableBased && selectedRow && occupantCapacity !== null) {
    parameters.occupant_capacity = occupantCapacity;
    parameters.selected_range = {
      min: selectedRow.min_occupants,
      max: selectedRow.max_occupants,
    };
    parameters.measurement_definition =
      "least clear width between vertical door-frame members";
  }
  return {
    finding_id: await findingId(
      config.id,
      door.entity.global_id,
      "clear-width",
    ),
    rule_id: config.id,
    rule_title: config.title,
    category: config.category,
    status: passed ? "PASS" : "FAIL",
    severity: passed ? "INFO" : "ERROR",
    entity: door.entity,
    applicability: isTableBased
      ? "Confirmed exit door; occupant capacity selects the applicable Table B2 row."
      : "Confirmed exit door via explicit model property.",
    message,
    recommendation,
    model_evidence: modelEvidence,
    rule_evidence: ruleEvidence({
      pack,
      ruleId: config.id,
      title: config.title,
      version: config.version,
      parameters: ruleParameters(pack, parameters, isTableBased),
    }),
    explanation: null,
  };
}

export async function evaluateEgress001(
  model: ExtractedModel,
  pack: RulePack,
): Promise<Finding[]> {
  if (!pack.egress.enabled) return [];
  const findings = await Promise.all(
    model.doors.map((door) => evaluateDoor(door, pack)),
  );
  return findings.filter((finding): finding is Finding => finding !== null);
}
