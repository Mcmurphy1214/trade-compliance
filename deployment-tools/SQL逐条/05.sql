CREATE TABLE IF NOT EXISTS `page_views` (
	`id` text PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`path` text NOT NULL,
	`article_id` text,
	`created_at` text NOT NULL
);
