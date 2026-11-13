CREATE TABLE IF NOT EXISTS `oauth_consents` (
	`id` text PRIMARY KEY NOT NULL,
	`binding_mode` text NOT NULL,
	`binding_hash` text NOT NULL,
	`payload` text NOT NULL,
	`expires_at` integer NOT NULL
);
