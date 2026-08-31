// "Last played" = la última vez que toqué este juego, venga el dato de donde
// venga: el fin de la última sesión o el último evento CON FECHA PROPIA, lo que
// sea más reciente.
//
// Antes era `sesión ?? evento`, o sea que en cuanto había una sola sesión el
// log dejaba de mirarse: trackeas en enero, terminas el juego en la consola y
// lo marcas completado con fecha de junio — y la biblioteca seguía ordenándolo
// por enero, por debajo de juegos que tocaste menos.
//
// Y vive aquí, en shared, porque el escritorio lo arregló y el móvil se quedó
// con el `??`: durante un tiempo la MISMA biblioteca ordenaba por junio en el
// PC y por enero en el teléfono. La cabecera de worker/src/queries/library.ts
// ya decía que ese fichero existe para reusar las reglas del escritorio "en vez
// de reinventarlas, que es como los dos lados acabarían diciendo cifras
// distintas"; ésta se le había escapado.
//
// Las dos fuentes tienen que llegar YA LIMPIAS: quien llame descarta de su log
// los 'plan_to_play' (planear no es jugar) y los artefactos del alta
// (isAddedAtArtifact), que es lo que impide que esto suba un juego por una
// fecha que nadie escribió. Aquí solo se elige entre dos fechas buenas.
//
// null cuando no hay ni una cosa ni la otra: es "no lo sé", y como tal se va al
// final de la lista en vez de inventarse una fecha.
export const lastPlayedAtFor = (bySession: Date | null, byEvent: Date | null): Date | null => {
  if (!bySession) return byEvent;
  if (!byEvent) return bySession;
  return byEvent.getTime() > bySession.getTime() ? byEvent : bySession;
};
