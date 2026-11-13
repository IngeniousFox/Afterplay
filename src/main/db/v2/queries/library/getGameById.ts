import { and, asc, eq } from 'drizzle-orm';
import { deriveGameDetail } from '../../../../../shared/domain/gameDetail';
import type { Iteration, Session, SpendEvent, StateEvent } from '../../../../../shared/dto';
import { playthroughs, sessions, spendEvents, stateEvents } from '../../schema';
import { alive } from '../../store';
import { liveSession, liveSpendEvent, liveStateEvent } from '../common/alive';
import type { QueryContext } from '../common/context';
import { readGameRow } from '../common/gameView';
import {
  effectivePlaythroughLabel,
  playthroughCreationOrder,
  playthroughPositions,
} from '../common/labels';
import { canMoveToPlan } from './canMoveToPlan';
import { readPlanHistory } from './planHistory';
import type { GameDetailV2, IterationDetailV2 } from './types';

// LA FICHA DE UN JUEGO sobre el esquema 2.0 (sustituye a
// db/queries/games/getGameById.ts).
//
// Las derivaciones (fechas, estado, horas, reparto del gasto: SPEC 4.4) son
// las de `deriveGameDetail` (shared/domain/gameDetail.ts), compartidas con la
// ficha del móvil. Aquí solo se traen las filas y se monta la respuesta.
//
// Como en la 1.x, aquí NO se agrega en SQL: todo lo que se trae VIAJA al
// renderer (las sesiones son el Session History, los eventos el Journey, los
// gastos su historial). El coste crece con lo que la ficha enseña. Y el número
// de consultas es fijo, no depende de cuántos playthroughs tenga el juego
// (presupuestos): juego, playthroughs, posiciones, sesiones, eventos, gastos,
// paso por el Plan y, si no está planeado, `canMoveToPlan`.
//
// Lo que cambia con el 2.0:
//   - La fila del juego es la vista común (`readGameRow`): valores efectivos,
//     `planned` = `plan_entries` viva, rutas de ESTE PC.
//   - Solo filas vivas con la regla F-11 (`liveSession`, `liveStateEvent`,
//     `liveSpendEvent`): el hijo vivo de un padre con lápida no sale.
//   - La etiqueta "Playthrough N" se deriva por posición contando también los
//     playthroughs con lápida (R-03): borrar el 1 no renombra el 2.
//   - `manualTotalPlayed` ← `manualHours`; `isManual` ← `source =
//     'legacy_manual'`; `lastHeartbeatAt` ← `lastSeenAt` (CONSULTAS.md §1.2).
//   - `stateHistory` ya no trae "Plan to Play" (no hay evento `plan_to_play`):
//     lo sustituye `planHistory` (R-06), con "Añadido al Plan" y "Salió del
//     Plan" derivados de `plan_entries` y `games.promotedAt`.
//   - Orden de eventos y gastos: `occurredAt`, luego creación (`syncCreated`,
//     F-09), no el id numérico.
//   - Los eventos `'unknown'` (papeleo del alta, R-07) viajan tal cual en
//     `stateHistory` y en los bordes del playthrough: decidir cómo se pintan
//     es del renderer.

