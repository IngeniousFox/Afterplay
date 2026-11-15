import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { formatClock } from '../../../../../../shared/sync/clock';
import type { LocalDatabase } from '../../../connection';
import { registry, type SyncedTableName } from '../../../registry';
import type {
  AchievementCatalogItem,
  AchievementSource,
  CheckStatus,
  DatePrecision,
  ExternalCheckSource,
  SessionClosedBy,
  SessionSource,
  StateEventDatePrecision,
  StateEventType,
  UnlockOrigin,
} from '../../../schema';
import type { CreateValues, ForeignWriteRule } from '../../../store';
import { idForNewRow } from '../../../store/ids';
import { LOCAL, OTHER, T0, fakeWall, openTestDb, type FakeWall } from '../../../__tests__/helpers';
import { writeCheck } from '../checks';
import { createQueryContext, type QueryContext } from '../context';
import { ensureThisDevice } from '../device';
import { computeDurationSec } from '../sessionsClose';

// Fixtures de los tests de las consultas 2.0 (CONSULTAS.md §4). Las usan los
// ocho paquetes: léelas antes de escribir las tuyas.
//
// - `openQueryDb()` abre una base 2.0 en memoria con las migraciones de
//   verdad, ESTE dispositivo ya creado (`ensureThisDevice`) y un reloj de
//   pared falso parado en `T0` (2025-11-13). Cerrar con `fx.close()`.
// - `seed*` crean filas POR LA PUERTA, con valores por defecto sensatos y
//   fechas deterministas (por defecto, la hora del reloj falso), y devuelven
//   el id (texto). Para fechas distintas: `at(ms)` / `day(n)`, o avanzar el
//   reloj (`fx.wall.advance(ms)`). Los ids de texto no se escriben a mano en
//   los tests: se guardan los que devuelven los seeds (o se buscan por
//   título), como pide §20.3.1.
// - `asOtherDevice` simula OTRA MÁQUINA: escribe filas de otro `deviceId` como
//   si hubieran llegado por sync, por debajo de la puerta (la regla del dueño
//   no las dejaría crear). Es la forma de probar que una consulta filtra por
//   dispositivo. Solo en tests: la barrera de §8.6 no recorre `__tests__`.
//
// Todo con datos inventados.

export { LOCAL, OTHER, T0 };

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** `T0 + ms`. */
export const at = (ms: number): Date => new Date(T0 + ms);
/** `T0 + n días`. */
export const day = (n: number): Date => new Date(T0 + n * DAY_MS);
export const hours = (n: number): number => n * HOUR_MS;

export interface QueryFixture {
  readonly local: LocalDatabase;
  readonly ctx: QueryContext;
  /** El reloj de pared de la puerta y de `ctx.now()`. */
  readonly wall: FakeWall;
  close(): void;
}

export interface OpenQueryDbOptions {
  /** Por defecto `LOCAL`. */
  readonly deviceId?: string;
  /** Por defecto `T0`. */
  readonly start?: number;
  /** Por defecto true. Con false, la base queda sin la fila de este PC. */
  readonly withThisDevice?: boolean;
  /**
   * El reloj del sistema en vez del falso. Para probar código que mide contra
   * `Date.now()` (el vigilante de procesos); `fx.wall` sigue existiendo, pero
   * `advance`/`set` no mueven nada.
   */
  readonly realClock?: boolean;
  /** Excepciones a la regla del dueño registradas en la puerta (como hace `runtime.ts`). */
  readonly foreignWriteRules?: readonly ForeignWriteRule[];
}

export function openQueryDb(options: OpenQueryDbOptions = {}): QueryFixture {
  const wall: FakeWall = options.realClock
    ? { wall: () => Date.now(), advance: () => {}, set: () => {} }
    : fakeWall(options.start ?? T0);
  const local = openTestDb({
    deviceId: options.deviceId ?? LOCAL,
    wall: wall.wall,
    foreignWriteRules: options.foreignWriteRules,
  });
  const ctx = createQueryContext(local, { now: () => new Date(wall.wall()) });
  if (options.withThisDevice ?? true) {
    ensureThisDevice(ctx, {
      name: 'PC-A',
      home: 'C:\\Users\\ana',
      appVersion: '2.0.0-test',
      schemaVersion: 1,
      now: ctx.now(),
    });
  }
  return { local, ctx, wall, close: () => local.close() };
}

