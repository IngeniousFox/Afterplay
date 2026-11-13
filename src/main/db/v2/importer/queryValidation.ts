import { createHash } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { Chapter, ChapterScope } from '../../../../shared/memory/chapters';
import {
  buildChapter,
  canonicalChapterFacts,
  listClosedPeriodsWithActivity,
  scopeKeyOf,
} from '../../../../shared/memory/chapters';
import { deriveMoments } from '../../../../shared/memory/moments';
import { isAddedAtArtifact } from '../../../../shared/playthroughState';
import { chapterHash, legacyChapterHash } from '../../../memories/hash';
import type { LocalDatabase } from '../connection';
import {
  getAchievementsOverview,
  getAchievementsStatus,
  getGameAchievements,
  getSessionUnlocks,
} from '../queries/achievements';
import { createQueryContext, type QueryContext } from '../queries/common';
import {
  getGameById,
  getGames,
  getOwnedGames,
  getPlannedGameExtras,
  getPlannedGames,
} from '../queries/library';
import {
  chapterSignature,
  getAllCuriosities,
  getCuriositiesCounts,
  getLatestMemories,
  getMemoryFacts,
  listRadarGames,
  loadMemoryFactsSnapshot,
  memoryChapterFor,
  toLegacyIds,
} from '../queries/loop';
import { getAllSpendEvents, getAllStateEvents } from '../queries/playthroughs';
import {
  getAllSessions,
  getEmulators,
  getPendingSessions,
  getWatchTargets,
} from '../queries/sessions';
import { emulatorInstalls, gameInstalls } from '../schema';
import type { ImportContext } from './build';
import type { LegacyQueryViews } from './legacyQueries';

// VALIDACIÓN CON LAS CONSULTAS DE VERDAD (§19.5, segunda capa de "lo que la
// app enseña").
//
// La validación de `validate.ts` aplica las reglas de `src/shared/domain` a
// las filas importadas: comprueba el modelo, no la app. Esta compara lo que
// DEVUELVEN las lecturas de la 1.x sobre el origen (`legacyQueries.ts`, foto
// tomada antes) con lo que devuelven las consultas 2.0 sobre el destino, para
// todos los juegos y sobre la base entera, traduciendo los ids con el mapa del
// importador (el mismo que queda en `local_legacy_ids`).
//
// Cada valor de cada DTO se compara exactamente (fechas por milisegundos,
// números con `Object.is`). Las diferencias ESPERADAS entre 1.x y 2.0 están
// enumeradas en `EXPECTED` con su motivo, y cada una se aplica en un sitio
// concreto y se cuenta: no hay tolerancias generales. Cualquier otra
// diferencia es un hallazgo y hace fallar la importación.
//
// Lo que solo existe en la 2.0 (`planHistory`, `completion`, `bySource`) no
// tiene contrapartida 1.x: se lista aparte (`onlyInTarget`) y, cuando sale de
// un dato 1.x (el paso por el Plan), se comprueba con su regla.
//
// El informe solo lleva ids antiguos, nombres de campo, números, fechas y
// enumeraciones; un texto se resume como «texto de N caracteres».

/** Las diferencias decididas entre la 1.x y la 2.0, con su motivo. */
export const EXPECTED = {
  ids: 'Los ids son otros: se traducen con local_legacy_ids (§19.5) antes de comparar; el radar pasa de id numérico a igdb:<id>. Una lista que la 1.x ordenaba por su id entero (los extras del Plan, que se cruzan por id y cuyo orden no se enseña) no puede salir en ese orden con ids 2.0.',
  planToPlay:
    'El evento plan_to_play ya no está en el historial de estados ni en las lecturas de eventos: su fecha y su nota pasan a plan_entries y la ficha las enseña en planHistory (R-06), que se comprueba aparte.',
  emptyPlannedIteration:
    'La iteración vacía de un juego planeado no se importa: la sustituye plan_entries (§19.5, F-12). Su ficha deja de listarla.',
  unknownPrecision:
    "La precisión 'unknown' sustituye al artefacto del alta: un evento que isAddedAtArtifact reconoce como papeleo llega con datePrecision = 'unknown' (§7.5, R-07).",
  installPaths:
    'Las rutas de instalación (executablePath, installDirectory, installSizeBytes) no se importan: cada PC las reclama (§19.6). Sin reclamar, la 2.0 enseña null.',
  unorderedLegacy:
    'Orden: la lectura 1.x no tenía ORDER BY (orden del motor: sesiones de la ficha, estados, desbloqueos por sesión, hechos de los recaps, gastos, curiosidades) o empataba sin desempate (y entonces solo se aceptan cambios ENTRE empatados); la 2.0 ordena de forma determinista. Los elementos se comparan por clave.',
  perSourceCompletion:
    'Los juegos perfectos y el completado van por fuente (decisión del usuario, §20.3.1): Steam y RetroAchievements son dos hitos. Solo en juegos con catálogo de las dos fuentes; en «perfectos» se comprueba igualmente que la 1.x lo da por perfecto si y solo si la 2.0 da perfectas las dos fuentes, con el total sumado y la fecha del último logro.',
  playthroughPosition:
    '"Playthrough N" es una posición: la 2.0 la deriva del orden de creación (R-03) y el importador guarda la etiqueta solo si no es la automática de su posición. No genera diferencias: la etiqueta se compara exactamente y tiene que salir igual.',
  zeroPlaythroughsMoveToPlan:
    'Devolver al Plan con CERO playthroughs (CONSULTAS.md §5.0, I-15): la 1.x exigía exactamente una iteración vacía; la 2.0 admite cero o una, porque un juego planeado ya no tiene playthrough y "nunca se ha jugado" con cero es coherente y más permisivo sin riesgo. Solo en un juego de la biblioteca sin ninguna iteración, sin gastos que no sean compras, sin desbloqueos y sin copias de partidas en la 1.x.',
  mixedCatalogOrder:
    'Orden de los logros de un catálogo mezclado Steam + RA (CONSULTAS.md §5.0, I-16; R-11): la 1.x los intercalaba por sortIndex y la 2.0 pone el bloque de Steam y luego el de RA. Solo en juegos con catálogo de las dos fuentes, y comprobando que DENTRO de cada fuente el orden coincide (salvo empates de sortIndex).',
  catalogWithoutStamp:
    'Catálogo de logros sin achievementsSyncedAt en la 1.x (CONSULTAS.md §5.0, I-17): el importador usa la fecha de alta como fetchedAt (no puede usar "ahora": no sería determinista) y la 2.0 enseña esa fecha como sincronizado y cuenta el juego como sincronizado, donde la 1.x enseña null. Estado anómalo y benigno. Solo en juegos con catálogo y sin el sello: ficha de logros (syncedAt) y recuento de juegos sincronizados.',
  curiositiesWithoutStamp:
    'Curiosidades sin curiositiesGeneratedAt en la 1.x (CONSULTAS.md §5.0, I-18): el importador usa la fecha de alta como generatedAt y la 2.0 da el juego por generado (no vuelve a pagar la generación), donde la 1.x lo dejaría pendiente. Solo en juegos con curiosidades y sin el sello: ficha (curiositiesGeneratedAt) y recuento de generados.',
  resealedSignature:
    'La firma de los recaps (sourceHash) se recalcula con los ids 2.0 cuando casa con los hechos importados (§19.5); la que no casa se conserva.',
} as const;
export type ExpectedRule = keyof typeof EXPECTED;

export interface QueryDifference {
  /** Lectura y campo (sin índices), p. ej. `ficha: iterations[].sessions[].note`. */
  readonly check: string;
  readonly legacyTable?: string;
  readonly legacyId?: number | string;
  /** Ruta completa dentro del DTO (con índices o claves de comparación). */
  readonly path: string;
  readonly expected: string;
  readonly actual: string;
}

