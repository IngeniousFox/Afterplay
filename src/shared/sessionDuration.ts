// "1h 47m" — cuánto duró una sesión recién cerrada, con la MISMA aritmética
// en todas las superficies que anuncian ese mismo evento
// (SessionClosedEvent.durationSec): el toast dentro de la app, el panel del
// modo TV y la notificación nativa de Windows que manda el main.
//
// CICATRIZ: la regla estaba copiada a mano tres veces (main/index.ts,
// SessionClosedToast y TvSessionPanel) y ninguna se referenciaba a las otras;
// el único comentario que justificaba una copia decía "son tres líneas" sin
// saber que ya eran tres. Tocar el redondeo o el formato en la superficie que
// tuvieras delante dejaba a las demás contando el mismo rato de otra manera,
// y nada lo habría cantado: la vía la elige el main según si la ventana está
// visible, así que las tres nunca se ven a la vez.
//
// Vive en src/shared y no en el lib/format del renderer porque el main no
// puede importar del renderer, y de shared ya importa (playthroughState,
// timerFreshness).

// El suelo de 1 minuto es deliberado: una sesión de cuarenta segundos existió
// de verdad, y anunciar "0m" se lee como un fallo de la app.
export const splitSessionDuration = (seconds: number): { value: string; unit: string } => {
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return { value: hours > 0 ? `${hours}h ${minutes}` : String(minutes), unit: 'm' };
};

// Partida en cifra y unidad para quien pinta el número grande y la "m"
// pequeña (el toast); en una sola cadena para quien escribe texto plano (el
// panel de TV y el cuerpo de la notificación de Windows).
export const formatSessionDuration = (seconds: number): string => {
  const { value, unit } = splitSessionDuration(seconds);
  return `${value}${unit}`;
};
