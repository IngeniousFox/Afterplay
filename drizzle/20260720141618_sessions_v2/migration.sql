-- Modelo v2 de sesiones: una sesión es SOLO tiempo jugado real. Los
-- marcadores de borde (milestone, duración 0) y las anclas start/endSessionId
-- desaparecen — las fechas de un playthrough viven en su log de state_events
-- y se derivan al leer. EDITADA A MANO sobre lo que generó drizzle-kit: el
-- paso 1 (backfill) y el 2 (borrar marcadores) garantizan que ninguna fecha
-- se pierde — cada marcador nació con un evento gemelo (misma iteración,
-- misma fecha, mismo tipo), pero si a alguno le faltara, se crea aquí ANTES
-- de borrar nada.
INSERT INTO `state_events` (`iterationId`, `type`, `occurredAt`, `datePrecision`, `note`)
SELECT s.`iterationId`, s.`milestone`, s.`startedAt`, s.`datePrecision`, NULL
FROM `sessions` s
WHERE s.`milestone` IS NOT NULL
  AND s.`iterationId` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `state_events` e
    WHERE e.`iterationId` = s.`iterationId`
      AND e.`occurredAt` = s.`startedAt`
      AND e.`type` = s.`milestone`
  );--> statement-breakpoint
DELETE FROM `sessions` WHERE `milestone` IS NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_iterations` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`gameId` integer NOT NULL,
	`label` text NOT NULL,
	`playedPlatform` text NOT NULL,
	`origin` text NOT NULL,
	`format` text,
	`manualTotalPlayed` real,
	`rating` integer,
	`extraContent` integer DEFAULT false NOT NULL,
	CONSTRAINT `fk_iterations_gameId_games_id_fk` FOREIGN KEY (`gameId`) REFERENCES `games`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__new_iterations`(`id`, `gameId`, `label`, `playedPlatform`, `origin`, `format`, `manualTotalPlayed`, `rating`, `extraContent`) SELECT `id`, `gameId`, `label`, `playedPlatform`, `origin`, `format`, `manualTotalPlayed`, `rating`, `extraContent` FROM `iterations`;--> statement-breakpoint
DROP TABLE `iterations`;--> statement-breakpoint
ALTER TABLE `__new_iterations` RENAME TO `iterations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `sessions` DROP COLUMN `milestone`;
