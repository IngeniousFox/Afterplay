import type { EventDatePrecision } from '../api';

// Formateadores de presentación, copiados del escritorio
// (src/renderer/src/lib/format.ts y dateMath.ts) para que las mismas cifras se
// LEAN igual en los dos sitios.
//
// Por qué copiados y no importados: el format.ts del escritorio importa tipos
// de shared/types.ts, que arrastra tipos de media docena de módulos del main
// (igdb, saves, scan, steam…). Serían type-only, pero TypeScript tiene que
// resolverlos igual, así que el typecheck de una PWA acabaría necesitando el
// grafo de tipos del proceso principal de Electron entero.
//
// La línea que separa qué se comparte y qué se copia:
//
//   · Todo lo que CALCULA UN NÚMERO (horas, estado, gasto repartido) se
//     comparte de verdad — en el Worker, que importa el código real del
//     escritorio. Ver worker/src/queries/game.ts.
//   · Lo que solo DA FORMA a un número ya calculado se copia. Sin estado y sin
//     reglas de negocio: el riesgo de que deriven es que un "12h 30m" salga
//     "12.5h" — feo, no incorrecto.

// "Xh Ym" si hay minutos sueltos, "Xh" si es redondo, "0h" si no hay nada.
export const formatHours = (hours: number): string => {
  const totalMinutes = Math.round(hours * 60);
  if (totalMinutes <= 0) return '0h';
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${wholeHours}h ${minutes}m` : `${wholeHours}h`;
};

// HH:MM:SS con ceros a la izquierda — el contador de una sesión en marcha.
export const formatElapsed = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds));
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
};

export const pluralize = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? '' : 's'}`;

// Mismo separador decimal que el escritorio — nunca coma, sin importar el
// idioma del móvil.
export const formatMoney = (amount: number): string => `€${amount.toFixed(2)}`;

// Un CONTEO grande en un hueco pequeño: "416K reviews" en vez de "415,946".
// Redondear una MUESTRA no pierde nada: lo que informa de ella es el orden de
// magnitud.
//
// Cada tramo se elige por lo que se va a ESCRIBIR, no por el valor crudo, y
// esa es la corrección: mirando el valor crudo, 99.999 caía en el tramo del
// decimal y su redondeo lo sacaba de él — "100.0K" justo antes de que 100.000
// dijera "100K". El mismo escalón un piso más arriba escribía "1000K" para
// 999.999 en vez de "1.0M". Los cortes son los valores a partir de los cuales
// el redondeo YA cambia de tramo (99,95 millares redondean a 100; 999,5
// millares redondean a 1,0 millones). Arreglado a la vez en el escritorio.
export const formatCount = (value: number): string => {
  const thousands = value / 1000;
  if (thousands >= 999.5) return `${(value / 1_000_000).toFixed(1)}M`;
  if (thousands >= 99.95) return `${Math.round(thousands)}K`;
  if (value >= 10_000) return `${thousands.toFixed(1)}K`;
  return value.toLocaleString('en-US');
};

// GB si llega a 1000MB, MB si llega a 1, KB por debajo. El salto a GB es a los
// 1000 y no a los 1024: los 24 MB de tierra de nadie salían como "1009 MB",
// que nadie lee como una talla.
//
// El cero se contesta antes que nada: el suelo de 1 KB de la última línea
// está para que una partida guardada diminuta no se redondee a "0", no para
// inventarle tamaño a lo que no existe — sin esta guarda una carpeta vacía
// decía "1 KB". Arreglado a la vez en el escritorio.
export const formatBytes = (bytes: number): string => {
  if (bytes <= 0) return '0 KB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1000) return `${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 1) return `${mb.toFixed(0)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

// 'en-US' fijo, igual que el escritorio: la interfaz está en inglés sin i18n,
// y dejar que la fecha cambie de idioma con el móvil dejaría un "15 de julio
// de 2026" en medio de una pantalla en inglés.
export const formatDate = (ms: number): string =>
  new Date(ms).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });

// 24h SIEMPRE, y a diferencia del escritorio no es un ajuste. El gemelo
// (src/renderer/src/lib/format.ts) recibe un TimeFormat obligatorio porque
// allí hay un slider 12h/24h en Settings; aquí ese parámetro no existe, y esa
// asimetría es deliberada aunque no estuviera escrita en ningún sitio — que
// es lo que la hacía parecer un descuido:
//
//   · El ajuste no es un DATO, es configuración de una máquina: vive en el
//     electron-store del PC, al lado de las medidas de la ventana, y nunca
//     entra en Turso. La PWA lee lo que hay en la nube (REMOTO.md §1.1) y ahí
//     no hay nada que leer. Traerlo significaría sincronizar preferencias de
//     escritorio, que es una tubería entera para elegir dos puntos.
//   · Se clava el DEFAULT del escritorio ('24h', src/main/config/store.ts),
//     así que las dos mitades coinciden mientras nadie mueva el slider. Solo
//     quien lo cambia a mano en su PC ve el mismo evento como "06:30 PM" allí
//     y "18:30" aquí.
export const formatTime = (ms: number): string =>
  new Date(ms).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

