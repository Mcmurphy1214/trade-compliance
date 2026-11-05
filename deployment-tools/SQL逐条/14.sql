CREATE TABLE IF NOT EXISTS `workspace_login_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`attempts` integer NOT NULL,
	`reset_at` text NOT NULL
);
