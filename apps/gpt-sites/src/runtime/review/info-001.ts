import type { RulePack } from "@/src/contracts/rule-pack";
import type { Finding, Observation } from "@/src/contracts/review";
import {
  factIsMissing,
  type DoorFacts,
  type ExtractedModel,
  type Fact,
} from "@/src/runtime/ifc/extractor";
import {
  explicitBool,
  findingId,
  observationFromFact,
  ruleEvidence,
} from "./common";

function applicabilityObservation(door: DoorFacts): Observation {
  return observationFromFact({
    label: "Exit classification",
    fact: door.fireExit,
    normalizedValue: explicitBool(door.fireExit.value),
  });
}

function missingFact(sourcePath: string): Fact {
  return {
    value: null,
    sourcePath,
    reliability: "MISSING",
    note: null,
  };
}

function factForRequirement(
  door: DoorFacts,
  field: "name" | "fire_rating" | "fire_exit" | "clear_width" | "occupant_capacity",
  sourcePath: string,
): Fact {
  if (field === "name") return door.name;
  if (field === "fire_rating") return door.fireRating;
  if (field === "fire_exit") return door.fireExit;
  if (field === "occupant_capacity") return door.occupantCapacity;
  return door.explicitWidths[0] ?? missingFact(sourcePath);
}

function numericFactValue(fact: Fact): number | null {
  if (typeof fact.value === "number") {
    return Number.isFinite(fact.value) ? fact.value : null;
  }
  if (typeof fact.value === "string" && fact.value.trim()) {
    const value = Number(fact.value);
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

function factIsUsable(fact: Fact, field: string): boolean {
  if (factIsMissing(fact)) return false;
  if (field === "fire_exit") return explicitBool(fact.value) !== null;
  if (field === "name" || field === "fire_rating") {
    return typeof fact.value === "string" && fact.value.trim().length > 0;
  }
  if (field === "clear_width" || field === "occupant_capacity") {
    const value = numericFactValue(fact);
    return value !== null && value > 0 &&
      (field !== "occupant_capacity" || Number.isInteger(value));
  }
  return true;
}

function normalizedFactValue(fact: Fact, field: string): number | string | boolean | null {
  if (field === "fire_exit") return explicitBool(fact.value);
  if (field === "clear_width" || field === "occupant_capacity") {
    const value = numericFactValue(fact);
    return value === null ? null : value;
  }
  return factIsMissing(fact) ? null : String(fact.value).trim();
}

export async function evaluateInfo001(
  model: ExtractedModel,
  pack: RulePack,
): Promise<Finding[]> {
  const config = pack.info;
  if (!config.enabled) return [];

  const findings: Finding[] = [];
  for (const door of model.doors) {
    for (const requirement of config.requirements) {
      let applicabilitySignal: Observation | null = null;
      let applicability: string;
      if (requirement.applicability === "confirmed_exit_doors") {
        if (explicitBool(door.fireExit.value) !== true) continue;
        applicability = "Confirmed exit door via explicit model property.";
        applicabilitySignal = applicabilityObservation(door);
      } else {
        applicability = requirement.field === "fire_exit"
          ? "Applies to every IfcDoor so the review can establish whether exit rules apply."
          : pack.id === "hku-demo-2026"
            ? "Applies to every IfcDoor in the demo project rule pack."
            : "Applies to every IfcDoor in the information-readiness profile.";
      }

      const fact = factForRequirement(
        door,
        requirement.field,
        requirement.source_path,
      );
      const present = factIsUsable(fact, requirement.field);
      const entityName = door.entity.name ?? "Unnamed door";
      const explicitExit = explicitBool(fact.value);
      let message: string;
      let recommendation: string;
      if (present && requirement.field === "fire_exit") {
        message = explicitExit
          ? `${entityName} is explicitly classified as an exit door.`
          : `${entityName} is explicitly classified as a non-exit door.`;
        recommendation = "No action is required for this classification field.";
      } else if (present) {
        message = `${requirement.label} is present for ${entityName}.`;
        recommendation = "No action is required for this configured information field.";
      } else if (requirement.field === "fire_exit") {
        message = `${entityName} has no explicit exit classification.`;
        recommendation =
          "Set Pset_DoorCommon.FireExit to TRUE or FALSE from the documented design intent; do not infer it from the element name.";
      } else if (requirement.field === "fire_rating") {
        message = `${entityName} is a confirmed exit door but has no usable FireRating evidence.`;
        recommendation =
          "Confirm the applicable fire-resistance classification and populate Pset_DoorCommon.FireRating; do not infer it from the element name.";
      } else {
        message = `${requirement.label} is missing or invalid for ${entityName}.`;
        recommendation = `Confirm the intended value and populate ${requirement.source_path}; do not infer it from the element name.`;
      }

      findings.push({
        finding_id: await findingId(
          config.id,
          door.entity.global_id,
          requirement.key,
        ),
        rule_id: config.id,
        rule_title: config.title,
        category: config.category,
        status: present ? "PASS" : "REVIEW",
        severity: present ? "INFO" : "WARNING",
        entity: door.entity,
        applicability,
        message,
        recommendation,
        model_evidence: {
          applicability_signal: applicabilitySignal,
          observations: [
            observationFromFact({
              label: requirement.label,
              fact,
              normalizedValue: normalizedFactValue(fact, requirement.field),
            }),
          ],
        },
        rule_evidence: ruleEvidence({
          pack,
          ruleId: config.id,
          title: config.title,
          version: config.version,
          parameters: {
            requirement_key: requirement.key,
            required_field: requirement.source_path,
            applicability: requirement.applicability,
            missing_outcome: requirement.missing_status,
          },
        }),
        explanation: null,
      });
    }
  }
  return findings;
}
