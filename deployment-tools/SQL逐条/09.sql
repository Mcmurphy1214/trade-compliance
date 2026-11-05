CREATE TABLE IF NOT EXISTS `workspace_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`actor_name` text NOT NULL,
	`action` text NOT NULL,
	`article_id` text,
	`detail` text NOT NULL,
	`created_at` text NOT NULL
);
