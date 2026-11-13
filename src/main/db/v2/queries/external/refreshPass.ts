import { and, asc, eq, isNull, or, type SQL } from 'drizzle-orm';
import { gameMetadata, games, planEntries, type KeySource } from '../../schema';
import { alive } from '../../store';
import type { QueryContext } from '../common/context';
import {
  STEAM_FIELDS_CLEARED,
  forgetSteamProductChecks,
  hasAnyHltbTime,
  hasSteamData,
  hltbFields,
  igdbBatchFields,
  readLiveIdentity,
  readMetadata,
  recordCheck,
  sameSteamIdentity,
  setAutoSteamAppId,
  steamFields,
  writeMetadata,
  type GameIdentity,
} from './internal';
import {
  isFailure,
  type AppIdResolution,
  type HltbTimesData,
  type IgdbBatchData,
  type RefreshScope,
  type SourceFailure,
  type SteamStoreData,
} from './types';

// La pasada de datos externos de la biblioteca (`external/refresh.ts`,
// `startExternalRefresh` / `runPass`): el botón del Plan (solo planeados) y el
// de Ajustes (todo). Aquí están sus dos mitades de base:
//
//   1. `selectRefreshTargets(scope)` → la foto, y más tarde
//      `selectHltbOrphans(scope, ids)` justo antes de la repesca de HLTB.
//   2. Minutos de red (IGDB por lotes, appids, etiquetas, reseñas una a una,
//      HLTB de los huérfanos), SIN nada abierto.
//   3. `applyRefreshPass(items)`: una transacción que, juego a juego, relee la
//      identidad y solo entonces escribe.
//
// Lo que cambia respecto a la 1.x:
// - La guarda de identidad ya no es todo o nada por juego. La 1.x descartaba
//   la fila entera si el appid había cambiado (`refresh.ts:543-549`); aquí se
//   descarta solo la parte que depende de lo que cambió: lo de IGDB si cambió
//   el `igdbId`, lo de Steam si cambió el appid o su origen, y los tiempos de
//   HLTB si el juego ya no es huérfano (el botón de su ficha le encontró
//   tiempos durante la pasada).
// - Sellos en `external_checks` (y no en columnas). Una respuesta repetida no
//   se re-sella (ver `recordCheck`), así que una pasada que trae lo mismo no
//   escribe nada (F-33).

/** Un juego de la foto de la pasada. */
export interface RefreshTarget {
  readonly gameId: string;
  readonly title: string;
  readonly igdbId: number | null;
  readonly steamAppId: number | null;
  readonly steamAppIdSource: KeySource | null;
}

const planned = (): SQL =>
  // Planeado = `plan_entries` viva (CONSULTAS.md §1.1.3).
  and(eq(planEntries.gameId, games.id), alive(planEntries)) as SQL;

/** Los juegos vivos del alcance, en orden de creación. */
export function selectRefreshTargets(ctx: QueryContext, scope: RefreshScope): RefreshTarget[] {
  const base = ctx.db
    .select({
      gameId: games.id,
      title: games.title,
      igdbId: games.igdbId,
      steamAppId: games.steamAppId,
      steamAppIdSource: games.steamAppIdSource,
    })
    .from(games);
  const rows =
    scope === 'plan'
      ? base
          .innerJoin(planEntries, planned())
          .where(alive(games))
          .orderBy(asc(games.syncCreated), asc(games.id))
          .all()
      : base.where(alive(games)).orderBy(asc(games.syncCreated), asc(games.id)).all();
  return rows;
}

/** Juegos sin appid a los que preguntar uno (no manuales, con igdbId). */
export const needsAppIdLookup = (
  target: RefreshTarget,
): target is RefreshTarget & {
  igdbId: number;
} => target.igdbId !== null && target.steamAppId === null && target.steamAppIdSource !== 'manual';

/** Juegos con appid automático cuyo appid se revisa (`findSteamAppIdFixes`). */
export const needsAppIdReview = (
  target: RefreshTarget,
): target is RefreshTarget & {
  igdbId: number;
  steamAppId: number;
} => target.igdbId !== null && target.steamAppId !== null && target.steamAppIdSource !== 'manual';

export interface HltbOrphan {
  readonly gameId: string;
  readonly title: string;
  readonly igdbId: number | null;
  readonly releaseYear: number | null;
}

/** Sin caché, o con los tres tramos a null (un juego sin `md` es huérfano). */
const orphanCondition = (): SQL =>
  or(
    isNull(gameMetadata.id),
    and(
      isNull(gameMetadata.hltbMain),
      isNull(gameMetadata.hltbMainExtras),
      isNull(gameMetadata.hltbCompletionist),
    ),
  ) as SQL;

