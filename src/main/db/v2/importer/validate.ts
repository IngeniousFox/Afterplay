import type { DatabaseSync } from 'node:sqlite';
import type { StateEventDatePrecision } from '../../../../shared/dateTypes';
import { deriveGameDetail } from '../../../../shared/domain/gameDetail';
import { deriveLibrary } from '../../../../shared/domain/library';
import type { PaperworkRule } from '../../../../shared/playthroughState';
import type { StateEvent } from '../../../../shared/types';
import { achievementCatalogId } from '../../../../shared/sync/ids';
import { syncedEntries } from '../registry';
import { LEGACY_EMU_ORIGIN, type ImportContext, type ImportPlan } from './build';
import { reconcileColumns, type ColumnReconciliation } from './reconcile';

// VALIDACIÓN de una importación (§19.5 "Validación"). Falla si algo no cuadra.
//
// Tres capas:
// 1. Recuentos y sumas: filas por tabla (descontando lo descartado a
//    propósito), segundos de sesión y gasto, total y por juego, desbloqueos por
//    juego y origen, tamaño de cada catálogo.
// 2. Lo que la app ENSEÑA: para cada juego, estado, horas, último día jugado,
//    fechas, gasto y coste por hora; para cada playthrough, estado, horas,
//    fechas, gasto y su etiqueta "Playthrough N". Se calcula con las reglas de
//    `src/shared/domain` sobre las filas del origen (como lo hace hoy la 1.x:
//    getGames y getGameById) y sobre las del destino (como lo hará la 2.0: el
//    papeleo del alta es `datePrecision = 'unknown'` y los desempates son por
//    `syncCreated`, R-07 y §7.4 de CONSULTAS.md). Se queda como red de
//    seguridad independiente de las consultas: lo que DEVUELVEN las
//    consultas 1.x y 2.0 lo compara `queryValidation.ts`.
// 3. La conciliación columna a columna (`reconcile.ts`), y la integridad del
//    destino (claves foráneas, enlaces lógicos, mapa de ids antiguos).
//
// El informe solo lleva números, estados, fechas, ids antiguos y nombres de
// columna: nunca títulos, notas ni rutas.

type StateType = StateEvent['type'];

export interface PlaythroughView {
  /** Id antiguo (origen) o nuevo (destino), para emparejar. */
  readonly id: string;
  readonly label: string;
  readonly state: StateType | null;
  readonly hours: number;
  readonly startedAt: number | null;
  readonly endedAt: number | null;
  readonly startedBySession: boolean;
  readonly spend: number;
}

export interface GameView {
  readonly state: StateType | null;
  readonly libraryHours: number;
  readonly detailHours: number;
  readonly sessionCount: number;
  readonly lastPlayedAt: number | null;
  readonly startedAt: number | null;
  readonly endedAt: number | null;
  /** Horas manuales con su año, en orden de playthrough (vistas por año). */
  readonly manualYears: readonly string[];
  readonly totalSpend: number;
  readonly costPerHour: number | null;
  /** Gasto que no cae en ningún playthrough (juego sin playthroughs). */
  readonly unassignedSpend: number;
  readonly trackedSeconds: number;
  readonly playthroughs: readonly PlaythroughView[];
}

export interface ValidationDifference {
  readonly check: string;
  /** Tabla 1.x y id antiguo del objeto comparado (juego, playthrough…). */
  readonly legacyTable?: string;
  readonly legacyId?: number | string;
  readonly field?: string;
  readonly expected?: string;
  readonly actual?: string;
}

export interface ValidationReport {
  readonly ok: boolean;
  /** Por comprobación: cuántas cosas se compararon y cuántas no cuadran. */
  readonly checks: Record<string, { compared: number; differences: number }>;
  readonly totals: Record<string, number>;
  readonly differences: readonly ValidationDifference[];
  readonly differenceCount: number;
  readonly columns: ColumnReconciliation;
}

const MAX_DIFFERENCES = 200;

// ── La entrada común de las reglas ──────────────────────────────────────────

