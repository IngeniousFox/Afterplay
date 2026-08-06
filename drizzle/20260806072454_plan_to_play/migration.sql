ALTER TABLE `games` ADD `summary` text;--> statement-breakpoint
ALTER TABLE `games` ADD `igdbCollections` text;--> statement-breakpoint
ALTER TABLE `games` ADD `steamTags` text;--> statement-breakpoint
ALTER TABLE `games` ADD `steamPositive` integer;--> statement-breakpoint
ALTER TABLE `games` ADD `steamNegative` integer;--> statement-breakpoint
ALTER TABLE `games` ADD `steamSpyCheckedAt` integer;--> statement-breakpoint
ALTER TABLE `games` ADD `planPinnedAt` integer;--> statement-breakpoint
ALTER TABLE `games` ADD `releaseDate` integer;--> statement-breakpoint
ALTER TABLE `games` ADD `releaseDatePrecision` text;