import type {
  AgentDefinition,
  AgentReviewResult,
} from "../../contracts/agent";
import type { ValidatedUpload } from "../upload/validation";
import { runAgent } from "./kernel";
import {
  DEFAULT_AGENT_OBJECTIVE,
  ScriptedBimProvider,
} from "./provider";
import { buildBimToolRegistry, type BimReviewToolContext } from "./tools";
import {
  DEFAULT_REVIEW_PROFILE_ID,
  type ReviewProfileId,
} from "../review/rule-pack";

export const SITE_BIM_CONNECTOR_ID = "site-bim-runtime";

export const BIM_REVIEW_MANAGER: AgentDefinition = {
  agent_id: "bim-review-manager",
  name: "BIM Review Manager",
  version: "1.1.0",
  instructions:
    "Inspect model evidence first. Use only exposed Site-resident tools. Treat schema-valid tool observations as the source of model facts and deterministic verdicts. Never invent or edit PASS, FAIL, REVIEW, rule thresholds, source properties, or authority labels.",
  allowed_tools: [
    "inspect_ifc_model",
    "run_deterministic_review",
    "critique_review_evidence",
  ],
  allowed_specialists: [],
  max_steps: 5,
  max_tool_calls: 3,
  max_delegations: 0,
  max_parallel_children: 1,
};

export async function runBimReviewAgent(
  upload: ValidatedUpload,
  objective = DEFAULT_AGENT_OBJECTIVE,
  profileId: ReviewProfileId = DEFAULT_REVIEW_PROFILE_ID,
): Promise<AgentReviewResult> {
  const context: BimReviewToolContext = {
    upload,
    profile_id: profileId,
    extracted_model: null,
    review_run: null,
  };
  const agentRun = await runAgent({
    definition: BIM_REVIEW_MANAGER,
    objective,
    provider: new ScriptedBimProvider(),
    registry: buildBimToolRegistry(),
    tool_context: context,
    connector_ids: [SITE_BIM_CONNECTOR_ID],
  });
  return { agent_run: agentRun, review_run: context.review_run };
}
