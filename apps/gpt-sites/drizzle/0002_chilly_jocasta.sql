CREATE TABLE `anonymous_rate_windows` (
	`rate_key` text PRIMARY KEY NOT NULL,
	`session_hash` text NOT NULL,
	`request_kind` text NOT NULL,
	`window_started_at` integer NOT NULL,
	`request_count` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_anonymous_rate_windows_updated_at` ON `anonymous_rate_windows` (`updated_at`);--> statement-breakpoint
CREATE TABLE `anonymous_run_leases` (
	`session_hash` text PRIMARY KEY NOT NULL,
	`lease_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_anonymous_run_leases_expires_at` ON `anonymous_run_leases` (`expires_at`);