// ── Juegos ──────────────────────────────────────────────────────────────────

type GameValues = CreateValues<'games'>;
type MetadataValues = Omit<CreateValues<'game_metadata'>, 'gameId' | 'id'>;

export interface SeedGameOptions extends Partial<Omit<GameValues, 'title' | 'id'>> {
  readonly title: string;
  /** Crea `plan_entries` viva. `true` = planeado ahora, sin fijar. */
  readonly planned?: boolean | Omit<SeedPlanOptions, 'gameId'>;
  /** Fila de `game_metadata` (la caché externa). */
  readonly metadata?: MetadataValues;
  /** Instalación en ESTE PC. */
  readonly install?: Omit<SeedInstallOptions, 'gameId'>;
}

/**
 * Un juego. `addedAt` por defecto es la hora del reloj; `saveKey` se fija como
 * lo hará el alta (§7.4: el `igdbId` si existe, si no el id).
 */
export function seedGame(ctx: QueryContext, options: SeedGameOptions): string {
  const { planned, metadata, install, ...values } = options;
  return ctx.store.transaction(() => {
    const igdbId = values.igdbId ?? null;
    const { id } = ctx.store.create('games', {
      addedAt: ctx.now(),
      ...values,
      ...(igdbId !== null && values.saveKey === undefined ? { saveKey: String(igdbId) } : {}),
    });
    if (igdbId === null && values.saveKey === undefined) {
      ctx.store.patch('games', id, { saveKey: id });
    }
    if (metadata) ctx.store.create('game_metadata', { gameId: id, ...metadata });
    if (planned) seedPlanEntry(ctx, { gameId: id, ...(planned === true ? {} : planned) });
    if (install) seedInstall(ctx, { gameId: id, ...install });
    return id;
  });
}

export interface SeedPlanOptions {
  readonly gameId: string;
  readonly plannedAt?: Date;
  readonly pinnedAt?: Date | null;
  readonly note?: string | null;
}

export function seedPlanEntry(ctx: QueryContext, options: SeedPlanOptions): string {
  const { gameId, plannedAt, ...rest } = options;
  return ctx.store.create('plan_entries', { gameId, plannedAt: plannedAt ?? ctx.now(), ...rest })
    .id;
}

export interface SeedInstallOptions {
  readonly gameId: string;
  readonly executablePath?: string | null;
  readonly installDirectory?: string | null;
  readonly installSizeBytes?: number | null;
  readonly lastVerifiedAt?: Date | null;
}

/** Instalación del juego en ESTE PC. Por defecto con un ejecutable inventado. */
export function seedInstall(ctx: QueryContext, options: SeedInstallOptions): string {
  const { gameId, ...rest } = options;
  return ctx.store.create('game_installs', {
    gameId,
    deviceId: ctx.deviceId,
    executablePath: `C:\\Games\\${gameId.slice(0, 8)}\\game.exe`,
    lastVerifiedAt: ctx.now(),
    ...rest,
  }).id;
}

// ── Playthroughs, estados, sesiones y gasto ────────────────────────────────

export interface SeedPlaythroughOptions extends Partial<
  Omit<CreateValues<'playthroughs'>, 'gameId' | 'id'>
> {
  readonly gameId: string;
}

/** Un playthrough. Por defecto PC / Steam, sin etiqueta propia (automática). */
export function seedPlaythrough(ctx: QueryContext, options: SeedPlaythroughOptions): string {
  return ctx.store.create('playthroughs', {
    playedPlatform: 'PC',
    origin: 'Steam',
    ...options,
  }).id;
}

export interface SeedStateEventOptions {
  readonly playthroughId: string;
  readonly type?: StateEventType;
  readonly occurredAt?: Date;
  readonly datePrecision?: StateEventDatePrecision;
  readonly note?: string | null;
}

/** Un evento de estado de este PC. Por defecto `started`, ahora, precisión de día. */
export function seedStateEvent(ctx: QueryContext, options: SeedStateEventOptions): string {
  return ctx.store.create('state_events', {
    type: 'started',
    occurredAt: ctx.now(),
    datePrecision: 'day',
    deviceId: ctx.deviceId,
    ...options,
  }).id;
}