/**
 * Los huérfanos de HowLongToBeat del alcance: los TRES tramos a null (uno solo
 * ya puesto = HLTB lo conoce, y refrescarlo es del botón de la ficha). Se lee
 * justo antes de la repesca, con el estado más fresco.
 *
 * `onlyGameIds`: recorta a los juegos de la foto de la pasada. Un alta durante
 * los minutos de reseñas no está en la foto y su resultado no tendría dónde
 * escribirse (el caso de `refreshHltbOrphans.test.ts`). No mira
 * `external_checks`: un "no" de HLTB (`empty`) se vuelve a preguntar en la
 * pasada siguiente, como hoy.
 */
export function selectHltbOrphans(
  ctx: QueryContext,
  scope: RefreshScope,
  onlyGameIds?: readonly string[],
): HltbOrphan[] {
  const allowed = onlyGameIds ? new Set(onlyGameIds) : null;
  const base = ctx.db
    .select({
      gameId: games.id,
      title: games.title,
      igdbId: games.igdbId,
      releaseYear: gameMetadata.releaseYear,
    })
    .from(games)
    .leftJoin(gameMetadata, and(eq(gameMetadata.gameId, games.id), alive(gameMetadata)));
  const rows =
    scope === 'plan'
      ? base
          .innerJoin(planEntries, planned())
          .where(and(alive(games), orphanCondition()))
          .orderBy(asc(games.syncCreated), asc(games.id))
          .all()
      : base
          .where(and(alive(games), orphanCondition()))
          .orderBy(asc(games.syncCreated), asc(games.id))
          .all();
  return allowed ? rows.filter((row) => allowed.has(row.gameId)) : rows;
}

/**
 * Lo que la red trajo para UN juego de la pasada. Cada campo ausente es "no se
 * preguntó"; así quien llama no tiene que inventar nada para lo que no tocó.
 */
export interface RefreshPassItem {
  /** La foto del juego, tal como salió de `selectRefreshTargets`. */
  readonly target: RefreshTarget;
  /**
   * El lote de IGDB: los datos, o `null` si IGDB no devolvió el juego (o el
   * juego no tiene igdbId). En los dos casos se apunta `igdb_ratings` como
   * `empty` sin pisar lo que hubiera, como la 1.x (`ratingsCheckedAt`).
   */
  readonly igdb: IgdbBatchData | null;
  /** Resultado de buscar o revisar el appid. Ausente = no se preguntó. */
  readonly appId?: AppIdResolution;
  /**
   * Lo que Steam supo del appid que tocaba (el corregido, el encontrado o el
   * de siempre). `null` = se preguntó y no supo nada. Ausente = no se preguntó
   * (el juego no tiene appid).
   */
  readonly steam?: SteamStoreData | null;
  /**
   * La repesca de HLTB, solo para huérfanos: tiempos, `null` (no lo conoce) o
   * un fallo. Ausente = no se le preguntó.
   */
  readonly hltb?: HltbTimesData | null | SourceFailure;
}

/** Qué se hizo con un juego al aplicar. */
export type RefreshPassGameOutcome =
  /** Borrado durante la red: no recibe nada (R-15). */
  | { readonly status: 'gone' }
  | {
      readonly status: 'applied';
      /** El appid cambió de producto o apareció: el llamador re-encola sus logros si `corrected`. */
      readonly appIdChanged: 'found' | 'corrected' | null;
      /** Partes descartadas por la relectura. */
      readonly discarded: readonly ('igdb' | 'steam' | 'hltb')[];
    };

export interface RefreshPassResult {
  readonly games: ReadonlyMap<string, RefreshPassGameOutcome>;
  /** Juegos con el appid corregido: los que hay que re-encolar en logros. */
  readonly correctedGameIds: readonly string[];
}

/**
 * Aplica la pasada entera en UNA transacción (todo o nada, como la 1.x), con
 * relectura juego a juego. Es síncrona y corta: toda la red ya pasó.
 */
export function applyRefreshPass(
  ctx: QueryContext,
  items: readonly RefreshPassItem[],
): RefreshPassResult {
  return ctx.store.transaction(() => {
    const outcomes = new Map<string, RefreshPassGameOutcome>();
    const corrected: string[] = [];
    for (const item of items) {
      const outcome = applyRefreshPassGame(ctx, item);
      outcomes.set(item.target.gameId, outcome);
      if (outcome.status === 'applied' && outcome.appIdChanged === 'corrected') {
        corrected.push(item.target.gameId);
      }
    }
    return { games: outcomes, correctedGameIds: corrected };
  });
}

