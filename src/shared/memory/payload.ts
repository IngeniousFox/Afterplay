// La forma del JSON que guarda cada fila de generated_memories (AFTERPLAY-
// LOOP.md §3.1) — lo ÚNICO que la IA produce. Vive en su propio módulo (y no
// en shared/types.ts) porque el esquema de la DB lo necesita para tipar la
// columna payload, y schema.ts no puede importar de shared/types (sería un
// ciclo: types reexporta el esquema).

export type RecapPayload = {
  // El titular del periodo — corto, va junto al número del mes/año.
  headline: string;
  // La historia en sí: unas pocas frases en segunda persona.
  narrative: string;
  // 0-3 apuntes sueltos que merecen quedarse (récords, regresos, remates).
  highlights: string[];
  // Una frase tranquila de cierre.
  closingLine: string;
};
