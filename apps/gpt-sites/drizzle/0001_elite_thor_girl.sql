CREATE TABLE `run_documents` (
	`run_id` text NOT NULL,
	`document_kind` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`content` text NOT NULL,
	PRIMARY KEY(`run_id`, `document_kind`, `chunk_index`),
	FOREIGN KEY (`run_id`) REFERENCES `review_runs`(`run_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_run_documents_run_kind` ON `run_documents` (`run_id`,`document_kind`);--> statement-breakpoint
ALTER TABLE `review_runs` ADD `review_run_id` text;--> statement-breakpoint
ALTER TABLE `review_runs` ADD `last_accessed_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_review_runs_review_run_id` ON `review_runs` (`review_run_id`);