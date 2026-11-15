// Escrituras: plan (fijar, soltar, reordenar, añadir) y cronómetro (§13.3).
//
// Todo va por `HubQueries.write`: las MISMAS consultas del escritorio, con la
// misma puerta de escritura, firmadas como el dispositivo `web` y con
// secuencia nueva para que los PCs lo bajen. No hay buzón (F-27): lo que el
// móvil escribe existe al momento. El Durable Object atiende una petición cada
// vez, así que comprobar y escribir dentro de un `write` no se cruza con otra
// escritura (F-28).

import type {
  ActiveTimerDto,
  PlanAddRequest,
  PlanAddResponse,
  PlanPinResponse,
  PlanReorderResponse,
  TimerBeatResponse,
  TimerStopResponse,
} from '../../../../src/shared/api/v2/writes';
import type { SyncErrorCode } from '../../../../src/shared/sync/protocol';
import {
  createPlannedGame,
  isGameWriteError,
  reorderUpNext,
  setPlanPinned,
  type GameEnrichmentData,
} from '../../../../src/main/db/v2/queries/games';
import {
  beatTimer,
  getActiveTimer,
  startTimer,
  stopTimer,
  type ActiveTimer,
} from '../../../../src/main/db/v2/queries/sessions';
import { isStoreError } from '../../../../src/main/db/v2/store';
import { ok, type Outcome } from '../outcome';
import type { WebRoute } from './types';

const fail = (error: SyncErrorCode, message: string): Outcome<never> => ({
  ok: false,
  error: { error, message },
});

// ---------- Validación del cuerpo ----------

/** Un id de fila: texto corto y no vacío. */
const MAX_ID_LENGTH = 100;
/** Tope de ids en un reordenado (el Plan real tiene decenas). */
const MAX_REORDER_IDS = 1000;
const MAX_TITLE_LENGTH = 300;
const MAX_URL_LENGTH = 2000;

type Parsed<T> = { ok: true; value: T } | { ok: false; error: Outcome<never> };

const bad = (message: string): { ok: false; error: Outcome<never> } => ({
  ok: false,
  error: fail('invalid_request', message),
});

