CREATE TABLE IF NOT EXISTS `workspace_matches` (
	`article_id` text NOT NULL,
	`rule_id` text NOT NULL,
	`rule_name` text NOT NULL,
	`rule_version` integer NOT NULL,
	`matched_at` text NOT NULL,
	`mutation_id` text NOT NULL,
	PRIMARY KEY(`article_id`, `rule_id`)
);
