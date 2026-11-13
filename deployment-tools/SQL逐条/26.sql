CREATE TABLE IF NOT EXISTS `topic_tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	`last_mutation` text NOT NULL
);
