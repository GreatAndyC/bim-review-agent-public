import {
  privateJson,
  runAccessToken,
  runStoreErrorResponse,
} from "@/src/runtime/store/http";
import { readStoredRunByReviewId } from "@/src/runtime/store/runs";
import {
  buildQuickCheckReport,
  quickCheckJson,
  quickCheckMarkdown,
} from "@/src/runtime/report/quick-check";
import type { QuickCheckLocale } from "@/src/contracts/quick-check";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ runId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const params = await context.params;
    const quickCheckJsonDownload = params.runId.endsWith(".quick-check.json");
    const quickCheckMarkdownDownload = params.runId.endsWith(".quick-check.md");
    const canonicalJsonDownload = !quickCheckJsonDownload && !quickCheckMarkdownDownload && params.runId.endsWith(".json");
    const download = quickCheckJsonDownload || quickCheckMarkdownDownload || canonicalJsonDownload;
    const suffixLength = quickCheckJsonDownload
      ? ".quick-check.json".length
      : quickCheckMarkdownDownload
        ? ".quick-check.md".length
        : canonicalJsonDownload
          ? ".json".length
          : 0;
    const reviewRunId = suffixLength ? params.runId.slice(0, -suffixLength) : params.runId;
    if (!reviewRunId) throw new Error("Missing ReviewRun ID.");
    const stored = await readStoredRunByReviewId(
      reviewRunId,
      runAccessToken(request),
    );
    if (!stored.review_run) throw new Error("Canonical ReviewRun is missing.");
    if (!download) return privateJson(stored.review_run);
    if (quickCheckJsonDownload || quickCheckMarkdownDownload) {
      const requestedLocale = new URL(request.url).searchParams.get("locale");
      const locale: QuickCheckLocale = requestedLocale === "zh-CN" || requestedLocale === "zh-Hant" ? requestedLocale : "en";
      const report = buildQuickCheckReport(stored.review_run, locale);
      const body = quickCheckJsonDownload ? quickCheckJson(report) : quickCheckMarkdown(report);
      const extension = quickCheckJsonDownload ? "json" : "md";
      return new Response(body, {
        status: 200,
        headers: {
          "content-type": quickCheckJsonDownload ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8",
          "content-disposition": `attachment; filename="quick-check-${reviewRunId}.${extension}"`,
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }
    return new Response(JSON.stringify(stored.review_run, null, 2), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="review-${reviewRunId}.json"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return runStoreErrorResponse(error);
  }
}
