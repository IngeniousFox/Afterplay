import type { PlanMailboxEntry } from '../planMailbox';
import type { EntityId, EntityIdLike, GameId } from '../entityIds';

// EL ORDEN DEL PLAN ("Up next"), escrito UNA vez (AFTERPLAY-2.0.md §15.2, F-26).
//
// Estaba tres veces: reorderUpNext en el escritorio (vía shared/planPinOrder),
// `redistribute` copiado a mano en web/src/lib/planPending.ts —el propio
// comentario lo confesaba— y la condición de "marca creíble" repetida en el
// drenado del buzón (pinStamp) y en el Worker (isTimestamp). Si dos de ellas
// discrepan, la vista previa del móvil promete un orden y el drenado escribe
// otro: la fila "salta" justo cuando el escritorio aplica la orden.
//
// Funciones puras sobre datos planos: milisegundos y no Date, porque los
// milisegundos son lo único que comparten el SQLite del escritorio (que los
// adapta en su borde), el JSON del Worker y la PWA. Sin base, sin drizzle, sin
// React: el escritorio, el Worker y la PWA importan este mismo fichero.

// Lo mínimo que hay que saber de un juego para repartir marcas: su id y su
// marca de fijado (null = no está en Up next).
//
// Genérico en la representación del id (ver entityIds.ts): el reparto solo usa
// el id como clave. Lo del buzón de más abajo NO lo es: el buzón desaparece en
// la 2.0 y se queda con los ids de la app.
export type PinnedPlanRow<Id extends EntityIdLike = EntityId> = {
  id: GameId<Id>;
  pinnedAt: number | null;
};

// ── REPARTO DE MARCAS AL REORDENAR ─────────────────────────────────────────

// Reordenar es REPARTIR las marcas que YA existen entre los ids, en el orden
// nuevo. Nada se inventa ni deriva hacia el futuro: el multiset de fechas es el
// mismo, solo cambia a quién le toca cada una (por eso no hace falta columna de
// orden y la columna sigue sincronizando igual).
//
// Devuelve id → marca nueva SOLO para los ids que cambian de mano. Un mapa vacío
// significa "no hay reorden que aplicar", y el escritorio lo traduce a `false`,
// que el buzón lee como fallo (drainMailbox.ts).
export const redistributePinStamps = <Id extends EntityIdLike>(
  rows: readonly PinnedPlanRow<Id>[],
  orderedIds: readonly GameId<Id>[],
): Map<GameId<Id>, number> => {
  const byId = new Map(rows.map((row) => [row.id, row.pinnedAt]));
  // Solo los que SIGUEN fijados: entre el gesto y el commit pudo pasar
  // cualquier cosa (un unpin desde otra máquina vía sync), y los ids
  // desconocidos se ignoran en vez de reventar el gesto entero.
  //
  // Y REPETIDOS fuera antes de contar (el Set): sin deduplicar, un [A, A] con un
  // solo juego fijado medía 2, pasaba el guardián de abajo y daba por aplicada
  // una orden sin estantería que reordenar. El Set conserva la PRIMERA
  // aparición, que es la posición que el usuario soltó.
  const ids = [...new Set(orderedIds)].filter((id) => byId.get(id) != null);
  if (ids.length < 2) return new Map();

  const stamps = ids.map((id) => byId.get(id) as number).sort((a, b) => a - b);
  // Estrictamente crecientes: dos fijados en el mismo milisegundo (lo que pasa
  // al drenar de golpe dos pines) empatarían, y el desempate por título de
  // sortUpNext podría deshacer el orden recién elegido.
  for (let index = 1; index < stamps.length; index++) {
    if (stamps[index] <= stamps[index - 1]) stamps[index] = stamps[index - 1] + 1;
  }
  return new Map(ids.map((id, index) => [id, stamps[index]]));
};

// ── LA MARCA DE UN PIN QUE VIENE DEL MÓVIL ─────────────────────────────────

// ¿Es `value` un instante con el que se puede sellar un pin? Lo usan los TRES
// lados con el mismo criterio: el Worker para rechazar la orden al encolarla,
// el drenado para decidir si sella con la marca del teléfono o cae a "ahora", y
// la vista previa de la PWA para prever lo mismo que hará el drenado.
//
// El futuro NO se recorta a propósito: un teléfono con el reloj adelantado deja
// su juego al final de Up next, que es raro pero es SU orden, y reordenar desde
// cualquiera de los dos lados lo arregla repartiendo las marcas existentes.
export const isCrediblePinStamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

// La marca con la que el escritorio sella un pin del buzón: la del GESTO si es
// creíble, y si no, `now` (lo que haría setPlanPinned sin marca). Sellar
// siempre con "ahora" perdía el orden en que se fijó en el teléfono: una pasada
// aplica de golpe pines de hace minutos y quedaban empatados al milisegundo.
export const mailboxPinStamp = (pinnedAt: unknown, now: number): number =>
  isCrediblePinStamp(pinnedAt) ? pinnedAt : now;

