CREATE TABLE `chat_leases` (
	`session_id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `research_records` (
	`collection` text NOT NULL,
	`id` text NOT NULL,
	`position` integer NOT NULL,
	`payload` text NOT NULL,
	PRIMARY KEY(`collection`, `id`)
);
--> statement-breakpoint
CREATE TABLE `workspace_revision` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`token` text DEFAULT '' NOT NULL
);
