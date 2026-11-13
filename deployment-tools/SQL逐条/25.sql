CREATE TABLE IF NOT EXISTS `topic_track_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`topic_id` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);
