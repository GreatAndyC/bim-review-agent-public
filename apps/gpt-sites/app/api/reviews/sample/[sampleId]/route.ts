import {
  beginAnonymousReview,
  type AnonymousAdmission,
} from "@/src/runtime/admission";
import { publicErrorResponse } from "@/src/runtime/http/responses";
import { reviewErrorResponse } from "@/src/runtime/review/http";
import {
  requestedReviewProfile,
  reviewValidatedUpload,
} from "@/src/runtime/review/reviewer";
import { loadSampleUpload } from "@/src/runtime/samples/catalog";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ sampleId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { sampleId } = await context.params;
  const loaded = await loadSampleUpload(sampleId);
  if (!loaded) {
    return publicErrorResponse(
      "sample_not_found",
      "The requested synthetic IFC sample does not exist.",
      "Choose one of the sample IDs returned by /api/samples.",
      404,
    );
  }

  let admission: AnonymousAdmission | undefined;
  try {
    admission = await beginAnonymousReview(request, "sample");
    const profileId = requestedReviewProfile(
      new URL(request.url).searchParams.get("profile_id"),
    );
    return Response.json(await reviewValidatedUpload(loaded.upload, undefined, profileId), {
      status: 201,
    });
  } catch (error) {
    return reviewErrorResponse(error);
  } finally {
    await admission?.release();
  }
}
