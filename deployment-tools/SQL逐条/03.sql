CREATE TABLE IF NOT EXISTS `monitor_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`completed_at` text NOT NULL
);
