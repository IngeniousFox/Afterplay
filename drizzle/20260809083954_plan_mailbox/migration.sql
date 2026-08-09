CREATE TABLE `plan_mailbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`createdAt` integer NOT NULL,
	`requestedBy` text,
	`processedAt` integer,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `plan_mailbox_pending_idx` ON `plan_mailbox` (`processedAt`,`id`);