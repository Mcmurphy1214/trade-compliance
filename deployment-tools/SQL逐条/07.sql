--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `page_views_article_day_idx` ON `page_views` (`article_id`,`day`);
