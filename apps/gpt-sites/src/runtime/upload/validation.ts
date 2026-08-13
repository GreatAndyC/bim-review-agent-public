import { publicErrorResponse } from "../http/responses";
import { MAX_UPLOAD_BYTES } from "@/src/contracts/upload";

export { MAX_UPLOAD_BYTES } from "@/src/contracts/upload";

const IFC_EXTENSION = ".ifc";
const STEP_MAGIC = "ISO-10303-21;";

export const MAX_MULTIPART_OVERHEAD_BYTES = 1024 * 1024;
export const MAX_MULTIPART_REQUEST_BYTES =
  MAX_UPLOAD_BYTES + MAX_MULTIPART_OVERHEAD_BYTES;

export type ValidatedUpload = {
  safeFilename: string;
  bytes: Uint8Array;
  sha256: string;
};

export class UploadValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly recovery: string,
  ) {
    super(message);
    this.name = "UploadValidationError";
  }
}

function safeFilename(filename: string): string {
  const basename = filename.split(/[\\/]/).at(-1)?.trim() || "model.ifc";
  const withoutControls = Array.from(basename)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("");
  return withoutControls.slice(0, 180) || "model.ifc";
}

function trimStepPrefix(value: string): string {
  let start = 0;
  while (start < value.length) {
    const code = value.charCodeAt(start);
    if (![0, 9, 10, 13, 32, 0xfeff].includes(code)) break;
    start += 1;
  }
  return value.slice(start);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function validateIfcUpload(
  filename: string,
  bytes: Uint8Array,
): Promise<ValidatedUpload> {
  const normalizedName = safeFilename(filename);

  if (!normalizedName.toLocaleLowerCase("en-US").endsWith(IFC_EXTENSION)) {
    throw new UploadValidationError(
      "unsupported_file_type",
      "Only IFC STEP files with the .ifc extension are accepted.",
      400,
      "Choose an IFC STEP export or use a bundled sample.",
    );
  }
  if (bytes.byteLength === 0) {
    throw new UploadValidationError(
      "empty_file",
      "The selected IFC file is empty.",
      422,
      "Choose a non-empty IFC export and try again.",
    );
  }
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new UploadValidationError(
      "file_too_large",
      "The selected file exceeds the 50 MiB review limit.",
      413,
      "Export a smaller coordination model or remove non-essential geometry.",
    );
  }

  const header = trimStepPrefix(
    new TextDecoder("latin1").decode(bytes.subarray(0, 4096)),
  );
  if (!header.startsWith(STEP_MAGIC) || !header.includes("FILE_SCHEMA")) {
    throw new UploadValidationError(
      "invalid_step_header",
      "The file does not contain the expected IFC STEP header and schema declaration.",
      422,
      "Re-export the model as an IFC STEP file instead of renaming another file.",
    );
  }

  return {
    safeFilename: normalizedName,
    bytes,
    sha256: await sha256Hex(bytes),
  };
}

export async function uploadRequestFromMultipart(request: Request): Promise<{
  upload: ValidatedUpload;
  formData: FormData;
}> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_MULTIPART_REQUEST_BYTES
  ) {
    throw new UploadValidationError(
      "request_too_large",
      "The multipart request exceeds the bounded upload limit.",
      413,
      "Choose an IFC file no larger than 50 MiB.",
    );
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLocaleLowerCase("en-US").startsWith("multipart/form-data")) {
    throw new UploadValidationError(
      "invalid_request_type",
      "IFC uploads must use multipart/form-data.",
      415,
      "Submit exactly one IFC file using the file field.",
    );
  }

  let formData: FormData;
  try {
    if (!request.body) throw new Error("Missing multipart request body.");
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_MULTIPART_REQUEST_BYTES) {
        await reader.cancel("Multipart request exceeds the bounded limit.");
        throw new UploadValidationError(
          "request_too_large",
          "The multipart request exceeds the bounded upload limit.",
          413,
          "Choose an IFC file no larger than 50 MiB.",
        );
      }
      chunks.push(value);
    }
    const boundedBody = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      boundedBody.set(chunk, offset);
      offset += chunk.byteLength;
    }
    formData = await new Response(boundedBody, {
      headers: { "content-type": contentType },
    }).formData();
  } catch (error) {
    if (error instanceof UploadValidationError) throw error;
    throw new UploadValidationError(
      "invalid_multipart",
      "The upload request could not be decoded.",
      400,
      "Submit one IFC file using the file field.",
    );
  }

  const files = formData.getAll("file");
  if (files.length !== 1 || !(files[0] instanceof File)) {
    throw new UploadValidationError(
      files.length > 1 ? "duplicate_file_field" : "missing_file",
      files.length > 1
        ? "Exactly one IFC file may be reviewed at a time."
        : "The upload did not include an IFC file.",
      400,
      "Submit exactly one file using the file field.",
    );
  }

  const file = files[0];
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new UploadValidationError(
      "file_too_large",
      "The selected file exceeds the 50 MiB review limit.",
      413,
      "Choose an IFC file no larger than 50 MiB.",
    );
  }

  return {
    upload: await validateIfcUpload(
      file.name,
      new Uint8Array(await file.arrayBuffer()),
    ),
    formData,
  };
}

export async function uploadFromMultipart(request: Request): Promise<ValidatedUpload> {
  return (await uploadRequestFromMultipart(request)).upload;
}

export function uploadErrorResponse(error: unknown): Response {
  if (error instanceof UploadValidationError) {
    return publicErrorResponse(
      error.code,
      error.message,
      error.recovery,
      error.status,
    );
  }

  return publicErrorResponse(
    "upload_failed",
    "The IFC upload could not be processed safely.",
    "Try the upload again or use a bundled sample.",
    500,
  );
}
