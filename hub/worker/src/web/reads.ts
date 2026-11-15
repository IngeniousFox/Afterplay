// Lecturas: biblioteca, plan, ficha, logros, curiosidades, sesiones y estadísticas (§13.2).
//
// Cada ruta llama a una consulta del ESCRITORIO (`src/main/db/v2/queries`) a
// través de `service.queries().read(...)` y solo TRANSFORMA su resultado al
// tipo de la API (`src/shared/api/v2/reads.ts`): fechas a ms y fuera todo lo
// que sea de un PC (F-31). Los campos se copian UNO A UNO (lista blanca): si
// una consulta gana una ruta local mañana, no llega a la PWA. Aquí no hay SQL
// ni reglas de dominio (F-26).
//
// Caché (§9.7): el resultado de cada lectura se guarda con la secuencia del
// inquilino y se devuelve mientras no cambie (`readCache.ts`).

import { getGameAchievements } from '../../../../src/main/db/v2/queries/achievements';
import {
  getGameById,
  getGames,
  getInstalledOn,
  getPlannedGameExtras,
  getPlannedGames,
  getStatsSummary,
} from '../../../../src/main/db/v2/queries/library';
import { getGameCuriosities } from '../../../../src/main/db/v2/queries/loop';
import {
  countAllSessions,
  getAllSessions,
  isGameAlive,
} from '../../../../src/main/db/v2/queries/sessions';
import {
  SESSIONS_PAGE_DEFAULT,
  SESSIONS_PAGE_MAX,
  type GameAchievements,
  type GameDetail,
  type GameSession,
  type IterationDetail,
  type LibraryGame,
  type PlannedGame,
  type SessionPage,
  type SessionWithGame,
  type StatsSummary,
} from '../../../../src/shared/api/v2/reads';
import type { Session } from '../../../../src/shared/dto';
import type {
  GameAchievements as DesktopAchievements,
  GameDetail as DesktopGameDetail,
  GameListItem,
  PlannedGameExtras,
  PlannedGameListItem,
  SessionWithGame as DesktopSession,
} from '../../../../src/shared/types';
import { yearOf } from '../../../../src/shared/yearOf';
import type { SyncErrorBody } from '../../../../src/shared/sync/protocol';
import { ok, type Outcome } from '../outcome';
import type { TenantService } from '../tenantService';
import { ReadCache } from './readCache';
import type { WebRoute } from './types';

// ---------- Errores ----------

const fail = (error: SyncErrorBody['error'], message: string): Outcome<never> => ({
  ok: false,
  error: { error, message },
});
const notFound = (what: string): Outcome<never> => fail('not_found', `${what} no existe`);

// ---------- Caché por inquilino ----------

// Una por `TenantService` (= por Durable Object), sin tocar su clase.
const caches = new WeakMap<TenantService, ReadCache>();

/**
 * La lectura `key` con la caché por secuencia: si la secuencia del inquilino no
 * ha cambiado desde que se calculó, se devuelve tal cual (cero filas leídas
 * salvo la de `tenant_meta`). `compute` devuelve `null` si no existe (no se
 * guarda).
 */
function cachedRead<T>(
  service: TenantService,
  key: string,
  compute: () => T | null,
  what: string,
): Outcome<T> {
  let cache = caches.get(service);
  if (!cache) caches.set(service, (cache = new ReadCache()));
  const seq = service.hub.currentSeq();
  const hit = cache.get(seq, key);
  if (hit !== undefined) return ok(hit as T);
  const value = compute();
  if (value === null) return notFound(what);
  cache.set(seq, key, value);
  return ok(value);
}

// ---------- Transformaciones (consulta del escritorio -> tipo de la API) ----------

const ms = (date: Date): number => date.getTime();
const msOrNull = (date: Date | null): number | null => (date === null ? null : date.getTime());

