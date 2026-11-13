import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { compareByCreation } from '../../../../../shared/entityIds';
import {
  buildChapter,
  canonicalChapterFacts,
  type Chapter,
  type ChapterFactsGeneration,
  type ChapterScope,
} from '../../../../../shared/memory/chapters';
import { deriveMoments, type Moment } from '../../../../../shared/memory/moments';
import { generatedMemories, localLegacyIds, type MemoryScopeType } from '../../schema';
import { alive } from '../../store';
import type { QueryContext } from '../common';
import { getMemoryFacts, type MemoryFacts } from './memories';

// La firma de los recaps (`sourceHash`) con ids 2.0, y su recálculo para los
// recaps importados de la 1.x (AFTERPLAY-2.0.md §19.5).
//
// La firma es el SHA-256 de `canonicalChapterFacts(capítulo)`, que lleva los
// ids de juego y ordena por ellos. Aquí NO se cambia cómo se calcula: es la
// misma fórmula que `src/main/memories/hash.ts` (que solo acepta capítulos con
// ids numéricos, por eso se repite aquí en dos líneas; ver el informe).
//
// El problema de la migración: los ids de juego cambian, así que una firma
// 1.x no casa nunca con los mismos hechos leídos de la 2.0, y si se copiara
// tal cual todos los recaps saldrían obsoletos y se volverían a pagar. La
// solución es VERIFICAR antes de resellar:
//
//   1. Se construye el capítulo del periodo con los hechos 2.0.
//   2. Se traducen sus ids de juego a los ids 1.x (`local_legacy_ids`) y se
//      firma: si casa con la firma guardada, los hechos no han cambiado al
//      migrar y el recap seguía vigente en la 1.x.
//   3. Entonces se devuelve la firma 2.0 de ese mismo capítulo (misma
//      generación de firma que casó), que es la que hay que guardar.
//   4. Si no casa (el recap ya estaba obsoleto en la 1.x, o la migración
//      cambió algún hecho), se deja la firma antigua: con ids viejos no casará
//      nunca, así que sigue contando como obsoleto, que es lo correcto.

/** Las generaciones que `status.ts` acepta hoy, en orden de preferencia. */
const ACCEPTED_GENERATIONS = ['noAchievements', 'noDecisions'] as const;
export type AcceptedGeneration = (typeof ACCEPTED_GENERATIONS)[number];

/**
 * SHA-256 hex de los hechos canónicos. `'noAchievements'` es `chapterHash` y
 * `'noDecisions'` es `legacyChapterHash` de `src/main/memories/hash.ts`.
 */
export function chapterSignature(
  chapter: Chapter<string> | Chapter<number>,
  generation: ChapterFactsGeneration = 'noAchievements',
): string {
  // `canonicalChapterFacts` es genérica: el cast solo une las dos ramas.
  return createHash('sha256')
    .update(canonicalChapterFacts(chapter as Chapter<string>, generation))
    .digest('hex');
}

/** `'2026-06'` → mes (0-11), `'2026'` → año. Null si la clave no tiene esa forma. */
export function scopeFromKey(scopeType: MemoryScopeType, scopeKey: string): ChapterScope | null {
  if (scopeType === 'year') {
    return /^\d{4}$/.test(scopeKey) ? { type: 'year', year: Number(scopeKey) } : null;
  }
  const match = /^(\d{4})-(\d{2})$/.exec(scopeKey);
  if (!match) return null;
  const month = Number(match[2]) - 1;
  return month >= 0 && month <= 11 ? { type: 'month', year: Number(match[1]), month } : null;
}

/** Los hechos más sus momentos, derivados UNA vez sobre la historia completa. */
export type MemoryFactsSnapshot = {
  readonly facts: MemoryFacts;
  readonly moments: Moment<string>[];
};

export function loadMemoryFactsSnapshot(ctx: QueryContext): MemoryFactsSnapshot {
  const facts = getMemoryFacts(ctx);
  return { facts, moments: deriveMoments(facts.sessions, facts.manualHoursByGame) };
}

