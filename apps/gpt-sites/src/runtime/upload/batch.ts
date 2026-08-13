import type { BatchReviewFailure } from "@/src/contracts/batch";
import { MAX_UPLOAD_BYTES } from "@/src/contracts/upload";

export type UploadCandidate = {
  name: string;
  size: number;
};

export type ClassifiedUpload<T extends UploadCandidate> = {
  file: T;
  skipped: BatchReviewFailure | null;
};

/** Classify each selected file independently so one oversized file cannot block a batch. */
export function classifyBatchUploads<T extends UploadCandidate>(
  files: readonly T[],
  skippedMessage: string,
): ClassifiedUpload<T>[] {
  return files.map((file) => ({
    file,
    skipped:
      file.size > MAX_UPLOAD_BYTES
        ? {
            filename: file.name,
            code: "file_too_large",
            message: skippedMessage,
            status: "SKIPPED" as const,
          }
        : null,
  }));
}