function toLibraryGame(game: GameListItem<string>): LibraryGame {
  return {
    id: game.id,
    title: game.title,
    coverUrl: game.coverUrl,
    releaseYear: game.releaseYear,
    totalHours: game.totalHours,
    sessionCount: game.sessionCount,
    currentState: game.currentState,
    lastPlayedAt: msOrNull(game.lastPlayedAt),
    isLive: game.isLive,
    liveSince: msOrNull(game.liveSince),
    liveDeviceId: game.liveDeviceId ?? null,
  };
}

function toPlannedGame(
  game: PlannedGameListItem<string>,
  extras: PlannedGameExtras<string> | undefined,
): PlannedGame {
  return {
    id: game.id,
    title: game.title,
    coverUrl: game.coverUrl,
    releaseYear: game.releaseYear,
    releaseDate: msOrNull(extras?.releaseDate ?? null),
    releaseDatePrecision: extras?.releaseDatePrecision ?? null,
    genres: game.genres,
    hltbMain: game.hltbMain,
    endless: game.endless,
    // En la lista del Plan `addedAt` ya es "desde cuándo espera" (planWaitingSince).
    addedAt: ms(game.addedAt),
    pinnedAt: msOrNull(game.planPinnedAt),
    planNote: extras?.planNote ?? null,
    ratingCritics: extras?.ratingCritics ?? null,
    ratingCriticsCount: extras?.ratingCriticsCount ?? null,
    ratingUsers: extras?.ratingUsers ?? null,
    ratingUsersCount: extras?.ratingUsersCount ?? null,
    steamPositive: extras?.steamPositive ?? null,
    steamNegative: extras?.steamNegative ?? null,
  };
}

function toGameSession(session: Session<string>): GameSession {
  return {
    id: session.id,
    iterationId: session.iterationId,
    emulatorId: session.emulatorId,
    isManual: session.isManual,
    startedAt: ms(session.startedAt),
    endedAt: msOrNull(session.endedAt),
    durationSec: session.durationSec,
    datePrecision: session.datePrecision,
    note: session.note,
    deviceId: session.deviceId,
    startedBy: session.startedBy,
  };
}

function toIteration(iteration: DesktopGameDetail<string>['iterations'][number]): IterationDetail {
  const edge = (event: typeof iteration.startEvent): IterationDetail['startEvent'] =>
    event === null
      ? null
      : { id: event.id, occurredAt: ms(event.occurredAt), datePrecision: event.datePrecision };
  return {
    id: iteration.id,
    label: iteration.label,
    playedPlatform: iteration.playedPlatform,
    origin: iteration.origin,
    format: iteration.format,
    manualTotalPlayed: iteration.manualTotalPlayed,
    rating: iteration.rating,
    extraContent: iteration.extraContent,
    hours: iteration.hours,
    startedAt: msOrNull(iteration.startedAt),
    endedAt: msOrNull(iteration.endedAt),
    startEvent: edge(iteration.startEvent),
    endEvent: edge(iteration.endEvent),
    startedBySession: iteration.startedBySession,
    currentState: iteration.currentState,
    sessions: iteration.sessions.map(toGameSession),
    spend: iteration.spend,
  };
}