// ── VISTA PREVIA DEL BUZÓN ─────────────────────────────────────────────────

// Un alta encolada que todavía no es un juego: no tiene id de biblioteca, así
// que su clave es la de su fila del buzón.
export type PendingPlanGhost = {
  mailboxId: number;
  title: string;
  coverUrl: string | null;
};

export type PendingPlanEntry = { id: number; entry: PlanMailboxEntry };

export type PendingPlanPreview<G> = {
  games: G[];
  // Altas encoladas que aún no son juegos: se pintan aparte porque no tienen
  // ficha a la que entrar ni nada que se pueda fijar todavía.
  ghosts: PendingPlanGhost[];
  // Qué juegos tienen un cambio sin drenar, para marcarlos como pendientes.
  touched: Set<GameId>;
};

// Los pendientes del buzón aplicados ENCIMA del plan leído, tal y como los va a
// aplicar el drenado del escritorio (drainMailbox.ts). Su único deber es
// enseñar el plan como QUEDARÁ: si previera otra cosa, la fila saltaría al
// drenarse, que es peor que no previsualizar nada (REMOTO.md §6.3).
//
// Mismo orden que el drenado: por id de buzón ascendente (el orden en que se
// encolaron), así que la última orden sobre el mismo juego manda, y cada
// reorden ve las marcas que dejaron las órdenes anteriores.
//
// `now` es el instante con el que el escritorio sellaría un pin cuya marca no
// es creíble (mailboxPinStamp). El Worker ya rechaza esas órdenes, así que en
// la práctica no se usa; se pide como parámetro para que la función siga siendo
// pura y prevea EXACTAMENTE lo mismo que el drenado.
export const applyPendingPlanEntries = <G extends PinnedPlanRow>(
  games: readonly G[],
  pending: readonly PendingPlanEntry[],
  now: number,
): PendingPlanPreview<G> => {
  // Estado de trabajo: la marca actual de cada juego, que las órdenes van
  // modificando en cadena.
  const pinnedAt = new Map<GameId, number | null>(games.map((game) => [game.id, game.pinnedAt]));
  const ghosts: PendingPlanGhost[] = [];
  const touched = new Set<GameId>();

  for (const { id, entry } of pending) {
    if (entry.type === 'add') {
      ghosts.push({ mailboxId: id, title: entry.title, coverUrl: entry.coverUrl });
      continue;
    }
    if (entry.type === 'pin') {
      // La marca del GESTO, no la del render: previsualizar con Date.now()
      // prometía un orden distinto del que deja el drenado, y con varios pines
      // en el mismo render todos empataban al milisegundo.
      pinnedAt.set(entry.gameId, mailboxPinStamp(entry.pinnedAt, now));
      touched.add(entry.gameId);
      continue;
    }
    if (entry.type === 'unpin') {
      pinnedAt.set(entry.gameId, null);
      touched.add(entry.gameId);
      continue;
    }
    if (entry.type === 'reorder') {
      const rows = [...pinnedAt].map(([gameId, stamp]) => ({ id: gameId, pinnedAt: stamp }));
      for (const [gameId, stamp] of redistributePinStamps(rows, entry.orderedIds)) {
        pinnedAt.set(gameId, stamp);
        touched.add(gameId);
      }
      continue;
    }

    // Un tipo que este bundle no conoce se IGNORA, no revienta. Antes era un
    // `else` implícito: un tipo nuevo caía en el reorden, hacía
    // `undefined.filter` dentro de un useMemo y dejaba la pantalla de la PWA en
    // blanco. El escritorio, por su parte, lo deja pendiente sin aplicarlo, así
    // que ignorarlo es prever lo mismo que hará.
  }

  return {
    games: games.map((game) =>
      touched.has(game.id) ? { ...game, pinnedAt: pinnedAt.get(game.id) ?? null } : game,
    ),
    ghosts,
    touched,
  };
};

// ── DESDE CUÁNDO ESPERA UN PLANEADO ────────────────────────────────────────

// La fecha con la que un planeado "espera" en el Plan: la del PRIMER evento
// plan_to_play si existe, y si no, el alta del juego. Así un juego devuelto de
// Library al Plan conserva su primera fecha allí, y uno que nunca estuvo empieza
// a esperar desde su alta sin tocar esa fecha original.
//
// `firstPlanAt` llega de una subconsulta SQL cruda, que el driver puede
// devolver como número o como texto según el motor: por eso el Number().
export const planWaitingSince = (addedAt: number, firstPlanAt: number | string | null): number =>
  firstPlanAt === null ? addedAt : Number(firstPlanAt);
