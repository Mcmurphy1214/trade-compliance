CREATE TABLE `workspace_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`actor_name` text NOT NULL,
	`action` text NOT NULL,
	`article_id` text,
	`detail` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workspace_activity_time_idx` ON `workspace_activity` (`created_at`);--> statement-breakpoint
CREATE INDEX `workspace_activity_article_idx` ON `workspace_activity` (`article_id`);--> statement-breakpoint
CREATE TABLE `workspace_exports` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`checksum` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`row_count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspace_follows` (
	`article_id` text NOT NULL,
	`user_id` text NOT NULL,
	`display_name` text NOT NULL,
	`followed_at` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`article_id`, `user_id`)
);
--> statement-breakpoint
CREATE TABLE `workspace_login_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`attempts` integer NOT NULL,
	`reset_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspace_matches` (
	`article_id` text NOT NULL,
	`rule_id` text NOT NULL,
	`rule_name` text NOT NULL,
	`rule_version` integer NOT NULL,
	`matched_at` text NOT NULL,
	`mutation_id` text NOT NULL,
	PRIMARY KEY(`article_id`, `rule_id`)
);
--> statement-breakpoint
CREATE TABLE `workspace_pool` (
	`article_id` text PRIMARY KEY NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`suppressed` integer DEFAULT 0 NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`status` text DEFAULT '待研判' NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`last_mutation` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspace_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`conditions` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`last_mutation` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspace_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workspace_sessions_user_idx` ON `workspace_sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `workspace_users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`password_hash` text NOT NULL,
	`salt` text NOT NULL,
	`disabled` integer DEFAULT 0 NOT NULL,
	`must_change_password` integer DEFAULT 1 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`last_mutation` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_users_username_unique` ON `workspace_users` (`username`);