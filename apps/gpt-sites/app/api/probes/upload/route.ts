import {
  uploadErrorResponse,
  uploadFromMultipart,
} from "@/src/runtime/upload/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const upload = await uploadFromMultipart(request);
    return Response.json({
      status: "accepted",
      safeFilename: upload.safeFilename,
      sizeBytes: upload.bytes.byteLength,
      sha256: upload.sha256,
      rawBytesRetained: false,
    });
  } catch (error) {
    return uploadErrorResponse(error);
  }
}
