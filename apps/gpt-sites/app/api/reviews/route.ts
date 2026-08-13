import {
  beginAnonymousReview,
  type AnonymousAdmission,
} from "@/src/runtime/admission";
import { reviewErrorResponse } from "@/src/runtime/review/http";
import {
  requestedReviewProfile,
  reviewValidatedUpload,
} from "@/src/runtime/review/reviewer";
import { uploadFromMultipart } from "@/src/runtime/upload/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let admission: AnonymousAdmission | undefined;
  try {
    admission = await beginAnonymousReview(request, "upload");
    const upload = await uploadFromMultipart(request);
    const profileId = requestedReviewProfile(
      new URL(request.url).searchParams.get("profile_id"),
    );
    return Response.json(await reviewValidatedUpload(upload, undefined, profileId), {
      status: 201,
    });
  } catch (error) {
    return reviewErrorResponse(error);
  } finally {
    await admission?.release();
  }
}
