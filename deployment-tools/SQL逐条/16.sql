CREATE TABLE IF NOT EXISTS `workspace_pool` (
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
