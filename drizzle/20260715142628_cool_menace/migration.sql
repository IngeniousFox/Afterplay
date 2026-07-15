CREATE TABLE `games` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`title` text NOT NULL,
	`coverUrl` text,
	`heroUrl` text,
	`igdbId` integer NOT NULL UNIQUE,
	`steamGridDbId` integer UNIQUE,
	`officialPlatforms` text,
	`releaseYear` integer,
	`hltbMain` real,
	`hltbMainExtras` real,
	`hltbCompletionist` real,
	`notes` text,
	`executablePath` text,
	`developer` text,
	`publisher` text,
	`installDirectory` text,
	`installSizeBytes` integer,
	`genres` text,
	`endless` integer DEFAULT false NOT NULL,
	`planned` integer DEFAULT false NOT NULL,
	`addedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `iterations` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`gameId` integer NOT NULL,
	`label` text NOT NULL,
	`playedPlatform` text NOT NULL,
	`origin` text NOT NULL,
	`format` text,
	`manualTotalPlayed` real,
	`rating` integer,
	`extraContent` integer DEFAULT false NOT NULL,
	`startSessionId` integer,
	`endSessionId` integer,
	CONSTRAINT `fk_iterations_gameId_games_id_fk` FOREIGN KEY (`gameId`) REFERENCES `games`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_iterations_startSessionId_sessions_id_fk` FOREIGN KEY (`startSessionId`) REFERENCES `sessions`(`id`),
	CONSTRAINT `fk_iterations_endSessionId_sessions_id_fk` FOREIGN KEY (`endSessionId`) REFERENCES `sessions`(`id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`iterationId` integer NOT NULL,
	`isManual` integer DEFAULT false NOT NULL,
	`startedAt` integer NOT NULL,
	`endedAt` integer,
	`durationSec` integer,
	`lastHeartbeatAt` integer,
	`datePrecision` text NOT NULL,
	`milestone` text,
	CONSTRAINT `fk_sessions_iterationId_iterations_id_fk` FOREIGN KEY (`iterationId`) REFERENCES `iterations`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `spend_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`gameId` integer NOT NULL,
	`type` text NOT NULL,
	`amount` real NOT NULL,
	`occurredAt` integer NOT NULL,
	`datePrecision` text NOT NULL,
	`note` text,
	CONSTRAINT `fk_spend_events_gameId_games_id_fk` FOREIGN KEY (`gameId`) REFERENCES `games`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `state_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`iterationId` integer NOT NULL,
	`type` text NOT NULL,
	`occurredAt` integer NOT NULL,
	`datePrecision` text NOT NULL,
	`note` text,
	CONSTRAINT `fk_state_events_iterationId_iterations_id_fk` FOREIGN KEY (`iterationId`) REFERENCES `iterations`(`id`) ON DELETE CASCADE
);
