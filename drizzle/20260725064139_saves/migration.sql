CREATE TABLE `save_backups` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`gameId` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`backupName` text NOT NULL,
	`r2Key` text NOT NULL,
	`sizeBytes` integer DEFAULT 0 NOT NULL,
	`ludusaviName` text NOT NULL,
	`differential` integer DEFAULT false NOT NULL,
	`parentBackupName` text,
	`machineId` text NOT NULL,
	`machineName` text NOT NULL,
	`machineHome` text NOT NULL,
	`locations` text,
	`hasRegistry` integer DEFAULT false NOT NULL,
	CONSTRAINT `fk_save_backups_gameId_games_id_fk` FOREIGN KEY (`gameId`) REFERENCES `games`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `games` ADD `saveBackupEnabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `games` ADD `saveDetectionSource` text;--> statement-breakpoint
ALTER TABLE `games` ADD `saveLudusaviName` text;--> statement-breakpoint
ALTER TABLE `games` ADD `saveCustomPaths` text;