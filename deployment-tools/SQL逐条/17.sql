CREATE TABLE IF NOT EXISTS `workspace_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`conditions` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`last_mutation` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL
);
