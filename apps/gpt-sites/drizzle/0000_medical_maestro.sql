CREATE TABLE `review_runs` (
	`run_id` text PRIMARY KEY NOT NULL,
	`access_token_hash` text NOT NULL,
	`state` text NOT NULL,
	`safe_filename` text,
	`source_sha256` text,
	`size_bytes` integer,
	`schema_name` text,
	`rule_pack_id` text,
	`rule_pack_version` text,
	`review_json` text,
	`agent_json` text,
	`error_code` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_review_runs_expires_at` ON `review_runs` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_review_runs_state_expires_at` ON `review_runs` (`state`,`expires_at`);