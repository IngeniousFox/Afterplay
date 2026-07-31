CREATE TABLE IF NOT EXISTS `generated_memories` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`scopeType` text NOT NULL,
	`scopeKey` text NOT NULL,
	`payload` text NOT NULL,
	`sourceHash` text NOT NULL,
	`model` text NOT NULL,
	`promptVersion` integer NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
DELETE FROM `generated_memories` WHERE `id` NOT IN (SELECT MAX(`id`) FROM `generated_memories` GROUP BY `scopeType`, `scopeKey`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `generated_memories_scope_unique` ON `generated_memories` (`scopeType`,`scopeKey`);
