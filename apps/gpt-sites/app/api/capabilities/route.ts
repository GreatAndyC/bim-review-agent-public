import { BIM_REVIEW_MANAGER, SITE_BIM_CONNECTOR_ID } from "@/src/runtime/agent/bim-review";
import { ScriptedBimProvider } from "@/src/runtime/agent/provider";
import { bimToolCatalogue } from "@/src/runtime/agent/tools";
import { parserHealth } from "@/src/runtime/ifc/web-ifc";
import { MAX_UPLOAD_BYTES } from "@/src/runtime/upload/validation";
import {
  ANONYMOUS_SAMPLE_LIMIT,
  ANONYMOUS_UPLOAD_LIMIT,
  realUploadsEnabled,
} from "@/src/runtime/admission";

export const dynamic = "force-dynamic";

export async function GET() {
  const parser = await parserHealth();
  const provider = new ScriptedBimProvider();
  const healthy = parser.status === "available";
  return Response.json(
    {
      profile: {
        id: "gpt-sites-hosted-ifc",
        detection: "deployment-health",
        local_hardware_discovery: false,
        local_hardware_reason: "Deferred from the hosted MVP profile.",
      },
      agent: {
        id: BIM_REVIEW_MANAGER.agent_id,
        version: BIM_REVIEW_MANAGER.version,
        state: healthy ? "available" : "degraded",
        budgets: {
          max_steps: BIM_REVIEW_MANAGER.max_steps,
          max_tool_calls: BIM_REVIEW_MANAGER.max_tool_calls,
          max_delegations: BIM_REVIEW_MANAGER.max_delegations,
        },
      },
      providers: [
        {
          id: provider.provider_id,
          model_id: provider.model_id,
          state: "available",
          external_inference: false,
          credential_required: false,
        },
      ],
      connectors: [
        {
          id: SITE_BIM_CONNECTOR_ID,
          state: healthy ? "available" : "degraded",
          transport: "in-process",
          external_endpoint: false,
        },
      ],
      tools: bimToolCatalogue().map((tool) => ({
        ...tool,
        state: healthy ? "available" : "degraded",
      })),
      limits: {
        accepted_format: "IFC STEP",
        max_upload_bytes: MAX_UPLOAD_BYTES,
        real_uploads_enabled: realUploadsEnabled(),
        anonymous_window_seconds: null,
        anonymous_sample_limit: ANONYMOUS_SAMPLE_LIMIT,
        anonymous_sample_limit_policy: "no_session_count_limit",
        anonymous_upload_limit: ANONYMOUS_UPLOAD_LIMIT,
        anonymous_upload_limit_policy: "no_session_count_limit",
        active_reviews_per_session: 1,
        raw_ifc_in_provider_payload: false,
      },
    },
    { status: healthy ? 200 : 503 },
  );
}