/** El capítulo de un periodo sobre una foto ya cargada (como `chapterFor` de `status.ts`). */
export function memoryChapterFor(
  snapshot: MemoryFactsSnapshot,
  scope: ChapterScope,
  now: Date,
): Chapter<string> | null {
  const { facts } = snapshot;
  return buildChapter(
    scope,
    facts.sessions,
    facts.events,
    facts.titlesByGame,
    snapshot.moments,
    now,
    facts.manualBlocks,
    facts.unlocks,
  );
}

/**
 * El mismo capítulo con los ids de juego 1.x, para firmarlo como lo firmó la
 * 1.x. Devuelve los juegos sin id 1.x si falta alguno (no se puede verificar).
 *
 * Los ids de sesión de los momentos no salen en la firma: solo desempatan su
 * orden. Se sustituyen por su posición en orden de creación, que es el orden
 * de los ids 1.x (los UUIDv7 importados lo conservan, R-04).
 */
export function toLegacyIds(
  chapter: Chapter<string>,
  legacyGameIds: ReadonlyMap<string, number>,
): { chapter: Chapter<number> } | { unmappedGameIds: string[] } {
  const unmapped = new Set<string>();
  const game = (id: string): number => {
    const legacy = legacyGameIds.get(id);
    if (legacy === undefined) {
      unmapped.add(id);
      return -1;
    }
    return legacy;
  };
  const sessionRank = new Map(
    [...new Set(chapter.moments.map((moment) => moment.sessionId))]
      .sort(compareByCreation)
      .map((id, index) => [id, index]),
  );
  const games = chapter.games.map((entry) => ({ ...entry, gameId: game(entry.gameId) }));
  const legacy: Chapter<number> = {
    ...chapter,
    games,
    dominant: games[0] ?? null,
    completions: chapter.completions.map((entry) => ({ ...entry, gameId: game(entry.gameId) })),
    stateChanges: chapter.stateChanges.map((entry) => ({ ...entry, gameId: game(entry.gameId) })),
    moments: chapter.moments.map(
      (moment) =>
        ({
          ...moment,
          gameId: game(moment.gameId),
          sessionId: sessionRank.get(moment.sessionId) ?? 0,
        }) as Moment<number>,
    ),
    achievements: chapter.achievements && {
      ...chapter.achievements,
      highlights: chapter.achievements.highlights.map((entry) => ({
        ...entry,
        gameId: game(entry.gameId),
      })),
    },
  };
  return unmapped.size > 0 ? { unmappedGameIds: [...unmapped] } : { chapter: legacy };
}

export interface StoredMemorySignature {
  readonly scopeType: MemoryScopeType;
  readonly scopeKey: string;
  readonly sourceHash: string;
}

export type MemorySignatureCheck =
  /**
   * La firma guardada casa con los hechos 2.0 del periodo. `sourceHash` es la
   * firma que hay que guardar (con ids 2.0 y la misma generación que casó);
   * coincide con la guardada si ya estaba sellada con ids 2.0.
   */
  | {
      readonly status: 'match';
      readonly ids: 'v2' | 'legacy';
      readonly generation: AcceptedGeneration;
      readonly sourceHash: string;
    }
  /**
   * No casa: el recap ya estaba obsoleto o los hechos cambiaron. Hay que
   * dejar la firma guardada como está (sigue contando como obsoleto).
   * `sourceHash` es la firma 2.0 de hoy, solo informativa.
   * `unmappedGameIds`: juegos del capítulo sin id 1.x (no se pudo comparar
   * con ids 1.x).
   */
  | {
      readonly status: 'mismatch';
      readonly sourceHash: string;
      readonly unmappedGameIds?: readonly string[];
    }
  /** El periodo ya no tiene nada que contar: el recap queda como recuerdo. */
  | { readonly status: 'no_chapter' }
  /** `scopeKey` no tiene la forma de su `scopeType`. */
  | { readonly status: 'invalid_scope' };

