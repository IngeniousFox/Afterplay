import type { PendingEntry, PlannedGame } from '../api';

// Los pendientes del buzón, aplicados ENCIMA de lo que devuelve la API.
//
// Sin esto, tocar el pin en el móvil no cambiaría nada en pantalla hasta que
// abrieras el PC, que es exactamente la sensación de gritarle al vacío que el
// §6.3 quiere evitar. Con esto, el gesto se ve al instante donde lo hiciste y
// además se dice que está pendiente — no se finge que ya está hecho.
//
// El orden importa: se aplican por id ascendente, o sea en el orden en que se
// encolaron, así que la última orden sobre el mismo juego manda.

export type GhostGame = {
  // Todavía no existe como juego, así que no tiene id de biblioteca: la clave
  // es la de su fila del buzón.
  mailboxId: number;
  title: string;
  coverUrl: string | null;
};

export type PlanOverlay = {
  games: PlannedGame[];
  // Altas encoladas que aún no son juegos. Se pintan aparte porque no tienen
  // ficha a la que entrar ni nada que se pueda pinear todavía.
  ghosts: GhostGame[];
  // Qué juegos tienen un cambio sin drenar, para marcarlos.
  touched: Set<number>;
};

// Reparte las marcas que YA existen entre los ids, en el orden nuevo.
//
// Es el mismo algoritmo que reorderUpNext() en el escritorio, y tiene que
// serlo: si aquí se previera un orden y allí saliera otro, el reorden
// "saltaría" al drenarse. Nada se inventa ni deriva hacia el futuro — el
// conjunto de fechas es el mismo, solo cambia a quién le toca cada una.
const redistribute = (
  orderedIds: number[],
  pinnedAt: Map<number, number | null>,
): Map<number, number> => {
  // Solo los que SIGUEN fijados: entre el gesto y el drenado pudo pasar
  // cualquier cosa (un unpin desde otra máquina).
  const ids = orderedIds.filter((id) => {
    const value = pinnedAt.get(id);
    return value !== null && value !== undefined;
  });

  const stamps = ids.map((id) => pinnedAt.get(id) as number).sort((a, b) => a - b);
  // Estrictamente crecientes: dos fijados en el mismo milisegundo empatarían y
  // el desempate por título podría deshacer visualmente el orden pedido.
  for (let k = 1; k < stamps.length; k++) {
    if (stamps[k] <= stamps[k - 1]) stamps[k] = stamps[k - 1] + 1;
  }

  const result = new Map<number, number>();
  ids.forEach((id, index) => result.set(id, stamps[index]));
  return result;
};

export const applyPending = (games: PlannedGame[], pending: PendingEntry[]): PlanOverlay => {
  // Estado de trabajo: el pin actual de cada juego, que las órdenes van
  // modificando en cadena.
  const pinnedAt = new Map<number, number | null>(games.map((game) => [game.id, game.pinnedAt]));
  const ghosts: GhostGame[] = [];
  const touched = new Set<number>();

  for (const { id, entry } of pending) {
    if (entry.type === 'add') {
      ghosts.push({ mailboxId: id, title: entry.title, coverUrl: entry.coverUrl });
      continue;
    }
    if (entry.type === 'pin') {
      // El escritorio usa setPlanPinned, que sella con "ahora": soltar y
      // volver a fijar te manda al final de la estantería. Se imita para que
      // la vista previa no mienta sobre dónde va a caer.
      pinnedAt.set(entry.gameId, Date.now());
      touched.add(entry.gameId);
      continue;
    }
    if (entry.type === 'unpin') {
      pinnedAt.set(entry.gameId, null);
      touched.add(entry.gameId);
      continue;
    }
    if (entry.type === 'reorder') {
      for (const [gameId, stamp] of redistribute(entry.orderedIds, pinnedAt)) {
        pinnedAt.set(gameId, stamp);
        touched.add(gameId);
      }
      continue;
    }

    // Un tipo que este bundle no conoce se IGNORA, no revienta.
    //
    // Antes esto era un `else` implícito —el mismo defecto que ya arreglé en
    // el escritorio y que aquí se me quedó— así que un tipo nuevo caía en el
    // reorden y hacía `undefined.filter`. Y como esto corre dentro de un
    // useMemo durante el render, y la PWA no tenía ErrorBoundary, el resultado
    // no era una sección rota: era la pantalla entera en blanco. Sin salida,
    // además, porque el escritorio deja los tipos desconocidos pendientes para
    // siempre a propósito.
  }

  return {
    games: games.map((game) =>
      touched.has(game.id) ? { ...game, pinnedAt: pinnedAt.get(game.id) ?? null } : game,
    ),
    ghosts,
    touched,
  };
};
