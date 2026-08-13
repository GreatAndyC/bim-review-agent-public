import catalogueJson from "../../../../../src/bim_review_agent/assets/samples/catalog.json" with {
  type: "json",
};
import cleanIfc from "../../../../../src/bim_review_agent/assets/samples/clean.ifc?raw";
import missingInformationIfc from "../../../../../src/bim_review_agent/assets/samples/missing_information.ifc?raw";
import mixedReviewIfc from "../../../../../src/bim_review_agent/assets/samples/mixed_review.ifc?raw";
import narrowExitIfc from "../../../../../src/bim_review_agent/assets/samples/narrow_exit.ifc?raw";
import proxyWidthIfc from "../../../../../src/bim_review_agent/assets/samples/proxy_width.ifc?raw";
import { validateIfcUpload } from "@/src/runtime/upload/validation";

export type SampleId =
  | "clean"
  | "missing_information"
  | "mixed_review"
  | "narrow_exit"
  | "proxy_width";

export type SampleSummary = {
  id: SampleId;
  filename: string;
  title: string;
  description: string;
  expected: string;
};

const SOURCES: Record<SampleId, string> = {
  clean: cleanIfc,
  missing_information: missingInformationIfc,
  mixed_review: mixedReviewIfc,
  narrow_exit: narrowExitIfc,
  proxy_width: proxyWidthIfc,
};

function validateCatalogue(value: unknown): SampleSummary[] {
  if (!Array.isArray(value) || value.length !== Object.keys(SOURCES).length) {
    throw new Error("The bundled IFC sample catalogue failed its v1 contract.");
  }
  const samples = value as SampleSummary[];
  for (const sample of samples) {
    if (
      !(sample.id in SOURCES) ||
      !sample.filename.endsWith(".ifc") ||
      !sample.title ||
      !sample.description ||
      !sample.expected
    ) {
      throw new Error("The bundled IFC sample catalogue contains an invalid entry.");
    }
  }
  return samples;
}

const CATALOGUE = validateCatalogue(catalogueJson);

export function listSamples(): SampleSummary[] {
  return CATALOGUE.map((sample) => ({ ...sample }));
}

export async function loadSampleUpload(sampleId: string) {
  const sample = CATALOGUE.find((item) => item.id === sampleId);
  if (!sample) return null;
  const bytes = new TextEncoder().encode(SOURCES[sample.id]);
  return {
    sample,
    upload: await validateIfcUpload(sample.filename, bytes),
  };
}