export interface QueryValidationReport {
  readonly ok: boolean;
  /** Valores comparados en total. */
  readonly compared: number;
  readonly differenceCount: number;
  /** Por lectura y campo: comparados y diferencias. */
  readonly checks: Record<string, { compared: number; differences: number }>;
  /** Cuántas veces se aplicó cada diferencia esperada. */
  readonly expected: Partial<Record<ExpectedRule, number>>;
  /** Campos de los DTO 2.0 que no existen en la 1.x (no se comparan). */
  readonly onlyInTarget: readonly string[];
  /** Las primeras diferencias (acotadas). */
  readonly differences: readonly QueryDifference[];
  readonly totals: Record<string, number>;
  readonly elapsedMs: number;
}

/** El recálculo de la firma de un recap importado (lo hace `index.ts`). */
export interface ResealedMemory {
  /** La firma que tiene que quedar en el destino. */
  readonly expectedHash: string;
  /** True si se reescribió en esta importación (casó con ids 1.x). */
  readonly resealed: boolean;
}

export interface QueryValidationInput {
  readonly target: LocalDatabase;
  readonly context: ImportContext;
  readonly legacy: LegacyQueryViews;
  /** Id 2.0 del recap → su firma esperada. */
  readonly memories: ReadonlyMap<string, ResealedMemory>;
  readonly now: Date;
  /**
   * Si se reclamaron las instalaciones de este PC (`claimInstalls`). Sin
   * reclamar, el watcher de la 2.0 no vigila nada (sus objetivos salen de las
   * instalaciones) y comparar sus objetivos no diría nada: se omite.
   */
  readonly claimedInstalls?: boolean;
}

const MAX_DIFFERENCES = 300;

// ── Mostrar sin contenido ───────────────────────────────────────────────────

/** Campos de texto cuyo valor es una enumeración o una clave, no contenido. */
const SAFE_TEXT = new Set([
  'type',
  'currentState',
  'datePrecision',
  'releaseDatePrecision',
  'saveDetectionSource',
  'startedBy',
  'format',
  'scopeType',
  'scopeKey',
  'sources',
  'source',
  'promptVersion',
  'model',
]);

function show(value: unknown, field: string): string {
  if (value === undefined) return 'ausente';
  if (value === null) return 'null';
  if (value instanceof Date) return `${value.toISOString()} (${value.getTime()})`;
  if (typeof value === 'number')
    return Number.isInteger(value) ? String(value) : value.toPrecision(17);
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'string') {
    // Las rutas `…{orden}`, `…{presente}` son comprobaciones de esta
    // validación y sus valores son mensajes propios, no datos.
    if ((SAFE_TEXT.has(field) || field.endsWith('}')) && value.length <= 60) return value;
    // Un resumen que distingue dos textos sin enseñarlos.
    const digest = createHash('sha256').update(value).digest('hex').slice(0, 8);
    return `«texto de ${value.length} caracteres #${digest}»`;
  }
  if (Array.isArray(value)) return `[lista de ${value.length}]`;
  return '{objeto}';
}

type Where = { readonly legacyTable?: string; readonly legacyId?: number | string };

class QueryCollector {
  readonly checks: Record<string, { compared: number; differences: number }> = {};
  readonly expected: Partial<Record<ExpectedRule, number>> = {};
  readonly differences: QueryDifference[] = [];
  readonly onlyInTarget = new Set<string>();
  readonly totals: Record<string, number> = {};
  count = 0;
  compared = 0;

  /** Compara un valor final. `check` es la lectura y `path` la ruta con índices. */
  leaf(read: string, path: string, expected: unknown, actual: unknown, where: Where): void {
    const check = `${read}: ${path.replace(/\[[^\]]*\]/g, '[]') || '(valor)'}`;
    const entry = (this.checks[check] ??= { compared: 0, differences: 0 });
    entry.compared += 1;
    this.compared += 1;
    if (sameLeaf(expected, actual)) return;
    entry.differences += 1;
    this.count += 1;
    if (this.differences.length < MAX_DIFFERENCES) {
      const field = (path.split('.').pop() ?? '').replace(/\[.*$/, '');
      this.differences.push({
        check,
        ...where,
        path,
        expected: show(expected, field),
        actual: show(actual, field),
      });
    }
  }

  expect(rule: ExpectedRule, by = 1): void {
    if (by > 0) this.expected[rule] = (this.expected[rule] ?? 0) + by;
  }

  total(name: string, by = 1): void {
    this.totals[name] = (this.totals[name] ?? 0) + by;
  }
}

function sameLeaf(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return Object.is(a, b);
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);

/**
 * Compara en profundidad lo que enseña la 1.x (`expected`, ya traducido a ids
 * 2.0) con lo que enseña la 2.0 (`actual`). Las claves que solo tiene la 2.0
 * se anotan en `onlyInTarget` y no se comparan.
 */
function deep(
  out: QueryCollector,
  read: string,
  path: string,
  expected: unknown,
  actual: unknown,
  where: Where,
): void {
  if (Array.isArray(expected) && Array.isArray(actual)) {
    out.leaf(read, `${path}.length`, expected.length, actual.length, where);
    const n = Math.min(expected.length, actual.length);
    for (let i = 0; i < n; i++) deep(out, read, `${path}[${i}]`, expected[i], actual[i], where);
    return;
  }
  if (isPlainObject(expected) && isPlainObject(actual)) {
    for (const key of Object.keys(expected)) {
      deep(out, read, path ? `${path}.${key}` : key, expected[key], actual[key], where);
    }
    for (const key of Object.keys(actual)) {
      if (!(key in expected)) {
        const at = `${path ? `${path}.` : ''}${key}`.replace(/\[[^\]]*\]/g, '[]');
        out.onlyInTarget.add(`${read}: ${at}`);
      }
    }
    return;
  }
  out.leaf(read, path, expected, actual, where);
}

/**
 * Compara dos listas por clave: presencia (las que faltan o sobran), cada
 * elemento en profundidad y el orden. Si el orden difiere, `orderRule` dice
 * por qué se acepta (null = el orden tiene que ser idéntico).
 */