function toGameDetail(
  game: DesktopGameDetail<string>,
  installedOn: GameDetail['installedOn'],
): GameDetail {
  // La sesión abierta más reciente de cualquier playthrough.
  let liveSince: number | null = null;
  for (const iteration of game.iterations) {
    for (const session of iteration.sessions) {
      if (session.endedAt !== null) continue;
      const startedAt = ms(session.startedAt);
      if (liveSince === null || startedAt > liveSince) liveSince = startedAt;
    }
  }
  return {
    id: game.id,
    title: game.title,
    coverUrl: game.coverUrl,
    heroUrl: game.heroUrl,
    igdbId: game.igdbId,
    steamAppId: game.steamAppId,
    releaseYear: game.releaseYear,
    releaseDate: msOrNull(game.releaseDate),
    releaseDatePrecision: game.releaseDatePrecision,
    genres: game.genres,
    officialPlatforms: game.officialPlatforms,
    developer: game.developer,
    publisher: game.publisher,
    summary: game.summary,
    igdbCollections: game.igdbCollections,
    isEmulated: game.isEmulated,
    endless: game.endless,
    planned: game.planned,
    addedAt: ms(game.addedAt),
    planPinnedAt: msOrNull(game.planPinnedAt),
    planHistory: game.planHistory
      ? {
          plannedAt: ms(game.planHistory.plannedAt),
          note: game.planHistory.note,
          leftAt: msOrNull(game.planHistory.leftAt),
        }
      : null,
    notes: game.notes,
    installedOn,
    hltbMain: game.hltbMain,
    hltbMainExtras: game.hltbMainExtras,
    hltbCompletionist: game.hltbCompletionist,
    ratingCritics: game.ratingCritics,
    ratingCriticsCount: game.ratingCriticsCount,
    ratingUsers: game.ratingUsers,
    ratingUsersCount: game.ratingUsersCount,
    steamTags: game.steamTags,
    steamPositive: game.steamPositive,
    steamNegative: game.steamNegative,
    totalHours: game.totalHours,
    currentState: game.currentState,
    isLive: game.isLive,
    liveSince,
    totalSpend: game.totalSpend,
    costPerHour: game.costPerHour,
    iterations: game.iterations.map(toIteration),
    stateHistory: game.stateHistory.map((event) => ({
      id: event.id,
      iterationId: event.iterationId,
      type: event.type,
      occurredAt: ms(event.occurredAt),
      datePrecision: event.datePrecision,
      note: event.note,
    })),
    spendHistory: game.spendHistory.map((event) => ({
      id: event.id,
      type: event.type,
      amount: event.amount,
      occurredAt: ms(event.occurredAt),
      datePrecision: event.datePrecision,
      note: event.note,
    })),
  };
}

function toAchievements(result: DesktopAchievements<string>): GameAchievements {
  return {
    gameId: result.gameId,
    steamAppId: result.steamAppId,
    syncedAt: msOrNull(result.syncedAt),
    unlocksSyncedAt: msOrNull(result.unlocksSyncedAt),
    entries: result.entries.map((entry) => ({
      id: entry.id,
      apiName: entry.apiName,
      displayName: entry.displayName,
      description: entry.description,
      iconUrl: entry.iconUrl,
      iconGrayUrl: entry.iconGrayUrl,
      hidden: entry.hidden,
      globalPercent: entry.globalPercent,
      unlockedAt: msOrNull(entry.unlockedAt),
      dateReliable: entry.dateReliable,
      sources: entry.sources,
    })),
    completion: result.completion.map((item) => ({
      source: item.source,
      total: item.total,
      unlocked: item.unlocked,
      complete: item.complete,
      known: item.known,
      completedAt: msOrNull(item.completedAt),
    })),
  };
}

function toSessionWithGame(session: DesktopSession<string>): SessionWithGame {
  return {
    id: session.id,
    iterationId: session.iterationId,
    gameId: session.gameId,
    gameTitle: session.gameTitle,
    coverUrl: session.coverUrl,
    isManual: session.isManual,
    startedAt: ms(session.startedAt),
    endedAt: msOrNull(session.endedAt),
    durationSec: session.durationSec,
    datePrecision: session.datePrecision,
    note: session.note,
    deviceId: session.deviceId,
  };
}

// ---------- Parámetros ----------

/** Un entero no negativo escrito con dígitos, o null si no lo es. */
function parseCount(raw: string | undefined, fallback: number): number | null {
  if (raw === undefined) return fallback;
  if (!/^\d{1,9}$/.test(raw)) return null;
  return Number(raw);
}

