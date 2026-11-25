CREATE TABLE `agent_results` (
	`result_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`owner_key` text NOT NULL,
	`filters_json` text NOT NULL,
	`fingerprint` text NOT NULL,
	`checked_fingerprint` text,
	`quality_json` text,
	`export_plan_json` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `agent_sessions`(`session_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agent_results_session` ON `agent_results` (`session_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `agent_sessions` (
	`session_id` text PRIMARY KEY NOT NULL,
	`owner_key` text NOT NULL,
	`context_json` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_sessions_owner_updated` ON `agent_sessions` (`owner_key`,`updated_at`);