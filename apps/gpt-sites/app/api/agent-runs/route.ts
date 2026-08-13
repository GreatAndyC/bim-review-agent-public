import { runBimReviewAgent } from "@/src/runtime/agent/bim-review";
import {
  beginAnonymousReview,
  type AnonymousAdmission,
} from "@/src/runtime/admission";
import {
  agentErrorResponse,
  agentUploadRequest,
} from "@/src/runtime/agent/http";
import { privateJson } from "@/src/runtime/store/http";
import { storeAgentReviewResult } from "@/src/runtime/store/runs";
import {
  DEFAULT_REVIEW_PROFILE_ID,
  requestedReviewProfile,
} from "@/src/runtime/review/reviewer";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let admission: AnonymousAdmission | undefined;
  try {
    admission = await beginAnonymousReview(request, "upload");
    const { upload, objective } = await agentUploadRequest(request);
    const profileId = requestedReviewProfile(
      new URL(request.url).searchParams.get("profile_id") ??
        DEFAULT_REVIEW_PROFILE_ID,
    );
    const result = await runBimReviewAgent(upload, objective, profileId);
    return privateJson(await storeAgentReviewResult(result, upload), 201);
  } catch (error) {
    return agentErrorResponse(error);
  } finally {
    await admission?.release();
  }
}
