// Drizzle peta con un .set() vacío, y un patch vacío es legítimo (guardar un
// formulario sin tocar nada) — en ese caso hay que hacer un SELECT en vez de
// un UPDATE. Este guard se repetía idéntico en updateGame/updateIteration/
// updateStateEvent/updateSpendEvent; aquí se centraliza solo la DECISIÓN
// (vacío -> fetch, si no -> update), no las queries en sí: cada caller sigue
// construyendo su propio .select(columns)/.update(table).set(patch) con la
// proyección explícita que ya tenía (necesaria para que Drizzle infiera el
// tipo del resultado sin degradarse a `any`, ver projections.ts), así que
// esto no toca el tipado de ninguna tabla, solo evita repetir el `if`.
export const updateOrFetch = async <T>(
  patch: Record<string, unknown>,
  fetchExisting: () => Promise<T | null>,
  applyUpdate: () => Promise<T | null>,
): Promise<T | null> => (Object.keys(patch).length === 0 ? fetchExisting() : applyUpdate());
