CREATE TABLE `oauth_consents` (
	`id` text PRIMARY KEY NOT NULL,
	`binding_mode` text NOT NULL,
	`binding_hash` text NOT NULL,
	`payload` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `oauth_consents_expiry_idx` ON `oauth_consents` (`expires_at`);