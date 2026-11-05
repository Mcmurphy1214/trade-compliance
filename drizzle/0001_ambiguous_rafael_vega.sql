CREATE TABLE `analytics_state` (
	`id` text PRIMARY KEY NOT NULL,
	`started_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `page_views` (
	`id` text PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`path` text NOT NULL,
	`article_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `page_views_day_idx` ON `page_views` (`day`);--> statement-breakpoint
CREATE INDEX `page_views_article_day_idx` ON `page_views` (`article_id`,`day`);