/** ¿Es una zona IANA que el motor conoce? */
function isTimeZone(zone: string): boolean {
  if (zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

// ---------- Rutas ----------

export const READS_ROUTES: readonly WebRoute[] = [
  {
    method: 'GET',
    pattern: '/library',
    handler: (service) =>
      cachedRead(
        service,
        'library',
        () =>
          service
            .queries()
            .read((ctx) => getGames(ctx))
            .map(toLibraryGame),
        'la biblioteca',
      ),
  },
  {
    method: 'GET',
    pattern: '/plan',
    handler: (service) =>
      cachedRead(
        service,
        'plan',
        () =>
          service.queries().read((ctx) => {
            const extras = new Map(getPlannedGameExtras(ctx).map((extra) => [extra.id, extra]));
            return getPlannedGames(ctx).map((game) => toPlannedGame(game, extras.get(game.id)));
          }),
        'el plan',
      ),
  },
  {
    method: 'GET',
    pattern: '/games/:id',
    handler: (service, _request, params) =>
      cachedRead(
        service,
        `game:${params.id}`,
        () =>
          service.queries().read((ctx) => {
            const game = getGameById(ctx, params.id);
            if (!game) return null;
            const installedOn = getInstalledOn(ctx, params.id).map((install) => ({
              deviceId: install.deviceId,
              deviceName: install.deviceName,
            }));
            return toGameDetail(game, installedOn);
          }),
        'el juego',
      ),
  },
  {
    method: 'GET',
    pattern: '/games/:id/achievements',
    handler: (service, _request, params) =>
      cachedRead(
        service,
        `achievements:${params.id}`,
        () =>
          service.queries().read((ctx) =>
            // La consulta de logros devuelve un resultado vacío para un juego
            // que no existe; la API distingue "no existe" de "sin logros".
            isGameAlive(ctx, params.id)
              ? toAchievements(getGameAchievements(ctx, params.id))
              : null,
          ),
        'el juego',
      ),
  },
  {
    method: 'GET',
    pattern: '/games/:id/curiosities',
    handler: (service, _request, params) =>
      cachedRead(
        service,
        `curiosities:${params.id}`,
        () =>
          service
            .queries()
            .read((ctx) =>
              isGameAlive(ctx, params.id) ? getGameCuriosities(ctx, params.id) : null,
            ),
        'el juego',
      ),
  },
  {
    method: 'GET',
    pattern: '/sessions',
    handler: (service, request) => {
      const limit = parseCount(request.query.limit, SESSIONS_PAGE_DEFAULT);
      const offset = parseCount(request.query.offset, 0);
      if (limit === null || limit < 1 || limit > SESSIONS_PAGE_MAX) {
        return fail('invalid_request', `limit debe ser un entero entre 1 y ${SESSIONS_PAGE_MAX}`);
      }
      if (offset === null) return fail('invalid_request', 'offset debe ser un entero no negativo');
      return cachedRead<SessionPage>(
        service,
        `sessions:${limit}:${offset}`,
        () =>
          service.queries().read((ctx) => ({
            sessions: getAllSessions(ctx, { limit, offset }).map(toSessionWithGame),
            total: countAllSessions(ctx),
            limit,
            offset,
          })),
        'las sesiones',
      );
    },
  },
  {
    method: 'GET',
    pattern: '/stats/summary',
    handler: (service, request) => {
      // El año se lee en el reloj de quien mira; un Durable Object no tiene zona.
      const timeZone = request.query.tz ?? null;
      if (timeZone !== null && !isTimeZone(timeZone)) {
        return fail('invalid_request', 'tz no es una zona horaria conocida');
      }
      // El año cambia sin que cambie la secuencia: va en la clave.
      const year = yearOf(new Date(service.hub.hubNow()), timeZone);
      return cachedRead<StatsSummary>(
        service,
        `stats:${timeZone ?? ''}:${year}`,
        () => service.queries().read((ctx) => getStatsSummary(ctx, { timeZone })),
        'las estadísticas',
      );
    },
  },
];
