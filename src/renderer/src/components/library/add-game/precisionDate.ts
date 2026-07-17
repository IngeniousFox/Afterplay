// Tipos + helpers puros de PrecisionDateValue, separados de
// DateWithPrecisionPicker.tsx (que solo puede exportar el componente en sí
// — el linter de react-refresh se queja si un archivo de componente también
// exporta funciones/constantes de valor).
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
