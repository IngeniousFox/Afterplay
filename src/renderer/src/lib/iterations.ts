import { endsPlaythrough } from '../../../shared/playthroughState';
import type { IterationDetail } from '../../../shared/types';

// La iteración activa ahora mismo (SPEC 4: como mucho una por juego con
// currentState 'started').
export const startedIteration = (iterations: IterationDetail[]): IterationDetail | null =>
  iterations.find((it) => it.currentState === 'started') ?? null;

// La última creada — getGameById ordena las iteraciones por id ascendente,
// así que el final del array es la más reciente.
export const lastIteration = (iterations: IterationDetail[]): IterationDetail | null =>
  iterations[iterations.length - 1] ?? null;

// La activa si la hay; si no, la última — patrón de "qué playthrough edito
// por defecto" repetido en EditGameModal/StatusCard.
export const activeOrLastIteration = (iterations: IterationDetail[]): IterationDetail | null =>
  startedIteration(iterations) ?? lastIteration(iterations);

// Completado o abandonado — un final, sin más estados posibles salvo un
// nuevo playthrough. Misma regla exacta que usa el main en
// resolveIterationForPlay para decidir si jugar abre uno nuevo.
export const isTerminal = (iteration: IterationDetail | null): boolean =>
  endsPlaythrough(iteration?.currentState);
