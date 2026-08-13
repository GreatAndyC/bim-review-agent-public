import type { QuickCheckLocale, QuickCheckReport } from "./quick-check";

export type BatchReviewItemStatus =
  | "QUEUED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "SKIPPED";

export type BatchReviewFailure = {
  filename: string;
  code: string;
  message: string;
  status?: "FAILED" | "SKIPPED";
};

export type BatchQuickCheckReport = {
  format: "bim-review-batch-quick-check/v1";
  locale: QuickCheckLocale;
  generated_at: string;
  summary: {
    total_files: number;
    completed_files: number;
    failed_files: number;
    skipped_files: number;
    total_findings: number;
    pass: number;
    fail: number;
    review: number;
    actionable: number;
  };
  results: QuickCheckReport[];
  failures: BatchReviewFailure[];
};