export interface SeedSessionOptions {
  readonly playthroughId?: string | null;
  readonly emulatorId?: string | null;
  readonly startedAt?: Date;
  /** Por defecto una hora después del inicio. `null` = abierta. */
  readonly endedAt?: Date | null;
  readonly startedBy?: 'watcher' | 'play' | 'timer';
  readonly datePrecision?: DatePrecision;
  readonly closedBy?: SessionClosedBy | null;
  readonly lastSeenAt?: Date | null;
  readonly note?: string | null;
  /** Por defecto `measured`; `legacy_manual` es la sesión tecleada de la 1.x. */
  readonly source?: SessionSource;
}

function sessionValues(
  deviceId: string,
  now: Date,
  options: SeedSessionOptions,
): CreateValues<'sessions'> {
  const startedAt = options.startedAt ?? now;
  const endedAt =
    options.endedAt === undefined ? new Date(startedAt.getTime() + HOUR_MS) : options.endedAt;
  return {
    playthroughId: options.playthroughId ?? null,
    emulatorId: options.emulatorId ?? null,
    deviceId,
    startedBy: options.startedBy ?? 'watcher',
    source: options.source ?? 'measured',
    startedAt,
    endedAt,
    durationSec: endedAt === null ? null : computeDurationSec(startedAt, endedAt),
    datePrecision: options.datePrecision ?? 'datetime',
    lastSeenAt: options.lastSeenAt ?? endedAt ?? startedAt,
    closedBy: options.closedBy !== undefined ? options.closedBy : endedAt === null ? null : 'owner',
    ...(options.note !== undefined ? { note: options.note } : {}),
  };
}

/**
 * Una sesión de ESTE PC (medida, del watcher). Cerrada de una hora por
 * defecto; `endedAt: null` la deja abierta. Hace falta `playthroughId` o
 * `emulatorId` (sin asignar).
 */
export function seedSession(ctx: QueryContext, options: SeedSessionOptions): string {
  return ctx.store.create('sessions', sessionValues(ctx.deviceId, ctx.now(), options)).id;
}

export interface SeedSpendOptions extends Partial<
  Omit<CreateValues<'spend_events'>, 'gameId' | 'id'>
> {
  readonly gameId: string;
}

/** Un gasto: compra de 10 EUR, ahora, precisión de día. */
export function seedSpendEvent(ctx: QueryContext, options: SeedSpendOptions): string {
  return ctx.store.create('spend_events', {
    type: 'purchase',
    amount: 10,
    currency: 'EUR',
    occurredAt: ctx.now(),
    datePrecision: 'day',
    ...options,
  }).id;
}

// ── Emuladores ──────────────────────────────────────────────────────────────

export interface SeedEmulatorOptions {
  readonly name: string;
  /** Ruta en ESTE PC. `null` = sin instalación aquí. */
  readonly executablePath?: string | null;
}

export function seedEmulator(ctx: QueryContext, options: SeedEmulatorOptions): string {
  return ctx.store.transaction(() => {
    const { id } = ctx.store.create('emulators', { name: options.name });
    const path =
      options.executablePath === undefined
        ? `C:\\Emulators\\${options.name}.exe`
        : options.executablePath;
    if (path !== null) {
      ctx.store.create('emulator_installs', {
        emulatorId: id,
        deviceId: ctx.deviceId,
        executablePath: path,
      });
    }
    return id;
  });
}

// ── Logros, comprobaciones, curiosidades, partidas, radar ──────────────────

export interface SeedCatalogOptions {
  readonly gameId: string;
  readonly source?: AchievementSource;
  /** Por defecto tres logros `ACH_1…ACH_3`. Los campos que falten se inventan. */
  readonly items?: readonly (Partial<AchievementCatalogItem> & { apiName: string })[];
  readonly fetchedAt?: Date;
}

