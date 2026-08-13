import type { AgentReviewResult } from "./agent";

export type AnonymousRunAccess = {
  agent_run_id: string;
  review_run_id: string | null;
  access_token: string;
  created_at: string;
  expires_at: string;
  retrieval: {
    agent: string;
    review: string | null;
    review_json: string | null;
    quick_check_json: string | null;
    quick_check_markdown: string | null;
    delete: string;
  };
};

export type StoredAgentReviewResult = AgentReviewResult & {
  access: AnonymousRunAccess;
};
