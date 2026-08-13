import { probeIfc } from "@/src/runtime/ifc/web-ifc";
import {
  uploadErrorResponse,
  uploadFromMultipart,
} from "@/src/runtime/upload/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const upload = await uploadFromMultipart(request);
    const inventory = await probeIfc(upload.bytes);
    return Response.json({
      status: "parsed",
      source: {
        safeFilename: upload.safeFilename,
        sizeBytes: upload.bytes.byteLength,
        sha256: upload.sha256,
      },
      inventory,
      rawBytesRetained: false,
    });
  } catch (error) {
    if (error instanceof Error && error.name !== "UploadValidationError") {
      return Response.json(
        {
          detail: {
            code: "invalid_ifc",
            message: "The Site-compatible IFC parser could not read this model.",
            recovery: "Re-export as IFC2X3 or IFC4, or use a bundled sample.",
          },
        },
        { status: 422 },
      );
    }
    return uploadErrorResponse(error);
  }
}
