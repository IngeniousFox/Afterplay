import { and, asc, desc, eq, isNotNull } from 'drizzle-orm';
import { generatedMemoryId } from '../../../../../shared/sync/ids';
import type {
  ChapterStateEventV2,
  ChapterUnlock,
  ManualBlock,
} from '../../../../../shared/memory/chapters';
import type { MemorySession } from '../../../../../shared/memory/moments';
import type { RecapPayload } from '../../../../../shared/memory/payload';
import { manualHoursAnchor } from '../../../../../shared/playthroughState';
import {
  games,
  generatedMemories,
  playthroughs,
  sessions,
  stateEvents,
  type MemoryScopeType,
  type StateEventType,
} from '../../schema';
import { alive } from '../../store';
import { getReliableUnlocks } from '../achievements/reliableUnlocks';
import {
  liveGame,
  livePlaythrough,
  liveSession,
  liveStateEvent,
  type QueryContext,
} from '../common';

// Recaps del Loop sobre el esquema 2.0 (CONSULTAS.md §2.2, "memories"):
// los hechos con los que se construye un capítulo y los recaps guardados.
//
// Sustituye a `src/main/db/queries/memories/{getMemoryFacts,getLatestMemories,
// insertMemory}.ts`. El contrato es el de hoy con ids de texto.

// ── Hechos ──────────────────────────────────────────────────────────────────

/** Un evento de estado tal como lo necesita un capítulo, en su forma 2.0. */
export type MemoryStateEvent = {
  gameId: string;
  type: StateEventType;
  occurredAt: Date;
} & ChapterStateEventV2;

/**
 * La materia prima de los capítulos (`buildChapter`, `deriveMoments`,
 * `listClosedPeriodsWithActivity`), con ids de texto. Mismos campos que el
 * `MemoryFacts` 1.x.
 *
 * Es la historia ENTERA, no la de un periodo: los momentos (récords, vueltas,
 * hitos de horas) solo se pueden derivar mirando todo, y `buildChapter` ya
 * filtra por el rango del periodo.
 */
export type MemoryFacts = {
  sessions: MemorySession<string>[];
  events: MemoryStateEvent[];
  titlesByGame: Map<string, string>;
  manualBlocks: ManualBlock<string>[];
  manualHoursByGame: Map<string, number>;
  unlocks: ChapterUnlock<string>[];
};

/**
 * Los hechos de toda la historia, solo con filas vivas (regla F-11: una sesión
 * o un evento cuyo playthrough o juego tiene lápida no cuenta).
 *
 * Diferencias con la 1.x, todas del modelo nuevo:
 * - Los eventos viajan con `datePrecision` y SIN `addedAt`/`promotedAt`
 *   (R-07): el papeleo del alta es exactamente `datePrecision = 'unknown'` y
 *   el tipo de `chapters.ts` impide activar la heurística de los 5 s.
 * - `isManual` sale de `sessions.source = 'legacy_manual'`.
 * - Las horas manuales son `playthroughs.manualHours`, ancladas con
 *   `manualHoursAnchor(…, 'datePrecision')`.
 * - Los desbloqueos (solo los de fecha fiable, fundidos por logro) los da el
 *   lector de logros, `achievements/getReliableUnlocks`: el mismo progreso que
 *   el resumen de Stats. Sustituyó en la integración al lector propio que
 *   tenía este paquete, tras comprobar que devolvían lo mismo.
 *
 * El resto del cálculo se ha copiado a propósito tal cual, en el mismo orden:
 * la firma de los recaps importados (ver `memorySignature.ts`) solo casa si
 * los hechos 2.0 de un periodo salen idénticos a los de la 1.x.
 */
