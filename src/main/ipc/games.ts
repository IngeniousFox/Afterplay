import { ipcMain } from 'electron';
import { handleDb } from './dbHandle';
import { pickUpdateGamePatch } from './gamePatch';
import type {
  CreateGameWithDetailsInput,
  CreatePlannedGameInput,
  PromotePlannedGameInput,
  UpdateGamePatch,
} from '../../shared/types';
import { generateCuriositiesInBackground } from '../curiosities/backfill';
import { resolveGameEnrichment } from '../external/resolveGameEnrichment';
import { appCtx } from '../db/v2/appDb';
import {
  GameWriteError,
  createGameWithDetails,
  createPlannedGame,
  deleteGame,
  findLiveGameIdForIgdb,
  moveToPlan,
  planEnrichmentRequest,
  promotePlannedGame,
  reorderUpNext,
  resetEndlessState,
  setPlanPinned,
  setSteamAppId,
  updateGame,
} from '../db/v2/queries/games';
import {
  getGameById,
  getGames,
  getPlannedGameExtras,
  getPlannedGames,
} from '../db/v2/queries/library';
import { openPathResult } from '../lib/openPath';
import { queueAchievementsRefreshForGame } from '../steam/backfill';
import { notifyAchievementsActivity } from '../steam/notify';
import { warmImageCache, warmSteamData } from '../external/warmNewGame';
import type { GameId } from '../../shared/entityIds';

// warmImageCache y warmSteamData viven en external/warmNewGame.ts desde que
// el alta desde el MÓVIL (que entra por el buzón del Plan, no por aquí) se
// quedaba sin ellas. Ver el porqué allí.

// ── LO QUE PESA CADA RESPUESTA DE ESTE DOMINIO ─────────────────────────────
//
// Cada `invoke` serializa (structured clone) TODO lo que el handler devuelve,
// y estas dos listas se vuelven a pedir enteras en cada 'games:changed' (un
// arranque o cierre de sesión del watcher, un pull de Turso que trae filas,
// cualquier mutation). Medido sobre la biblioteca real —994 juegos: 333 en
// biblioteca y 661 planeados— con el payload de verdad, no con datos de
// prueba:
//
//   games:getAll            333 filas   212 KB   1,0 ms de clone (ida y vuelta)
//   games:getPlanned        661 filas   354 KB   la lista escueta, para todos
//   games:getPlannedExtras  661 filas   591 KB   SOLO con la pantalla del Plan montada
//   games:getById             1 ficha     3 KB de media, 8,2 KB el peor de los 333
//
// getAll NO tiene grasa, y esto está escrito para que nadie vuelva a
// intentarlo de oído: se auditaron sus 22 campos uno a uno contra el
// renderer y todos tienen consumidor EN LA LISTA (heroUrl es la cara
// trasera de la card, executablePath el Play del modo TV, los tres tramos
// de HLTB el overlay, manualIterations las vistas por año de Stats…).
// Quitar campos tampoco era el eje: lo caro son las FILAS, no el ancho.
// 212 KB y 1 ms no son el problema de nadie — mira otra cosa.
//
// getPlanned ERA el payload más pesado de la app: 928 KB en un solo canal,
// con el 63% en campos que solo mira la pantalla del Plan (summary 220 KB,
// steamTags 171 KB, las seis notas de crítica/Steam 85 KB, heroUrl 47 KB,
// releaseDate+precisión 43 KB). Sus otros tres consumidores (la columna de
// navegación, el Backlog flow de Stats y el "esto ya lo tienes" del
// buscador) solo leen id/igdbId/steamAppId/título/carátula/géneros/año — y
// la lista está ACTIVA fuera del Plan: SagaSection llama a usePlannedGames()
// antes de su early return, así que cualquier ficha abierta pagaba los
// 928 KB en cada 'games:changed'. Por eso va partido en DOS canales (la
// partición vive en getPlannedGames.ts, la forma en shared/types.ts y la
// unión por id en hooks/games.ts): el caso común paga ahora 354 KB por aviso
// (-62%, medido con JSON.stringify sobre los 661 reales), los extras solo
// cruzan el IPC mientras la pantalla del Plan está montada, y un pin o un
// arrastre de Up next refetchean solo la lista escueta.
// El alta 2.0 en dos pasos: la red primero (fuera de cualquier transacción) y
// después una sola escritura. Antes de ir a la red se mira si el juego ya está
// vivo: el id determinista no admite un duplicado (I-02) y la llamada se
// gastaría para nada.
const enrichForNewGame = async (
  input: CreateGameWithDetailsInput | CreatePlannedGameInput,
): Promise<Awaited<ReturnType<typeof resolveGameEnrichment>>> => {
  if ('igdbId' in input.source && findLiveGameIdForIgdb(appCtx(), input.source.igdbId) !== null) {
    throw new GameWriteError('already_exists', 'Este juego ya está en tu biblioteca o en el Plan.');
  }
  const request = planEnrichmentRequest(input);
  return resolveGameEnrichment(request.source, request.overrides);
};

