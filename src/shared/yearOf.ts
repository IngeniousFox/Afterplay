// A qué AÑO pertenece un instante, y —lo importante— según el reloj de quién.
//
// Existe por una divergencia que se veía en pantalla: el escritorio lee sus
// fechas con `getFullYear()`, que es hora LOCAL, y un Worker de Cloudflare no
// tiene zona horaria, así que allí el mismo `getFullYear()` es UTC. Una fecha
// con precisión de AÑO se guarda como el 1 de enero a MEDIANOCHE LOCAL
// (add-game/precisionDate.ts evita a propósito `new Date('YYYY-MM-DD')`, que
// se interpreta en UTC), o sea las 23:00Z del 31 de diciembre anterior desde
// España. Resultado medido: las mismas 60 horas contaban en 2019 en Stats del
// escritorio y en 2018 en la portada del móvil.
//
// LA ZONA ENTRA POR PARÁMETRO, nunca se adivina aquí. Quien sabe en qué reloj
// vive el que está mirando es quien atiende la petición: el Worker la saca de
// la propia petición (index.ts), y el escritorio ya corre en el reloj bueno.
//
// `null`/`undefined` significa "el del proceso", que es lo correcto en el
// escritorio y es EXACTAMENTE lo que hacía el Worker antes de esto. Así el
// helper no cambia el comportamiento de nadie que no le dé zona: el arreglo
// solo entra donde alguien sabe la respuesta.

// Construir un Intl.DateTimeFormat cuesta bastante más que leer un Date, y
// esto se llama una vez por sesión y por bloque de horas manuales — en una
// biblioteca con miles de sesiones se nota. Las claves son nombres IANA que
// pone Cloudflare, no texto libre del cliente, así que el mapa no crece sin
// límite. El `null` cacheado es "esta zona no existe", para no repetir el
// try/catch en cada fila.
const formatters = new Map<string, Intl.DateTimeFormat | null>();

const formatterFor = (timeZone: string): Intl.DateTimeFormat | null => {
  const cached = formatters.get(timeZone);
  if (cached !== undefined) return cached;

  let formatter: Intl.DateTimeFormat | null = null;
  try {
    // Calendario gregoriano y locale fijos a propósito: aquí no se está
    // formateando nada para leer, se está extrayendo un número. Con el locale
    // del entorno, un sistema en 'th' devolvería el año budista (2562 en vez
    // de 2019) y el reparto por años se iría al garete en silencio.
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      calendar: 'gregory',
    });
  } catch {
    // Zona desconocida (un `cf.timezone` raro, un valor viejo de config): se
    // cae al reloj del proceso, que es el comportamiento de siempre. Inventar
    // un año o reventar la petición por esto sería peor.
    formatter = null;
  }

  formatters.set(timeZone, formatter);
  return formatter;
};

export const yearOf = (date: Date, timeZone?: string | null): number => {
  if (!timeZone) return date.getFullYear();

  const formatter = formatterFor(timeZone);
  if (formatter === null) return date.getFullYear();

  const part = formatter.formatToParts(date).find((piece) => piece.type === 'year');
  const year = Number(part?.value);
  return Number.isFinite(year) ? year : date.getFullYear();
};
