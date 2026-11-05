CREATE TABLE IF NOT EXISTS `monitor_source_state` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`updated_at` text NOT NULL
);
