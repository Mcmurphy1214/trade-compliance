CREATE TABLE `topic_track_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`topic_id` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `topic_tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	`last_mutation` text NOT NULL
);
