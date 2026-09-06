// Date precision and clock preferences are also used by the PWA. Keep them
// independent of shared/types.ts, which exposes the Electron IPC contract.
export type DatePrecision = 'year' | 'month' | 'day';
export type EventDatePrecision = DatePrecision | 'datetime';
export type TimeFormat = '12h' | '24h';

// Electron sends Dates over IPC; JSON APIs send the same instants as millis.
export type DateValue = Date | number;

export const asDate = (value: DateValue): Date =>
  typeof value === 'number' ? new Date(value) : value;

export const timestamp = (value: DateValue): number =>
  typeof value === 'number' ? value : value.getTime();
