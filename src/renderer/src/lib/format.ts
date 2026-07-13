// "Xh Ym" si hay minutos sueltos, "Xh" si es un número redondo de horas,
// "0h" si no hay nada — mismo formato que el prototipo (fmtH).
export const formatHours = (hours: number): string => {
  const totalMinutes = Math.round(hours * 60);
  if (totalMinutes <= 0) return '0h';
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${wholeHours}h ${minutes}m` : `${wholeHours}h`;
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