// Una fecha pintada con la precisión que de verdad se sabe de ella. Sin esto,
// un evento con precisión de AÑO (guardado como el día 1 a medianoche) se
// enseñaría como "January 1, 2021 · 00:00", que es un dato inventado.
export const formatDateOnly = (ms: number, precision: 'year' | 'month' | 'day'): string => {
  const date = new Date(ms);
  if (precision === 'year') return String(date.getFullYear());
  if (precision === 'month')
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
};

export const formatByPrecision = (ms: number, precision: EventDatePrecision): string => {
  if (precision !== 'datetime') return formatDateOnly(ms, precision);
  return `${formatDate(ms)} · ${formatTime(ms)}`;
};

const DAY_MS = 86_400_000;

const startOfDayMs = (value: Date | number): number => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

export const daysBetween = (from: number, to: number): number => (to - from) / DAY_MS;

export const humanizeSpan = (days: number): string => {
  if (days < 1) return 'less than a day';
  if (days < 60) return `${Math.round(days)} ${Math.round(days) === 1 ? 'day' : 'days'}`;
  if (days < 730) return `${Math.round(days / 30.44)} months`;
  return `${Math.round(days / 365.25)} years`;
};

// Un tramo entre dos fechas cuya precisión puede ser gruesa. Con precisión de
// AÑO o MES la fecha guardada es el día 1 a medianoche: restarlas da un número
// de días que no significa nada — un juego empezado y terminado en 2021 salía
// como "less than a day". La unidad del resultado nunca puede ser más fina que
// la más gruesa de las dos precisiones.
//
// La rama de días mide tramos REALES (los timestamps restados tal cual), igual
// que dateMath.ts en el escritorio. Esta copia los truncaba a medianoche antes
// de restar, y era el mismo playthrough contado de dos maneras: uno del 1 de
// marzo a las 23:00 al 2 a la 01:00 (dos horas) decía "less than a day" en el
// PC y "1 day" en el móvil. Ojo, relativeDay —aquí abajo— sí cuenta días de
// calendario, pero eso es a propósito y responde a otra pregunta.
export const humanizeSpanByPrecision = (
  from: number,
  to: number,
  fromPrecision: EventDatePrecision,
  toPrecision: EventDatePrecision,
): string => {
  const coarsest =
    fromPrecision === 'year' || toPrecision === 'year'
      ? 'year'
      : fromPrecision === 'month' || toPrecision === 'month'
        ? 'month'
        : 'day';

  const start = new Date(from);
  const end = new Date(to);

  if (coarsest === 'year') {
    const years = end.getFullYear() - start.getFullYear();
    return years <= 0 ? 'Same year' : `${years} ${years === 1 ? 'year' : 'years'}`;
  }

  if (coarsest === 'month') {
    const months =
      (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
    return months <= 0 ? 'Same month' : `${months} ${months === 1 ? 'month' : 'months'}`;
  }

  return humanizeSpan(daysBetween(from, to));
};

// Escala corta para "hace cuánto" en frases sueltas: redondear sin vergüenza,
// porque a partir de una semana nadie cuenta los días.
const humanizeShort = (days: number): string => {
  if (days < 7) return pluralize(days, 'day');
  if (days < 31) return pluralize(Math.round(days / 7), 'week');
  if (days < 365) return pluralize(Math.round(days / 30), 'month');
  const years = days / 365;
  return years < 1.5 ? 'a year' : pluralize(Math.round(years), 'year');
};

// Días de CALENDARIO, no tramos de 24 h: una sesión de ayer a las 20:00 es
// "yesterday" aunque no hayan pasado 24 horas — que es como lo cuenta
// cualquiera. Medir horas transcurridas hacía decir "today" a lo de anoche.
export const relativeDay = (ms: number): string => {
  const days = Math.round((startOfDayMs(new Date()) - startOfDayMs(ms)) / DAY_MS);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${humanizeShort(days)} ago`;
};

// Aquí vivía `dayHeading`, una segunda escala de etiquetas de día (Today /
// Yesterday / la fecha suelta) que no llamaba nadie. Las cabeceras de grupo de
// Sesiones las pinta lib/sessionGroups.ts, que es el gemelo portado del
// escritorio y el que vigila el test de paridad — y esta escala es justo la
// que él descartó por no coincidir con la de allí (ver su cabecera). Borrada:
// tenerla exportada era invitar a usarla creyendo que era la buena.

// La fecha de salida, con la HONESTIDAD de siempre: IGDB devuelve un timestamp
// concreto incluso cuando solo conoce el año, así que sin la precisión al lado
// un juego "1994" se convertiría en un "December 31, 1994" que miente.
export const formatRelease = (game: {
  releaseDate: number | null;
  releaseDatePrecision: 'year' | 'month' | 'day' | null;
  releaseYear: number | null;
}): string | null => {
  if (game.releaseDate !== null && game.releaseDatePrecision) {
    return formatDateOnly(game.releaseDate, game.releaseDatePrecision);
  }
  return game.releaseYear === null ? null : String(game.releaseYear);
};