export const registerGamesHandlers = (): void => {
  handleDb('games:getAll', async () => {
    return getGames(appCtx());
  });

  handleDb('games:getById', async (_event, id: GameId) => {
    return getGameById(appCtx(), id);
  });

  handleDb('games:createWithDetails', async (_event, input: CreateGameWithDetailsInput) => {
    const enrichment = await enrichForNewGame(input);
    const game = createGameWithDetails(appCtx(), input, enrichment);
    warmImageCache(game);
    warmSteamData(game);
    // Sus curiosidades del modo ambiente, de fondo (mismo espíritu que la
    // caché de imágenes): el guardado no espera a Wikipedia ni a la API.
    generateCuriositiesInBackground(game);
    // Y sus logros (LOGROS.md): el alta ya trae appid, carpeta y exe, así que
    // el juego puede tener su catálogo —y sus desbloqueos de emulador— sin
    // esperar al próximo arranque.
    void queueAchievementsRefreshForGame(game.id);
    return game;
  });

  // Sección Plan to Play (alta reducida + lista propia + paso a biblioteca).
  handleDb('games:getPlanned', async () => {
    return getPlannedGames(appCtx());
  });

  // El segundo canal de la lista del Plan (ver la tabla de payloads de
  // arriba): solo lo pide la query de extras del renderer, que únicamente
  // está suscrita mientras la pantalla del Plan está montada.
  handleDb('games:getPlannedExtras', async () => {
    return getPlannedGameExtras(appCtx());
  });

  handleDb('games:createPlanned', async (_event, input: CreatePlannedGameInput) => {
    const enrichment = await enrichForNewGame(input);
    const game = createPlannedGame(appCtx(), input, enrichment);
    warmImageCache(game);
    // Las etiquetas SÍ, a diferencia de las curiosidades: la tienda de Steam
    // contesta sobre el juego tengas la cuenta que tengas, y las etiquetas son
    // justo uno de los datos con los que la pantalla del Plan se decide.
    warmSteamData(game);
    // Curiosidades NO aquí: un Plan to Play puede ser un juego que ni ha
    // salido todavía, del que no se sabe nada — pedirle trivia al modelo en
    // ese momento es pagar por un "no lo sé" seguro, y encima lo dejaría
    // marcado como generado para siempre (una sola vez EN LA VIDA, ver
    // generate.ts), así que ni al salir el juego de verdad se le volvería a
    // preguntar. Se genera al pasar a la biblioteca (games:promote), que es
    // cuando el juego es real de verdad.
    //
    // Los logros SÍ, y aquí no hay ninguna de esas pegas: el catálogo de
    // Steam contesta tengas el juego o no, el alta ya trae el appid (viene
    // en el mismo enriquecimiento de IGDB) y la ficha de un planeado ya
    // pinta su sección de logros. Sin esto el juego se quedaba con appid
    // pero sin catálogo hasta el siguiente arranque de la app, que es la
    // única pasada que recogía a los planeados. Sin aviso en pantalla:
    // planear un juego no es haberlo jugado.
    void queueAchievementsRefreshForGame(game.id, { notify: false });
    return game;
  });

  // "Up next" (PLAN-TO-PLAY.md §2.2) — fijar/soltar un planeado como
  // prioridad de verdad. Un solo campo, sin nada externo que resolver.
  handleDb('games:setPlanPinned', async (_event, id: GameId, pinned: boolean) => {
    return setPlanPinned(appCtx(), id, pinned);
  });

  // Y reordenarlos arrastrando: reparte los timestamps de planPinnedAt que ya
  // existen en el orden nuevo (ver la query para el porqué).
  handleDb('games:reorderUpNext', async (_event, orderedIds: GameId[]) => {
    return reorderUpNext(appCtx(), orderedIds);
  });

  handleDb('games:promote', async (_event, input: PromotePlannedGameInput) => {
    const game = promotePlannedGame(appCtx(), input);
    warmImageCache(game);
    generateCuriositiesInBackground(game);
    // Pasar de plan a biblioteca es cuando el juego estrena carpeta y exe —
    // el momento exacto en que su fuente de emuladores empieza a existir.
    void queueAchievementsRefreshForGame(game.id);
    return game;
  });

  handleDb('games:moveToPlan', async (_event, gameId: GameId) => {
    return moveToPlan(appCtx(), gameId);
  });

  handleDb('games:update', async (_event, id: GameId, rawPatch: UpdateGamePatch) => {
    // El aviso explícito de siempre para el appid: tiene su propio editor y
    // mandarlo aquí es un error de quien llama, no algo que tragarse.
    if ('steamAppId' in rawPatch || 'steamAppIdManual' in rawPatch) {
      throw new Error('Use the Steam App ID editor.');
    }
    // Y cualquier otra clave fuera de la lista cerrada se descarta antes de
    // escribir: el tipo no viaja por el IPC (ver gamePatch.ts).
    const patch = pickUpdateGamePatch(rawPatch);
    const game = updateGame(appCtx(), id, patch);
    if (game) warmImageCache(game);

    // Señalar dónde está instalado un juego es JUSTO lo que le faltaba a la
    // fuente de emuladores (LOGROS.md §7): sin carpeta no se le puede escribir
    // el catálogo a Goldberg, y sin ruta del exe no se miran las dos fuentes
    // que viven junto a él. Encolar aquí evita la espera tonta de "pon la
    // ruta y reinicia" — solo cuando el patch toca esas dos claves, no en cada
    // cambio de notas o de carátula.
    if (game && ('installDirectory' in patch || 'executablePath' in patch)) {
      void queueAchievementsRefreshForGame(id);
    }
    return game;
  });

  handleDb('games:setSteamAppId', async (_event, id: GameId, appId: number) => {
    const game = setSteamAppId(appCtx(), id, appId);
    if (!game) return null;
    notifyAchievementsActivity({ kind: 'synced', gameId: id, catalogCount: 0, unlockedCount: 0 });
    warmSteamData(game);
    void queueAchievementsRefreshForGame(id, { notify: false });
    return game;
  });

  handleDb('games:delete', async (_event, id: GameId) => {
    // Borrar un juego ya no borra sus copias de partidas (§12.7, I-07): las
    // filas de save_backups y los objetos del bucket se quedan, y volver a
    // añadir el juego las recupera.
    return deleteGame(appCtx(), id);
  });

  // Conversión a endless: limpia desenlaces y marcadores de partida discreta
  // CONSERVANDO sesiones trackeadas y horas manuales (ver la query).
  handleDb('games:resetEndlessState', async (_event, id: GameId) => {
    return resetEndlessState(appCtx(), id);
  });

  // Botón Play y botón "abrir carpeta" — ni uno ni otro es acceso a datos
  // (ipcMain.handle directo, no handleDb). openPathResult comprueba que
  // exista ANTES de shell.openPath, así el mensaje ("no se encontró...") es
  // nuestro en español en vez del texto crudo del sistema operativo — y
  // sirve igual para un .exe que para un directorio (abrir carpetas en el
  // explorador es lo mismo para openPath que "ejecutar" un archivo).
  ipcMain.handle('games:launchExecutable', (_event, executablePath: string) =>
    openPathResult(executablePath),
  );

  ipcMain.handle('games:openInstallDirectory', (_event, installDirectory: string) =>
    openPathResult(installDirectory),
  );
};
