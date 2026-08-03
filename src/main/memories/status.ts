import type { Chapter, ChapterScope } from '../../shared/memory/chapters';
import {
  buildChapter,
  listClosedPeriodsWithActivity,
  scopeKeyOf,
} from '../../shared/memory/chapters';
import type { Moment } from '../../shared/memory/moments';
import { deriveMoments } from '../../shared/memory/moments';
import { withDbAccess } from '../db';
import type { LatestMemory } from '../db/queries/memories/getLatestMemories';
import { getLatestMemories } from '../db/queries/memories/getLatestMemories';
import type { MemoryFacts } from '../db/queries/memories/getMemoryFacts';
import { getMemoryFacts } from '../db/queries/memories/getMemoryFacts';
import { MODEL, PROMPT_VERSION } from './generate';
import { chapterHash, legacyChapterHash } from './hash';

// El estado del sistema de recaps: qué periodos cerrados con actividad están
// al día, cuáles no tienen recap y cuáles quedaron desactualizados. Es la
// única pieza que compara hechos contra prosa — la detección automática, el
// backfill de Ajustes y la tarjeta de estado preguntan aquí.

// Foto completa de los hechos + momentos derivados, cargada UNA vez y
// compartida por todo lo que haga falta calcular con ella (el overview
// entero, o una racha de generación de la cola): derivar momentos recorre la
// historia completa y no se repite por periodo.
export type FactsSnapshot = {
  facts: MemoryFacts;
  moments: Moment[];
};

export const loadFactsSnapshot = async (): Promise<FactsSnapshot> => {
  const facts = await withDbAccess(() => getMemoryFacts());
  return { facts, moments: deriveMoments(facts.sessions, facts.manualHoursByGame) };
};

// El capítulo de un periodo sobre una foto ya cargada. Null = sin historia
// (no debería pasar para periodos listados con actividad, pero los datos
// pueden cambiar entre foto y foto — quien llama lo trata como "nada que
// hacer", nunca como error).
export const chapterFor = (
  snapshot: FactsSnapshot,
  scope: ChapterScope,
  now: Date,
): Chapter | null =>
  buildChapter(
    scope,
    snapshot.facts.sessions,
    snapshot.facts.events,
    snapshot.facts.titlesByGame,
    snapshot.moments,
    now,
    snapshot.facts.manualBlocks,
    snapshot.facts.unlocks,
  );

export type MemoriesOverview = {
  // Periodos cerrados con actividad sin recap, ascendentes.
  missing: ChapterScope[];
  // Con recap que ya no cuenta la verdad: los hechos cambiaron (§7.2, el
  // sourceHash no casa), o el prompt mejoró, o el modelo cambió desde que se
  // escribió — la prosa se escribiría distinta hoy. En todos los casos,
  // regenerar es manual.
  stale: ChapterScope[];
  current: number;
};

export const computeMemoriesOverview = async (
  now: Date = new Date(),
): Promise<{ overview: MemoriesOverview; snapshot: FactsSnapshot }> => {
  const snapshot = await loadFactsSnapshot();
  const stored = await withDbAccess(() => getLatestMemories());

  const byScope = new Map<string, LatestMemory>(
    stored.map((memory) => [`${memory.scopeType}:${memory.scopeKey}`, memory]),
  );

  const { months, years } = listClosedPeriodsWithActivity(
    snapshot.facts.sessions,
    snapshot.facts.events,
    now,
    snapshot.facts.manualBlocks,
  );

  const missing: ChapterScope[] = [];
  const stale: ChapterScope[] = [];
  let current = 0;

  for (const scope of [...months, ...years]) {
    const existing = byScope.get(`${scope.type}:${scopeKeyOf(scope)}`);
    if (!existing) {
      missing.push(scope);
      continue;
    }
    const chapter = chapterFor(snapshot, scope, now);
    // Sin capítulo ya no hay hechos que narrar (se borró la actividad): el
    // recap guardado queda como recuerdo y no se cuenta en ningún cubo.
    if (!chapter) continue;
    // Vale CUALQUIERA de las dos firmas: la actual o la anterior a que las
    // decisiones fueran hechos (ver legacyChapterHash). Sin esto, aquel
    // cambio habría marcado obsoletos de golpe todos los recaps ya escritos
    // — decenas de regeneraciones de pago para reescribir prosa correcta.
    // El precio, dicho claro: mientras un recap viejo siga con su firma
    // vieja, corregir SOLO una decisión suya no lo marca obsoleto (el resto
    // de hechos sí). En cuanto se regenera por lo que sea, queda sellado con
    // la firma nueva y recupera la detección completa.
    const sealed =
      chapterHash(chapter) === existing.sourceHash ||
      legacyChapterHash(chapter) === existing.sourceHash;
    if (sealed && existing.promptVersion === PROMPT_VERSION && existing.model === MODEL) {
      current++;
    } else {
      stale.push(scope);
    }
  }

  return { overview: { missing, stale, current }, snapshot };
};