export function getMemoryFacts(ctx: QueryContext): MemoryFacts {
  // Inner join con el playthrough: una sesión de emulador sin asignar no es
  // de ningún juego y no cuenta en ningún capítulo (AFTERPLAY-LOOP.md §7.4).
  // `liveSession()` ya exige playthrough y juego vivos para las asignadas.
  const sessionRows = ctx.db
    .select({
      id: sessions.id,
      syncCreated: sessions.syncCreated,
      gameId: playthroughs.gameId,
      playthroughId: playthroughs.id,
      startedAt: sessions.startedAt,
      endedAt: sessions.endedAt,
      durationSec: sessions.durationSec,
      source: sessions.source,
    })
    .from(sessions)
    .innerJoin(playthroughs, eq(sessions.playthroughId, playthroughs.id))
    .where(liveSession())
    .orderBy(asc(sessions.syncCreated), asc(sessions.id))
    .all();

  const eventRows = ctx.db
    .select({
      playthroughId: stateEvents.playthroughId,
      gameId: playthroughs.gameId,
      type: stateEvents.type,
      occurredAt: stateEvents.occurredAt,
      datePrecision: stateEvents.datePrecision,
    })
    .from(stateEvents)
    .innerJoin(playthroughs, eq(stateEvents.playthroughId, playthroughs.id))
    .where(liveStateEvent())
    .orderBy(asc(stateEvents.syncCreated), asc(stateEvents.id))
    .all();

  const gameRows = ctx.db
    .select({ id: games.id, title: games.title })
    .from(games)
    .where(liveGame())
    .all();

  const manualRows = ctx.db
    .select({
      playthroughId: playthroughs.id,
      gameId: playthroughs.gameId,
      hours: playthroughs.manualHours,
    })
    .from(playthroughs)
    .where(and(livePlaythrough(), isNotNull(playthroughs.manualHours)))
    .orderBy(asc(playthroughs.syncCreated), asc(playthroughs.id))
    .all();

  const memorySessions: MemorySession<string>[] = sessionRows.map((row) => ({
    id: row.id,
    syncCreated: row.syncCreated,
    gameId: row.gameId,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    durationSec: row.durationSec,
    isManual: row.source === 'legacy_manual',
  }));

  // La forma 2.0 exacta: nada de `addedAt`/`promotedAt` (R-07).
  const events: MemoryStateEvent[] = eventRows.map((row) => ({
    gameId: row.gameId,
    type: row.type,
    occurredAt: row.occurredAt,
    datePrecision: row.datePrecision,
  }));

  const eventsByPlaythrough = new Map<string, MemoryStateEvent[]>();
  eventRows.forEach((row, index) => {
    const list = eventsByPlaythrough.get(row.playthroughId) ?? [];
    list.push(events[index] as MemoryStateEvent);
    eventsByPlaythrough.set(row.playthroughId, list);
  });

  // La primera sesión de cada playthrough, la tercera pista del ancla de las
  // horas manuales. Cualquier sesión, como en la 1.x (también las abiertas y
  // las `legacy_manual`): cambiarlo movería anclas y con ellas firmas.
  const firstSessionByPlaythrough = new Map<string, Date>();
  for (const row of sessionRows) {
    const known = firstSessionByPlaythrough.get(row.playthroughId);
    if (!known || row.startedAt.getTime() < known.getTime()) {
      firstSessionByPlaythrough.set(row.playthroughId, row.startedAt);
    }
  }

  const manualBlocks: ManualBlock<string>[] = [];
  const manualHoursByGame = new Map<string, number>();
  for (const row of manualRows) {
    const hours = row.hours ?? 0;
    if (hours <= 0) continue;
    const firstSessionAt = firstSessionByPlaythrough.get(row.playthroughId);
    manualBlocks.push({
      gameId: row.gameId,
      hours,
      // Regla 'datePrecision': las anclas de alta y promoción no hacen falta
      // (solo las usaba la heurística 1.x), por eso van `undefined`.
      anchor: manualHoursAnchor(
        eventsByPlaythrough.get(row.playthroughId) ?? [],
        undefined,
        firstSessionAt ? [firstSessionAt] : undefined,
        undefined,
        'datePrecision',
      ),
    });
    manualHoursByGame.set(row.gameId, (manualHoursByGame.get(row.gameId) ?? 0) + hours);
  }

  return {
    sessions: memorySessions,
    events,
    titlesByGame: new Map(gameRows.map((game) => [game.id, game.title])),
    manualBlocks,
    manualHoursByGame,
    unlocks: getReliableUnlocks(ctx),
  };
}

// ── Recaps guardados ────────────────────────────────────────────────────────

/** El recap de un periodo, con lo que `status.ts` compara (firma, prompt, modelo). */
export type LatestMemory = {
  scopeType: MemoryScopeType;
  scopeKey: string;
  payload: RecapPayload;
  sourceHash: string;
  promptVersion: number;
  model: string;
  createdAt: Date;
};

const MEMORY_FIELDS = {
  scopeType: generatedMemories.scopeType,
  scopeKey: generatedMemories.scopeKey,
  payload: generatedMemories.payload,
  sourceHash: generatedMemories.sourceHash,
  promptVersion: generatedMemories.promptVersion,
  model: generatedMemories.model,
  createdAt: generatedMemories.createdAt,
};

/**
 * Los recaps vivos, uno por periodo (el id `<scopeType>:<scopeKey>` lo
 * garantiza: no hay historial que deduplicar). Del más reciente al más
 * antiguo; el id solo desempata para que el orden sea estable.
 */
export function getLatestMemories(ctx: QueryContext): LatestMemory[] {
  return ctx.db
    .select(MEMORY_FIELDS)
    .from(generatedMemories)
    .where(alive(generatedMemories))
    .orderBy(desc(generatedMemories.createdAt), desc(generatedMemories.id))
    .all();
}

/** El recap vivo de un periodo, o null si no hay (o tiene lápida). */
export function getMemory(
  ctx: QueryContext,
  scopeType: MemoryScopeType,
  scopeKey: string,
): LatestMemory | null {
  const row = ctx.db
    .select(MEMORY_FIELDS)
    .from(generatedMemories)
    .where(
      and(
        eq(generatedMemories.id, generatedMemoryId(scopeType, scopeKey)),
        alive(generatedMemories),
      ),
    )
    .get();
  return row ?? null;
}

export interface InsertMemoryInput {
  readonly scopeType: MemoryScopeType;
  readonly scopeKey: string;
  readonly payload: RecapPayload;
  readonly sourceHash: string;
  readonly model: string;
  readonly promptVersion: number;
  /** Por defecto `ctx.now()`: la fecha del recap es la de su ÚLTIMA escritura. */
  readonly createdAt?: Date;
}

/**
 * Guarda el recap de un periodo. Regenerar es escribir encima: el id
 * `<scopeType>:<scopeKey>` hace de `ON CONFLICT` (y resucita uno con lápida,
 * que es lo que se quiere al volver a generarlo). Devuelve el id.
 *
 * La firma la calcula quien llama con los hechos que ha narrado: si cambian
 * mientras el modelo escribe, el recap queda obsoleto, como hoy.
 */
export function insertMemory(ctx: QueryContext, input: InsertMemoryInput): string {
  return ctx.store.create('generated_memories', {
    scopeType: input.scopeType,
    scopeKey: input.scopeKey,
    payload: input.payload,
    sourceHash: input.sourceHash,
    model: input.model,
    promptVersion: input.promptVersion,
    createdAt: input.createdAt ?? ctx.now(),
  }).id;
}
