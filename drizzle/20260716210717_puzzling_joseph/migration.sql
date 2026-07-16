CREATE TABLE `emulators` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`name` text NOT NULL,
	`executablePath` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `games` ADD `isEmulated` integer DEFAULT false NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`iterationId` integer,
	`emulatorId` integer,
	`isManual` integer DEFAULT false NOT NULL,
	`startedAt` integer NOT NULL,
	`endedAt` integer,
	`durationSec` integer,
	`lastHeartbeatAt` integer,
	`datePrecision` text NOT NULL,
	`milestone` text,
	CONSTRAINT `fk_sessions_iterationId_iterations_id_fk` FOREIGN KEY (`iterationId`) REFERENCES `iterations`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_sessions_emulatorId_emulators_id_fk` FOREIGN KEY (`emulatorId`) REFERENCES `emulators`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
INSERT INTO `__new_sessions`(`id`, `iterationId`, `isManual`, `startedAt`, `endedAt`, `durationSec`, `lastHeartbeatAt`, `datePrecision`, `milestone`) SELECT `id`, `iterationId`, `isManual`, `startedAt`, `endedAt`, `durationSec`, `lastHeartbeatAt`, `datePrecision`, `milestone` FROM `sessions`;--> statement-breakpoint
DROP TABLE `sessions`;--> statement-breakpoint
ALTER TABLE `__new_sessions` RENAME TO `sessions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;