function keyed<A, B>(
  out: QueryCollector,
  read: string,
  path: string,
  expected: readonly A[],
  actual: readonly B[],
  keyOfExpected: (item: A) => string,
  keyOfActual: (item: B) => string,
  options: {
    readonly where?: (item: A) => Where;
    /** Dónde está la lista (el juego de una ficha…), para situar un orden distinto. */
    readonly list?: Where;
    readonly orderRule?: ExpectedRule | 'ties' | null;
    /** Para `ties`: la clave de orden de la 1.x (empatados = mismo valor). */
    readonly tieKey?: (item: A) => string;
    /**
     * Orden por bloques (una diferencia decidida): la 2.0 pone los elementos
     * agrupados por `groupOf(clave)` en el orden `order`, y DENTRO de cada
     * grupo el orden tiene que ser el de la 1.x (con la regla `orderRule`).
     */
    readonly blocks?: {
      readonly groupOf: (key: string) => string;
      readonly order: readonly string[];
      readonly rule: ExpectedRule;
    };
  } = {},
): void {
  const actualByKey = new Map<string, B>();
  for (const item of actual) {
    const key = keyOfActual(item);
    if (actualByKey.has(key)) out.leaf(read, `${path}{clave repetida}`, 1, 2, { legacyId: key });
    actualByKey.set(key, item);
  }
  const expectedKeys = new Set<string>();
  for (const item of expected) {
    const key = keyOfExpected(item);
    expectedKeys.add(key);
    const where = options.where?.(item) ?? {};
    const match = actualByKey.get(key);
    out.leaf(read, `${path}{presente}`, true, match !== undefined, where);
    if (match === undefined) continue;
    // `legacyId` lo añade quien normaliza, solo para situar la diferencia en
    // el informe: no es un campo del DTO.
    const { legacyId, ...fields } = item as Record<string, unknown>;
    void legacyId;
    deep(out, read, `${path}[${key}]`, fields, match, where);
  }
  for (const [key] of actualByKey) {
    if (!expectedKeys.has(key)) out.leaf(read, `${path}{sobra}`, false, true, { legacyId: key });
  }

  // Orden: sobre los elementos que están en los dos lados.
  const order1 = expected.map(keyOfExpected).filter((k) => actualByKey.has(k));
  const order2 = actual.map(keyOfActual).filter((k) => expectedKeys.has(k));
  const same = order1.length === order2.length && order1.every((k, i) => k === order2[i]);
  const list = options.list ?? {};
  if (same) {
    out.leaf(read, `${path}{orden}`, true, true, list);
    return;
  }
  // Sin claves en el informe (pueden llevar un apiName): la primera posición distinta.
  const first = order1.findIndex((k, i) => k !== order2[i]);
  const differs = `primera posición distinta: ${first} de ${order1.length}`;
  const tie = options.tieKey
    ? new Map(expected.map((item) => [keyOfExpected(item), options.tieKey!(item)]))
    : null;
  // ¿Coinciden dos órdenes salvo cambios entre empatados de la 1.x?
  const tiesOnly = (a: readonly string[], b: readonly string[]): boolean =>
    a.length === b.length && tie !== null && a.every((k, i) => tie.get(k) === tie.get(b[i]));
  const identical = (a: readonly string[], b: readonly string[]): boolean =>
    a.length === b.length && a.every((k, i) => k === b[i]);
  if (options.blocks) {
    const { groupOf, order, rule } = options.blocks;
    const rank = (k: string): number => order.indexOf(groupOf(k));
    const inBlocks = order2.every(
      (k, i) => rank(k) >= 0 && (i === 0 || rank(order2[i - 1]) <= rank(k)),
    );
    let ties = false;
    const withinOk = order.every((group) => {
      const a = order1.filter((k) => groupOf(k) === group);
      const b = order2.filter((k) => groupOf(k) === group);
      if (identical(a, b)) return true;
      if (options.orderRule === 'ties' && tiesOnly(a, b)) return (ties = true);
      return false;
    });
    if (inBlocks && withinOk) {
      out.expect(rule);
      if (ties) out.expect('unorderedLegacy');
      out.leaf(read, `${path}{orden}`, true, true, list);
    } else {
      out.leaf(read, `${path}{orden}`, 'orden 1.x (por bloques)', differs, list);
    }
    return;
  }
  if (options.orderRule === 'ties' && tie) {
    // Se acepta solo si los dos órdenes coinciden al agrupar los empatados de la 1.x.
    if (tiesOnly(order1, order2)) {
      out.expect('unorderedLegacy');
      out.leaf(read, `${path}{orden}`, true, true, list);
    } else {
      out.leaf(read, `${path}{orden}`, 'orden 1.x', differs, list);
    }
    return;
  }
  if (options.orderRule && options.orderRule !== 'ties') {
    out.expect(options.orderRule);
    out.leaf(read, `${path}{orden}`, true, true, list);
    return;
  }
  out.leaf(read, `${path}{orden}`, 'orden 1.x', differs, list);
}

