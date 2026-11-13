CREATE TABLE `achievements` (
	`id` text PRIMARY KEY,
	`syncCreated` text NOT NULL,
	`syncUpdated` text NOT NULL,
	`syncFields` text DEFAULT '{}' NOT NULL,
	`syncDeleted` text,
	`syncDirty` integer DEFAULT 0 NOT NULL,
	`syncSeq` integer,
	`gameId` text NOT NULL,
	`source` text NOT NULL,
	`apiName` text NOT NULL,
	`displayName` text,
	`description` text,
	`iconUrl` text,
	`iconGrayUrl` text,
	`hidden` integer DEFAULT 0 NOT NULL,
	`globalPercent` real,
	`sortIndex` integer,
	CONSTRAINT `fk_achievements_gameId_games_id_fk` FOREIGN KEY (`gameId`) REFERENCES `games`(`id`)
);
--> statement-breakpoint
CREATE TABLE `games` (
	`id` text PRIMARY KEY,
	`syncCreated` text NOT NULL,
	`syncUpdated` text NOT NULL,
	`syncFields` text DEFAULT '{}' NOT NULL,
	`syncDeleted` text,
	`syncDirty` integer DEFAULT 0 NOT NULL,
	`syncSeq` integer,
	`title` text NOT NULL,
	`igdbId` integer,
	`steamAppId` integer,
	`raGameId` integer,
	`sgdbId` integer,
	`steamAppIdSource` text,
	`sgdbIdSource` text,
	`coverOverride` text,
	`heroOverride` text,
	`developerOverride` text,
	`publisherOverride` text,
	`genresOverride` text,
	`notes` text,
	`endless` integer DEFAULT 0 NOT NULL,
	`isEmulated` integer DEFAULT 0 NOT NULL,
	`addedAt` integer NOT NULL,
	`promotedAt` integer,
	`saveBackupEnabled` integer DEFAULT 0 NOT NULL,
	`saveDetectionSource` text,
	`saveLudusaviName` text,
	`saveCustomPaths` text,
	`saveKey` text
);
--> statement-breakpoint
CREATE TABLE `playthroughs` (
	`id` text PRIMARY KEY,
	`syncCreated` text NOT NULL,
	`syncUpdated` text NOT NULL,
	`syncFields` text DEFAULT '{}' NOT NULL,
	`syncDeleted` text,
	`syncDirty` integer DEFAULT 0 NOT NULL,
	`syncSeq` integer,
	`gameId` text NOT NULL,
	`customLabel` text,
	`playedPlatform` text,
	`origin` text,
	`format` text,
	`manualHours` real,
	`rating` integer,
	`extraContent` text,
	CONSTRAINT `fk_playthroughs_gameId_games_id_fk` FOREIGN KEY (`gameId`) REFERENCES `games`(`id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY,
	`syncCreated` text NOT NULL,
	`syncUpdated` text NOT NULL,
	`syncFields` text DEFAULT '{}' NOT NULL,
	`syncDeleted` text,
	`syncDirty` integer DEFAULT 0 NOT NULL,
	`syncSeq` integer,
	`playthroughId` text,
	`emulatorId` text,
	`deviceId` text NOT NULL,
	`startedBy` text NOT NULL,
	`source` text NOT NULL,
	`startedAt` integer NOT NULL,
	`endedAt` integer,
	`durationSec` integer,
	`datePrecision` text NOT NULL,
	`lastSeenAt` integer,
	`closedBy` text,
	`note` text,
	CONSTRAINT `fk_sessions_playthroughId_playthroughs_id_fk` FOREIGN KEY (`playthroughId`) REFERENCES `playthroughs`(`id`)
);
--> statement-breakpoint
CREATE TABLE `state_events` (
	`id` text PRIMARY KEY,
	`syncCreated` text NOT NULL,
	`syncUpdated` text NOT NULL,
	`syncFields` text DEFAULT '{}' NOT NULL,
	`syncDeleted` text,
	`syncDirty` integer DEFAULT 0 NOT NULL,
	`syncSeq` integer,
	`playthroughId` text NOT NULL,
	`type` text NOT NULL,
	`occurredAt` integer NOT NULL,
	`datePrecision` text NOT NULL,
	`note` text,
	`deviceId` text,
	CONSTRAINT `fk_state_events_playthroughId_playthroughs_id_fk` FOREIGN KEY (`playthroughId`) REFERENCES `playthroughs`(`id`)
);
--> statement-breakpoint
CREATE INDEX `achievements_sync_dirty_idx` ON `achievements` (`syncDirty`) WHERE "syncDirty" = 1;--> statement-breakpoint
CREATE INDEX `achievements_sync_seq_idx` ON `achievements` (`syncSeq`) WHERE "syncSeq" is not null;--> statement-breakpoint
CREATE INDEX `achievements_game_idx` ON `achievements` (`gameId`);--> statement-breakpoint
CREATE INDEX `games_sync_dirty_idx` ON `games` (`syncDirty`) WHERE "syncDirty" = 1;--> statement-breakpoint
CREATE INDEX `games_sync_seq_idx` ON `games` (`syncSeq`) WHERE "syncSeq" is not null;--> statement-breakpoint
CREATE INDEX `games_igdb_idx` ON `games` (`igdbId`);--> statement-breakpoint
CREATE INDEX `games_steam_idx` ON `games` (`steamAppId`);--> statement-breakpoint
CREATE INDEX `playthroughs_sync_dirty_idx` ON `playthroughs` (`syncDirty`) WHERE "syncDirty" = 1;--> statement-breakpoint
CREATE INDEX `playthroughs_sync_seq_idx` ON `playthroughs` (`syncSeq`) WHERE "syncSeq" is not null;--> statement-breakpoint
CREATE INDEX `playthroughs_game_idx` ON `playthroughs` (`gameId`);--> statement-breakpoint
CREATE INDEX `sessions_sync_dirty_idx` ON `sessions` (`syncDirty`) WHERE "syncDirty" = 1;--> statement-breakpoint
CREATE INDEX `sessions_sync_seq_idx` ON `sessions` (`syncSeq`) WHERE "syncSeq" is not null;--> statement-breakpoint
CREATE INDEX `sessions_pt_idx` ON `sessions` (`playthroughId`);--> statement-breakpoint
CREATE INDEX `sessions_device_ended_idx` ON `sessions` (`deviceId`,`endedAt`);--> statement-breakpoint
CREATE INDEX `sessions_emulator_idx` ON `sessions` (`emulatorId`);--> statement-breakpoint
CREATE INDEX `sessions_started_idx` ON `sessions` (`startedAt`);--> statement-breakpoint
CREATE INDEX `state_events_sync_dirty_idx` ON `state_events` (`syncDirty`) WHERE "syncDirty" = 1;--> statement-breakpoint
CREATE INDEX `state_events_sync_seq_idx` ON `state_events` (`syncSeq`) WHERE "syncSeq" is not null;--> statement-breakpoint
CREATE INDEX `state_events_pt_idx` ON `state_events` (`playthroughId`);