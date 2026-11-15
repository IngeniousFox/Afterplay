// Escrituras y lecturas "de usuario" sobre un cliente del arnés. Todo pasa por
// las consultas REALES de la 2.0 (`src/main/db/v2/queries`), nunca por SQL
// crudo: así lo que se sincroniza lleva los relojes y las marcas que pone la
// puerta de escritura (§8.6), y lo que se comprueba es lo que vería la app.

import { gameIdForIgdb } from '../../src/shared/sync/ids';
import { createGameWithDetails } from '../../src/main/db/v2/queries/games/createGameWithDetails';
import { deleteGame } from '../../src/main/db/v2/queries/games/deleteGame';
import { updateGame } from '../../src/main/db/v2/queries/common/updateGame';
import { getGames } from '../../src/main/db/v2/queries/library/getGames';
import { getGameById } from '../../src/main/db/v2/queries/library/getGameById';
import { getAllSessions } from '../../src/main/db/v2/queries/sessions/read';
import { closeSession } from '../../src/main/db/v2/queries/sessions/close';
import { startGameSession } from '../../src/main/db/v2/queries/sessions/start';
import { createInput, enrichment, EUR } from '../../src/main/db/v2/queries/games/__tests__/helpers';
import type { GameEnrichmentData } from '../../src/main/db/v2/queries/games/newGame';
import type { Client, World } from './harness';

export { gameIdForIgdb };

export interface AddGameOptions {
  title?: string;
  gameNotes?: string | null;
  /** Campos de la caché externa (`game_metadata`) que traería la red. */
  enrichment?: Partial<GameEnrichmentData>;
}

/** El alta normal de un juego de IGDB (con su primer playthrough). Devuelve el id (determinista). */
export function addGame(client: Client, igdbId: number, options: AddGameOptions = {}): string {
  const row = createGameWithDetails(
    client.ctx,
    createInput({ source: { igdbId }, gameNotes: options.gameNotes ?? null }),
    enrichment({ igdbId, title: options.title ?? `Juego ${igdbId}`, ...options.enrichment }),
    EUR,
  );
  return row.id;
}

/**
 * Una partida: abre la sesión medida, deja pasar `minutes` de tiempo REAL (el
 * del mundo entero) y la cierra como lo haría el watcher. Devuelve el id de la
 * sesión, o null si la consulta no la abrió.
 */
export function play(world: World, client: Client, gameId: string, minutes = 30): string | null {
  const opened = startGameSession(client.ctx, gameId, 'watcher');
  if (!opened) return null;
  world.advance(minutes * 60_000);
  closeSession(client.ctx, opened.id, { endedAt: client.ctx.now(), closedBy: 'owner' });
  return opened.id;
}

/** Abre una sesión y la deja abierta (devuelve su id o null). */
export function openSession(client: Client, gameId: string): string | null {
  return startGameSession(client.ctx, gameId, 'watcher')?.id ?? null;
}

export function setNotes(client: Client, gameId: string, notes: string | null): void {
  updateGame(client.ctx, gameId, { notes });
}

export function setCoverOverride(client: Client, gameId: string, coverUrl: string | null): void {
  updateGame(client.ctx, gameId, { coverUrl });
}

export function removeGame(client: Client, gameId: string): boolean {
  return deleteGame(client.ctx, gameId);
}

// ---------- Lo que ve el usuario ----------

/** La biblioteca: títulos vivos, ordenados. */
export function libraryTitles(client: Client): string[] {
  return getGames(client.ctx)
    .map((game) => game.title)
    .sort();
}

export function libraryIds(client: Client): string[] {
  return getGames(client.ctx)
    .map((game) => game.id)
    .sort();
}

/** Las sesiones del historial: [juego, id], ordenadas. */
export function visibleSessions(client: Client): { id: string; gameId: string; title: string }[] {
  return getAllSessions(client.ctx)
    .map((s) => ({ id: s.id, gameId: s.gameId, title: s.gameTitle }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** La ficha del juego tal como la ve la app, o null si no existe o está borrado. */
export function detail(client: Client, gameId: string): ReturnType<typeof getGameById> {
  return getGameById(client.ctx, gameId);
}
