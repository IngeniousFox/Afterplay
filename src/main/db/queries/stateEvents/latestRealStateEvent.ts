// Forma mínima que hace falta para decidir "el más reciente": type para
// poder ignorar 'plan_to_play' (solo historial, nunca estado real — ver
// schema.ts), occurredAt para comparar fechas, e id para desempatar cuando
// dos eventos comparten fecha exacta (gana el insertado después). Genérico
// a propósito — getGames, getGameById y resolveIterationForPlay traen cada
// uno su propia forma de fila con estos tres campos pegados.
export type RealStateEventCandidate = {
  type: string;
  occurredAt: Date;
  id: number;
};

// El "último estado real" de un juego/iteración: el evento con occurredAt
// más reciente ignorando 'plan_to_play', con empate resuelto por id más
// alto. Funciona igual reciba las filas ordenadas o no — recorre todo el
// array y se queda con la mejor candidata vista hasta el momento, así que no
// depende de ningún ORDER BY previo.
export const latestRealStateEvent = <T extends RealStateEventCandidate>(
  events: T[],
): T | undefined => {
  let latest: T | undefined;

  for (const event of events) {
    if (event.type === 'plan_to_play') continue;

    if (!latest) {
      latest = event;
      continue;
    }

    const isNewer = event.occurredAt.getTime() > latest.occurredAt.getTime();
    const isSameDateButHigherId =
      event.occurredAt.getTime() === latest.occurredAt.getTime() && event.id > latest.id;

    if (isNewer || isSameDateButHigherId) {
      latest = event;
    }
  }

  return latest;
};
