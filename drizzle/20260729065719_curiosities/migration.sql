CREATE TABLE `curiosities` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`gameId` integer NOT NULL,
	`text` text NOT NULL,
	CONSTRAINT `fk_curiosities_gameId_games_id_fk` FOREIGN KEY (`gameId`) REFERENCES `games`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `games` ADD `curiositiesGeneratedAt` integer;