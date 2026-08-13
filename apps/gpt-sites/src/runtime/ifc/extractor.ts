import {
  IFCBEAM,
  IFCBUILDING,
  IFCBUILDINGSTOREY,
  IFCCONVERSIONBASEDUNIT,
  IFCCONVERSIONBASEDUNITWITHOFFSET,
  IFCDOOR,
  IFCMEASUREWITHUNIT,
  IFCPROJECT,
  IFCPROPERTYSET,
  IFCRELDEFINESBYPROPERTIES,
  IFCRELDEFINESBYTYPE,
  IFCRELCONTAINEDINSPATIALSTRUCTURE,
  IFCSITE,
  IFCSIUNIT,
  IFCSLAB,
  IFCSPACE,
  IFCUNITASSIGNMENT,
  IFCWALL,
  type IfcAPI,
} from "web-ifc";
import type {
  EntityRef,
  JsonValue,
  ModelInventory,
  Reliability,
} from "@/src/contracts/review";
import { withIfcModel } from "./web-ifc";

export type Fact = {
  value: JsonValue;
  sourcePath: string;
  reliability: Reliability;
  note: string | null;
};

export type DoorFacts = {
  entity: EntityRef;
  name: Fact;
  fireExit: Fact;
  fireRating: Fact;
  occupantCapacity: Fact;
  explicitWidths: Fact[];
  overallWidth: Fact;
  nameExitCandidate: boolean;
  lengthToMetreScale: number;
  lengthUnit: string;
  lengthUnitKnown: boolean;
};

export type ExtractedModel = {
  inventory: ModelInventory;
  doors: DoorFacts[];
};

type UnknownRecord = Record<string, unknown>;
type PropertyFact = {
  psetName: string;
  propertyName: string;
  value: JsonValue;
};
type UnitInfo = {
  symbol: string;
  scale: number;
  known: boolean;
};

const EXIT_PATTERN = /\b(exit|emergency|egress)\b/i;
const MISSING = (sourcePath: string): Fact => ({
  value: null,
  sourcePath,
  reliability: "MISSING",
  note: null,
});

const COUNTED_CLASSES = [
  ["IfcProject", IFCPROJECT],
  ["IfcSite", IFCSITE],
  ["IfcBuilding", IFCBUILDING],
  ["IfcBuildingStorey", IFCBUILDINGSTOREY],
  ["IfcSpace", IFCSPACE],
  ["IfcDoor", IFCDOOR],
  ["IfcWall", IFCWALL],
  ["IfcSlab", IFCSLAB],
  ["IfcBeam", IFCBEAM],
] as const;

const SI_PREFIXES: Record<string, { scale: number; symbol: string }> = {
  EXA: { scale: 1e18, symbol: "E" },
  PETA: { scale: 1e15, symbol: "P" },
  TERA: { scale: 1e12, symbol: "T" },
  GIGA: { scale: 1e9, symbol: "G" },
  MEGA: { scale: 1e6, symbol: "M" },
  KILO: { scale: 1e3, symbol: "k" },
  HECTO: { scale: 1e2, symbol: "h" },
  DECA: { scale: 1e1, symbol: "da" },
  DECI: { scale: 1e-1, symbol: "d" },
  CENTI: { scale: 1e-2, symbol: "c" },
  MILLI: { scale: 1e-3, symbol: "m" },
  MICRO: { scale: 1e-6, symbol: "µ" },
  NANO: { scale: 1e-9, symbol: "n" },
  PICO: { scale: 1e-12, symbol: "p" },
  FEMTO: { scale: 1e-15, symbol: "f" },
  ATTO: { scale: 1e-18, symbol: "a" },
};

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function jsonPrimitive(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function unwrap(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return jsonPrimitive(value);
  }
  const wrapped = record(value);
  if (!wrapped) return null;
  if ("_representationValue" in wrapped) {
    return jsonPrimitive(wrapped._representationValue);
  }
  if ("value" in wrapped) return jsonPrimitive(wrapped.value);
  return null;
}

function stringValue(value: unknown): string | null {
  const unwrapped = unwrap(value);
  return typeof unwrapped === "string" && unwrapped ? unwrapped : null;
}