/** Lista sin clave (sumas por fecha): se compara como multiconjunto ordenado. */
function multiset<T>(
  out: QueryCollector,
  read: string,
  expected: readonly T[],
  actual: readonly T[],
  sortKey: (item: T) => string,
  orderRule: ExpectedRule,
): void {
  const sameOrder =
    expected.length === actual.length &&
    expected.every((item, i) => sortKey(item) === sortKey(actual[i]));
  const a = [...expected].sort((x, y) => cmp(sortKey(x), sortKey(y)));
  const b = [...actual].sort((x, y) => cmp(sortKey(x), sortKey(y)));
  deep(out, read, '', a, b, {});
  if (!sameOrder) out.expect(orderRule);
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const ms = (date: Date | null | undefined): string =>
  date ? String(date.getTime()).padStart(15, '0') : 'null';

// ── Traducción de ids 1.x → 2.0 ─────────────────────────────────────────────

class Ids {
  private readonly achievementKeys = new Map<number, string>();

  constructor(private readonly ctx: ImportContext) {
    for (const a of ctx.data.achievements) {
      const legacyId = Number(a.id);
      const sources = ctx.achievementSources.get(legacyId) ?? [];
      const game = ctx.gameIds.get(Number(a.gameId));
      // En la 2.0 un logro es (juego, fuente, apiName). Uno en conflicto entra
      // en dos catálogos: su entrada 1.x se empareja con la del primero.
      if (game && sources.length > 0) {
        this.achievementKeys.set(legacyId, `${game}:${sources[0]}:${String(a.apiName)}`);
      }
    }
  }

  private static of(map: ReadonlyMap<number, string>, kind: string, id: number): string {
    return map.get(id) ?? `¿${kind} 1.x ${id} sin id 2.0?`;
  }
  game = (id: number): string => Ids.of(this.ctx.gameIds, 'juego', id);
  gameOrNull = (id: number | null): string | null => (id === null ? null : this.game(id));
  iteration = (id: number): string => Ids.of(this.ctx.iterationIds, 'iteración', id);
  iterationOrNull = (id: number | null): string | null => (id === null ? null : this.iteration(id));
  session = (id: number): string => Ids.of(this.ctx.sessionIds, 'sesión', id);
  sessionOrNull = (id: number | null): string | null => (id === null ? null : this.session(id));
  event = (id: number): string => Ids.of(this.ctx.eventIds, 'evento', id);
  spend = (id: number): string => Ids.of(this.ctx.spendIds, 'gasto', id);
  emulatorOrNull = (id: number | null): string | null =>
    id === null ? null : Ids.of(this.ctx.emulatorIds, 'emulador', id);
  achievement = (id: number): string => Ids.of(this.achievementKeys, 'logro', id);
}

// ── El contexto de las comparaciones ────────────────────────────────────────

type Legacy = LegacyQueryViews;
type LegacyDetail = Legacy['details'] extends ReadonlyMap<number, infer D> ? D : never;
type LegacyEvent = LegacyDetail['stateHistory'][number];

interface Run {
  readonly out: QueryCollector;
  readonly ids: Ids;
  readonly ctx: ImportContext;
  readonly q: QueryContext;
  readonly legacy: Legacy;
  /** Juegos 2.0 con instalación reclamada en este PC. */
  readonly installs: ReadonlyMap<string, ClaimedInstall>;
  /** Emuladores 2.0 con ruta reclamada en este PC → la ruta. */
  readonly emulatorPaths: ReadonlyMap<string, string>;
  /** Juego 1.x → (alta, promoción), para la regla del artefacto. */
  readonly gameDates: ReadonlyMap<number, { addedAt: Date; promotedAt: Date | null }>;
  /** Los juegos 1.x a los que se aplica cada diferencia esperada por juego. */
  readonly cases: ExpectedCases;
}

/** Los juegos 1.x de las diferencias esperadas que dependen del juego. */
interface ExpectedCases {
  /** Biblioteca, cero iteraciones y ningún registro de partida (zeroPlaythroughsMoveToPlan). */
  readonly zeroPlaythroughs: ReadonlySet<number>;
  /** Con catálogo de Steam Y de RA (mixedCatalogOrder, perSourceCompletion). */
  readonly mixedCatalogs: ReadonlySet<number>;
  /** Con catálogo y sin achievementsSyncedAt (catalogWithoutStamp). */
  readonly catalogWithoutStamp: ReadonlySet<number>;
  /** Con curiosidades y sin curiositiesGeneratedAt (curiositiesWithoutStamp). */
  readonly curiositiesWithoutStamp: ReadonlySet<number>;
}

/**
 * Los casos exactos, sacados del ORIGEN (sus filas 1.x), no de lo importado:
 * así una diferencia esperada no puede taparse con un fallo del importador.
 */
export function expectedCases(ctx: ImportContext): ExpectedCases {
  const { data } = ctx;
  const catalogs = new Map<number, Set<string>>();
  for (const entry of ctx.classified) {
    const gameId = Number(entry.achievement.gameId);
    const set = catalogs.get(gameId) ?? new Set<string>();
    for (const source of entry.sources) set.add(source);
    catalogs.set(gameId, set);
  }
  const withIterations = new Set(data.iterations.map((i) => Number(i.gameId)));
  // "Registro de partida" según la condición 1.x (canMoveToPlanWhere): sin
  // iteraciones no puede haber sesiones ni eventos (cuelgan de ellas), así que
  // quedan los gastos que no son compras, los desbloqueos y las copias.
  const withPlay = new Set<number>([
    ...data.spendEvents.filter((sp) => sp.type !== 'purchase').map((sp) => Number(sp.gameId)),
    ...data.saveBackupGameIds,
  ]);
  const achievementGame = new Map(data.achievements.map((a) => [Number(a.id), Number(a.gameId)]));
  for (const u of data.unlocks) {
    const gameId = achievementGame.get(Number(u.achievementId));
    if (gameId !== undefined) withPlay.add(gameId);
  }
  const withCuriosities = new Set(data.curiosities.map((c) => Number(c.gameId)));
  const zeroPlaythroughs = new Set<number>();
  const catalogWithoutStamp = new Set<number>();
  const curiositiesWithoutStamp = new Set<number>();
  for (const g of data.games) {
    const id = Number(g.id);
    if (!Number(g.planned) && !withIterations.has(id) && !withPlay.has(id))
      zeroPlaythroughs.add(id);
    if (g.achievementsSyncedAt === null && catalogs.has(id)) catalogWithoutStamp.add(id);
    if (g.curiositiesGeneratedAt === null && withCuriosities.has(id))
      curiositiesWithoutStamp.add(id);
  }
  const mixedCatalogs = new Set(
    [...catalogs].filter(([, set]) => set.size > 1).map(([gameId]) => gameId),
  );
  return { zeroPlaythroughs, mixedCatalogs, catalogWithoutStamp, curiositiesWithoutStamp };
}

/** La precisión que la 2.0 tiene que enseñar para un evento 1.x. */
function expectedPrecision(
  run: Run,
  legacyGameId: number,
  occurredAt: Date,
  precision: string,
): string {
  const dates = run.gameDates.get(legacyGameId);
  if (dates && isAddedAtArtifact(occurredAt, dates.addedAt, dates.promotedAt)) {
    if (precision !== 'unknown') run.out.expect('unknownPrecision');
    return 'unknown';
  }
  return precision;
}

/** Lo reclamado en este PC para un juego (game_installs). */
interface ClaimedInstall {
  readonly executablePath: string | null;
  readonly installDirectory: string | null;
}

/**
 * Las rutas de este PC (§19.6): la de la 1.x si ESA ruta se reclamó (el
 * tamaño va con la carpeta), si no null. Columna a columna: un juego puede
 * tener reclamada la carpeta y no el ejecutable.
 */
function expectedPath<T>(
  run: Run,
  newGameId: string,
  column: 'executablePath' | 'installDirectory' | 'installSizeBytes',
  value: T | null,
): T | null {
  const install = run.installs.get(newGameId);
  const claimed = column === 'installSizeBytes' ? install?.installDirectory : install?.[column];
  if (claimed != null) return value;
  if (value !== null) run.out.expect('installPaths');
  return null;
}

// ── Biblioteca ──────────────────────────────────────────────────────────────

type ListItem1x = Legacy['games'][number];
type NormalizedListItem<T extends ListItem1x> = Omit<T, 'id' | 'manualIterations'> & {
  id: string;
  manualIterations: { iterationId: string; hours: number; year: number | null }[];
  legacyId: number;
};

function normalizeListItem<T extends ListItem1x>(run: Run, item: T): NormalizedListItem<T> {
  const id = run.ids.game(item.id);
  return {
    ...item,
    id,
    executablePath: expectedPath(run, id, 'executablePath', item.executablePath),
    manualIterations: item.manualIterations.map((m) => ({
      ...m,
      iterationId: run.ids.iteration(m.iterationId),
    })),
    legacyId: item.id,
  };
}

/** El orden de la 1.x: `title collate nocase` (solo ASCII), empatados por el motor. */
const nocaseKey = (title: string): string => title.replace(/[A-Z]/g, (c) => c.toLowerCase());

function compareLibrary(run: Run): void {
  const actual = getGames(run.q);
  keyed(
    run.out,
    'biblioteca',
    '',
    run.legacy.games.map((g) => normalizeListItem(run, g)),
    actual,
    (g) => String(g.id),
    (g) => String(g.id),
    {
      where: (g) => ({ legacyTable: 'games', legacyId: g.legacyId }),
      orderRule: 'ties',
      tieKey: (g) => nocaseKey(String(g.title)),
    },
  );
  run.out.totals['biblioteca: juegos 1.x'] = run.legacy.games.length;
  run.out.totals['biblioteca: juegos 2.0'] = actual.length;
}

// ── Ficha ───────────────────────────────────────────────────────────────────

function normalizeEvent(run: Run, legacyGameId: number, e: LegacyEvent): Record<string, unknown> {
  return {
    ...e,
    id: run.ids.event(e.id),
    iterationId: run.ids.iteration(e.iterationId),
    datePrecision: expectedPrecision(run, legacyGameId, e.occurredAt, e.datePrecision),
  };
}

function normalizeEdge(
  run: Run,
  legacyGameId: number,
  edge: LegacyDetail['iterations'][number]['startEvent'],
): Record<string, unknown> | null {
  if (edge === null) return null;
  return {
    ...edge,
    id: run.ids.event(edge.id),
    datePrecision: expectedPrecision(run, legacyGameId, edge.occurredAt, edge.datePrecision),
  };
}

type LegacySession = LegacyDetail['iterations'][number]['sessions'][number];
function normalizeSession(run: Run, s: LegacySession): Record<string, unknown> {
  return {
    ...s,
    id: run.ids.session(s.id),
    iterationId: run.ids.iterationOrNull(s.iterationId),
    emulatorId: run.ids.emulatorOrNull(s.emulatorId),
  };
}

/** zeroPlaythroughsMoveToPlan: la 1.x dice que no (no hay iteración) y la 2.0 que sí. */
function expectedCanMoveToPlan(run: Run, legacyGameId: number, legacy: boolean): boolean {
  if (legacy || !run.cases.zeroPlaythroughs.has(legacyGameId)) return legacy;
  run.out.expect('zeroPlaythroughsMoveToPlan');
  return true;
}

/** curiositiesWithoutStamp: sin sello en la 1.x, la 2.0 enseña la fecha del alta. */
function expectedCuriositiesAt(run: Run, legacyGameId: number, legacy: Date | null): Date | null {
  if (legacy !== null || !run.cases.curiositiesWithoutStamp.has(legacyGameId)) return legacy;
  run.out.expect('curiositiesWithoutStamp');
  return run.gameDates.get(legacyGameId)?.addedAt ?? null;
}

/** El paso por el Plan que la 2.0 tiene que enseñar, sacado de lo que enseña la 1.x. */
function expectedPlanHistory(
  run: Run,
  detail: LegacyDetail,
): { plannedAt: Date; note: string | null; leftAt: Date | null } | null {
  const events = detail.stateHistory.filter((e) => e.type === 'plan_to_play');
  if (!detail.planned && events.length === 0) return null;
  // "Esperando desde": el PRIMER plan_to_play por id (planWaitingSince); la
  // nota: la que enseña el Plan, el más reciente por fecha y luego por id.
  const byId = [...events].sort((a, b) => a.id - b.id);
  const byRecency = [...events].sort(
    (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || b.id - a.id,
  );
  // Un plan_to_play que no da ni la fecha ni la nota no tiene destino en la 2.0.
  for (const extra of byId.slice(1)) {
    if (extra === byRecency[0]) continue;
    run.out.leaf('ficha', 'planHistory{plan_to_play adicional}', 'conservado', 'sin destino', {
      legacyTable: 'state_events',
      legacyId: extra.id,
    });
  }
  return {
    plannedAt: byId[0]?.occurredAt ?? detail.addedAt,
    note: byRecency[0]?.note ?? null,
    leftAt: detail.planned ? null : detail.promotedAt,
  };
}

function compareDetail(run: Run, legacyGameId: number, detail: LegacyDetail): void {
  const where: Where = { legacyTable: 'games', legacyId: legacyGameId };
  const id = run.ids.game(legacyGameId);
  const actual = getGameById(run.q, id);
  run.out.leaf('ficha', '{presente}', true, actual !== null, where);
  if (!actual) return;

  const planEvents = detail.stateHistory.filter((e) => e.type === 'plan_to_play').length;
  run.out.expect('planToPlay', planEvents);
  const kept = detail.iterations.filter((i) => {
    if (!run.ctx.droppedIterations.has(i.id)) return true;
    run.out.expect('emptyPlannedIteration');
    return false;
  });
  // Las iteraciones se comparan una a una más abajo.
  const { stateHistory, spendHistory, ...withIterations } = detail;
  const { iterations: legacyIterations, ...game } = withIterations;
  void legacyIterations;
  const expectedGame = {
    ...game,
    id,
    executablePath: expectedPath(run, id, 'executablePath', game.executablePath),
    installDirectory: expectedPath(run, id, 'installDirectory', game.installDirectory),
    installSizeBytes: expectedPath(run, id, 'installSizeBytes', game.installSizeBytes),
    canMoveToPlan: expectedCanMoveToPlan(run, legacyGameId, game.canMoveToPlan),
    curiositiesGeneratedAt: expectedCuriositiesAt(run, legacyGameId, game.curiositiesGeneratedAt),
  };
  const {
    iterations: actualIterations,
    stateHistory: actualHistory,
    spendHistory: actualSpend,
    planHistory,
    ...actualGame
  } = actual;
  deep(run.out, 'ficha', '', expectedGame, actualGame, where);
  deep(run.out, 'ficha', 'planHistory', expectedPlanHistory(run, detail), planHistory, where);

  keyed(
    run.out,
    'ficha',
    'stateHistory',
    stateHistory
      .filter((e) => e.type !== 'plan_to_play')
      .map((e) => normalizeEvent(run, legacyGameId, e)),
    actualHistory,
    (e) => String(e.id),
    (e) => e.id,
    { where: () => where },
  );
  keyed(
    run.out,
    'ficha',
    'spendHistory',
    spendHistory.map((s) => ({ ...s, id: run.ids.spend(s.id), gameId: id })),
    actualSpend,
    (s) => s.id,
    (s) => s.id,
    { where: () => where },
  );

  run.out.leaf('ficha', 'iterations.length', kept.length, actualIterations.length, where);
  const actualById = new Map(actualIterations.map((i) => [i.id, i]));
  kept.forEach((it, index) => {
    const at: Where = { legacyTable: 'iterations', legacyId: it.id };
    const newId = run.ids.iteration(it.id);
    const q = actualById.get(newId);
    run.out.leaf('ficha', 'iterations[]{presente}', true, q !== undefined, at);
    if (!q) return;
    run.out.leaf('ficha', 'iterations[]{posición}', index, actualIterations.indexOf(q), at);
    const { sessions, startEvent, endEvent, ...rest } = it;
    const { sessions: qSessions, startEvent: qStart, endEvent: qEnd, ...qRest } = q;
    deep(run.out, 'ficha', 'iterations[]', { ...rest, id: newId, gameId: id }, qRest, at);
    deep(
      run.out,
      'ficha',
      'iterations[].startEvent',
      normalizeEdge(run, legacyGameId, startEvent),
      qStart,
      at,
    );
    deep(
      run.out,
      'ficha',
      'iterations[].endEvent',
      normalizeEdge(run, legacyGameId, endEvent),
      qEnd,
      at,
    );
    keyed(
      run.out,
      'ficha',
      'iterations[].sessions',
      sessions.map((s) => normalizeSession(run, s)),
      qSessions,
      (s) => String(s.id),
      (s) => s.id,
      // La 1.x las trae con `inArray` y sin ORDER BY.
      { where: () => at, orderRule: 'unorderedLegacy' },
    );
  });
  run.out.total('fichas comparadas');
}

// ── Plan ────────────────────────────────────────────────────────────────────

function comparePlan(run: Run): void {
  const actual = getPlannedGames(run.q);
  keyed(
    run.out,
    'plan',
    '',
    run.legacy.planned.map((g) => normalizeListItem(run, g)),
    actual,
    (g) => String(g.id),
    (g) => g.id,
    {
      where: (g) => ({ legacyTable: 'games', legacyId: g.legacyId }),
      orderRule: 'ties',
      tieKey: (g) => nocaseKey(String(g.title)),
    },
  );
  run.out.totals['plan: juegos 1.x'] = run.legacy.planned.length;
  // Los extras se cruzan por id con el canal escueto: su orden no se enseña.
  keyed(
    run.out,
    'plan (extras)',
    '',
    run.legacy.plannedExtras.map((g) => ({ ...g, id: run.ids.game(g.id) })),
    getPlannedGameExtras(run.q),
    (g) => g.id,
    (g) => g.id,
    // La 1.x los ordena por su id entero (`orderBy(asc(gamesTable.id))`).
    { orderRule: 'ids' },
  );
}

// ── Sesiones, estados y gastos ──────────────────────────────────────────────

function compareTimelines(run: Run): void {
  keyed(
    run.out,
    'sesiones',
    '',
    run.legacy.sessions.map((s) => ({
      ...s,
      id: run.ids.session(s.id),
      iterationId: run.ids.iteration(s.iterationId),
      gameId: run.ids.game(s.gameId),
      legacyId: s.id,
    })),
    getAllSessions(run.q),
    (s) => s.id,
    (s) => s.id,
    // startedAt desc, id desc en las dos (id 1.x ≡ orden de creación).
    { where: (s) => ({ legacyTable: 'sessions', legacyId: s.legacyId }) },
  );

  const events = run.legacy.stateEvents;
  run.out.expect('planToPlay', events.filter((e) => e.type === 'plan_to_play').length);
  keyed(
    run.out,
    'estados',
    '',
    events
      .filter((e) => e.type !== 'plan_to_play')
      .map((e) => ({
        ...e,
        id: run.ids.event(e.id),
        gameId: run.ids.game(e.gameId),
        iterationId: run.ids.iteration(e.iterationId),
        datePrecision: expectedPrecision(run, e.gameId, e.occurredAt, e.datePrecision),
        legacyId: e.id,
      })),
    getAllStateEvents(run.q),
    (e) => e.id,
    (e) => e.id,
    {
      where: (e) => ({ legacyTable: 'state_events', legacyId: e.legacyId }),
      // La 1.x no tenía ORDER BY.
      orderRule: 'unorderedLegacy',
    },
  );

  multiset(
    run.out,
    'gastos',
    run.legacy.spendEvents.map((s) => ({ ...s, gameId: run.ids.game(s.gameId) })),
    getAllSpendEvents(run.q),
    (s) => `${s.gameId}|${ms(s.occurredAt)}|${s.amount}`,
    'unorderedLegacy',
  );
}

// ── Logros ──────────────────────────────────────────────────────────────────

/** La fuente de un logro 2.0 por su clave `<juego>:<fuente>:<apiName>`. */
const sourceOfAchievementKey = (key: string): string => key.split(':')[1] ?? '?';

type Perfect1x =
  Legacy['overview'] extends ReadonlyMap<unknown, infer O>
    ? O extends { perfectGames: readonly (infer P)[] }
      ? P
      : never
    : never;
type Perfect2x = ReturnType<typeof getAchievementsOverview>['perfectGames'][number];

/**
 * Los perfectos de un juego con catálogo de las dos fuentes (perSourceCompletion,
 * estrechada): en la 1.x es perfecto si TODO el catálogo mezclado lo es, así
 * que tiene que serlo si y solo si la 2.0 da perfectas LAS DOS fuentes, con
 * el total sumado y, como fecha, la del último logro (null si alguna fuente
 * no la tiene fiable). Que la 2.0 dé perfecta UNA sola fuente es justo la
 * diferencia decidida.
 */
function mixedPerfect(
  run: Run,
  read: string,
  mixed: ReadonlySet<string>,
  legacy: readonly Perfect1x[],
  actual: readonly Perfect2x[],
): void {
  for (const legacyId of run.cases.mixedCatalogs) {
    const gameId = run.ids.game(legacyId);
    if (!mixed.has(gameId)) continue;
    const old = legacy.find((g) => g.gameId === legacyId);
    const sources = actual.filter((g) => g.gameId === gameId);
    const both = sources.length === 2 && new Set(sources.map((g) => g.source)).size === 2;
    const where: Where = { legacyTable: 'games', legacyId };
    run.out.leaf(read, 'perfectGames{fuentes mezcladas}', old !== undefined, both, where);
    if (!old || !both) continue;
    const dates = sources.map((g) => g.completedAt);
    const last = dates.every((d) => d !== null)
      ? new Date(Math.max(...dates.map((d) => (d as Date).getTime())))
      : null;
    run.out.leaf(
      read,
      'perfectGames{fuentes mezcladas}.total',
      old.total,
      sources[0].total + sources[1].total,
      where,
    );
    run.out.leaf(read, 'perfectGames{fuentes mezcladas}.completedAt', old.completedAt, last, where);
  }
}

function compareAchievements(run: Run): void {
  const sortIndexOf = new Map(
    run.ctx.data.achievements.map((a) => [Number(a.id), Number(a.sortIndex)]),
  );
  for (const [legacyGameId, legacy] of run.legacy.achievements) {
    const where: Where = { legacyTable: 'games', legacyId: legacyGameId };
    const id = run.ids.game(legacyGameId);
    const actual = getGameAchievements(run.q, id);
    const { entries, ...head } = legacy;
    const { entries: actualEntries, ...actualHead } = actual;
    let syncedAt = head.syncedAt;
    if (syncedAt === null && run.cases.catalogWithoutStamp.has(legacyGameId)) {
      // catalogWithoutStamp: el catálogo lleva la fecha del alta (build.ts).
      run.out.expect('catalogWithoutStamp');
      syncedAt = run.gameDates.get(legacyGameId)?.addedAt ?? null;
    }
    deep(run.out, 'logros (ficha)', '', { ...head, syncedAt, gameId: id }, actualHead, where);
    const mixed = run.cases.mixedCatalogs.has(legacyGameId);
    keyed(
      run.out,
      'logros (ficha)',
      'entries',
      entries.map((e) => ({
        ...e,
        id: run.ids.achievement(e.id),
        sessionId: run.ids.sessionOrNull(e.sessionId),
        iterationId: run.ids.iterationOrNull(e.iterationId),
        legacyId: e.id,
      })),
      actualEntries,
      (e) => e.id,
      (e) => e.id,
      {
        where: (e) => ({ legacyTable: 'achievements', legacyId: e.legacyId }),
        list: where,
        // La 1.x ordena solo por `sortIndex` (empatados en el orden del
        // motor); la 2.0 desempata por el orden guardado en el catálogo.
        orderRule: 'ties',
        tieKey: (e) => String(sortIndexOf.get(e.legacyId) ?? '?'),
        // mixedCatalogOrder: con las dos fuentes, bloque de Steam y luego el
        // de RA; dentro de cada una, la regla de los empates.
        blocks: mixed
          ? { groupOf: sourceOfAchievementKey, order: ['steam', 'ra'], rule: 'mixedCatalogOrder' }
          : undefined,
      },
    );
    run.out.total('fichas de logros comparadas');
  }

  // Juegos 2.0 con catálogo de las dos fuentes (sacados del origen).
  const mixed = new Set([...run.cases.mixedCatalogs].map((legacyId) => run.ids.game(legacyId)));

  for (const [year, legacy] of run.legacy.overview) {
    const read = `logros (resumen ${year ?? 'All Time'})`;
    const actual = getAchievementsOverview(run.q, year);
    const { topGames, hallOfFame, perfectGames, almostThere, ...rest } = legacy;
    const {
      topGames: aTop,
      hallOfFame: aHall,
      perfectGames: aPerfect,
      almostThere: aAlmost,
      ...aRest
    } = actual;
    deep(run.out, read, '', rest, aRest, {});
    deep(
      run.out,
      read,
      'topGames',
      topGames?.map((g) => ({ ...g, gameId: run.ids.game(g.gameId) })) ?? null,
      aTop,
      {},
    );
    deep(
      run.out,
      read,
      'hallOfFame',
      hallOfFame.map((h) => ({
        ...h,
        gameId: run.ids.game(h.gameId),
        achievementId: run.ids.achievement(h.achievementId),
      })),
      aHall,
      {},
    );
    // Completado por fuente: un juego con catálogo de Steam Y de RA es un hito
    // por fuente en la 2.0 y uno solo (todo el catálogo mezclado) en la 1.x.
    // Esos juegos se apartan de la comparación por clave (y se cuentan); el
    // resto se compara exactamente. Los perfectos apartados se comprueban
    // aparte (`mixedPerfect`).
    const single = <T extends { gameId: string }>(list: readonly T[]): T[] =>
      list.filter((g) => {
        if (!mixed.has(g.gameId)) return true;
        run.out.expect('perSourceCompletion');
        return false;
      });
    mixedPerfect(run, read, mixed, perfectGames, aPerfect);
    keyed(
      run.out,
      read,
      'perfectGames',
      single(
        perfectGames.map((g) => ({ ...g, gameId: run.ids.game(g.gameId), legacyId: g.gameId })),
      ),
      single(aPerfect),
      (g) => g.gameId,
      (g) => g.gameId,
      { where: (g) => ({ legacyTable: 'games', legacyId: g.legacyId }) },
    );
    keyed(
      run.out,
      read,
      'almostThere',
      single(
        almostThere.map((g) => ({
          ...g,
          gameId: run.ids.game(g.gameId),
          missing: g.missing.map((m) => ({
            ...m,
            achievementId: run.ids.achievement(m.achievementId),
          })),
          legacyId: g.gameId,
        })),
      ),
      single(aAlmost),
      (g) => g.gameId,
      (g) => g.gameId,
      { where: (g) => ({ legacyTable: 'games', legacyId: g.legacyId }) },
    );
  }

  const status = getAchievementsStatus(run.q, {
    running: run.legacy.status.running,
    failedGames: run.legacy.status.failedGames,
    hasApiKey: run.legacy.status.hasApiKey,
    hasUserId: run.legacy.status.hasUserId,
    hasRaCredentials: run.legacy.status.hasRaCredentials,
  });
  // catalogWithoutStamp: la 2.0 cuenta como sincronizado un juego con
  // catálogo aunque no tenga sello; la 1.x solo cuenta el sello.
  const stampless = run.cases.catalogWithoutStamp.size;
  run.out.expect('catalogWithoutStamp', stampless);
  deep(
    run.out,
    'logros (estado)',
    '',
    { ...run.legacy.status, syncedGames: run.legacy.status.syncedGames + stampless },
    status,
    {},
  );

  keyed(
    run.out,
    'logros (por sesión)',
    '',
    run.legacy.sessionUnlocks.map((u) => ({
      ...u,
      sessionId: run.ids.session(u.sessionId),
      achievementId: run.ids.achievement(u.achievementId),
    })),
    getSessionUnlocks(run.q),
    (u) => `${u.sessionId}|${u.achievementId}`,
    (u) => `${u.sessionId}|${u.achievementId}`,
    { orderRule: 'unorderedLegacy' },
  );
}

// ── Recaps ──────────────────────────────────────────────────────────────────

function compareMemories(run: Run, memories: ReadonlyMap<string, ResealedMemory>, now: Date): void {
  const actualMemories = getLatestMemories(run.q);
  keyed(
    run.out,
    'recaps',
    '',
    run.legacy.memories.map((m) => {
      const id = `${m.scopeType}:${m.scopeKey}`;
      const reseal = memories.get(id);
      if (reseal && reseal.expectedHash !== m.sourceHash) run.out.expect('resealedSignature');
      return { ...m, sourceHash: reseal?.expectedHash ?? m.sourceHash };
    }),
    actualMemories,
    (m) => `${m.scopeType}:${m.scopeKey}`,
    (m) => `${m.scopeType}:${m.scopeKey}`,
    // createdAt desc en las dos; el id solo desempata en la 2.0.
    { orderRule: 'ties', tieKey: (m) => ms(m.createdAt) },
  );

  // Los hechos crudos, traducidos.
  const legacyFacts = run.legacy.memoryFacts;
  const facts = getMemoryFacts(run.q);
  keyed(
    run.out,
    'recaps (hechos)',
    'sessions',
    // La consulta 1.x se trae también `iterationId` para anclar las horas
    // manuales, pero no es parte de su contrato (`MemorySession`): no se compara.
    legacyFacts.sessions.map((s) => ({
      id: run.ids.session(s.id),
      gameId: run.ids.game(s.gameId),
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      durationSec: s.durationSec,
      isManual: s.isManual,
    })),
    facts.sessions,
    (s) => s.id,
    (s) => s.id,
    { orderRule: 'unorderedLegacy' },
  );
  deep(
    run.out,
    'recaps (hechos)',
    'titlesByGame',
    Object.fromEntries([...legacyFacts.titlesByGame].map(([k, v]) => [run.ids.game(k), v])),
    Object.fromEntries(facts.titlesByGame),
    {},
  );
  deep(
    run.out,
    'recaps (hechos)',
    'manualHoursByGame',
    Object.fromEntries([...legacyFacts.manualHoursByGame].map(([k, v]) => [run.ids.game(k), v])),
    Object.fromEntries(facts.manualHoursByGame),
    {},
  );
  multiset(
    run.out,
    'recaps (hechos) manualBlocks',
    legacyFacts.manualBlocks.map((b) => ({ ...b, gameId: run.ids.game(b.gameId) })),
    facts.manualBlocks,
    (b) => `${b.gameId}|${b.hours}|${ms(b.anchor)}`,
    'unorderedLegacy',
  );
  multiset(
    run.out,
    'recaps (hechos) unlocks',
    legacyFacts.unlocks.map((u) => ({ ...u, gameId: run.ids.game(u.gameId) })),
    facts.unlocks,
    (u) => `${u.gameId}|${ms(u.unlockedAt)}|${u.globalPercent}|${u.name}`,
    'unorderedLegacy',
  );
  // Eventos: la 1.x lleva (alta, promoción) y aplica la heurística; la 2.0
  // lleva la precisión. Se compara el tipo, la fecha y si es papeleo.
  const legacyEvents = legacyFacts.events.filter((e) => e.type !== 'plan_to_play');
  run.out.expect('planToPlay', legacyFacts.events.length - legacyEvents.length);
  multiset(
    run.out,
    'recaps (hechos) events',
    legacyEvents.map((e) => ({
      gameId: run.ids.game(e.gameId),
      type: e.type,
      occurredAt: e.occurredAt,
      paperwork: isAddedAtArtifact(e.occurredAt, e.addedAt, e.promotedAt),
    })),
    facts.events.map((e) => ({
      gameId: e.gameId,
      type: e.type,
      occurredAt: e.occurredAt,
      paperwork: e.datePrecision === 'unknown',
    })),
    (e) => `${e.gameId}|${ms(e.occurredAt)}|${e.type}|${e.paperwork}`,
    'unorderedLegacy',
  );

  // Los capítulos: cada periodo cerrado con actividad, construido con los
  // hechos de cada lado. Con ids 1.x, los hechos canónicos tienen que salir
  // idénticos: es lo que hace que la firma de un recap siga casando.
  const legacyMoments = deriveMoments(legacyFacts.sessions, legacyFacts.manualHoursByGame);
  const snapshot = loadMemoryFactsSnapshot(run.q);
  const legacyIdsOfGames = new Map([...run.ctx.gameIds].map(([legacy, id]) => [id, legacy]));
  const periods1 = listClosedPeriodsWithActivity(
    legacyFacts.sessions,
    legacyFacts.events,
    now,
    legacyFacts.manualBlocks,
  );
  const periods2 = listClosedPeriodsWithActivity(
    facts.sessions,
    facts.events,
    now,
    facts.manualBlocks,
  );
  const keysOf = (p: { months: ChapterScope[]; years: ChapterScope[] }): string[] =>
    [...p.months, ...p.years].map((s) => `${s.type}:${scopeKeyOf(s)}`);
  deep(
    run.out,
    'recaps (periodos cerrados con actividad)',
    '',
    keysOf(periods1),
    keysOf(periods2),
    {},
  );

  const chapter1 = (scope: ChapterScope): Chapter<number> | null =>
    buildChapter(
      scope,
      legacyFacts.sessions,
      legacyFacts.events,
      legacyFacts.titlesByGame,
      legacyMoments,
      now,
      legacyFacts.manualBlocks,
      legacyFacts.unlocks,
    );
  const scopes = new Map<string, ChapterScope>();
  for (const scope of [
    ...periods1.months,
    ...periods1.years,
    ...periods2.months,
    ...periods2.years,
  ])
    scopes.set(`${scope.type}:${scopeKeyOf(scope)}`, scope);
  for (const [key, scope] of scopes) {
    const a = chapter1(scope);
    const b = memoryChapterFor(snapshot, scope, now);
    run.out.leaf('recaps (capítulos)', `{existe}`, a !== null, b !== null, { legacyId: key });
    if (!a || !b) continue;
    const translated = toLegacyIds(b, legacyIdsOfGames);
    if ('unmappedGameIds' in translated) {
      run.out.leaf(
        'recaps (capítulos)',
        '{juegos sin id 1.x}',
        0,
        translated.unmappedGameIds.length,
        {
          legacyId: key,
        },
      );
      continue;
    }
    for (const generation of ['full', 'noAchievements', 'noDecisions'] as const) {
      run.out.leaf(
        'recaps (capítulos)',
        `hechos canónicos (${generation})`,
        canonicalChapterFacts(a, generation),
        canonicalChapterFacts(translated.chapter, generation),
        { legacyId: key },
      );
    }
  }
  run.out.totals['recaps: periodos comparados'] = scopes.size;

  // Vigencia de cada recap guardado: la 1.x (status.ts: chapterHash o
  // legacyChapterHash) frente a la 2.0 con la firma que quedó en el destino.
  const actualByScope = new Map(actualMemories.map((m) => [`${m.scopeType}:${m.scopeKey}`, m]));
  for (const memory of run.legacy.memories) {
    const key = `${memory.scopeType}:${memory.scopeKey}`;
    const scope = scopes.get(key);
    const a = scope ? chapter1(scope) : null;
    const sealed1 =
      a !== null &&
      (chapterHash(a) === memory.sourceHash || legacyChapterHash(a) === memory.sourceHash);
    const stored = actualByScope.get(key);
    const b = scope ? memoryChapterFor(snapshot, scope, now) : null;
    const sealed2 =
      b !== null &&
      stored !== undefined &&
      (chapterSignature(b, 'noAchievements') === stored.sourceHash ||
        chapterSignature(b, 'noDecisions') === stored.sourceHash);
    run.out.leaf('recaps', 'vigente', sealed1, sealed2, {
      legacyTable: 'generated_memories',
      legacyId: key,
    });
    if (sealed1) run.out.total('recaps vigentes en la 1.x');
    if (sealed2) run.out.total('recaps vigentes en la 2.0');
  }
}

// ── Curiosidades y radar ────────────────────────────────────────────────────

function compareLoopExtras(run: Run): void {
  const group = <T extends { gameId: string; text: string }>(
    list: readonly T[],
  ): Record<string, string[]> => {
    const out: Record<string, string[]> = {};
    for (const c of list) (out[c.gameId] ??= []).push(c.text);
    return out;
  };
  const legacy = run.legacy.curiosities.map((c) => ({
    gameId: run.ids.game(c.gameId),
    text: c.text,
  }));
  const actual = getAllCuriosities(run.q);
  deep(run.out, 'curiosidades', '', group(legacy), group(actual), {});
  const sameOrder =
    legacy.length === actual.length && legacy.every((c, i) => c.gameId === actual[i].gameId);
  if (!sameOrder) run.out.expect('unorderedLegacy');
  // curiositiesWithoutStamp: la 2.0 cuenta como generado un juego con
  // curiosidades sin sello (el recuento es de la biblioteca: sin planeados).
  const plannedGames = new Set(
    run.ctx.data.games.filter((g) => Number(g.planned)).map((g) => Number(g.id)),
  );
  const stampless = [...run.cases.curiositiesWithoutStamp].filter((id) => !plannedGames.has(id));
  run.out.expect('curiositiesWithoutStamp', stampless.length);
  deep(
    run.out,
    'curiosidades (recuento)',
    '',
    {
      ...run.legacy.curiositiesCounts,
      generatedGames: run.legacy.curiositiesCounts.generatedGames + stampless.length,
    },
    getCuriositiesCounts(run.q),
    {},
  );

  run.out.expect('ids', run.legacy.radar.length);
  keyed(
    run.out,
    'radar',
    '',
    run.legacy.radar.map(({ id, ...r }) => ({ ...r, id: `igdb:${r.igdbId}`, legacyId: id })),
    listRadarGames(run.q),
    (r) => String(r.igdbId),
    (r) => String(r.igdbId),
    {
      where: (r) => ({ legacyTable: 'radar_games', legacyId: r.legacyId }),
      orderRule: 'ties',
      tieKey: (r) => ms(r.releaseDate),
    },
  );
}

// ── Emuladores, bandeja Pending, escaneo y watcher ──────────────────────────

function compareDevices(run: Run, claimedInstalls: boolean): void {
  const emulatorId = (id: number): string => run.ids.emulatorOrNull(id) as string;
  // La ruta de un emulador es de ESTE PC (emulator_installs): la de la 1.x si
  // se reclamó; si no, '' (R-08, como el DTO de la 2.0).
  keyed(
    run.out,
    'emuladores',
    '',
    run.legacy.emulators.map((e) => {
      const id = emulatorId(e.id);
      const claimed = run.emulatorPaths.get(id);
      if (claimed === undefined) run.out.expect('installPaths');
      return {
        ...e,
        id,
        executablePath: claimed === undefined ? '' : e.executablePath,
        legacyId: e.id,
      };
    }),
    getEmulators(run.q),
    (e) => e.id,
    (e) => e.id,
    {
      where: (e) => ({ legacyTable: 'emulators', legacyId: e.legacyId }),
      // `name collate nocase` en las dos; la 2.0 desempata por creación.
      orderRule: 'ties',
      tieKey: (e) => nocaseKey(e.name),
    },
  );

  keyed(
    run.out,
    'sesiones (pendientes)',
    '',
    run.legacy.pendingSessions.map((p) => ({
      ...p,
      id: run.ids.session(p.id),
      emulatorId: emulatorId(p.emulatorId),
      legacyId: p.id,
    })),
    getPendingSessions(run.q),
    (p) => p.id,
    (p) => p.id,
    {
      where: (p) => ({ legacyTable: 'sessions', legacyId: p.legacyId }),
      // `startedAt desc` en las dos; la 1.x no desempata.
      orderRule: 'ties',
      tieKey: (p) => ms(p.startedAt),
    },
  );

  keyed(
    run.out,
    'escaneo (juegos de la colección)',
    '',
    run.legacy.ownedGames.map((g) => ({ ...g, id: run.ids.game(g.id), legacyId: g.id })),
    getOwnedGames(run.q),
    (g) => g.id,
    (g) => g.id,
    {
      where: (g) => ({ legacyTable: 'games', legacyId: g.legacyId }),
      // La 1.x no tiene ORDER BY.
      orderRule: 'unorderedLegacy',
    },
  );

  if (!claimedInstalls) {
    run.out.total('watcher: sin comparar (importación sin claimInstalls)');
    return;
  }
  // Lo que vigila la 1.x, menos lo que no se reclamó en este PC (§19.6).
  const expected = run.legacy.watchTargets.flatMap((t) => {
    const refId = t.kind === 'game' ? run.ids.game(t.refId) : emulatorId(t.refId);
    const claimed =
      t.kind === 'game'
        ? run.installs.get(refId)?.executablePath != null
        : run.emulatorPaths.has(refId);
    if (!claimed) {
      run.out.expect('installPaths');
      return [];
    }
    const prefix = t.kind === 'game' ? 'game' : 'emu';
    return [{ ...t, key: `${prefix}:${refId}`, refId, legacyId: t.refId }];
  });
  keyed(
    run.out,
    'watcher',
    '',
    expected,
    getWatchTargets(run.q),
    (t) => t.key,
    (t) => t.key,
    {
      where: (t) => ({
        legacyTable: t.kind === 'game' ? 'games' : 'emulators',
        legacyId: t.legacyId,
      }),
      // Juegos y luego emuladores en las dos; dentro, la 1.x no tiene ORDER BY.
      orderRule: 'unorderedLegacy',
    },
  );
  run.out.totals['watcher: objetivos 1.x'] = run.legacy.watchTargets.length;
}

// ── Entrada ─────────────────────────────────────────────────────────────────

/**
 * Compara las lecturas 1.x (foto del origen) con las consultas 2.0 sobre el
 * destino ya escrito. Solo lee. Ver la cabecera para qué cuenta como esperado.
 */
export function validateWithQueries(input: QueryValidationInput): QueryValidationReport {
  const started = performance.now();
  const { target, context, legacy } = input;
  const out = new QueryCollector();
  const q = createQueryContext(target, { now: () => new Date(input.now) });
  const installs = new Map(
    q.db
      .select({
        gameId: gameInstalls.gameId,
        executablePath: gameInstalls.executablePath,
        installDirectory: gameInstalls.installDirectory,
      })
      .from(gameInstalls)
      .where(and(eq(gameInstalls.deviceId, target.deviceId), isNull(gameInstalls.syncDeleted)))
      .all()
      .map(({ gameId, ...install }) => [gameId, install]),
  );
  const emulatorPaths = new Map(
    q.db
      .select({
        emulatorId: emulatorInstalls.emulatorId,
        executablePath: emulatorInstalls.executablePath,
      })
      .from(emulatorInstalls)
      .where(
        and(eq(emulatorInstalls.deviceId, target.deviceId), isNull(emulatorInstalls.syncDeleted)),
      )
      .all()
      .map((r) => [r.emulatorId, r.executablePath]),
  );
  const gameDates = new Map(
    context.data.games.map((g) => [
      Number(g.id),
      {
        addedAt: new Date(Number(g.addedAt)),
        promotedAt: g.promotedAt === null ? null : new Date(Number(g.promotedAt)),
      },
    ]),
  );
  const run: Run = {
    out,
    ids: new Ids(context),
    ctx: context,
    q,
    legacy,
    installs,
    emulatorPaths,
    gameDates,
    cases: expectedCases(context),
  };

  // Cuántos juegos caen en cada diferencia esperada por juego, para que quien
  // migre lo vea aunque cada una se aplique en varias lecturas.
  out.totals['juegos en zeroPlaythroughsMoveToPlan'] = run.cases.zeroPlaythroughs.size;
  out.totals['juegos en mixedCatalogOrder / perSourceCompletion'] = run.cases.mixedCatalogs.size;
  out.totals['juegos en catalogWithoutStamp'] = run.cases.catalogWithoutStamp.size;
  out.totals['juegos en curiositiesWithoutStamp'] = run.cases.curiositiesWithoutStamp.size;

  compareLibrary(run);
  for (const [legacyGameId, detail] of legacy.details) compareDetail(run, legacyGameId, detail);
  // Un juego de la 1.x sin ficha sería un hallazgo de la propia foto.
  out.leaf('ficha', '{todas las fichas 1.x}', context.data.games.length, legacy.details.size, {});
  comparePlan(run);
  compareTimelines(run);
  compareAchievements(run);
  compareMemories(run, input.memories, input.now);
  compareLoopExtras(run);
  compareDevices(run, input.claimedInstalls ?? false);

  out.totals['valores comparados'] = out.compared;
  return {
    ok: out.count === 0,
    compared: out.compared,
    differenceCount: out.count,
    checks: out.checks,
    expected: out.expected,
    onlyInTarget: [...out.onlyInTarget].sort(),
    differences: out.differences,
    totals: out.totals,
    elapsedMs: Math.round(performance.now() - started),
  };
}
