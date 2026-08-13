import { runBimReviewAgent } from "@/src/runtime/agent/bim-review";
import {
  beginAnonymousReview,
  type AnonymousAdmission,
} from "@/src/runtime/admission";
import {
  agentErrorResponse,
  sampleAgentObjective,
} from "@/src/runtime/agent/http";
import { publicErrorResponse } from "@/src/runtime/http/responses";
import { loadSampleUpload } from "@/src/runtime/samples/catalog";
import { privateJson } from "@/src/runtime/store/http";
import { storeAgentReviewResult } from "@/src/runtime/store/runs";
import {
  DEFAULT_REVIEW_PROFILE_ID,
  requestedReviewProfile,
} from "@/src/runtime/review/reviewer";

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
    const objective = await sampleAgentObjective(request);
    const profileId = requestedReviewProfile(
      new URL(request.url).searchParams.get("profile_id") ??
        DEFAULT_REVIEW_PROFILE_ID,
    );
    const result = await runBimReviewAgent(loaded.upload, objective, profileId);
    return privateJson(
      await storeAgentReviewResult(result, loaded.upload),
      201,
    );
  } catch (error) {
    return agentErrorResponse(error);
  } finally {
    await admission?.release();
  }
}
