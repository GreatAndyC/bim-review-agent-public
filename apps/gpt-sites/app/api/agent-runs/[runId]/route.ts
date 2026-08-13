import {
  privateJson,
  runAccessToken,
  runStoreErrorResponse,
} from "@/src/runtime/store/http";
import { readStoredRunByAgentId } from "@/src/runtime/store/runs";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ runId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { runId } = await context.params;
    const stored = await readStoredRunByAgentId(
      runId,
      runAccessToken(request),
    );
    return privateJson({
      agent_run: stored.agent_run,
      review_run_id: stored.review_run?.run_id ?? null,
      created_at: stored.created_at,
      expires_at: stored.expires_at,
    });
  } catch (error) {
    return runStoreErrorResponse(error);
  }
}