interface EvalGame {
  readonly id: string;
  readonly addedAt: Date;
  readonly promotedAt: Date | null;
}
interface EvalIteration {
  /** Clave de creación: id 1.x con relleno, o `syncCreated|id` en el destino. */
  readonly key: string;
  readonly id: string;
  readonly gameId: string;
  readonly manual: number | null;
  readonly label: string;
}
interface EvalSession {
  readonly iterationKey: string | null;
  readonly isManual: boolean;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  readonly durationSec: number | null;
}
interface EvalEvent {
  readonly key: string;
  readonly iterationKey: string;
  readonly type: StateType;
  readonly occurredAt: Date;
  readonly datePrecision: StateEventDatePrecision;
}
interface EvalSpend {
  readonly gameId: string;
  readonly amount: number;
  readonly occurredAt: Date;
  /** Orden de la lectura: (fecha, creación). */
  readonly key: string;
}
interface EvalInput {
  readonly games: readonly EvalGame[];
  readonly iterations: readonly EvalIteration[];
  readonly sessions: readonly EvalSession[];
  readonly events: readonly EvalEvent[];
  readonly spends: readonly EvalSpend[];
  readonly paperwork: PaperworkRule;
}

const pad = (value: number): string => String(value).padStart(16, '0');
const later = (a: number | null, b: number | null): number | null =>
  a === null ? b : b === null ? a : Math.max(a, b);
const earlier = (a: number | null, b: number | null): number | null =>
  a === null ? b : b === null ? a : Math.min(a, b);
const ms = (date: Date | null): number | null => (date === null ? null : date.getTime());

