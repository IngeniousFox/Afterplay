import { asc, count, eq, inArray, sql } from 'drizzle-orm';
import { playthroughs } from '../../schema';
import type { QueryContext } from './context';

// La etiqueta "Playthrough N" (AFTERPLAY-2.0.md §7.4, CONSULTAS.md §1.1.6).
//
// Ya no se guarda: N es la POSICIÓN del playthrough dentro de su juego por
// orden de creación (`syncCreated`, y el id para desempatar). Así dos PCs que
// crean "el segundo" offline no producen dos "Playthrough 2". Y se cuentan
// también los que tienen lápida (decisión R-03): borrar el 1 no convierte el 2
// en "Playthrough 1". Por eso aquí NO se filtra por `alive()` a propósito.
//
// Limitación aceptada (R-03): un playthrough creado en otro PC con un
// `syncCreated` anterior renumera los de este al llegar por sync.
//
// La etiqueta se deriva SIEMPRE en el main, nunca en el renderer: es lo que
// viaja en `Iteration.label` y en `StateEventSummary.iterationLabel`.

const AUTO_PREFIX = 'Playthrough ';

/** "Playthrough N". */
export const autoPlaythroughLabel = (position: number): string => `${AUTO_PREFIX}${position}`;

/** La etiqueta que se enseña: la del usuario si la puso, si no la automática. */
export const effectivePlaythroughLabel = (
  customLabel: string | null | undefined,
  position: number,
): string => {
  const trimmed = customLabel?.trim();
  return trimmed ? customLabel! : autoPlaythroughLabel(position);
};

/**
 * La posición (1, 2, 3…) de cada playthrough de esos juegos, contando los que
 * tienen lápida. Una consulta para todos (función ventana), sin N+1.
 *
 * Sin `gameIds`, la de todos los playthroughs de la base: para listados
 * transversales como el historial de estados de Stats. Devuelve también las
 * posiciones de los borrados; quien llama solo pregunta por los suyos.
 */
export function playthroughPositions(
  ctx: QueryContext,
  gameIds?: readonly string[],
): Map<string, number> {
  if (gameIds && gameIds.length === 0) return new Map();
  const position = sql<number>`row_number() over (partition by ${playthroughs.gameId} order by ${playthroughs.syncCreated}, ${playthroughs.id})`;
  const query = ctx.db.select({ id: playthroughs.id, position }).from(playthroughs);
  const rows = gameIds
    ? query.where(inArray(playthroughs.gameId, [...new Set(gameIds)])).all()
    : query.all();
  return new Map(rows.map((row) => [row.id, Number(row.position)]));
}

/** La posición de un playthrough, o null si no existe. */
export function playthroughPosition(ctx: QueryContext, playthroughId: string): number | null {
  const row = ctx.db
    .select({ gameId: playthroughs.gameId })
    .from(playthroughs)
    .where(eq(playthroughs.id, playthroughId))
    .get();
  if (!row) return null;
  return playthroughPositions(ctx, [row.gameId]).get(playthroughId) ?? null;
}

/**
 * La posición que tendrá el próximo playthrough que se cree en este juego
 * (todos los existentes, con lápida o sin ella, más uno). Es la `label` que
 * necesita `resolvePlaythroughForPlay` en su entrada, y la etiqueta
 * automática con la que comparar al crear uno con texto (ver
 * `customLabelToStore`).
 */
export function nextPlaythroughPosition(ctx: QueryContext, gameId: string): number {
  const row = ctx.db
    .select({ n: count() })
    .from(playthroughs)
    .where(eq(playthroughs.gameId, gameId))
    .get();
  return Number(row?.n ?? 0) + 1;
}

/**
 * Lo que se guarda en `customLabel` a partir del texto del usuario
 * (CONSULTAS.md §1.4, `CreateIterationInput` y `UpdateIterationPatch.label`):
 * vacío o null = etiqueta automática (null); y si el texto coincide con la
 * automática que le toca, también null, para no congelar un "Playthrough 2"
 * que dejaría de cuadrar si cambia la numeración.
 */
export const customLabelToStore = (
  text: string | null | undefined,
  position: number,
): string | null => {
  const trimmed = text?.trim() ?? '';
  if (trimmed === '' || trimmed === autoPlaythroughLabel(position)) return null;
  return trimmed;
};

// Orden por creación de los playthroughs de un juego, para quien los lista.
export const playthroughCreationOrder = [asc(playthroughs.syncCreated), asc(playthroughs.id)];
