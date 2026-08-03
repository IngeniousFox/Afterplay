ALTER TABLE `games` ADD `steamAppId` integer;--> statement-breakpoint
ALTER TABLE `games` ADD `steamAppIdCheckedAt` integer;--> statement-breakpoint
ALTER TABLE `games` ADD `achievementsSyncedAt` integer;--> statement-breakpoint
ALTER TABLE `games` ADD `achievementsUnlocksSyncedAt` integer;--> statement-breakpoint
CREATE TABLE `achievements` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`gameId` integer NOT NULL,
	`apiName` text NOT NULL,
	`displayName` text NOT NULL,
	`description` text,
	`iconUrl` text,
	`iconGrayUrl` text,
	`hidden` integer DEFAULT false NOT NULL,
	`globalPercent` real,
	`sortIndex` integer NOT NULL,
	CONSTRAINT `fk_achievements_gameId_games_id_fk` FOREIGN KEY (`gameId`) REFERENCES `games`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `achievement_unlocks` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`achievementId` integer NOT NULL,
	`unlockedAt` integer NOT NULL,
	`dateReliable` integer DEFAULT true NOT NULL,
	`source` text NOT NULL,
	`iterationId` integer,
	`sessionId` integer,
	CONSTRAINT `fk_achievement_unlocks_achievementId_achievements_id_fk` FOREIGN KEY (`achievementId`) REFERENCES `achievements`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_achievement_unlocks_iterationId_iterations_id_fk` FOREIGN KEY (`iterationId`) REFERENCES `iterations`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_achievement_unlocks_sessionId_sessions_id_fk` FOREIGN KEY (`sessionId`) REFERENCES `sessions`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `achievements_game_api_unique` ON `achievements` (`gameId`,`apiName`);--> statement-breakpoint
CREATE UNIQUE INDEX `achievement_unlocks_source_unique` ON `achievement_unlocks` (`achievementId`,`source`);