/**
 * Recalcula la firma de un recap guardado con los hechos 2.0 de su periodo y
 * dice si coincide (ver la cabecera). Pura: no lee ni escribe la base.
 *
 * Primero compara con ids 2.0 (recap ya sellado en 2.0) y, si se dan
 * `legacyGameIds` (id 2.0 → id 1.x del juego), con ids 1.x.
 */
export function recheckMemorySignature(
  snapshot: MemoryFactsSnapshot,
  memory: StoredMemorySignature,
  options: { readonly now: Date; readonly legacyGameIds?: ReadonlyMap<string, number> },
): MemorySignatureCheck {
  const scope = scopeFromKey(memory.scopeType, memory.scopeKey);
  if (!scope) return { status: 'invalid_scope' };
  const chapter = memoryChapterFor(snapshot, scope, options.now);
  if (!chapter) return { status: 'no_chapter' };

  for (const generation of ACCEPTED_GENERATIONS) {
    const signature = chapterSignature(chapter, generation);
    if (signature === memory.sourceHash) {
      return { status: 'match', ids: 'v2', generation, sourceHash: signature };
    }
  }

  const current = chapterSignature(chapter);
  if (!options.legacyGameIds) return { status: 'mismatch', sourceHash: current };
  const legacy = toLegacyIds(chapter, options.legacyGameIds);
  if ('unmappedGameIds' in legacy) {
    return { status: 'mismatch', sourceHash: current, unmappedGameIds: legacy.unmappedGameIds };
  }
  for (const generation of ACCEPTED_GENERATIONS) {
    if (chapterSignature(legacy.chapter, generation) === memory.sourceHash) {
      return {
        status: 'match',
        ids: 'legacy',
        generation,
        sourceHash: chapterSignature(chapter, generation),
      };
    }
  }
  return { status: 'mismatch', sourceHash: current };
}

/**
 * El mapa id 2.0 → id 1.x de los juegos que dejó el importador en
 * `local_legacy_ids` (tabla local: se lee directamente).
 */
export function readLegacyGameIds(ctx: QueryContext): Map<string, number> {
  const rows = ctx.db
    .select({ legacyId: localLegacyIds.legacyId, newId: localLegacyIds.newId })
    .from(localLegacyIds)
    .where(eq(localLegacyIds.legacyTable, 'games'))
    .all();
  return new Map(rows.map((row) => [row.newId, row.legacyId]));
}

export interface StoredMemoryCheck {
  readonly id: string;
  readonly scopeType: MemoryScopeType;
  readonly scopeKey: string;
  readonly storedHash: string;
  readonly check: MemorySignatureCheck;
}

/**
 * Comprueba TODOS los recaps vivos de la base con los hechos 2.0 (una sola
 * foto de hechos). No escribe nada: quien llama decide cómo guardar las
 * firmas nuevas (el importador, con sus relojes antiguos; ver el informe).
 *
 * `legacyGameIds` por defecto sale de `local_legacy_ids`.
 */
export function recheckStoredMemorySignatures(
  ctx: QueryContext,
  options: { readonly now?: Date; readonly legacyGameIds?: ReadonlyMap<string, number> } = {},
): StoredMemoryCheck[] {
  const snapshot = loadMemoryFactsSnapshot(ctx);
  const legacyGameIds = options.legacyGameIds ?? readLegacyGameIds(ctx);
  const now = options.now ?? ctx.now();
  return ctx.db
    .select({
      id: generatedMemories.id,
      scopeType: generatedMemories.scopeType,
      scopeKey: generatedMemories.scopeKey,
      sourceHash: generatedMemories.sourceHash,
    })
    .from(generatedMemories)
    .where(alive(generatedMemories))
    .orderBy(generatedMemories.id)
    .all()
    .map((row) => ({
      id: row.id,
      scopeType: row.scopeType,
      scopeKey: row.scopeKey,
      storedHash: row.sourceHash,
      check: recheckMemorySignature(snapshot, row, { now, legacyGameIds }),
    }));
}