function asObject(body: unknown): Record<string, unknown> | null {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

const isId = (value: unknown): value is string =>
  typeof value === 'string' && value !== '' && value.length <= MAX_ID_LENGTH;

function idField(body: unknown, field: string): Parsed<string> {
  const value = asObject(body)?.[field];
  return isId(value) ? { ok: true, value } : bad(`${field} debe ser un texto no vacío`);
}

/** Una URL de carátula: http(s) y de tamaño razonable. */
function isHttpUrl(value: string): boolean {
  if (value.length > MAX_URL_LENGTH) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function parsePlanAdd(body: unknown): Parsed<PlanAddRequest> {
  const obj = asObject(body);
  if (!obj) return bad('el cuerpo debe ser un objeto');
  const { igdbId, title, coverUrl, releaseYear } = obj;
  if (typeof igdbId !== 'number' || !Number.isSafeInteger(igdbId) || igdbId <= 0) {
    return bad('igdbId debe ser un entero positivo');
  }
  if (typeof title !== 'string' || title.trim() === '' || title.length > MAX_TITLE_LENGTH) {
    return bad('title debe ser un texto no vacío');
  }
  if (coverUrl !== null && coverUrl !== undefined) {
    if (typeof coverUrl !== 'string' || !isHttpUrl(coverUrl)) {
      return bad('coverUrl debe ser una URL http(s) o null');
    }
  }
  if (releaseYear !== null && releaseYear !== undefined) {
    if (
      typeof releaseYear !== 'number' ||
      !Number.isInteger(releaseYear) ||
      releaseYear < 1950 ||
      releaseYear > 2100
    ) {
      return bad('releaseYear debe ser un año entre 1950 y 2100');
    }
  }
  return {
    ok: true,
    value: {
      igdbId,
      title: title.trim(),
      coverUrl: coverUrl ?? null,
      releaseYear: releaseYear ?? null,
    },
  };
}

// ---------- Plan ----------

const pinRoute =
  (pinned: boolean): WebRoute['handler'] =>
  (service, request) => {
    const id = idField(request.body, 'gameId');
    if (!id.ok) return id.error;
    const { result } = service.queries().write((ctx) => setPlanPinned(ctx, id.value, pinned));
    // false = sin entrada viva en el Plan: no existe, está borrado o ya salió.
    if (!result) return fail('not_found', "That game isn't in your Plan.");
    return ok<PlanPinResponse>({ gameId: id.value, pinned });
  };

/** Lo que da una búsqueda de IGDB y nada más: el resto lo completa un PC (§13.3). */
function minimalEnrichment(input: PlanAddRequest): GameEnrichmentData {
  return {
    title: input.title,
    igdbId: input.igdbId,
    steamAppId: null,
    steamGridDbId: null,
    coverUrl: input.coverUrl,
    heroUrl: null,
    developer: null,
    publisher: null,
    genres: null,
    officialPlatforms: null,
    releaseYear: input.releaseYear ?? null,
    releaseDate: null,
    releaseDatePrecision: null,
    summary: null,
    igdbCollections: null,
    hltbMain: null,
    hltbMainExtras: null,
    hltbCompletionist: null,
    ratingCritics: null,
    ratingCriticsCount: null,
    ratingUsers: null,
    ratingUsersCount: null,
  };
}

// ---------- Cronómetro ----------

const timerDto = (timer: ActiveTimer): ActiveTimerDto => ({
  sessionId: timer.sessionId,
  gameId: timer.gameId,
  title: timer.title,
  coverUrl: timer.coverUrl,
  startedAt: timer.startedAt.toISOString(),
  lastSeenAt: (timer.lastSeenAt ?? timer.startedAt).toISOString(),
});

export const WRITES_ROUTES: readonly WebRoute[] = [
  { method: 'POST', pattern: '/plan/pin', handler: pinRoute(true) },
  { method: 'POST', pattern: '/plan/unpin', handler: pinRoute(false) },
  {
    method: 'POST',
    pattern: '/plan/reorder',
    handler: (service, request) => {
      const ids = asObject(request.body)?.orderedIds;
      if (!Array.isArray(ids) || ids.length > MAX_REORDER_IDS || !ids.every(isId)) {
        return fail('invalid_request', 'orderedIds debe ser una lista de ids');
      }
      const orderedIds: string[] = ids;
      const { result } = service.queries().write((ctx) => reorderUpNext(ctx, orderedIds));
      return ok<PlanReorderResponse>({ applied: result });
    },
  },
  {
    method: 'POST',
    pattern: '/plan/add',
    handler: (service, request) => {
      const input = parsePlanAdd(request.body);
      if (!input.ok) return input.error;
      try {
        const { result } = service.queries().write((ctx) =>
          // Sin sellos de `external_checks`: así un PC completa la ficha.
          createPlannedGame(
            ctx,
            {
              source: { igdbId: input.value.igdbId },
              note: null,
              gameNotes: null,
              coverUrl: null,
              heroUrl: null,
              steamGridDbId: null,
            },
            minimalEnrichment(input.value),
            { stampChecks: false },
          ),
        );
        return ok<PlanAddResponse>({ gameId: result.id });
      } catch (error) {
        if (isGameWriteError(error, 'already_exists'))
          return fail('conflict', 'That game is already in your library.');
        if (isGameWriteError(error) || isStoreError(error)) {
          return fail('invalid_request', error.message);
        }
        throw error;
      }
    },
  },
  {
    method: 'GET',
    pattern: '/timer',
    handler: (service) => {
      const timer = service.queries().read((ctx) => getActiveTimer(ctx));
      return ok<ActiveTimerDto | null>(timer ? timerDto(timer) : null);
    },
  },
  {
    method: 'POST',
    pattern: '/timer/start',
    handler: (service, request) => {
      const id = idField(request.body, 'gameId');
      if (!id.ok) return id.error;
      const { result } = service.queries().write((ctx) => startTimer(ctx, id.value));
      switch (result.status) {
        case 'started':
          return ok<ActiveTimerDto>(timerDto(result.timer));
        case 'game_not_found':
          return fail('not_found', "That game doesn't exist.");
        case 'timer_running':
          return fail(
            'conflict',
            result.timer.gameId === id.value
              ? 'A timer is already running for this game.'
              : `A timer is already running (${result.timer.title}).`,
          );
        case 'live_elsewhere':
          return fail('conflict', `That game is being played on ${result.deviceName}.`);
      }
    },
  },
  {
    method: 'POST',
    pattern: '/timer/stop',
    handler: (service, request) => {
      const id = idField(request.body, 'sessionId');
      if (!id.ok) return id.error;
      const { result } = service.queries().write((ctx) => stopTimer(ctx, id.value));
      switch (result.status) {
        case 'not_found':
          return fail('not_found', "That timer doesn't exist.");
        case 'not_a_timer':
          return fail('invalid_request', "That session isn't a timer.");
        default:
          return ok<TimerStopResponse>({
            sessionId: result.timer.sessionId,
            gameId: result.timer.gameId,
            title: result.timer.title,
            startedAt: result.timer.startedAt.toISOString(),
            endedAt: result.timer.endedAt.toISOString(),
            durationSec: result.timer.durationSec,
            stoppedNow: result.status === 'stopped',
          });
      }
    },
  },
  {
    method: 'POST',
    pattern: '/timer/beat',
    handler: (service, request) => {
      const id = idField(request.body, 'sessionId');
      if (!id.ok) return id.error;
      const { result } = service.queries().write((ctx) => beatTimer(ctx, id.value));
      return ok<TimerBeatResponse>({ alive: result });
    },
  },
];
