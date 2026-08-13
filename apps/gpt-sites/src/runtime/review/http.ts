import {
  uploadErrorResponse,
  UploadValidationError,
} from "@/src/runtime/upload/validation";
import {
  AdmissionError,
  admissionErrorResponse,
} from "../admission";
import { publicErrorResponse } from "../http/responses";
import { ReviewProfileError } from "./reviewer";

export function reviewErrorResponse(error: unknown): Response {
  if (error instanceof AdmissionError) return admissionErrorResponse(error);
  if (error instanceof UploadValidationError) return uploadErrorResponse(error);
  if (error instanceof ReviewProfileError) {
    return publicErrorResponse(
      "unsupported_review_profile",
      `The review profile ${error.profileId} is not available in this runtime.`,
      "Choose the Hong Kong source profile or the bundled demo profile.",
      422,
    );
  }
  return publicErrorResponse(
    "invalid_ifc",
    "The Site-native IFC review runtime could not read this model.",
    "Re-export as IFC2X3 or IFC4, or use a bundled sample.",
    422,
  );
}