function pushTo<K, T>(map: Map<K, T[]>, key: K, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Lo que la app enseña de cada juego, con las reglas de `shared/domain`. */
export function evaluate(input: EvalInput): Map<string, GameView> {
  const iterationsByGame = new Map<string, EvalIteration[]>();
  for (const iteration of input.iterations) pushTo(iterationsByGame, iteration.gameId, iteration);
  const iterationByKey = new Map(input.iterations.map((i) => [i.key, i]));
  const sessionsByIteration = new Map<string, EvalSession[]>();
  for (const session of input.sessions) {
    if (session.iterationKey !== null) pushTo(sessionsByIteration, session.iterationKey, session);
  }
  const eventsByIteration = new Map<string, EvalEvent[]>();
  for (const event of input.events) pushTo(eventsByIteration, event.iterationKey, event);
  const spendsByGame = new Map<string, EvalSpend[]>();
  for (const spend of [...input.spends].sort(
    (a, b) =>
      a.occurredAt.getTime() - b.occurredAt.getTime() ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  )) {
    pushTo(spendsByGame, spend.gameId, spend);
  }

  // La biblioteca (getGames): agregados de sesiones por playthrough, como el
  // SQL de iterationSessionTotals (count, sum, max(coalesce(fin, inicio)), min).
  const library = deriveLibrary({
    games: input.games,
    iterations: input.iterations.map((i) => {
      const sessions = sessionsByIteration.get(i.key) ?? [];
      let tracked = 0;
      let last: number | null = null;
      let first: number | null = null;
      for (const s of sessions) {
        tracked += s.durationSec ?? 0;
        last = later(last, (s.endedAt ?? s.startedAt).getTime());
        first = earlier(first, s.startedAt.getTime());
      }
      return {
        id: i.key,
        gameId: i.gameId,
        manualTotalPlayed: i.manual,
        sessionCount: sessions.length,
        trackedSeconds: tracked,
        lastSessionAt: last,
        firstSessionAt: first,
      };
    }),
    stateEvents: input.events.map((e) => ({
      gameId: iterationByKey.get(e.iterationKey)?.gameId ?? '?',
      iterationId: e.iterationKey,
      type: e.type,
      occurredAt: e.occurredAt,
      id: e.key,
      datePrecision: e.datePrecision,
    })),
    liveSessions: [],
    paperwork: input.paperwork,
  });

  const views = new Map<string, GameView>();
  for (const game of input.games) {
    const iterations = iterationsByGame.get(game.id) ?? [];
    const sessions = iterations.flatMap((i) =>
      (sessionsByIteration.get(i.key) ?? []).map((s) => ({ ...s, iterationId: i.key })),
    );
    const events = iterations.flatMap((i) =>
      (eventsByIteration.get(i.key) ?? []).map((e) => ({
        id: e.key,
        iterationId: i.key,
        type: e.type,
        occurredAt: e.occurredAt,
        datePrecision: e.datePrecision,
      })),
    );
    const spends = spendsByGame.get(game.id) ?? [];
    const detail = deriveGameDetail({
      iterations: iterations.map((i) => ({ id: i.key, manualTotalPlayed: i.manual })),
      sessions,
      stateEvents: events,
      spendEvents: spends,
    });
    const summary = library.get(game.id);
    const byKey = new Map(iterations.map((i) => [i.key, i]));
    let startedAt: number | null = null;
    let endedAt: number | null = null;
    const playthroughs = detail.iterations.map((d) => {
      const iteration = byKey.get(d.iteration.id) as EvalIteration;
      startedAt = earlier(startedAt, ms(d.startedAt));
      endedAt = later(endedAt, ms(d.endedAt));
      return {
        id: iteration.id,
        label: iteration.label,
        state: d.currentState,
        hours: d.hours,
        startedAt: ms(d.startedAt),
        endedAt: ms(d.endedAt),
        startedBySession: d.startedBySession,
        spend: d.spend,
      };
    });
    views.set(game.id, {
      state: summary?.currentState ?? null,
      libraryHours: summary?.totalHours ?? 0,
      detailHours: detail.totalHours,
      sessionCount: summary?.sessionCount ?? 0,
      lastPlayedAt: ms(summary?.lastPlayedAt ?? null),
      startedAt,
      endedAt,
      manualYears: (summary?.manualIterations ?? []).map((m) => `${m.hours}@${String(m.year)}`),
      totalSpend: detail.totalSpend,
      costPerHour: detail.costPerHour,
      unassignedSpend: iterations.length === 0 ? detail.totalSpend : 0,
      trackedSeconds: sessions.reduce((sum, s) => sum + (s.durationSec ?? 0), 0),
      playthroughs,
    });
  }
  return views;
}

// ── Origen y destino como entrada de las reglas ─────────────────────────────

const date = (value: unknown): Date => new Date(Number(value));
const dateOrNull = (value: unknown): Date | null =>
  value === null ? null : new Date(Number(value));

/** El origen tal como lo lee la 1.x (heurística del alta, desempate por id). */
export function legacyInput(ctx: ImportContext): EvalInput {
  const { data } = ctx;
  return {
    games: data.games.map((g) => ({
      id: String(g.id),
      addedAt: date(g.addedAt),
      promotedAt: dateOrNull(g.promotedAt),
    })),
    iterations: data.iterations.map((i) => ({
      key: pad(Number(i.id)),
      id: String(i.id),
      gameId: String(i.gameId),
      manual: i.manualTotalPlayed === null ? null : Number(i.manualTotalPlayed),
      label: String(i.label),
    })),
    sessions: ctx.sessions.map((s) => ({
      iterationKey: s.iterationId === null ? null : pad(Number(s.iterationId)),
      isManual: !!Number(s.isManual),
      startedAt: date(s.startedAt),
      endedAt: dateOrNull(s.endedAt),
      durationSec: s.durationSec === null ? null : Number(s.durationSec),
    })),
    events: data.stateEvents.map((e) => ({
      key: pad(Number(e.id)),
      iterationKey: pad(Number(e.iterationId)),
      type: e.type as StateType,
      occurredAt: date(e.occurredAt),
      datePrecision: e.datePrecision as StateEventDatePrecision,
    })),
    spends: data.spendEvents.map((s) => ({
      gameId: String(s.gameId),
      amount: Number(s.amount),
      occurredAt: date(s.occurredAt),
      key: pad(Number(s.id)),
    })),
    paperwork: 'addedAt',
  };
}

type Raw = Record<string, unknown>;
const all = (client: DatabaseSync, sql: string): Raw[] => client.prepare(sql).all() as Raw[];

/**
 * El destino tal como lo leerá la 2.0, solo para los juegos importados. Vivo =
 * sin lápida y con el padre vivo (§7.7, F-11). La etiqueta de un playthrough es
 * `customLabel` o "Playthrough N" con N su posición por `syncCreated` entre
 * todos los del juego, con lápida incluidos (R-03).
 */
export function targetInput(client: DatabaseSync, gameIds: ReadonlySet<string>): EvalInput {
  const games = all(
    client,
    'SELECT id, addedAt, promotedAt FROM games WHERE syncDeleted IS NULL',
  ).filter((g) => gameIds.has(String(g.id)));
  const liveGames = new Set(games.map((g) => String(g.id)));
  const allPlaythroughs = all(
    client,
    'SELECT id, gameId, customLabel, manualHours, syncCreated, syncDeleted FROM playthroughs ORDER BY syncCreated, id',
  );
  const positions = new Map<string, number>();
  const perGame = new Map<string, number>();
  for (const p of allPlaythroughs) {
    const n = (perGame.get(String(p.gameId)) ?? 0) + 1;
    perGame.set(String(p.gameId), n);
    positions.set(String(p.id), n);
  }
  const iterations: EvalIteration[] = allPlaythroughs
    .filter((p) => p.syncDeleted === null && liveGames.has(String(p.gameId)))
    .map((p) => ({
      key: `${String(p.syncCreated)}|${String(p.id)}`,
      id: String(p.id),
      gameId: String(p.gameId),
      manual: p.manualHours === null ? null : Number(p.manualHours),
      label:
        p.customLabel === null
          ? `Playthrough ${String(positions.get(String(p.id)))}`
          : String(p.customLabel),
    }));
  const keyById = new Map(iterations.map((i) => [i.id, i.key]));
  const sessions = all(
    client,
    'SELECT playthroughId, source, startedAt, endedAt, durationSec FROM sessions WHERE syncDeleted IS NULL AND playthroughId IS NOT NULL',
  )
    .filter((s) => keyById.has(String(s.playthroughId)))
    .map((s) => ({
      iterationKey: keyById.get(String(s.playthroughId)) as string,
      isManual: s.source === 'legacy_manual',
      startedAt: date(s.startedAt),
      endedAt: dateOrNull(s.endedAt),
      durationSec: s.durationSec === null ? null : Number(s.durationSec),
    }));
  const events = all(
    client,
    'SELECT id, playthroughId, type, occurredAt, datePrecision, syncCreated FROM state_events WHERE syncDeleted IS NULL',
  )
    .filter((e) => keyById.has(String(e.playthroughId)))
    .map((e) => ({
      key: `${String(e.syncCreated)}|${String(e.id)}`,
      iterationKey: keyById.get(String(e.playthroughId)) as string,
      type: e.type as StateType,
      occurredAt: date(e.occurredAt),
      datePrecision: e.datePrecision as StateEventDatePrecision,
    }));
  const spends = all(
    client,
    'SELECT id, gameId, amount, occurredAt, syncCreated FROM spend_events WHERE syncDeleted IS NULL',
  )
    .filter((s) => liveGames.has(String(s.gameId)))
    .map((s) => ({
      gameId: String(s.gameId),
      amount: Number(s.amount),
      occurredAt: date(s.occurredAt),
      key: `${String(s.syncCreated)}|${String(s.id)}`,
    }));
  return {
    games: games.map((g) => ({
      id: String(g.id),
      addedAt: date(g.addedAt),
      promotedAt: dateOrNull(g.promotedAt),
    })),
    iterations,
    sessions,
    events,
    spends,
    paperwork: 'datePrecision',
  };
}

// ── Comparación ─────────────────────────────────────────────────────────────

const show = (value: unknown): string => {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number')
    return Number.isInteger(value) ? String(value) : value.toPrecision(17);
  return String(value);
};

export class Collector {
  readonly checks: Record<string, { compared: number; differences: number }> = {};
  readonly differences: ValidationDifference[] = [];
  count = 0;

  compare(
    check: string,
    expected: unknown,
    actual: unknown,
    where: Omit<ValidationDifference, 'check' | 'expected' | 'actual'> = {},
  ): void {
    const entry = (this.checks[check] ??= { compared: 0, differences: 0 });
    entry.compared += 1;
    if (Object.is(expected, actual) || expected === actual) return;
    entry.differences += 1;
    this.count += 1;
    if (this.differences.length < MAX_DIFFERENCES) {
      this.differences.push({ check, ...where, expected: show(expected), actual: show(actual) });
    }
  }
}

/**
 * Compara lo que enseña la 1.x de cada juego con lo que enseñará la 2.0.
 * `gameMap` empareja id 1.x → id 2.0 y `iterationMap` lo mismo para los
 * playthroughs; las iteraciones descartadas a propósito se comprueban vacías.
 */
export function compareViews(
  out: Collector,
  legacy: ReadonlyMap<string, GameView>,
  target: ReadonlyMap<string, GameView>,
  gameMap: ReadonlyMap<number, string>,
  iterationMap: ReadonlyMap<number, string>,
  dropped: ReadonlySet<number>,
): void {
  for (const [legacyGameId, newGameId] of gameMap) {
    const where = { legacyTable: 'games', legacyId: legacyGameId };
    const s = legacy.get(String(legacyGameId));
    const t = target.get(newGameId);
    if (!s || !t) {
      out.compare('juego presente en el destino', true, false, where);
      continue;
    }
    out.compare('juego: estado', s.state, t.state, { ...where, field: 'state' });
    out.compare('juego: horas (biblioteca)', s.libraryHours, t.libraryHours, {
      ...where,
      field: 'totalHours',
    });
    out.compare('juego: horas (ficha)', s.detailHours, t.detailHours, {
      ...where,
      field: 'detail.totalHours',
    });
    out.compare('juego: sesiones', s.sessionCount, t.sessionCount, {
      ...where,
      field: 'sessionCount',
    });
    out.compare('juego: último día jugado', s.lastPlayedAt, t.lastPlayedAt, {
      ...where,
      field: 'lastPlayedAt',
    });
    out.compare('juego: fecha de inicio', s.startedAt, t.startedAt, {
      ...where,
      field: 'startedAt',
    });
    out.compare('juego: fecha de fin', s.endedAt, t.endedAt, { ...where, field: 'endedAt' });
    out.compare('juego: horas manuales por año', s.manualYears.join(';'), t.manualYears.join(';'), {
      ...where,
      field: 'manualIterations',
    });
    out.compare('juego: gasto total', s.totalSpend, t.totalSpend, {
      ...where,
      field: 'totalSpend',
    });
    out.compare('juego: coste por hora', s.costPerHour, t.costPerHour, {
      ...where,
      field: 'costPerHour',
    });
    out.compare('juego: segundos de sesión', s.trackedSeconds, t.trackedSeconds, {
      ...where,
      field: 'durationSec',
    });

    // Iteraciones descartadas: tenían que estar vacías, y su gasto pasa a no
    // tener playthrough (en un juego sin playthroughs, todo el gasto).
    let droppedSpend = 0;
    const kept = s.playthroughs.filter((p) => {
      if (!dropped.has(Number(p.id))) return true;
      out.compare('iteración descartada vacía: horas', 0, p.hours, {
        legacyTable: 'iterations',
        legacyId: Number(p.id),
      });
      out.compare('iteración descartada vacía: estado', null, p.state, {
        legacyTable: 'iterations',
        legacyId: Number(p.id),
      });
      droppedSpend += p.spend;
      return false;
    });
    out.compare(
      'juego: gasto sin playthrough',
      s.unassignedSpend + droppedSpend,
      t.unassignedSpend,
      { ...where, field: 'unassignedSpend' },
    );
    out.compare('juego: número de playthroughs', kept.length, t.playthroughs.length, {
      ...where,
      field: 'playthroughs',
    });
    kept.forEach((p, index) => {
      const q = t.playthroughs[index];
      const at = { legacyTable: 'iterations', legacyId: Number(p.id) };
      if (!q) return;
      // El orden por syncCreated tiene que ser el del id antiguo.
      out.compare('Playthrough N: orden', iterationMap.get(Number(p.id)), q.id, {
        ...at,
        field: 'posición',
      });
      out.compare('Playthrough N: etiqueta', p.label, q.label, { ...at, field: 'label' });
      out.compare('playthrough: estado', p.state, q.state, { ...at, field: 'state' });
      out.compare('playthrough: horas', p.hours, q.hours, { ...at, field: 'hours' });
      out.compare('playthrough: inicio', p.startedAt, q.startedAt, { ...at, field: 'startedAt' });
      out.compare('playthrough: fin', p.endedAt, q.endedAt, { ...at, field: 'endedAt' });
      out.compare('playthrough: inicio por sesión', p.startedBySession, q.startedBySession, {
        ...at,
        field: 'startedBySession',
      });
      out.compare('playthrough: gasto repartido', p.spend, q.spend, { ...at, field: 'spend' });
    });
  }
}

// ── Recuentos, sumas e integridad ───────────────────────────────────────────

function checkCountsAndSums(
  out: Collector,
  client: DatabaseSync,
  plan: ImportPlan,
  totals: Record<string, number>,
): void {
  const ctx = plan.context;
  // Cada fila del plan está en el destino.
  for (const [table, rows] of plan.rows) {
    const ids = new Set(all(client, `SELECT id FROM "${table}"`).map((r) => String(r.id)));
    const present = rows.filter((r) => ids.has(r.id)).length;
    out.compare(`recuento: ${table}`, rows.length, present, { field: table });
  }
  // Leídas − descartadas = importadas, en las tablas 1:1.
  for (const [table, entry] of Object.entries(plan.source)) {
    const discarded = Object.values(entry.discarded).reduce((a, b) => a + b, 0);
    if (['games', 'save_backups', 'plan_mailbox', 'achievements'].includes(table)) continue;
    out.compare(
      `recuento 1.x: leídas − descartadas = importadas (${table})`,
      entry.read - discarded,
      entry.imported,
      { legacyTable: table },
    );
  }

  // Segundos de sesión, total y por juego (las de emulador sin asignar, aparte).
  const legacyGameOfIteration = new Map(
    ctx.data.iterations.map((i) => [Number(i.id), Number(i.gameId)]),
  );
  const legacySeconds = new Map<string, number>();
  let legacyTotal = 0;
  for (const s of ctx.sessions) {
    const d = s.durationSec === null ? 0 : Number(s.durationSec);
    legacyTotal += d;
    const key =
      s.iterationId === null
        ? 'sin asignar'
        : (ctx.gameIds.get(legacyGameOfIteration.get(Number(s.iterationId)) as number) as string);
    legacySeconds.set(key, (legacySeconds.get(key) ?? 0) + d);
  }
  const targetSeconds = new Map<string, number>();
  let targetTotal = 0;
  for (const row of all(
    client,
    `SELECT s.durationSec AS d, p.gameId AS g FROM sessions s LEFT JOIN playthroughs p ON p.id = s.playthroughId WHERE s.deviceId = 'legacy'`,
  )) {
    const d = row.d === null ? 0 : Number(row.d);
    targetTotal += d;
    const key = row.g === null ? 'sin asignar' : String(row.g);
    targetSeconds.set(key, (targetSeconds.get(key) ?? 0) + d);
  }
  out.compare('sesiones: segundos totales', legacyTotal, targetTotal);
  totals['segundos de sesión'] = legacyTotal;
  for (const key of new Set([...legacySeconds.keys(), ...targetSeconds.keys()])) {
    out.compare(
      'sesiones: segundos por juego',
      legacySeconds.get(key) ?? 0,
      targetSeconds.get(key) ?? 0,
      { field: key === 'sin asignar' ? key : 'gameId' },
    );
  }

  // Gasto total y por juego, en orden (fecha, creación) para sumar igual.
  const legacySpend = [...ctx.data.spendEvents].sort(
    (a, b) => Number(a.occurredAt) - Number(b.occurredAt) || Number(a.id) - Number(b.id),
  );
  let legacySpendTotal = 0;
  const legacyByGame = new Map<number, number>();
  for (const s of legacySpend) {
    legacySpendTotal += Number(s.amount);
    legacyByGame.set(
      Number(s.gameId),
      (legacyByGame.get(Number(s.gameId)) ?? 0) + Number(s.amount),
    );
  }
  let targetSpendTotal = 0;
  const targetByGame = new Map<string, number>();
  for (const s of all(
    client,
    'SELECT gameId, amount FROM spend_events WHERE syncDeleted IS NULL ORDER BY occurredAt, syncCreated',
  )) {
    targetSpendTotal += Number(s.amount);
    targetByGame.set(
      String(s.gameId),
      (targetByGame.get(String(s.gameId)) ?? 0) + Number(s.amount),
    );
  }
  out.compare('gasto: total', legacySpendTotal, targetSpendTotal);
  totals['gasto total'] = legacySpendTotal;
  for (const [legacyGameId, amount] of legacyByGame) {
    out.compare(
      'gasto: por juego',
      amount,
      targetByGame.get(ctx.gameIds.get(legacyGameId) as string) ?? 0,
      { legacyTable: 'games', legacyId: legacyGameId },
    );
  }

  // Desbloqueos por juego y origen; tamaño de cada catálogo.
  const achievementGame = new Map(
    ctx.data.achievements.map((a) => [Number(a.id), Number(a.gameId)]),
  );
  const legacyUnlocks = new Map<string, number>();
  for (const u of ctx.data.unlocks) {
    const game = ctx.gameIds.get(achievementGame.get(Number(u.achievementId)) as number) as string;
    const origin = u.source === 'emu' ? LEGACY_EMU_ORIGIN : String(u.source);
    const key = `${game}|${origin}`;
    legacyUnlocks.set(key, (legacyUnlocks.get(key) ?? 0) + 1);
  }
  const targetUnlocks = new Map<string, number>();
  for (const r of all(
    client,
    'SELECT gameId, origin, count(*) AS n FROM achievement_unlocks WHERE syncDeleted IS NULL GROUP BY gameId, origin',
  )) {
    targetUnlocks.set(`${String(r.gameId)}|${String(r.origin)}`, Number(r.n));
  }
  for (const key of new Set([...legacyUnlocks.keys(), ...targetUnlocks.keys()])) {
    out.compare(
      'logros: desbloqueos por juego y origen',
      legacyUnlocks.get(key) ?? 0,
      targetUnlocks.get(key) ?? 0,
      { field: key.split('|')[1] },
    );
  }
  totals['desbloqueos'] = ctx.data.unlocks.length;
  const legacyCatalog = new Map<string, number>();
  for (const entry of ctx.classified) {
    for (const source of entry.sources) {
      const key = achievementCatalogId(
        ctx.gameIds.get(Number(entry.achievement.gameId)) as string,
        source,
      );
      legacyCatalog.set(key, (legacyCatalog.get(key) ?? 0) + 1);
    }
  }
  const targetCatalog = new Map<string, number>();
  for (const r of all(
    client,
    'SELECT id, items FROM achievement_catalogs WHERE syncDeleted IS NULL',
  )) {
    targetCatalog.set(String(r.id), (JSON.parse(String(r.items)) as unknown[]).length);
  }
  for (const [key, n] of legacyCatalog) {
    out.compare('logros: tamaño del catálogo', n, targetCatalog.get(key) ?? 0, {
      field: key.split(':')[1],
    });
  }
  totals['logros de catálogo'] = ctx.data.achievements.length;
}

function checkIntegrity(out: Collector, client: DatabaseSync): void {
  // Claves foráneas declaradas.
  const broken = all(client, 'PRAGMA foreign_key_check');
  out.compare('integridad: claves foráneas rotas', 0, broken.length);

  // Enlaces lógicos: cada desbloqueo tiene su logro en el catálogo de su fuente.
  const items = new Set<string>();
  for (const r of all(
    client,
    'SELECT gameId, source, items FROM achievement_catalogs WHERE syncDeleted IS NULL',
  )) {
    for (const item of JSON.parse(String(r.items)) as { apiName: string }[]) {
      items.add(`${String(r.gameId)}\u0000${String(r.source)}\u0000${item.apiName}`);
    }
  }
  let orphanUnlocks = 0;
  for (const u of all(
    client,
    'SELECT gameId, source, apiName FROM achievement_unlocks WHERE syncDeleted IS NULL',
  )) {
    if (!items.has(`${String(u.gameId)}\u0000${String(u.source)}\u0000${String(u.apiName)}`))
      orphanUnlocks += 1;
  }
  out.compare('integridad: desbloqueos sin su logro en el catálogo', 0, orphanUnlocks);

  // Tablas 1:1 con un juego: id = gameId; external_checks: id = gameId:source.
  for (const table of ['game_metadata', 'plan_entries', 'game_curiosities']) {
    const bad = all(client, `SELECT count(*) AS n FROM "${table}" WHERE id <> gameId`)[0];
    out.compare(`integridad: ${table}.id = gameId`, 0, Number(bad.n));
  }
  const badChecks = all(
    client,
    `SELECT count(*) AS n FROM external_checks WHERE id <> gameId || ':' || source`,
  )[0];
  out.compare('integridad: external_checks.id = gameId:source', 0, Number(badChecks.n));

  // Ningún hijo vivo de un padre con lápida (§7.7, F-11).
  for (const entry of syncedEntries) {
    for (const child of entry.children) {
      const condition = child.onlyWhereNull ? ` AND c."${child.onlyWhereNull}" IS NULL` : '';
      const row = all(
        client,
        `SELECT count(*) AS n FROM "${child.table}" c JOIN "${entry.name}" p ON p.id = c."${child.column}" ` +
          `WHERE c.syncDeleted IS NULL AND p.syncDeleted IS NOT NULL${condition}`,
      )[0];
      out.compare(`integridad: ${child.table} vivos con ${entry.name} borrado`, 0, Number(row.n));
    }
  }

  // El mapa de ids antiguos apunta a filas que existen.
  const tableOf: Record<string, string[]> = {
    games: ['games'],
    iterations: ['playthroughs'],
    state_events: ['state_events', 'plan_entries'],
    sessions: ['sessions'],
    spend_events: ['spend_events'],
    emulators: ['emulators'],
    achievements: ['achievement_catalogs'],
    achievement_unlocks: ['achievement_unlocks'],
    curiosities: ['game_curiosities'],
    generated_memories: ['generated_memories'],
    radar_games: ['radar_games'],
  };
  let dangling = 0;
  for (const [legacyTable, tables] of Object.entries(tableOf)) {
    const union = tables.map((t) => `SELECT id FROM "${t}"`).join(' UNION ALL ');
    const row = all(
      client,
      `SELECT count(*) AS n FROM local_legacy_ids l WHERE l.legacyTable = '${legacyTable}' AND l.newId NOT IN (${union})`,
    )[0];
    dangling += Number(row.n);
  }
  out.compare('integridad: local_legacy_ids apunta a filas inexistentes', 0, dangling);
}

export function validateImport(
  client: DatabaseSync,
  plan: ImportPlan,
  options: {
    /** Firma esperada de cada recap tras el recálculo (`memorySignatures.ts`). */
    readonly memoryHashes?: ReadonlyMap<string, { readonly expectedHash: string }>;
  } = {},
): ValidationReport {
  const out = new Collector();
  const totals: Record<string, number> = {};
  const ctx = plan.context;

  checkCountsAndSums(out, client, plan, totals);
  const legacyViews = evaluate(legacyInput(ctx));
  const targetViews = evaluate(targetInput(client, new Set(ctx.gameIds.values())));
  compareViews(out, legacyViews, targetViews, ctx.gameIds, ctx.iterationIds, ctx.droppedIterations);
  checkIntegrity(out, client);
  const columns = reconcileColumns(client, ctx, options.memoryHashes);

  totals['valores comparados columna a columna'] = columns.compared;
  totals['diferencias columna a columna'] = columns.differences;
  totals['juegos comparados'] = ctx.gameIds.size;
  return {
    ok: out.count === 0 && columns.differences === 0,
    checks: out.checks,
    totals,
    differences: out.differences,
    differenceCount: out.count,
    columns,
  };
}
