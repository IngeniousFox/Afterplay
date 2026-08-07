import type { LucideIcon } from 'lucide-react';
import { Clock3, History, Sparkles, Star } from 'lucide-react';
import type { PlannedGameItem } from '../../../shared/types';
import { bestRating } from './ratings';
import { isUnreleased, releaseSortKey } from './releaseDate';

// Las LENTES del Plan (PLAN-TO-PLAY.md §2.4). No son "ordenar por": son
// cuatro PREGUNTAS reales, que es lo que de verdad se le hace a una lista de
// 260 juegos cuando uno se sienta a elegir. De ahí que sean chips a la vista
// y no un desplegable enterrado con "Title A-Z" arriba del todo: el orden
// alfabético no responde a ninguna pregunta que nadie tenga.
export type PlanLens = 'oldest' | 'shortest' | 'best' | 'newest';

export const PLAN_LENSES: {
  id: PlanLens;
  label: string;
  question: string;
  Icon: LucideIcon;
}[] = [
  { id: 'oldest', label: 'Longest waiting', question: 'why is this still here?', Icon: History },
  { id: 'shortest', label: 'Shortest', question: "I've got tonight", Icon: Clock3 },
  { id: 'best', label: 'Best rated', question: "which one's most worth it?", Icon: Star },
  { id: 'newest', label: 'Just added', question: 'what did I just note down?', Icon: Sparkles },
];

// Los "sin dato" van SIEMPRE al final, en cualquier lente. Un juego sin
// tiempo de HowLongToBeat no es "el más corto" y uno sin notas no es "el
// peor valorado" — tratar un hueco como un cero pondría lo desconocido justo
// en el sitio donde más se mira.
const compareBy = (
  a: number | null,
  b: number | null,
  direction: 'asc' | 'desc',
): number | null => {
  if (a === null && b === null) return null;
  if (a === null) return 1;
  if (b === null) return -1;
  if (a === b) return null;
  return direction === 'asc' ? a - b : b - a;
};

const byTitle = (a: PlannedGameItem, b: PlannedGameItem): number =>
  a.title.localeCompare(b.title, 'en', { sensitivity: 'base' });

export const sortByLens = (games: PlannedGameItem[], lens: PlanLens): PlannedGameItem[] => {
  const sorted = [...games];
  sorted.sort((a, b) => {
    const compared = ((): number | null => {
      switch (lens) {
        case 'oldest':
          return compareBy(a.addedAt.getTime(), b.addedAt.getTime(), 'asc');
        case 'newest':
          return compareBy(a.addedAt.getTime(), b.addedAt.getTime(), 'desc');
        case 'shortest':
          return compareBy(a.hltbMain, b.hltbMain, 'asc');
        case 'best':
          return compareBy(bestRating(a), bestRating(b), 'desc');
      }
    })();
    // Desempate estable por título: sin él, dos juegos añadidos el mismo día
    // (o los dos sin estimación) bailaban de sitio entre repintados.
    return compared ?? byTitle(a, b);
  });
  return sorted;
};

export type PlanSections = {
  // Los fijados a mano, en orden de fijado (el último al final) — §2.2. Las
  // lentes NO los tocan: Up next es una estantería que TÚ has colocado, y
  // reordenarla al cambiar de pregunta sería quitarle justo lo que la hace
  // distinta de la cola.
  upNext: PlannedGameItem[];
  // Lo jugable: todo lo que ya ha salido y no está fijado.
  queue: PlannedGameItem[];
  // Lo que aún no ha salido (§2.5). Aparte porque no compite con lo jugable:
  // no puedes elegirlo esta noche, así que mezclarlo en la cola solo ensucia
  // la decisión. Es espera, no decisión.
  //
  // La ÚNICA de las tres que no es excluyente: un fijado sin salir sale aquí Y
  // en Up next (ver abajo).
  horizon: PlannedGameItem[];
};

// upNext y queue reparten lo jugable; el horizonte es una CAPA aparte, no un
// tercer trozo del reparto.
//
// Antes sí lo era, y se notaba mal: fijar un juego que estaba en el horizonte
// lo hacía desaparecer de allí. Desde el sofá parecía que la app se había
// comido la cuenta atrás — que es justo el dato por el que ese juego está en
// el horizonte y no en otro sitio. Fijar dice "este me importa", no "quítalo
// del calendario"; el calendario no es una estantería de la que se saca algo,
// es la vista de lo que aún no puedes jugar.
//
// Así que el horizonte se calcula sobre TODOS los planeados sin salir, estén
// fijados o no. De la cola sí siguen fuera los fijados: ahí el reparto es real
// (una fila no puede estar en dos estanterías de lo jugable a la vez).
export const splitPlanSections = (games: PlannedGameItem[], lens: PlanLens): PlanSections => {
  const upNext = games
    .filter((game) => game.planPinnedAt !== null)
    .sort(
      (a, b) =>
        (a.planPinnedAt as Date).getTime() - (b.planPinnedAt as Date).getTime() || byTitle(a, b),
    );

  const horizon = games
    .filter((game) => isUnreleased(game))
    .sort((a, b) => releaseSortKey(a) - releaseSortKey(b) || byTitle(a, b));
  const queue = sortByLens(
    games.filter((game) => game.planPinnedAt === null && !isUnreleased(game)),
    lens,
  );

  return { upNext, queue, horizon };
};

// La deuda de la cabecera (§2.1): el mismo criterio que la card de Backlog
// debt de Stats — horas de Main Story de HowLongToBeat, sin inventar nada
// para los juegos que no la tienen (se cuentan aparte y se dicen en pequeño)
// y sin los endless, que no tienen final que alcanzar.
export type PlanDebt = {
  totalGames: number;
  totalHours: number;
  withoutEstimate: number;
};

export const computePlanDebt = (games: PlannedGameItem[]): PlanDebt => {
  const counted = games.filter((game) => !game.endless);
  const withEstimate = counted.filter((game) => game.hltbMain !== null);
  return {
    totalGames: games.length,
    totalHours: withEstimate.reduce((sum, game) => sum + (game.hltbMain ?? 0), 0),
    withoutEstimate: counted.length - withEstimate.length,
  };
};