export function seedCatalog(ctx: QueryContext, options: SeedCatalogOptions): string {
  const raw = options.items ?? [{ apiName: 'ACH_1' }, { apiName: 'ACH_2' }, { apiName: 'ACH_3' }];
  const items: AchievementCatalogItem[] = raw.map((item, index) => ({
    displayName: item.apiName,
    description: null,
    iconUrl: null,
    iconGrayUrl: null,
    hidden: false,
    globalPercent: null,
    sortIndex: index,
    ...item,
  }));
  return ctx.store.create('achievement_catalogs', {
    gameId: options.gameId,
    source: options.source ?? 'steam',
    items,
    fetchedAt: options.fetchedAt ?? ctx.now(),
  }).id;
}

export interface SeedUnlockOptions {
  readonly gameId: string;
  readonly apiName: string;
  readonly source?: AchievementSource;
  /** Por defecto el de la fuente (`steam` o `ra`). */
  readonly origin?: UnlockOrigin;
  readonly unlockedAt?: Date;
  readonly dateReliable?: boolean;
  readonly playthroughId?: string | null;
  readonly sessionId?: string | null;
}

export function seedUnlock(ctx: QueryContext, options: SeedUnlockOptions): string {
  const source = options.source ?? 'steam';
  return ctx.store.create('achievement_unlocks', {
    gameId: options.gameId,
    source,
    apiName: options.apiName,
    origin: options.origin ?? source,
    unlockedAt: options.unlockedAt ?? ctx.now(),
    dateReliable: options.dateReliable ?? true,
    playthroughId: options.playthroughId ?? null,
    sessionId: options.sessionId ?? null,
  }).id;
}

export interface SeedCheckOptions {
  readonly gameId: string;
  readonly source: ExternalCheckSource;
  readonly status?: CheckStatus;
  readonly checkedAt?: Date;
  readonly error?: string | null;
}

/** Una comprobación externa con la política real (`writeCheck`). */
export function seedCheck(ctx: QueryContext, options: SeedCheckOptions): void {
  const written = writeCheck(ctx, options.gameId, options.source, options.status ?? 'ok', {
    checkedAt: options.checkedAt,
    error: options.error,
  });
  if (!written) throw new Error(`seedCheck: el juego ${options.gameId} no está vivo`);
}

export function seedCuriosities(
  ctx: QueryContext,
  options: { gameId: string; items?: string[]; generatedAt?: Date; model?: string | null },
): string {
  return ctx.store.create('game_curiosities', {
    gameId: options.gameId,
    items: options.items ?? ['Una curiosidad inventada.'],
    generatedAt: options.generatedAt ?? ctx.now(),
    model: options.model ?? null,
  }).id;
}

export interface SeedSaveBackupOptions extends Partial<
  Omit<CreateValues<'save_backups'>, 'gameId' | 'deviceId' | 'id'>
> {
  readonly gameId: string;
}

/** Una copia de partida de ESTE PC. */
export function seedSaveBackup(ctx: QueryContext, options: SeedSaveBackupOptions): string {
  const backupName = options.backupName ?? `backup-${ctx.now().getTime()}`;
  return ctx.store.create('save_backups', {
    deviceId: ctx.deviceId,
    backupName,
    r2Key: `saves/${options.gameId}/${ctx.deviceId}/${backupName}.zip`,
    ludusaviName: 'Juego Inventado',
    createdAt: ctx.now(),
    ...options,
  }).id;
}

export function seedRadarGame(
  ctx: QueryContext,
  options: Partial<Omit<CreateValues<'radar_games'>, 'id'>> & { igdbId: number; title: string },
): string {
  return ctx.store.create('radar_games', { discoveredAt: ctx.now(), ...options }).id;
}

// ── Otra máquina ────────────────────────────────────────────────────────────

/** Id corto con el que firma "la otra máquina" sus relojes. */
const OTHER_SHORT_ID = 'pcbbbb';

let syncedCounter = 0;

/**
 * Una fila de cualquier tabla sincronizada escrita como si hubiera llegado por
 * sync: por debajo de la puerta (ni regla del dueño ni de sesión abierta
 * única), con relojes firmados por `shortId` y `syncDirty = 0`. El id se
 * calcula como lo haría la puerta. Devuelve el id. Para filas de otra máquina,
 * mejor `asOtherDevice`.
 */
