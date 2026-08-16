import { DAY_MS, startOfDayMs } from './dateMath';

// Los cubos de fecha de la lista de sesiones.
//
// Vivía dentro de Sessions.tsx, como un `const` privado de un módulo que
// arrastra React, el router, lucide y seis hooks. Su gemelo de la PWA
// (web/src/lib/sessionGroups.ts) es una copia a mano, y el test de paridad
// —que existe justo para vigilar que las dos no se separen— no podía
// importar esta mitad: leía el .tsx con readFileSync y evaluaba el trozo con
// new Function, así que cualquier retoque a la firma o al cierre de la
// función rompía la extracción en vez de comparar nada.
//
// Aquí no hay React ni tipos del proceso principal, solo aritmética de
// calendario: se puede importar desde un test de node y desde el typecheck
// de la PWA sin arrastrar nada. Si algún día las dos mitades se funden en un
// único módulo compartido, este es el fichero que se mueve.

// El cubo al que pertenece una fecha: la etiqueta que se pinta y, cuando ese
// cubo ES un mes cerrado entero, la clave del mes.
export type SessionBucket = { label: string; monthScopeKey: string | null };

// Cubos de fecha para las cabeceras — de "Today" a un mes de un año
// concreto, cuanto más lejos en el tiempo más grueso el cubo (nadie necesita
// saber el día exacto de hace dos años, pero sí el de ayer). `now` se pasa y
// se calcula UNA vez por render (no una por sesión) para que todas las filas
// de la misma pasada usen el mismo "hoy", sin desajustes de un milisegundo
// entre unas y otras.
//
// monthScopeKey acompaña al label solo cuando el cubo ES un mes cerrado
// entero ("Last Month", "June", "March 2025"): es el gancho de la tarjeta de
// recap del diario (AFTERPLAY-LOOP.md §5). Los cubos del presente (Today...
// This Month) van a null — el mes en curso jamás se narra (§3.4), y un cubo
// de semana no es un mes aunque alguna fila caiga en el anterior.
export const getSessionGroup = (date: Date, now: Date): SessionBucket => {
  const diffDays = Math.round((startOfDayMs(now) - startOfDayMs(date)) / DAY_MS);

  if (diffDays <= 0) return { label: 'Today', monthScopeKey: null };
  if (diffDays === 1) return { label: 'Yesterday', monthScopeKey: null };
  if (diffDays <= 7) return { label: 'This Week', monthScopeKey: null };
  if (diffDays <= 14) return { label: 'Last Week', monthScopeKey: null };

  if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()) {
    return { label: 'This Month', monthScopeKey: null };
  }

  // '2026-06' — la clave con la que generated_memories conoce el periodo.
  const monthScopeKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  if (date.getFullYear() === lastMonth.getFullYear() && date.getMonth() === lastMonth.getMonth()) {
    return { label: 'Last Month', monthScopeKey };
  }

  if (date.getFullYear() === now.getFullYear()) {
    return { label: date.toLocaleDateString('en-US', { month: 'long' }), monthScopeKey };
  }

  // Años anteriores: siempre desglosado por mes ("March 2025", "January
  // 2025"...), no un cubo único por año.
  return {
    label: date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    monthScopeKey,
  };
};

export type SessionGroup<T> = SessionBucket & { sessions: T[] };

// Genérico sobre `{ startedAt: Date }` y no sobre SessionWithGame a
// propósito: importar shared/types traería aquí el grafo de tipos del
// proceso principal (igdb, saves, scan…) y este módulo dejaría de poder
// mirarse desde fuera del escritorio, que es justo lo que lo trajo aquí.
// Agrupar solo mira la fecha de inicio; lo demás se lo lleva puesto la fila.
//
// Agrupa una PÁGINA de sesiones, no la lista entera — la cabecera del primer
// registro de la página SIEMPRE se pinta, siga o no el mismo grupo que
// terminaba la página anterior. Sin esto, cambiar de página podía dejar una
// tanda de filas "This Week" arrancando a mitad, sin ningún titulito encima
// (el grupo ya se había impreso en la página anterior y no volvía a salir).
// (Y de regalo para el diario: un mes partido en dos páginas enseña su
// tarjeta de recap en las dos, que es donde su cabecera vuelve a pintarse.)
export const groupPageByDate = <T extends { startedAt: Date }>(
  sessions: T[],
  now: Date,
): SessionGroup<T>[] => {
  const groups: SessionGroup<T>[] = [];
  for (const session of sessions) {
    const { label, monthScopeKey } = getSessionGroup(session.startedAt, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.sessions.push(session);
    else groups.push({ label, monthScopeKey, sessions: [session] });
  }
  return groups;
};
