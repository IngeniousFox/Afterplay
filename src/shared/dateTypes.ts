// Date precision and clock preferences are also used by the PWA. Keep them
// independent of shared/types.ts, which exposes the Electron IPC contract.
export type DatePrecision = 'year' | 'month' | 'day';
export type EventDatePrecision = DatePrecision | 'datetime';
// Los eventos de estado del esquema 2.0 añaden 'unknown': "no consta cuándo
// pasó". Es lo que escribe un alta o una promoción sin fecha, y sustituye a la
// heurística de "cae a menos de 5 s del alta" (AFTERPLAY-2.0.md §7.5,
// isAddedAtArtifact). Solo los eventos de estado: sesiones y gastos siempre
// llevan una fecha de verdad.
export type StateEventDatePrecision = EventDatePrecision | 'unknown';
export type TimeFormat = '12h' | '24h';

// Electron sends Dates over IPC; JSON APIs send the same instants as millis.
export type DateValue = Date | number;

export const asDate = (value: DateValue): Date =>
  typeof value === 'number' ? new Date(value) : value;

export const timestamp = (value: DateValue): number =>
  typeof value === 'number' ? value : value.getTime();
