import type { EventDatePrecision } from '../../../../../shared/types';

// Tipos + helpers puros de PrecisionDateValue, separados de
// DateWithPrecisionPicker.tsx (que solo puede exportar el componente en sí
// — el linter de react-refresh se queja si un archivo de componente también
// exporta funciones/constantes de valor).
//
// Distinto de shared/types.ts DatePrecision (mismo shape, mismo nombre,
// declaración propia a propósito): este es el precision elegible A MANO en
// el picker (nadie teclea "datetime"), el de shared/types.ts es el que
// puede llevar la fecha guardada en la DB (eventos que la app crea sola en
// vivo sí llevan hora). Coinciden en shape hoy porque ninguno de los dos
// picker in-app ofrece 'datetime', pero son conceptos distintos que no
// deben fundirse en un solo alias importado.
export type DatePrecision = 'year' | 'month' | 'day';

// isoDate va SIEMPRE completo (YYYY-MM-DD) — la parte que no pinta según la
// precisión (mes/día cuando precision es 'year', día cuando es 'month')
// simplemente se rellena a 01 y no se muestra ni se usa aguas abajo: el
// timestamp guardado en sessions/stateEvents es siempre completo, precision
// solo dice cuánto de ese timestamp es de fiar (mismo modelo que ya usan
// esas tablas — no es un formato nuevo, es lo mismo con otro envoltorio).
export type PrecisionDateValue = { precision: DatePrecision; isoDate: string };

export const toIsoDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

// isoDate va siempre en hora local a propósito (sin sufijo Z) — parsear como
// fecha+hora local evita el clásico desfase de un día que da
// `new Date('YYYY-MM-DD')` (eso lo interpreta como UTC medianoche y lo
// muestra un día antes en husos horarios negativos).
export const parseIsoDate = (isoDate: string): Date => new Date(`${isoDate}T00:00:00`);

// Compartido por cualquier picker de este tipo que quiera arrancar en HOY en
// vez de vacío (AddSpendPopover, y el de "cuándo lo compraste" en Add Game)
// — una función y no una constante calculada una vez, para que cada llamada
// recoja el día real en el momento en que se abre el formulario, no el que
// era cuando arrancó la app.
export const todayValue = (): PrecisionDateValue => ({
  precision: 'day',
  isoDate: toIsoDate(new Date()),
});

// Sin esto, react-day-picker arranca el desplegable de año en "hace 100
// años" por defecto (documentado, y comprobado en vivo: con hoy en 2026
// abría en 1926). El tope de arriba es HOY, no hoy+1: lo que se registra
// aquí (sesiones, gastos, cambios de estado) ya pasó, nunca es una fecha
// futura — mismo criterio en los tres pickers (día/mes/año, ver
// MonthGrid/YearGrid/YearDropdown).
export const TODAY = new Date();
export const CURRENT_YEAR = TODAY.getFullYear();

// El valor de picker (fecha+precisión) de una fecha con precisión real de la
// DB ('datetime' incluido) — 'datetime' (eventos creados en vivo, con hora)
// cae a 'day' porque el picker no maneja horas. Compartido por los sitios
// que derivan un PrecisionDateValue de un ancla/entrada ya guardada
// (edit-game/types.ts anchorPickerValue, detail/HistoryList.tsx
// entryPickerValue).
export const toPickerValue = (date: Date, precision: EventDatePrecision): PrecisionDateValue => ({
  precision: precision === 'datetime' ? 'day' : precision,
  isoDate: toIsoDate(date),
});
