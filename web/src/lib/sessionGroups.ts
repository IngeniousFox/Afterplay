import type { SessionWithGame } from '../api';

const DAY_MS = 86_400_000;

const startOfDayMs = (value: Date | number): number => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

// Cubos de fecha para las cabeceras, portados TAL CUAL del escritorio
// (src/renderer/src/lib/sessionGroups.ts, que es donde vive el original desde
// que salió de dentro de la pantalla de Sesiones). La diferencia de firma es
// el monthScopeKey: allí acompaña al label para enganchar la tarjeta de recap
// del diario, y aquí no hay diario que enganchar, así que solo viaja el label.
// El test de paridad compara los labels de los dos, uno a uno.
//
// Cuanto más lejos en el tiempo, más grueso el cubo: nadie
// necesita saber el día exacto de hace dos años, pero sí el de ayer.
//
// Mi primera versión inventaba otra escala (Today / Yesterday / la fecha
// suelta), y por eso no coincidían: aquí no hay margen para criterio propio,
// las dos pantallas tienen que decir lo mismo.
//
// `now` se pasa como parámetro y se calcula UNA vez por render, no una por
// sesión, para que todas las filas de la misma pasada usen el mismo "hoy".
export const getSessionGroup = (date: Date, now: Date): string => {
  const diffDays = Math.round((startOfDayMs(now) - startOfDayMs(date)) / DAY_MS);

  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays <= 7) return 'This Week';
  if (diffDays <= 14) return 'Last Week';

  if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()) {
    return 'This Month';
  }

  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  if (date.getFullYear() === lastMonth.getFullYear() && date.getMonth() === lastMonth.getMonth()) {
    return 'Last Month';
  }

  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('en-US', { month: 'long' });
  }

  // Años anteriores: siempre desglosado por mes ("March 2025"), no un cubo
  // único por año.
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

export type SessionGroup = { label: string; sessions: SessionWithGame[] };

// Agrupa una PÁGINA de sesiones, no la lista entera — la cabecera del primer
// registro de la página SIEMPRE se pinta, siga o no el mismo grupo que
// terminaba la página anterior. Sin esto, cambiar de página puede dejar una
// tanda de filas "This Week" arrancando a mitad, sin ningún titulito encima.
export const groupPageByDate = (sessions: SessionWithGame[], now: Date): SessionGroup[] => {
  const groups: SessionGroup[] = [];
  for (const session of sessions) {
    const label = getSessionGroup(new Date(session.startedAt), now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.sessions.push(session);
    else groups.push({ label, sessions: [session] });
  }
  return groups;
};
