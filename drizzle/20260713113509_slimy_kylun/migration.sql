ALTER TABLE `games` ADD `executablePath` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_state_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`iterationId` integer NOT NULL,
	`type` text NOT NULL,
	`occurredAt` integer NOT NULL,
	`datePrecision` text NOT NULL,
	`note` text,
	CONSTRAINT `fk_state_events_iterationId_iterations_id_fk` FOREIGN KEY (`iterationId`) REFERENCES `iterations`(`id`) ON DELETE CASCADE,
	CONSTRAINT "state_events_type_check" CHECK("type" in ('started', 'completed', 'dropped', 'on_hold', 'resting')),
	CONSTRAINT "state_events_date_precision_check" CHECK("datePrecision" in ('year', 'month', 'day', 'datetime'))
);
--> statement-breakpoint
INSERT INTO `__new_state_events`(`id`, `iterationId`, `type`, `occurredAt`, `datePrecision`, `note`) SELECT `id`, `iterationId`, `type`, `occurredAt`, `datePrecision`, `note` FROM `state_events`;--> statement-breakpoint
DROP TABLE `state_events`;--> statement-breakpoint
ALTER TABLE `__new_state_events` RENAME TO `state_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;