export function insertSynced<N extends SyncedTableName>(
  ctx: QueryContext,
  table: N,
  values: CreateValues<N>,
  shortId = OTHER_SHORT_ID,
): string {
  const entry = registry[table];
  const { id: requested, ...rest } = values as Record<string, unknown>;
  const { id } = idForNewRow(entry, rest, requested, () => ctx.now().getTime());
  const clock = formatClock(ctx.now().getTime(), syncedCounter++ % 10_000, shortId);
  ctx.db
    .insert(entry.table as SQLiteTable)
    .values({
      ...rest,
      id,
      syncCreated: clock,
      syncUpdated: clock,
      syncFields: {},
      syncDeleted: null,
      syncDirty: false,
    } as never)
    .run();
  return id;
}

export interface OtherDevice {
  readonly deviceId: string;
  /**
   * Una fila de cualquier tabla sincronizada escrita como si hubiera llegado
   * por sync: sin pasar por la puerta (ni regla del dueño, ni de sesión
   * abierta única), con relojes de la otra máquina y `syncDirty = 0`. El id se
   * calcula como lo haría la puerta. Devuelve el id.
   */
  insert<N extends SyncedTableName>(table: N, values: CreateValues<N>): string;
  /** Una sesión de la otra máquina. Mismos valores por defecto que `seedSession`. */
  seedSession(options: SeedSessionOptions): string;
  /** Su instalación de un juego. */
  seedInstall(options: SeedInstallOptions): string;
  /** Su instalación de un emulador. */
  seedEmulatorInstall(options: { emulatorId: string; executablePath?: string }): string;
  /** Una copia de partida suya. */
  seedSaveBackup(options: SeedSaveBackupOptions): string;
}

/**
 * Otra máquina del mismo usuario. Crea su fila de `devices` (tabla U:
 * cualquiera puede, como hará `recoverIndexFromCloud`) si no existe.
 */
export function asOtherDevice(
  ctx: QueryContext,
  options: { deviceId?: string; name?: string; home?: string } = {},
): OtherDevice {
  const deviceId = options.deviceId ?? OTHER;
  ctx.store.create('devices', {
    id: deviceId,
    name: options.name ?? 'PC-B',
    kind: 'desktop',
    os: 'windows',
    home: options.home ?? 'C:\\Users\\bea',
    firstSeenAt: ctx.now(),
  });
  let counter = 0;
  const insert = <N extends SyncedTableName>(table: N, values: CreateValues<N>): string =>
    insertSynced(ctx, table, values, OTHER_SHORT_ID);
  return {
    deviceId,
    insert,
    seedSession: (session) => insert('sessions', sessionValues(deviceId, ctx.now(), session)),
    seedInstall: ({ gameId, ...rest }) =>
      insert('game_installs', {
        gameId,
        deviceId,
        executablePath: `D:\\Juegos\\${gameId.slice(0, 8)}\\game.exe`,
        ...rest,
      }),
    seedEmulatorInstall: ({ emulatorId, executablePath }) =>
      insert('emulator_installs', {
        emulatorId,
        deviceId,
        executablePath: executablePath ?? 'D:\\Emus\\emu.exe',
      }),
    seedSaveBackup: ({ gameId, ...rest }) => {
      const backupName = rest.backupName ?? `backup-b-${ctx.now().getTime()}-${counter++}`;
      return insert('save_backups', {
        gameId,
        deviceId,
        backupName,
        r2Key: `saves/${gameId}/${deviceId}/${backupName}.zip`,
        ludusaviName: 'Juego Inventado',
        createdAt: ctx.now(),
        ...rest,
      });
    },
  };
}

/**
 * Pone la lápida a una fila SIN cascada, como si solo hubiera llegado por sync
 * la del padre: es el caso que la regla F-11 cubre en lectura (hijo vivo de un
 * padre borrado). Para el borrado normal, `ctx.store.remove`.
 */
export function tombstoneOnly(ctx: QueryContext, table: SyncedTableName, id: string): void {
  ctx.db.$client
    .prepare(`UPDATE "${table}" SET syncDeleted = ? WHERE id = ?`)
    .run(formatClock(ctx.now().getTime(), 9_999, OTHER_SHORT_ID), id);
}
