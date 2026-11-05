--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `workspace_exports` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`checksum` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`row_count` integer NOT NULL
);
