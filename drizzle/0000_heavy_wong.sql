CREATE TABLE `business_groups` (
	`business_group_id` integer PRIMARY KEY NOT NULL,
	`business_group_name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_groups_business_group_name_unique` ON `business_groups` (`business_group_name`);--> statement-breakpoint
CREATE TABLE `dataset_metadata` (
	`metadata_key` text PRIMARY KEY NOT NULL,
	`metadata_value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `opportunities` (
	`project_id` text PRIMARY KEY NOT NULL,
	`owner_id` integer NOT NULL,
	`team_id` integer NOT NULL,
	`project_name` text NOT NULL,
	`customer_name` text NOT NULL,
	`project_amount_cents` integer NOT NULL,
	`expected_gross_profit_cents` integer NOT NULL,
	`expected_profit_cents` integer NOT NULL,
	`project_stage` integer NOT NULL,
	`expected_publish_date` text,
	`expected_close_date` text NOT NULL,
	`performance_commitment` text NOT NULL,
	`requires_tender` integer NOT NULL,
	`bid_award_date` text,
	`province` text NOT NULL,
	`city` text NOT NULL,
	`district` text NOT NULL,
	`created_date` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`team_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`team_id`) REFERENCES `project_owners`(`owner_id`,`team_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "valid_stage" CHECK("opportunities"."project_stage" IN (0,20,40,60,80,90,100)),
	CONSTRAINT "valid_commitment" CHECK("opportunities"."performance_commitment" IN ('力争','确保','冲刺')),
	CONSTRAINT "valid_amount" CHECK("opportunities"."project_amount_cents">0),
	CONSTRAINT "valid_tender" CHECK("opportunities"."requires_tender" IN (0,1)),
	CONSTRAINT "valid_profit" CHECK("opportunities"."expected_profit_cents"<="opportunities"."expected_gross_profit_cents" AND "opportunities"."expected_gross_profit_cents"<="opportunities"."project_amount_cents"),
	CONSTRAINT "valid_dates" CHECK("opportunities"."expected_close_date">="opportunities"."created_date"),
	CONSTRAINT "valid_bid" CHECK("opportunities"."requires_tender"=1 OR ("opportunities"."expected_publish_date" IS NULL AND "opportunities"."bid_award_date" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `opportunities_team_stage_close` ON `opportunities` (`team_id`,`project_stage`,`expected_close_date`);--> statement-breakpoint
CREATE INDEX `opportunities_created` ON `opportunities` (`created_date`);--> statement-breakpoint
CREATE TABLE `project_owners` (
	`owner_id` integer PRIMARY KEY NOT NULL,
	`owner_name` text NOT NULL,
	`team_id` integer NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`team_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_owners_owner_id_team_id_unique` ON `project_owners` (`owner_id`,`team_id`);--> statement-breakpoint
CREATE TABLE `team_closure` (
	`ancestor_team_id` integer NOT NULL,
	`descendant_team_id` integer NOT NULL,
	`depth` integer NOT NULL,
	PRIMARY KEY(`ancestor_team_id`, `descendant_team_id`),
	FOREIGN KEY (`ancestor_team_id`) REFERENCES `teams`(`team_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`descendant_team_id`) REFERENCES `teams`(`team_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `teams` (
	`team_id` integer PRIMARY KEY NOT NULL,
	`business_group_id` integer NOT NULL,
	`parent_team_id` integer,
	`team_name` text NOT NULL,
	`team_code` text NOT NULL,
	FOREIGN KEY (`business_group_id`) REFERENCES `business_groups`(`business_group_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_team_id`,`business_group_id`) REFERENCES `teams`(`team_id`,`business_group_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teams_team_name_unique` ON `teams` (`team_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `teams_team_code_unique` ON `teams` (`team_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `teams_team_id_business_group_id_unique` ON `teams` (`team_id`,`business_group_id`);