function numericValue(value: unknown): number | null {
  const unwrapped = unwrap(value);
  return typeof unwrapped === "number" && Number.isFinite(unwrapped)
    ? unwrapped
    : null;
}

function referenceId(value: unknown): number | null {
  const wrapped = record(value);
  const candidate = wrapped?.value;
  return typeof candidate === "number" && Number.isSafeInteger(candidate)
    ? candidate
    : null;
}

function referenceIds(value: unknown): number[] {
  if (!Array.isArray(value)) {
    const one = referenceId(value);
    return one === null ? [] : [one];
  }
  return value.flatMap((item) => {
    const id = referenceId(item);
    return id === null ? [] : [id];
  });
}

function line(api: IfcAPI, modelId: number, expressId: number): UnknownRecord {
  const value = record(api.GetLine(modelId, expressId));
  if (!value) throw new Error(`IFC line #${expressId} could not be decoded.`);
  return value;
}

function idsForType(
  api: IfcAPI,
  modelId: number,
  type: number,
  includeInherited = true,
): number[] {
  const vector = api.GetLineIDsWithType(modelId, type, includeInherited);
  const values: number[] = [];
  for (let index = 0; index < vector.size(); index += 1) {
    values.push(vector.get(index));
  }
  return values;
}

function directPropertySetIndex(api: IfcAPI, modelId: number): Map<number, number[]> {
  const index = new Map<number, number[]>();
  for (const relationId of idsForType(
    api,
    modelId,
    IFCRELDEFINESBYPROPERTIES,
    false,
  )) {
    const relation = line(api, modelId, relationId);
    const psetId = referenceId(relation.RelatingPropertyDefinition);
    if (psetId === null) continue;
    for (const objectId of referenceIds(relation.RelatedObjects)) {
      index.set(objectId, [...(index.get(objectId) ?? []), psetId]);
    }
  }
  return index;
}

function typePropertySetIndex(api: IfcAPI, modelId: number): Map<number, number[]> {
  const index = new Map<number, number[]>();
  for (const relationId of idsForType(api, modelId, IFCRELDEFINESBYTYPE, false)) {
    const relation = line(api, modelId, relationId);
    const typeId = referenceId(relation.RelatingType);
    if (typeId === null) continue;
    const typeLine = line(api, modelId, typeId);
    const psetIds = referenceIds(typeLine.HasPropertySets);
    for (const objectId of referenceIds(relation.RelatedObjects)) {
      index.set(objectId, psetIds);
    }
  }
  return index;
}

function readPropertySet(
  api: IfcAPI,
  modelId: number,
  psetId: number,
): PropertyFact[] {
  const pset = line(api, modelId, psetId);
  if (pset.type !== IFCPROPERTYSET) return [];
  const psetName = stringValue(pset.Name);
  if (!psetName) return [];

  return referenceIds(pset.HasProperties).flatMap((propertyId) => {
    const property = line(api, modelId, propertyId);
    const propertyName = stringValue(property.Name);
    if (!propertyName || !("NominalValue" in property)) return [];
    return [
      {
        psetName,
        propertyName,
        value: unwrap(property.NominalValue),
      },
    ];
  });
}

function propertiesForDoor(
  api: IfcAPI,
  modelId: number,
  doorId: number,
  directIndex: Map<number, number[]>,
  typeIndex: Map<number, number[]>,
): PropertyFact[] {
  const psetIds = [
    ...(typeIndex.get(doorId) ?? []),
    ...(directIndex.get(doorId) ?? []),
  ];
  return psetIds.flatMap((psetId) => readPropertySet(api, modelId, psetId));
}

function findProperty(
  properties: PropertyFact[],
  paths: ReadonlyArray<readonly [string, string]>,
): PropertyFact | null {
  for (const [psetName, propertyName] of paths) {
    for (let index = properties.length - 1; index >= 0; index -= 1) {
      const item = properties[index];
      if (
        item.psetName.toLocaleLowerCase("en-US") ===
          psetName.toLocaleLowerCase("en-US") &&
        item.propertyName.toLocaleLowerCase("en-US") ===
          propertyName.toLocaleLowerCase("en-US")
      ) {
        return item;
      }
    }
  }
  return null;
}

