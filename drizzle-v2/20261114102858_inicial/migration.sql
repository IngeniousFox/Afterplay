CREATE TABLE `achievement_catalogs` (
	`id` text PRIMARY KEY NOT NULL,
	`syncCreated` text NOT NULL,
	`syncUpdated` text NOT NULL,
	`syncFields` text DEFAULT '{}' NOT NULL,
	`syncDeleted` text,
	`syncDirty` integer DEFAULT false NOT NULL,
	`gameId` text NOT NULL,
	`source` text NOT NULL,
	`items` text DEFAULT '[]' NOT NULL,
	`fetchedAt` integer NOT NULL,
	CONSTRAINT `fk_achievement_catalogs_gameId_games_id_fk` FOREIGN KEY (`gameId`) REFERENCES `games`(`id`)
);
--> statement-breakpoint
CREATE TABLE `achievement_unlocks` (
	`id` text PRIMARY KEY NOT NULL,
	`syncCreated` text NOT NULL,
	`syncUpdated` text NOT NULL,
	`syncFields` text DEFAULT '{}' NOT NULL,
	`syncDeleted` text,
	`syncDirty` integer DEFAULT false NOT NULL,
	`gameId` text NOT NULL,
	`source` text NOT NULL,
	`apiName` text NOT NULL,
	`origin` text NOT NULL,
	`unlockedAt` integer NOT NULL,
	`dateReliable` integer DEFAULT true NOT NULL,
	`playthroughId` text,
	`sessionId` text,
	CONSTRAINT `fk_achievement_unlocks_gameId_games_id_fk` FOREIGN KEY (`gameId`) REFERENCES `games`(`id`),
	CONSTRAINT `fk_achievement_unlocks_playthroughId_playthroughs_id_fk` FOREIGN KEY (`playthroughId`) REFERENCES `playthroughs`(`id`),
	CONSTRAINT `fk_achievement_unlocks_sessionId_sessions_id_fk` FOREIGN KEY (`sessionId`) REFERENCES `sessions`(`id`)
);
--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`syncCreated` text NOT NULL,
	`syncUpdated` text NOT NULL,
	`syncFields` text DEFAULT '{}' NOT NULL,
	`syncDeleted` text,
	`syncDirty` integer DEFAULT false NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`os` text NOT NULL,
	`home` text,
	`appVersion` text,
	`schemaVersion` integer,
	`firstSeenAt` integer NOT NULL,
	`lastSeenAt` integer,
	`revokedAt` integer,
	`installNonce` text
);
--> statement-breakpoint
CREATE TABLE `emulator_installs` (
	`id` text PRIMARY KEY NOT NULL,
	`syncCreated` text NOT NULL,
	`syncUpdated` text NOT NULL,
	`syncFields` text DEFAULT '{}' NOT NULL,
	`syncDeleted` text,
	`syncDirty` integer DEFAULT false NOT NULL,
	`emulatorId` text NOT NULL,
	`deviceId` text NOT NULL,
	`executablePath` text NOT NULL,
	CONSTRAINT `fk_emulator_installs_emulatorId_emulators_id_fk` FOREIGN KEY (`emulatorId`) REFERENCES `emulators`(`id`),
	CONSTRAINT `fk_emulator_installs_deviceId_devices_id_fk` FOREIGN KEY (`deviceId`) REFERENCES `devices`(`id`)
);
--> statement-breakpoint
CREATE TABLE `emulators` (
	`id` text PRIMARY KEY NOT NULL,
	`syncCreated` text NOT NULL,
	`syncUpdated` text NOT NULL,
	`syncFields` text DEFAULT '{}' NOT NULL,
	`syncDeleted` text,
	`syncDirty` integer DEFAULT false NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `external_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`syncCreated` text NOT NULL,
	`syncUpdated` text NOT NULL,
	`syncFields` text DEFAULT '{}' NOT NULL,
	`syncDeleted` text,
	`syncDirty` integer DEFAULT false NOT NULL,
	`gameId` text NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`checkedAt` integer NOT NULL,
	`nextCheckAt` integer,
	`error` text,
	CONSTRAINT `fk_external_checks_gameId_games_id_fk` FOREIGN KEY (`gameId`) REFERENCES `games`(`id`)
);
--> statement-breakpoint
CREATE TABLE `game_curiosities` (
	`id` text PRIMARY KEY NOT NULL,
	`syncCreated` text NOT NULL,
	`syncUpdated` text NOT NULL,
	`syncFields` text DEFAULT '{}' NOT NULL,
	`syncDeleted` text,
	`syncDirty` integer DEFAULT false NOT NULL,
	`gameId` text NOT NULL,
	`items` text DEFAULT '[]' NOT NULL,
	`generatedAt` integer NOT NULL,
	`model` text,
	CONSTRAINT `fk_game_curiosities_gameId_games_id_fk` FOREIGN KEY (`gameId`) REFERENCES `games`(`id`)
);
--> statement-breakpoint
CREATE TABLE `game_installs` (
	`id` text PRIMARY KEY NOT NULL,
	`syncCreated` text NOT NULL,
	`syncUpdated` text NOT NULL,
	`syncFields` text DEFAULT '{}' NOT NULL,
	`syncDeleted` text,
	`syncDirty` integer DEFAULT false NOT NULL,
	`gameId` text NOT NULL,
	`deviceId` text NOT NULL,
	`executablePath` text,
	`installDirectory` text,
	`installSizeBytes` integer,
	`lastVerifiedAt` integer,
	CONSTRAINT `fk_game_installs_gameId_games_id_fk` FOREIGN KEY (`gameId`) REFERENCES `games`(`id`),
	CONSTRAINT `fk_game_installs_deviceId_devices_id_fk` FOREIGN KEY (`deviceId`) REFERENCES `devices`(`id`)
);
--> statement-breakpoint
CREATE TABLE `game_metadata` (
	`id` text PRIMARY KEY NOT NULL,
	`syncCreated` text NOT NULL,
	`syncUpdated` text NOT NULL,
	`syncFields` text DEFAULT '{}' NOT NULL,
	`syncDeleted` text,
	`syncDirty` integer DEFAULT false NOT NULL,
	`gameId` text NOT NULL,
	`coverUrl` text,
	`heroUrl` text,
	`officialPlatforms` text,
	`genres` text,
	`developer` text,
	`publisher` text,
	`releaseYear` integer,
	`releaseDate` integer,
	`releaseDatePrecision` text,
	`summary` text,
	`igdbCollections` text,
	`hltbMain` real,
	`hltbMainExtras` real,
	`hltbCompletionist` real,
	`ratingCritics` real,
	`ratingCriticsCount` integer,
	`ratingUsers` real,
	`ratingUsersCount` integer,
	`steamTags` text,
	`steamPositive` integer,
	`steamNegative` integer,
	CONSTRAINT `fk_game_metadata_gameId_games_id_fk` FOREIGN KEY (`gameId`) REFERENCES `games`(`id`)
);
--> statement-breakpoint
CREATE TABLE `games` (
	`id` text PRIMARY KEY NOT NULL,
	`syncCreated` text NOT NULL,
	`syncUpdated` text NOT NULL,
	`syncFields` text DEFAULT '{}' NOT NULL,
	`syncDeleted` text,
	`syncDirty` integer DEFAULT false NOT NULL,
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
	`endless` integer DEFAULT false NOT NULL,
	`isEmulated` integer DEFAULT false NOT NULL,
	`addedAt` integer NOT NULL,
	`promotedAt` integer,
	`saveBackupEnabled` integer DEFAULT false NOT NULL,
	`saveDetectionSource` text,
	`saveLudusaviName` text,
	`saveCustomPaths` text,
	`saveKey` text
);
--> statement-breakpoint
CREATE TABLE `generated_memories` (
	`id` text PRIMARY KEY NOT NULL,
	`syncCreated` text NOT NULL,
	`syncUpdated` text NOT NULL,
	`syncFields` text DEFAULT '{}' NOT NULL,
	`syncDeleted` text,
	`syncDirty` integer DEFAULT false NOT NULL,
	`scopeType` text NOT NULL,
	`scopeKey` text NOT NULL,
	`payload` text NOT NULL,
	`sourceHash` text NOT NULL,
	`model` text NOT NULL,
	`promptVersion` integer NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `local_emu_state` (
	`gameId` text PRIMARY KEY NOT NULL,
	`checkedAt` integer NOT NULL,
	`status` text NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `local_job_state` (
	`job` text PRIMARY KEY NOT NULL,
	`lastRunAt` integer,
	`lastOkAt` integer,
	`lastError` text
);
--> statement-breakpoint
CREATE TABLE `local_legacy_ids` (
	`legacyTable` text NOT NULL,
	`legacyId` integer NOT NULL,
	`newId` text NOT NULL,
	CONSTRAINT `local_legacy_ids_pk` PRIMARY KEY(`legacyTable`, `legacyId`)
);
--> statement-breakpoint
CREATE TABLE `local_save_state` (
	`gameId` text PRIMARY KEY NOT NULL,
	`lastSyncedHash` text,
	`restoreTarget` text,
	`restoreTargetSetAt` integer
);
--> statement-breakpoint
CREATE TABLE `local_session_beats` (
	`sessionId` text PRIMARY KEY NOT NULL,
	`beatAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `local_sync_state` (
	`id` integer PRIMARY KEY,
	`pullCursor` integer DEFAULT 0 NOT NULL,
	`lastPushAt` integer,
	`lastPullAt` integer,
	`lastError` text,
	`lastErrorAt` integer,
	`protocolVersion` integer,
	`shortDeviceId` text,
	`shortDeviceIdFor` text,
	CONSTRAINT "local_sync_state_single_row" CHECK("id" = 1)
);
--> statement-breakpoint
CREATE TABLE `plan_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`syncCreated` text NOT NULL,
	`syncUpdated` text NOT NULL,
	`syncFields` text DEFAULT '{}' NOT NULL,
	`syncDeleted` text,
	`syncDirty` integer DEFAULT false NOT NULL,
	`gameId` text NOT NULL,
	`plannedAt` integer NOT NULL,
	`pinnedAt` integer,
	`sortKey` text,
	`note` text,
	CONSTRAINT `fk_plan_entries_gameId_games_id_fk` FOREIGN KEY (`gameId`) REFERENCES `games`(`id`)
);
--> statement-breakpoint
CREATE TABLE `playthroughs` (
	`id` text PRIMARY KEY NOT NULL,
	`syncCreated` text NOT NULL,
	`syncUpdated` text NOT NULL,
	`syncFields` text DEFAULT '{}' NOT NULL,
	`syncDeleted` text,
	`syncDirty` integer DEFAULT false NOT NULL,
	`gameId` text NOT NULL,
	`customLabel` text,
	`playedPlatform` text NOT NULL,
	`origin` text NOT NULL,
	`format` text,
	`manualHours` real,
	`rating` integer,
	`extraContent` integer DEFAULT false NOT NULL,
	CONSTRAINT `fk_playthroughs_gameId_games_id_fk` FOREIGN KEY (`gameId`) REFERENCES `games`(`id`)
);
--> statement-breakpoint
CREATE TABLE `radar_games` (
	`id` text PRIMARY KEY NOT NULL,
	`syncCreated` text NOT NULL,
	`syncUpdated` text NOT NULL,
	`syncFields` text DEFAULT '{}' NOT NULL,
	`syncDeleted` text,
	`syncDirty` integer DEFAULT false NOT NULL,
	`igdbId` integer NOT NULL,
	`collectionId` integer,
	`collectionName` text,
	`title` text NOT NULL,
	`coverUrl` text,
	`releaseDate` integer,
	`releaseDatePrecision` text,
	`releaseYear` integer,
	`discoveredAt` integer NOT NULL,
	`dismissedAt` integer
);
--> statement-breakpoint
CREATE TABLE `save_backups` (
	`id` text PRIMARY KEY NOT NULL,
	`syncCreated` text NOT NULL,
	`syncUpdated` text NOT NULL,
	`syncFields` text DEFAULT '{}' NOT NULL,
	`syncDeleted` text,
	`syncDirty` integer DEFAULT false NOT NULL,
	`gameId` text NOT NULL,
	`deviceId` text NOT NULL,
	`backupName` text NOT NULL,
	`r2Key` text NOT NULL,
	`sizeBytes` integer DEFAULT 0 NOT NULL,
	`ludusaviName` text NOT NULL,
	`differential` integer DEFAULT false NOT NULL,
	`parentBackupName` text,
	`locations` text,
	`hasRegistry` integer DEFAULT false NOT NULL,
	`createdAt` integer NOT NULL,
	`contentHash` text,
	`parentContentHash` text,
	CONSTRAINT `fk_save_backups_gameId_games_id_fk` FOREIGN KEY (`gameId`) REFERENCES `games`(`id`),
	CONSTRAINT `fk_save_backups_deviceId_devices_id_fk` FOREIGN KEY (`deviceId`) REFERENCES `devices`(`id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`syncCreated` text NOT NULL,
	`syncUpdated` text NOT NULL,
	`syncFields` text DEFAULT '{}' NOT NULL,
	`syncDeleted` text,
	`syncDirty` integer DEFAULT false NOT NULL,
	`playthroughId` text,
	`emulatorId` text,
	`deviceId` text NOT NULL,
	`startedBy` text NOT NULL,
	`source` text DEFAULT 'measured' NOT NULL,
	`startedAt` integer NOT NULL,
	`endedAt` integer,
	`durationSec` integer,
	`datePrecision` text NOT NULL,
	`lastSeenAt` integer,
	`closedBy` text,
	`note` text,
	CONSTRAINT `fk_sessions_playthroughId_playthroughs_id_fk` FOREIGN KEY (`playthroughId`) REFERENCES `playthroughs`(`id`),
	CONSTRAINT `fk_sessions_emulatorId_emulators_id_fk` FOREIGN KEY (`emulatorId`) REFERENCES `emulators`(`id`),
	CONSTRAINT `fk_sessions_deviceId_devices_id_fk` FOREIGN KEY (`deviceId`) REFERENCES `devices`(`id`),
	CONSTRAINT "sessions_target_check" CHECK("playthroughId" IS NOT NULL OR "emulatorId" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `spend_events` (
	`id` text PRIMARY KEY NOT NULL,
	`syncCreated` text NOT NULL,
	`syncUpdated` text NOT NULL,
	`syncFields` text DEFAULT '{}' NOT NULL,
	`syncDeleted` text,
	`syncDirty` integer DEFAULT false NOT NULL,
	`gameId` text NOT NULL,
	`playthroughId` text,
	`type` text NOT NULL,
	`amount` real NOT NULL,
	`currency` text NOT NULL,
	`occurredAt` integer NOT NULL,
	`datePrecision` text NOT NULL,
	`note` text,
	CONSTRAINT `fk_spend_events_gameId_games_id_fk` FOREIGN KEY (`gameId`) REFERENCES `games`(`id`),
	CONSTRAINT `fk_spend_events_playthroughId_playthroughs_id_fk` FOREIGN KEY (`playthroughId`) REFERENCES `playthroughs`(`id`)
);
--> statement-breakpoint
CREATE TABLE `state_events` (
	`id` text PRIMARY KEY NOT NULL,
	`syncCreated` text NOT NULL,
	`syncUpdated` text NOT NULL,
	`syncFields` text DEFAULT '{}' NOT NULL,
	`syncDeleted` text,
	`syncDirty` integer DEFAULT false NOT NULL,
	`playthroughId` text NOT NULL,
	`type` text NOT NULL,
	`occurredAt` integer NOT NULL,
	`datePrecision` text NOT NULL,
	`note` text,
	`deviceId` text,
	CONSTRAINT `fk_state_events_playthroughId_playthroughs_id_fk` FOREIGN KEY (`playthroughId`) REFERENCES `playthroughs`(`id`),
	CONSTRAINT `fk_state_events_deviceId_devices_id_fk` FOREIGN KEY (`deviceId`) REFERENCES `devices`(`id`)
);
--> statement-breakpoint
CREATE INDEX `achievement_catalogs_sync_dirty_idx` ON `achievement_catalogs` (`syncDirty`) WHERE "syncDirty" = 1;--> statement-breakpoint
CREATE INDEX `achievement_catalogs_game_idx` ON `achievement_catalogs` (`gameId`);--> statement-breakpoint
CREATE INDEX `achievement_unlocks_sync_dirty_idx` ON `achievement_unlocks` (`syncDirty`) WHERE "syncDirty" = 1;--> statement-breakpoint
CREATE INDEX `achievement_unlocks_game_idx` ON `achievement_unlocks` (`gameId`);--> statement-breakpoint
CREATE INDEX `achievement_unlocks_session_idx` ON `achievement_unlocks` (`sessionId`);--> statement-breakpoint
CREATE INDEX `achievement_unlocks_playthrough_idx` ON `achievement_unlocks` (`playthroughId`);--> statement-breakpoint
CREATE INDEX `devices_sync_dirty_idx` ON `devices` (`syncDirty`) WHERE "syncDirty" = 1;--> statement-breakpoint
CREATE INDEX `emulator_installs_sync_dirty_idx` ON `emulator_installs` (`syncDirty`) WHERE "syncDirty" = 1;--> statement-breakpoint
CREATE INDEX `emulator_installs_emulator_idx` ON `emulator_installs` (`emulatorId`);--> statement-breakpoint
CREATE INDEX `emulator_installs_device_idx` ON `emulator_installs` (`deviceId`);--> statement-breakpoint
CREATE INDEX `emulators_sync_dirty_idx` ON `emulators` (`syncDirty`) WHERE "syncDirty" = 1;--> statement-breakpoint
CREATE INDEX `external_checks_sync_dirty_idx` ON `external_checks` (`syncDirty`) WHERE "syncDirty" = 1;--> statement-breakpoint
CREATE INDEX `external_checks_source_next_idx` ON `external_checks` (`source`,`nextCheckAt`);--> statement-breakpoint
CREATE INDEX `external_checks_game_idx` ON `external_checks` (`gameId`);--> statement-breakpoint
CREATE INDEX `game_curiosities_sync_dirty_idx` ON `game_curiosities` (`syncDirty`) WHERE "syncDirty" = 1;--> statement-breakpoint
CREATE INDEX `game_installs_sync_dirty_idx` ON `game_installs` (`syncDirty`) WHERE "syncDirty" = 1;--> statement-breakpoint
CREATE INDEX `game_installs_device_idx` ON `game_installs` (`deviceId`);--> statement-breakpoint
CREATE INDEX `game_installs_game_idx` ON `game_installs` (`gameId`);--> statement-breakpoint
CREATE INDEX `game_metadata_sync_dirty_idx` ON `game_metadata` (`syncDirty`) WHERE "syncDirty" = 1;--> statement-breakpoint
CREATE INDEX `games_sync_dirty_idx` ON `games` (`syncDirty`) WHERE "syncDirty" = 1;--> statement-breakpoint
CREATE INDEX `games_igdb_id_idx` ON `games` (`igdbId`);--> statement-breakpoint
CREATE INDEX `games_steam_app_id_idx` ON `games` (`steamAppId`);--> statement-breakpoint
CREATE INDEX `games_ra_game_id_idx` ON `games` (`raGameId`);--> statement-breakpoint
CREATE INDEX `games_sgdb_id_idx` ON `games` (`sgdbId`);--> statement-breakpoint
CREATE INDEX `generated_memories_sync_dirty_idx` ON `generated_memories` (`syncDirty`) WHERE "syncDirty" = 1;--> statement-breakpoint
CREATE INDEX `plan_entries_sync_dirty_idx` ON `plan_entries` (`syncDirty`) WHERE "syncDirty" = 1;--> statement-breakpoint
CREATE INDEX `playthroughs_sync_dirty_idx` ON `playthroughs` (`syncDirty`) WHERE "syncDirty" = 1;--> statement-breakpoint
CREATE INDEX `playthroughs_game_idx` ON `playthroughs` (`gameId`);--> statement-breakpoint
CREATE INDEX `radar_games_sync_dirty_idx` ON `radar_games` (`syncDirty`) WHERE "syncDirty" = 1;--> statement-breakpoint
CREATE INDEX `save_backups_sync_dirty_idx` ON `save_backups` (`syncDirty`) WHERE "syncDirty" = 1;--> statement-breakpoint
CREATE INDEX `save_backups_game_idx` ON `save_backups` (`gameId`);--> statement-breakpoint
CREATE INDEX `sessions_sync_dirty_idx` ON `sessions` (`syncDirty`) WHERE "syncDirty" = 1;--> statement-breakpoint
CREATE INDEX `sessions_playthrough_idx` ON `sessions` (`playthroughId`);--> statement-breakpoint
CREATE INDEX `sessions_device_ended_idx` ON `sessions` (`deviceId`,`endedAt`);--> statement-breakpoint
CREATE INDEX `sessions_emulator_idx` ON `sessions` (`emulatorId`);--> statement-breakpoint
CREATE INDEX `sessions_started_idx` ON `sessions` (`startedAt`);--> statement-breakpoint
CREATE INDEX `spend_events_sync_dirty_idx` ON `spend_events` (`syncDirty`) WHERE "syncDirty" = 1;--> statement-breakpoint
CREATE INDEX `spend_events_game_idx` ON `spend_events` (`gameId`);--> statement-breakpoint
CREATE INDEX `spend_events_playthrough_idx` ON `spend_events` (`playthroughId`);--> statement-breakpoint
CREATE INDEX `state_events_sync_dirty_idx` ON `state_events` (`syncDirty`) WHERE "syncDirty" = 1;--> statement-breakpoint
CREATE INDEX `state_events_playthrough_idx` ON `state_events` (`playthroughId`);