/** Un juego de la pasada (también sirve suelto: abre su propia transacción). */
export function applyRefreshPassGame(
  ctx: QueryContext,
  item: RefreshPassItem,
): RefreshPassGameOutcome {
  return ctx.store.transaction((): RefreshPassGameOutcome => {
    const current = readLiveIdentity(ctx, item.target.gameId);
    if (!current) return { status: 'gone' };
    const discarded: ('igdb' | 'steam' | 'hltb')[] = [];

    // ── IGDB ──
    if (current.igdbId !== item.target.igdbId) {
      discarded.push('igdb');
    } else {
      applyIgdbBatch(ctx, current, item.igdb);
    }

    // ── Steam: appid y tienda ──
    let appIdChanged: 'found' | 'corrected' | null = null;
    if (item.appId !== undefined || item.steam !== undefined) {
      if (!sameSteamIdentity(current, item.target)) {
        discarded.push('steam');
      } else {
        appIdChanged = applySteamPart(ctx, current, item.appId, item.steam, 'all');
      }
    }

    // ── HLTB, huérfanos ──
    if (item.hltb !== undefined) {
      const md = readMetadata(ctx, current.id);
      const stillOrphan =
        !md ||
        (md.hltbMain === null && md.hltbMainExtras === null && md.hltbCompletionist === null);
      if (!stillOrphan) discarded.push('hltb');
      else applyHltb(ctx, current, item.hltb);
    }

    return { status: 'applied', appIdChanged, discarded };
  });
}

/**
 * El lote de IGDB sobre un juego cuya identidad ya se releyó. Con datos:
 * `game_metadata` + `igdb_ratings` ok. Sin datos (IGDB no lo devolvió, o no
 * tiene igdbId): solo `igdb_ratings` empty, sin pisar nada. Compartido con la
 * fase 1 del radar (`radarMembership.ts`), como `buildIgdbBatchPatch` hoy.
 */
export function applyIgdbBatch(
  ctx: QueryContext,
  current: GameIdentity,
  data: IgdbBatchData | null,
): void {
  if (data === null) {
    recordCheck(ctx, current.id, 'igdb_ratings', 'empty');
    return;
  }
  writeMetadata(ctx, current, igdbBatchFields(data));
  recordCheck(ctx, current.id, 'igdb_ratings', 'ok');
}

/**
 * Appid y datos de tienda de Steam. `current` ya está comprobado contra la
 * foto (misma identidad de Steam). Devuelve si el appid cambió.
 *
 * `clear` dice qué se tira del producto viejo al corregir: `all` (etiquetas y
 * reseñas, la pasada y la ficha) o `reviews` (solo reseñas, el ⟳ de notas,
 * que no pide etiquetas: `refreshRatings.ts:147-155`).
 */
export function applySteamPart(
  ctx: QueryContext,
  current: GameIdentity,
  appId: AppIdResolution | undefined,
  steam: SteamStoreData | null | undefined,
  clear: 'all' | 'reviews',
): 'found' | 'corrected' | null {
  let changed: 'found' | 'corrected' | null = null;
  let steamAppId = current.steamAppId;

  if (appId !== undefined && current.steamAppIdSource !== 'manual') {
    if (appId.kind === 'not-on-steam') {
      // Solo si sigue sin appid: un "no" externo no borra uno que ya hay.
      if (current.steamAppId === null) recordCheck(ctx, current.id, 'steam_appid', 'empty');
    } else if (appId.appId !== current.steamAppId) {
      setAutoSteamAppId(ctx, current, appId.appId);
      recordCheck(ctx, current.id, 'steam_appid', 'ok');
      changed = current.steamAppId === null ? 'found' : 'corrected';
      steamAppId = appId.appId;
    }
  }

  if (changed === 'corrected') forgetSteamProductChecks(ctx, current.id);

  if (steam === undefined || steamAppId === null) {
    if (changed === 'corrected') {
      writeMetadata(ctx, current, clear === 'all' ? STEAM_FIELDS_CLEARED : reviewsCleared);
    }
    return changed;
  }

  const found = hasSteamData(steam);
  const base =
    changed === 'corrected' ? (clear === 'all' ? STEAM_FIELDS_CLEARED : reviewsCleared) : {};
  // En UNA escritura: lo del producto viejo a null y lo que Steam sepa encima.
  writeMetadata(ctx, current, { ...base, ...(found ? steamFields(steam) : {}) });
  recordCheck(ctx, current.id, 'steam_store', found ? 'ok' : 'empty');
  return changed;
}

const reviewsCleared = { steamPositive: null, steamNegative: null } as const;

/** HLTB: tramos que supo + sello (ok, empty o fallo). */
export function applyHltb(
  ctx: QueryContext,
  current: GameIdentity,
  hltb: HltbTimesData | null | SourceFailure,
): void {
  if (isFailure(hltb)) {
    recordCheck(ctx, current.id, 'hltb', 'error', { error: hltb.error });
    return;
  }
  if (hltb === null || !hasAnyHltbTime(hltb)) {
    recordCheck(ctx, current.id, 'hltb', 'empty');
    return;
  }
  writeMetadata(ctx, current, hltbFields(hltb));
  recordCheck(ctx, current.id, 'hltb', 'ok');
}
