CREATE TABLE `radar_games` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`igdbId` integer NOT NULL UNIQUE,
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
