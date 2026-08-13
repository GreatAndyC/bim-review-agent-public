import { parserHealth } from "@/src/runtime/ifc/web-ifc";
import { MAX_UPLOAD_BYTES } from "@/src/runtime/upload/validation";
import {
  ANONYMOUS_LEASE_SECONDS,
  ANONYMOUS_SAMPLE_LIMIT,
  ANONYMOUS_UPLOAD_LIMIT,
  realUploadsEnabled,
} from "@/src/runtime/admission";

export const dynamic = "force-dynamic";

export async function GET() {
  const parser = await parserHealth();
  const healthy = parser.status === "available";

  return Response.json(
    {
      status: healthy ? "ok" : "degraded",
      runtime: "chatgpt-sites-worker-esm",
      build: {
        appVersion: "0.3.0-agent-runtime",
        contractVersion: "runtime-health/v1",
      },
      parser,
      upload: {
        enabled: realUploadsEnabled(),
        maxBytes: MAX_UPLOAD_BYTES,
        acceptedFormat: "IFC STEP",
      },
      admission: {
        anonymousSessionHeader: "X-BIM-Review-Session",
        windowSeconds: null,
        sampleLimit: ANONYMOUS_SAMPLE_LIMIT,
        sampleLimitPolicy: "no_session_count_limit",
        uploadLimit: ANONYMOUS_UPLOAD_LIMIT,
        uploadLimitPolicy: "no_session_count_limit",
        activeReviewsPerSession: 1,
        staleLeaseSeconds: ANONYMOUS_LEASE_SECONDS,
      },
      storage: {
        d1: "configured",
        r2: "not-required-memory-first",
        rawIfc: "request-memory-only",
        derivedRunRetentionHours: 24,
        access: "opaque-token",
      },
      externalBimBackend: false,
      externalInferenceRequired: false,
      agentRuntime: {
        enabled: true,
        provider: "scripted",
        typedActionLoop: true,
        canonicalReviewLink: true,
        localHardwareDiscovery: false,
      },
    },
    { status: healthy ? 200 : 503 },
  );
}