function factFromProperty(property: PropertyFact | null, missingPath: string): Fact {
  return property
    ? {
        value: property.value,
        sourcePath: `${property.psetName}.${property.propertyName}`,
        reliability: "EXPLICIT",
        note: null,
      }
    : MISSING(missingPath);
}

function spatialContainerIndex(api: IfcAPI, modelId: number): Map<number, string> {
  const index = new Map<number, string>();
  for (const relationId of idsForType(
    api,
    modelId,
    IFCRELCONTAINEDINSPATIALSTRUCTURE,
    false,
  )) {
    const relation = line(api, modelId, relationId);
    const structureId = referenceId(relation.RelatingStructure);
    if (structureId === null) continue;
    const structureName = stringValue(line(api, modelId, structureId).Name);
    if (!structureName) continue;
    for (const elementId of referenceIds(relation.RelatedElements)) {
      index.set(elementId, structureName);
    }
  }
  return index;
}

function siLengthUnit(unit: UnknownRecord): UnitInfo | null {
  if (stringValue(unit.UnitType) !== "LENGTHUNIT") return null;
  if (stringValue(unit.Name) !== "METRE") return null;
  const prefix = stringValue(unit.Prefix);
  const prefixInfo = prefix ? SI_PREFIXES[prefix] : null;
  return {
    symbol: `${prefixInfo?.symbol ?? ""}m`,
    scale: prefixInfo?.scale ?? 1,
    known: true,
  };
}

function conversionLengthUnit(
  api: IfcAPI,
  modelId: number,
  unit: UnknownRecord,
): UnitInfo | null {
  if (stringValue(unit.UnitType) !== "LENGTHUNIT") return null;
  const factorId = referenceId(unit.ConversionFactor);
  if (factorId === null) return null;
  const factor = line(api, modelId, factorId);
  if (factor.type !== IFCMEASUREWITHUNIT) return null;
  const factorValue = numericValue(factor.ValueComponent);
  const baseUnitId = referenceId(factor.UnitComponent);
  if (factorValue === null || factorValue <= 0 || baseUnitId === null) return null;
  const base = lengthUnitFromLine(api, modelId, line(api, modelId, baseUnitId));
  if (!base.known) return null;
  const name = stringValue(unit.Name) ?? "unknown";
  const symbols: Record<string, string> = {
    FOOT: "ft",
    FEET: "ft",
    INCH: "in",
    INCHES: "in",
  };
  return {
    symbol: symbols[name.toLocaleUpperCase("en-US")] ?? name,
    scale: factorValue * base.scale,
    known: true,
  };
}

function lengthUnitFromLine(
  api: IfcAPI,
  modelId: number,
  unit: UnknownRecord,
): UnitInfo {
  if (unit.type === IFCSIUNIT) return siLengthUnit(unit) ?? unknownUnit();
  if (
    unit.type === IFCCONVERSIONBASEDUNIT ||
    unit.type === IFCCONVERSIONBASEDUNITWITHOFFSET
  ) {
    return conversionLengthUnit(api, modelId, unit) ?? unknownUnit();
  }
  return unknownUnit();
}

function unknownUnit(): UnitInfo {
  return { symbol: "unknown", scale: 1, known: false };
}

function projectLengthUnit(api: IfcAPI, modelId: number): UnitInfo {
  const projectId = idsForType(api, modelId, IFCPROJECT, false)[0];
  if (projectId === undefined) return unknownUnit();
  const assignmentId = referenceId(line(api, modelId, projectId).UnitsInContext);
  if (assignmentId === null) return unknownUnit();
  const assignment = line(api, modelId, assignmentId);
  if (assignment.type !== IFCUNITASSIGNMENT) return unknownUnit();
  for (const unitId of referenceIds(assignment.Units)) {
    const result = lengthUnitFromLine(api, modelId, line(api, modelId, unitId));
    if (result.known) return result;
  }
  return unknownUnit();
}

function isMissing(fact: Fact): boolean {
  return (
    fact.value === null ||
    (typeof fact.value === "string" && fact.value.trim().length === 0)
  );
}

