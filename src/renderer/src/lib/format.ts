import type { DatePrecision, EventDatePrecision, TimeFormat } from '../../../shared/types';

// "1 game" / "3 games" — usado en las cabeceras de las columnas de nav
// (Library/Sessions/Stats) y en la vista de Sesiones.
export const pluralize = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? '' : 's'}`;

// "Xh Ym" si hay minutos sueltos, "Xh" si es un número redondo de horas,
// "0h" si no hay nada — mismo formato que el prototipo (fmtH).
export const formatHours = (hours: number): string => {
  const totalMinutes = Math.round(hours * 60);
  if (totalMinutes <= 0) return '0h';
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${wholeHours}h ${minutes}m` : `${wholeHours}h`;
};

// Mismo separador decimal que el placeholder "0.00" del campo de gasto —
// nunca coma, sin importar el locale del sistema.
export const formatMoney = (amount: number): string => `€${amount.toFixed(2)}`;

// 'en-US' fijo (mismo motivo que abajo) — hour12 es lo único que cambia
// según el ajuste de Settings (slider 12h/24h, 24h por defecto).
export const formatTime = (date: Date, timeFormat: TimeFormat): string =>
  date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: timeFormat === '12h',
  });

// 'en-US' fijo, no el locale del sistema — el resto de la UI está en inglés
// sin i18n, así que dejar que esto cambie de idioma solo (el navegador de
// pruebas de Claude Code está en es-ES, y salía "15 de julio de 2026" aquí
// en medio de una interfaz en inglés) sería inconsistente.
export const formatDateOnly = (date: Date, precision: DatePrecision): string => {
  if (precision === 'year') return String(date.getFullYear());
  if (precision === 'month') {
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
};

// Fechas de eventos/sesiones (Date real, no el isoDate del picker) según su
// datePrecision — 'en-US' fijo, mismo motivo que formatDateOnly: el resto de
// la UI está en inglés sin i18n. timeFormat es obligatorio (no opcional con
// default) a propósito: así el compilador señala cualquier llamada que se me
// olvide actualizar si este archivo cambia, en vez de dejarla colada en 24h
// en silencio.
export const formatByPrecision = (
  date: Date,
  precision: EventDatePrecision,
  timeFormat: TimeFormat,
): string => {
  if (precision !== 'datetime') return formatDateOnly(date, precision);
  const datePart = date.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return `${datePart} · ${formatTime(date, timeFormat)}`;
};

// Hora de fin de una sesión, para pintarla justo debajo de la de inicio en
// cualquier fila de sesión — solo la hora (no repite la fecha, casi siempre
// el mismo día) y solo tiene sentido con precisión 'datetime' (año/mes/día
// no llevan hora que mostrar). null si no aplica (sesión en marcha, o sin
// hora que dar).
export const formatSessionEndTime = (
  endedAt: Date | null,
  datePrecision: EventDatePrecision,
  timeFormat: TimeFormat,
): string | null => {
  if (!endedAt || datePrecision !== 'datetime') return null;
  return formatTime(endedAt, timeFormat);
};

// GB si llega a 1024MB, si no MB — el tamaño de una carpeta de instalación
// nunca es tan pequeño como para necesitar KB/bytes sueltos.
export const formatBytes = (bytes: number): string => {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(0)} MB`;
};

// HH:MM:SS con ceros a la izquierda — el contador en vivo de una sesión
// abierta (mismo formato que el prototipo, fmtTimer).
export const formatElapsed = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds));
  const pad = (n: number): string => String(n).padStart(2, '0');
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
};
