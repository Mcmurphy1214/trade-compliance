CREATE TABLE IF NOT EXISTS `workspace_follows` (
	`article_id` text NOT NULL,
	`user_id` text NOT NULL,
	`display_name` text NOT NULL,
	`followed_at` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`article_id`, `user_id`)
);
