import {
  privateJson,
  runAccessToken,
  runStoreErrorResponse,
} from "@/src/runtime/store/http";
import { deleteStoredRun } from "@/src/runtime/store/runs";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ runId: string }>;
};

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { runId } = await context.params;
    const deleted = await deleteStoredRun(runId, runAccessToken(request));
    return privateJson({ deleted: true, ...deleted });
  } catch (error) {
    return runStoreErrorResponse(error);
  }
}
