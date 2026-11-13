CREATE TABLE IF NOT EXISTS `article_publications` (
	`article_id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL,
	`reason` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_name` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`last_mutation` text NOT NULL
);
