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

// Fechas de eventos/sesiones (Date real, no el isoDate del picker) según su
// datePrecision — 'en-US' fijo, mismo motivo que formatDisplay del picker:
// el resto de la UI está en inglés sin i18n.
export const formatByPrecision = (
  date: Date,
  precision: 'year' | 'month' | 'day' | 'datetime',
): string => {
  if (precision === 'year') return String(date.getFullYear());
  if (precision === 'month') {
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  if (precision === 'day') {
    return date.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  const datePart = date.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const timePart = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  return `${datePart} · ${timePart}`;
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
