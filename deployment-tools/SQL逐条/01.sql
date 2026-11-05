CREATE TABLE IF NOT EXISTS `article_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`article_id` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);
