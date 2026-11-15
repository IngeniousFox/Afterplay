// "Hace cuánto" para la tarjeta del sync: lo bastante basto para no parpadear
// cada segundo, lo bastante fino para saber si el último ciclo fue ahora o
// ayer. Sin Intl.RelativeTimeFormat a propósito: la interfaz entera va en
// inglés y esto cubre los cuatro tramos que se ven.
export const describeAgo = (at: number | null, now: number): string => {
  if (at === null) return 'never';
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
};