/** La ficha del juego, o null si no existe o tiene lápida. */
export function getGameById(ctx: QueryContext, gameId: string): GameDetailV2 | null {
  const game = readGameRow(ctx, gameId);
  if (!game) return null;

  // Solo los vivos: un playthrough con lápida no se enseña. El juego ya está
  // comprobado vivo arriba, en esta misma llamada síncrona (nada puede
  // escribir entre medias), así que basta `alive()` en la fila.
  const ptRows = ctx.db
    .select({
      id: playthroughs.id,
      gameId: playthroughs.gameId,
      customLabel: playthroughs.customLabel,
      playedPlatform: playthroughs.playedPlatform,
      origin: playthroughs.origin,
      format: playthroughs.format,
      manualHours: playthroughs.manualHours,
      rating: playthroughs.rating,
      extraContent: playthroughs.extraContent,
    })
    .from(playthroughs)
    .where(and(eq(playthroughs.gameId, gameId), alive(playthroughs)))
    .orderBy(...playthroughCreationOrder)
    .all();

  // Las posiciones cuentan también los borrados (R-03): por eso una consulta
  // aparte, sin filtro de vida, en vez de numerar la lista de arriba.
  const positions = ptRows.length > 0 ? playthroughPositions(ctx, [gameId]) : new Map();
  const iterations: Iteration<string>[] = ptRows.map((row) => ({
    id: row.id,
    gameId: row.gameId,
    label: effectivePlaythroughLabel(row.customLabel, positions.get(row.id) ?? 1),
    playedPlatform: row.playedPlatform,
    origin: row.origin,
    format: row.format,
    manualTotalPlayed: row.manualHours,
    rating: row.rating,
    extraContent: row.extraContent,
  }));

  // Sesiones, eventos y gastos del juego, por la unión con sus playthroughs
  // (sesiones y eventos) o por el juego (gastos), con su condición F-11. Sin
  // ningún `IN (…)` sobre los ids: un juego sin playthroughs no necesita caso
  // aparte.
  const sessionRows = ctx.db
    .select({
      id: sessions.id,
      playthroughId: sessions.playthroughId,
      emulatorId: sessions.emulatorId,
      source: sessions.source,
      startedAt: sessions.startedAt,
      endedAt: sessions.endedAt,
      durationSec: sessions.durationSec,
      lastSeenAt: sessions.lastSeenAt,
      startedBy: sessions.startedBy,
      datePrecision: sessions.datePrecision,
      note: sessions.note,
    })
    .from(sessions)
    .innerJoin(playthroughs, eq(playthroughs.id, sessions.playthroughId))
    .where(and(eq(playthroughs.gameId, gameId), liveSession(sessions)))
    .orderBy(asc(sessions.startedAt), asc(sessions.syncCreated), asc(sessions.id))
    .all();
  const sessionList: Session<string>[] = sessionRows.map((row) => ({
    id: row.id,
    iterationId: row.playthroughId,
    emulatorId: row.emulatorId,
    isManual: row.source === 'legacy_manual',
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    durationSec: row.durationSec,
    lastHeartbeatAt: row.lastSeenAt,
    startedBy: row.startedBy,
    datePrecision: row.datePrecision,
    note: row.note,
  }));

  // stateHistory viaja en este orden al renderer (el Journey).
  const stateHistory: StateEvent<string>[] = ctx.db
    .select({
      id: stateEvents.id,
      iterationId: stateEvents.playthroughId,
      type: stateEvents.type,
      occurredAt: stateEvents.occurredAt,
      datePrecision: stateEvents.datePrecision,
      note: stateEvents.note,
    })
    .from(stateEvents)
    .innerJoin(playthroughs, eq(playthroughs.id, stateEvents.playthroughId))
    .where(and(eq(playthroughs.gameId, gameId), liveStateEvent(stateEvents)))
    .orderBy(asc(stateEvents.occurredAt), asc(stateEvents.syncCreated), asc(stateEvents.id))
    .all();

  const spendHistory: SpendEvent<string>[] = ctx.db
    .select({
      id: spendEvents.id,
      gameId: spendEvents.gameId,
      type: spendEvents.type,
      amount: spendEvents.amount,
      occurredAt: spendEvents.occurredAt,
      datePrecision: spendEvents.datePrecision,
      note: spendEvents.note,
    })
    .from(spendEvents)
    .where(and(eq(spendEvents.gameId, gameId), liveSpendEvent(spendEvents)))
    .orderBy(asc(spendEvents.occurredAt), asc(spendEvents.syncCreated), asc(spendEvents.id))
    .all();

  // Sin `isRunning`: en el escritorio toda sesión abierta está en marcha.
  const derived = deriveGameDetail({
    iterations,
    sessions: sessionList,
    stateEvents: stateHistory,
    spendEvents: spendHistory,
  });

  const iterationDetails: IterationDetailV2[] = derived.iterations.map((entry) => ({
    ...entry.iteration,
    hours: entry.hours,
    startedAt: entry.startedAt,
    endedAt: entry.endedAt,
    startEvent: entry.startEvent,
    endEvent: entry.endEvent,
    startedBySession: entry.startedBySession,
    currentState: entry.currentState,
    sessions: entry.sessions,
    spend: entry.spend,
  }));

  return {
    ...game,
    totalHours: derived.totalHours,
    currentState: derived.currentState,
    isLive: derived.isLive,
    totalSpend: derived.totalSpend,
    costPerHour: derived.costPerHour,
    stateHistory,
    spendHistory,
    iterations: iterationDetails,
    // Un planeado ya está en el Plan: ni se pregunta (una consulta menos).
    canMoveToPlan: game.planned ? false : canMoveToPlan(ctx, gameId),
    planHistory: readPlanHistory(ctx, gameId, game.promotedAt),
  };
}
