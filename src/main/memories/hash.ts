import { createHash } from 'node:crypto';
import type { Chapter } from '../../shared/memory/chapters';
import { canonicalChapterFacts } from '../../shared/memory/chapters';
import type { EntityIdLike } from '../../shared/entityIds';

// SHA-256 de los hechos canonicalizados (AFTERPLAY-LOOP.md §3.1) — la llave
// del estado stale/current sin mirar la prosa. En módulo propio porque lo
// necesitan tanto status.ts (comparar) como generate.ts (sellar la fila), y
// que uno importe del otro montaría un ciclo.
//
// Genéricas en la representación del id (como `canonicalChapterFacts`): la
// misma fórmula firma los capítulos de la 1.x (ids numéricos) y los del
// esquema 2.0 (texto, `db/v2/queries/loop/memorySignature.ts`). Sin
// parámetro explícito, `Id` se infiere del capítulo: con la 1.x no cambia
// nada de lo que calculan.
export const chapterHash = <Id extends EntityIdLike>(chapter: Chapter<Id>): string =>
  createHash('sha256').update(canonicalChapterFacts(chapter)).digest('hex');

// La MISMA llave, con la firma anterior a que las decisiones (empezar,
// aparcar, soltar) fueran hechos del capítulo. Sirve para una sola cosa:
// que un recap escrito antes de aquel cambio siga contando como vigente en
// vez de aparecer obsoleto de la noche a la mañana (status.ts acepta las
// dos). Los recaps nuevos se sellan siempre con chapterHash.
export const legacyChapterHash = <Id extends EntityIdLike>(chapter: Chapter<Id>): string =>
  createHash('sha256').update(canonicalChapterFacts(chapter, false)).digest('hex');
