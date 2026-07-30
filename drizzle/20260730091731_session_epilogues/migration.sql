CREATE TABLE `session_epilogues` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`sessionId` integer NOT NULL UNIQUE,
	`closeReason` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`tags` text,
	`highlight` integer DEFAULT false NOT NULL,
	`createdAt` integer NOT NULL,
	`resolvedAt` integer,
	CONSTRAINT `fk_session_epilogues_sessionId_sessions_id_fk` FOREIGN KEY (`sessionId`) REFERENCES `sessions`(`id`) ON DELETE CASCADE
);
