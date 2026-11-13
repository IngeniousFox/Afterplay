import { and, eq, inArray } from 'drizzle-orm';
import {
  resolvePlaythroughForPlay,
  type PlaythroughDecision,
  type PlaythroughRow,
  type PlaythroughStateEventRow,
} from '../../../../../shared/domain/resolvePlaythrough';
import { gameMetadata, games, playthroughs, stateEvents } from '../../schema';
import { alive } from '../../store';
import {
  effectivePlaythroughLabel,
  liveGame,
  livePlaythrough,
  playthroughCreationOrder,
  playthroughPositions,
  type QueryContext,
} from '../common';

// "¿En qué playthrough cae una sesión de este juego en `at`?" sobre el
// esquema 2.0 (sustituye a `db/queries/sessions/resolveIterationForPlay.ts`;
// CONSULTAS.md §2.2, AFTERPLAY-2.0.md §10.7).
//
// La REGLA no está aquí: es `resolvePlaythroughForPlay` de `shared/domain`
// (las razones de cada rama están contadas allí). Esto es solo el papel del
// escritorio: leer las filas vivas, pedir la decisión y ejecutarla.
//
// Diferencias con la 1.x, todas del modelo nuevo:
// - Solo playthroughs y eventos VIVOS (F-11): uno borrado no es destino.
// - La etiqueta ya no se guarda (§7.4). La decisión la pide para numerar el
//   playthrough nuevo; se le pasa la derivada (`customLabel ?? "Playthrough
//   N"`, contando los borrados, R-03) y la que devuelve se DESCARTA: el nuevo
//   se crea sin `customLabel` y su número sale de su posición.
// - Las plataformas oficiales vienen de `game_metadata` (caché), no de
//   `games`.
// - Los eventos nuevos llevan `deviceId` = este PC (informativo).
//
// Escribe (el playthrough nuevo y sus eventos), así que va en su propia
// `store.transaction`, anidable: dentro de la de quien abre o asigna la
// sesión, todo se confirma o se deshace junto. Las lecturas van DENTRO de la
// transacción para que lo leído siga siendo verdad al escribir.

export interface ResolvedPlaythrough {
  readonly playthroughId: string;
  /** Qué ha hecho: nada (`use`), reanudar con un `started` (`resume`) o crear (`create`). */
  readonly kind: PlaythroughDecision<string>['kind'];
}

/**
 * Decide y ejecuta. `at` es la fecha a la que se pregunta (ahora para el
 * watcher y el Play; el inicio real de la sesión al asignarla) y `ctx.now()`
 * cuándo se decide.
 *
 * Lanza un `Error` si el juego no existe o está borrado: quien llama tiene
 * que comprobarlo antes y devolver lo que diga su contrato.
 */
export function resolvePlaythroughForSession(
  ctx: QueryContext,
  gameId: string,
  at: Date,
): ResolvedPlaythrough {
  return ctx.store.transaction((): ResolvedPlaythrough => {
    const game = ctx.db
      .select({
        isEmulated: games.isEmulated,
        endless: games.endless,
        officialPlatforms: gameMetadata.officialPlatforms,
      })
      .from(games)
      // La caché del juego que ya se filtra vivo en el WHERE: `alive` a secas.
      .leftJoin(gameMetadata, and(eq(gameMetadata.gameId, games.id), alive(gameMetadata)))
      .where(and(eq(games.id, gameId), liveGame()))
      .get();
    if (!game) throw new Error(`No existe el juego ${gameId}`);

    const rows = ctx.db
      .select({ id: playthroughs.id, customLabel: playthroughs.customLabel })
      .from(playthroughs)
      .where(and(eq(playthroughs.gameId, gameId), livePlaythrough()))
      .orderBy(...playthroughCreationOrder)
      .all();
    const positions = playthroughPositions(ctx, [gameId]);
    const candidates: PlaythroughRow<string>[] = rows.map((row) => ({
      id: row.id,
      label: effectivePlaythroughLabel(row.customLabel, positions.get(row.id) ?? 0),
    }));

    // El log ENTERO de esos playthroughs (la decisión mira a fecha `at` y
    // hoy). Sus padres ya están filtrados vivos arriba: `alive` a secas.
    const events: PlaythroughStateEventRow<string>[] =
      rows.length === 0
        ? []
        : ctx.db
            .select({
              id: stateEvents.id,
              iterationId: stateEvents.playthroughId,
              type: stateEvents.type,
              occurredAt: stateEvents.occurredAt,
            })
            .from(stateEvents)
            .where(
              and(
                inArray(
                  stateEvents.playthroughId,
                  rows.map((row) => row.id),
                ),
                alive(stateEvents),
              ),
            )
            .all();

    const decision = resolvePlaythroughForPlay<string>({
      playthroughs: candidates,
      events,
      game,
      at,
      now: ctx.now(),
    });

    if (decision.kind === 'use') return { playthroughId: decision.iterationId, kind: 'use' };

    let playthroughId: string;
    if (decision.kind === 'create') {
      // Sin `customLabel` (etiqueta automática) ni `manualHours`: no constan.
      const { playedPlatform, origin, format } = decision.playthrough;
      playthroughId = ctx.store.create('playthroughs', {
        gameId,
        playedPlatform,
        origin,
        format,
      }).id;
    } else {
      playthroughId = decision.iterationId;
    }

    // Uno a uno y EN ORDEN: cuando nace cerrado, el `completed` comparte
    // instante con el `started` y el estado lo decide el orden de creación
    // (UUIDv7 creciente dentro del mismo milisegundo). La nota es siempre
    // null en la decisión: se omite (H-2).
    for (const event of decision.events) {
      ctx.store.create('state_events', {
        playthroughId,
        type: event.type,
        occurredAt: event.occurredAt,
        datePrecision: event.datePrecision,
        deviceId: ctx.deviceId,
      });
    }

    return { playthroughId, kind: decision.kind };
  });
}