function extractDoor(
  api: IfcAPI,
  modelId: number,
  doorId: number,
  directIndex: Map<number, number[]>,
  typeIndex: Map<number, number[]>,
  containers: Map<number, string>,
  unit: UnitInfo,
): DoorFacts {
  const door = line(api, modelId, doorId);
  const nameValue = stringValue(door.Name);
  const objectType = stringValue(door.ObjectType);
  const tag = stringValue(door.Tag);
  const globalId = stringValue(door.GlobalId) ?? `ifc-id-${doorId}`;
  const properties = propertiesForDoor(api, modelId, doorId, directIndex, typeIndex);
  const fireExit = factFromProperty(
    findProperty(properties, [
      ["Pset_DoorCommon", "FireExit"],
      ["Pset_BIMReview", "IsExit"],
    ]),
    "Pset_DoorCommon.FireExit",
  );
  const fireRating = factFromProperty(
    findProperty(properties, [["Pset_DoorCommon", "FireRating"]]),
    "Pset_DoorCommon.FireRating",
  );
  const occupantCapacity = factFromProperty(
    findProperty(properties, [["Pset_BIMReview", "OccupantCapacity"]]),
    "Pset_BIMReview.OccupantCapacity",
  );
  const explicitWidths = [
    ["Pset_BIMReview", "ClearWidth"],
    ["Pset_DoorCommon", "ClearWidth"],
  ].flatMap(([psetName, propertyName]) => {
    const property = findProperty(properties, [[psetName, propertyName]]);
    return property
      ? [
          {
            ...factFromProperty(property, `${psetName}.${propertyName}`),
            note: "Reported clear-opening width in project length units.",
          },
        ]
      : [];
  });

  const overallValue = unwrap(door.OverallWidth);
  const overallWidth: Fact =
    overallValue === null
      ? MISSING("IfcDoor.OverallWidth")
      : {
          value: overallValue,
          sourcePath: "IfcDoor.OverallWidth",
          reliability: "PROXY",
          note: "OverallWidth is a nominal door width and is not silently treated as clear opening.",
        };
  const candidateText = [nameValue, objectType, tag].filter(Boolean).join(" ");
  const name: Fact = nameValue
    ? {
        value: nameValue,
        sourcePath: "IfcDoor.Name",
        reliability: "EXPLICIT",
        note: null,
      }
    : MISSING("IfcDoor.Name");

  return {
    entity: {
      ifc_class: "IfcDoor",
      global_id: globalId,
      name: nameValue,
      object_type: objectType,
      tag,
      storey: containers.get(doorId) ?? null,
    },
    name,
    fireExit,
    fireRating,
    occupantCapacity,
    explicitWidths,
    overallWidth,
    nameExitCandidate: EXIT_PATTERN.test(candidateText),
    lengthToMetreScale: unit.scale,
    lengthUnit: unit.symbol,
    lengthUnitKnown: unit.known,
  };
}

export async function extractModel(bytes: Uint8Array): Promise<ExtractedModel> {
  return withIfcModel(bytes, (api, modelId) => {
    const unit = projectLengthUnit(api, modelId);
    const directIndex = directPropertySetIndex(api, modelId);
    const typeIndex = typePropertySetIndex(api, modelId);
    const containers = spatialContainerIndex(api, modelId);
    const doorIds = idsForType(api, modelId, IFCDOOR, true).sort((a, b) => a - b);
    const entityCounts = Object.fromEntries(
      COUNTED_CLASSES.map(([name, type]) => [
        name,
        idsForType(api, modelId, type, true).length,
      ]),
    );

    return {
      inventory: {
        schema_name: api.GetModelSchema(modelId),
        length_unit: unit.symbol,
        length_unit_known: unit.known,
        length_to_metre_scale: unit.scale,
        total_entities: api.GetAllLines(modelId).size(),
        entity_counts: entityCounts,
      },
      doors: doorIds.map((doorId) =>
        extractDoor(
          api,
          modelId,
          doorId,
          directIndex,
          typeIndex,
          containers,
          unit,
        ),
      ),
    };
  });
}

export function factIsMissing(fact: Fact): boolean {
  return isMissing(fact);
}
