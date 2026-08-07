-- El id de SteamGridDB se muda de columna: steamGridDbId (UNIQUE por error —
-- dos fichas de IGDB que son la misma caja para SteamGridDB comparten id, y
-- el alta de la segunda reventaba) pasa a sgdbId, sin UNIQUE. Patrón
-- expandir-sin-contraer: quitar el UNIQUE en sitio es IMPOSIBLE en este stack
-- (reconstruir la tabla costó producción dos veces el 7-ago-2026,
-- writable_schema está bloqueado en el servidor de Turso y DROP COLUMN es
-- ilegal sobre columna indexada — ver schema.ts). La vieja queda muerta: el
-- código ya no la nombra y las filas nuevas la dejan a NULL.
--
-- EDITADA A MANO sobre lo que generó drizzle-kit (mismo precedente que
-- sessions_v2): el paso 2 copia los valores existentes para que ningún juego
-- pierda su id en la mudanza. Dos sentencias simples — ALTER ADD y UPDATE —,
-- las únicas clases de cambio que este esquema se permite.
ALTER TABLE `games` ADD `sgdbId` integer;--> statement-breakpoint
UPDATE `games` SET `sgdbId` = `steamGridDbId` WHERE `steamGridDbId` IS NOT NULL;
