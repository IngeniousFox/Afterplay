import type { DatabaseSync } from 'node:sqlite';
import type { LocalDatabase } from '../connection';
import { createQueryContext } from '../queries/common';
import { recheckStoredMemorySignatures } from '../queries/loop';
import type { ImportPlan } from './build';
import type { ResealedMemory } from './queryValidation';

// LAS FIRMAS DE LOS RECAPS IMPORTADOS (§19.5, `generated_memories.sourceHash`).
//
// La firma de un recap es el SHA-256 de los hechos de su capítulo, que llevan
// los ids de juego. Copiada tal cual, una firma 1.x no casaría nunca con los
// hechos 2.0 (ids nuevos) y todos los recaps saldrían desactualizados: volver
// a generarlos cuesta dinero. `recheckStoredMemorySignatures` (consultas del
// Loop) construye cada capítulo con los hechos 2.0 YA IMPORTADOS, lo firma con
// los ids 1.x (`local_legacy_ids`) y, si casa con la firma guardada, devuelve
// la firma 2.0 del mismo capítulo con la misma generación.
//
// Se ejecuta dentro de la transacción de la importación, después de escribir
// las filas y el mapa de ids (lo necesita) y antes de validar (la validación
// comprueba lo que queda escrito). Reglas:
// - Solo los recaps que trae esta importación. Uno que ya estaba sellado con
//   ids 2.0 (una segunda ejecución, o un recap regenerado en la 2.0) casa con
//   `ids: 'v2'` y no se toca.
// - Y solo se REESCRIBEN los que esta misma ejecución ha insertado (revisión,
//   sospecha sobre este módulo). Uno que ya estaba en la base pudo llegar por
//   sync o editarse en la 2.0: reescribirlo sin reloj ni `syncDirty` cambiaría
//   un dato que nadie subiría nunca y que divergiría entre PCs. Se comprueba
//   igual (para el informe y la validación), pero se deja como está.
// - La firma que casa se escribe CONSERVANDO los relojes de la fila: es la
//   misma información, solo cambia de ids, y como el resto de lo importado
//   tiene que perder frente a cualquier edición posterior. Por eso se escribe
//   por debajo de la puerta (que pondría el reloj de ahora), como `write.ts`.
// - La que no casa se deja como está: con ids 1.x no casará nunca, así que el
//   recap sigue contando como desactualizado, que es lo que ya era en la 1.x
//   (o lo que hay que ver si la migración cambió algún hecho: lo dice la
//   validación con consultas, que compara la vigencia en los dos lados).
//
// OJO: la firma depende de la ZONA HORARIA local (los capítulos y las fechas
// canónicas son de calendario local). Una firma 1.x solo casa si se importa
// en la zona en la que se generó el recap, y la firma 2.0 resultante es la de
// esa zona. Es determinista para un mismo origen, zona y `now`.

export type MemorySignatureOutcome = 'match' | 'mismatch' | 'no_chapter' | 'invalid_scope';

export interface MemorySignatureReport {
  /** Recaps de esta importación comprobados. */
  readonly checked: number;
  /** Los cuatro resultados posibles de la comprobación. */
  readonly outcomes: Record<MemorySignatureOutcome, number>;
  /** Detalle de los que casan: `legacy:<generación>` (reescritos) o `v2:<generación>`. */
  readonly matches: Record<string, number>;
  /** Firmas reescritas con ids 2.0 en esta ejecución. */
  readonly resealed: number;
  /** Casan con ids 1.x pero no se reescriben: la fila ya estaba antes de esta ejecución. */
  readonly notResealedPreexisting: number;
  /** De los que no casan: cuántos tienen juegos del capítulo sin id 1.x. */
  readonly mismatchWithUnmappedGames: number;
  /** Clave del periodo (`month:2026-06`) de cada recap que no casa: sin contenido. */
  readonly mismatchScopes: readonly string[];
  /** Zona horaria con la que se calcularon (la firma depende de ella). */
  readonly timeZone: string;
}

export interface ResealResult {
  readonly report: MemorySignatureReport;
  /** Id 2.0 del recap → la firma que tiene que quedar (para la validación). */
  readonly expected: ReadonlyMap<string, ResealedMemory>;
}

export function resealMemorySignatures(
  target: LocalDatabase,
  plan: ImportPlan,
  now: Date,
  /** Ids de `generated_memories` insertados en esta ejecución (`writePlan`). */
  insertedNow: ReadonlySet<string>,
): ResealResult {
  const imported = new Set((plan.rows.get('generated_memories') ?? []).map((row) => row.id));
  const outcomes: Record<MemorySignatureOutcome, number> = {
    match: 0,
    mismatch: 0,
    no_chapter: 0,
    invalid_scope: 0,
  };
  const matches: Record<string, number> = {};
  const expected = new Map<string, ResealedMemory>();
  const mismatchScopes: string[] = [];
  let resealed = 0;
  let preexisting = 0;
  let unmapped = 0;
  if (imported.size === 0) {
    return { report: emptyReport(outcomes), expected };
  }

  // El mapa de juegos lo lee la propia consulta de `local_legacy_ids`, que ya
  // está escrito en esta misma transacción.
  const ctx = createQueryContext(target, { now: () => new Date(now) });
  const update = (target.db.$client as DatabaseSync).prepare(
    'UPDATE "generated_memories" SET "sourceHash" = ? WHERE "id" = ? AND "sourceHash" = ?',
  );
  let checked = 0;
  for (const memory of recheckStoredMemorySignatures(ctx, { now })) {
    if (!imported.has(memory.id)) continue;
    checked += 1;
    const { check } = memory;
    outcomes[check.status] += 1;
    if (check.status === 'match') {
      const key = `${check.ids}:${check.generation}`;
      matches[key] = (matches[key] ?? 0) + 1;
      const differs = check.sourceHash !== memory.storedHash;
      if (differs && !insertedNow.has(memory.id)) {
        // Ya estaba: no es nuestro reescribirlo (ver la cabecera).
        preexisting += 1;
        expected.set(memory.id, { expectedHash: memory.storedHash, resealed: false });
        continue;
      }
      if (differs) {
        const result = update.run(check.sourceHash, memory.id, memory.storedHash);
        if (Number(result.changes) !== 1)
          throw new Error(`recap ${memory.id}: no se pudo resellar`);
        resealed += 1;
      }
      expected.set(memory.id, { expectedHash: check.sourceHash, resealed: differs });
    } else {
      if (check.status === 'mismatch' && check.unmappedGameIds?.length) unmapped += 1;
      if (check.status === 'mismatch')
        mismatchScopes.push(`${memory.scopeType}:${memory.scopeKey}`);
      expected.set(memory.id, { expectedHash: memory.storedHash, resealed: false });
    }
  }
  return {
    report: {
      checked,
      outcomes,
      matches,
      resealed,
      notResealedPreexisting: preexisting,
      mismatchWithUnmappedGames: unmapped,
      mismatchScopes: mismatchScopes.sort(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    expected,
  };
}

function emptyReport(outcomes: Record<MemorySignatureOutcome, number>): MemorySignatureReport {
  return {
    checked: 0,
    outcomes,
    matches: {},
    resealed: 0,
    notResealedPreexisting: 0,
    mismatchWithUnmappedGames: 0,
    mismatchScopes: [],
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}
