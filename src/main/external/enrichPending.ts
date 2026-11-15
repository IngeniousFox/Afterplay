import { JOB_TTL_SEC, runLeased, type JobClaims } from '../sync/jobClaims';

// Completar los juegos que otro dispositivo añadió (AFTERPLAY-2.0.md §13.3,
// §14.3 `enrich`). Un alta desde el móvil crea el juego en el hub con título,
// `igdbId` y carátula pero sin ninguna comprobación externa: queda "nunca
// preguntado". Cuando un ciclo de sync trae juegos así, un PC pide la
// concesión `enrich:<gameId>` y los completa con el mismo código que el botón
// "actualízalo todo" de la ficha (`refreshGameEverything`), que ya respeta lo
// manual (D-22), no pisa un dato con un "no" externo y no escribe lo que no
// cambia (F-33).
//
// Este módulo es solo la ORQUESTACIÓN, con todo lo que toca el mundo
// inyectado para poder probarla: qué juegos faltan, cómo se completa uno, las
// concesiones. El cableado real está en `enrichPendingApp.ts`.
//
// Reglas:
//   · Sin hub emparejado no hace nada: este trabajo nace del sync (los juegos
//     del móvil), y sin hub la app se comporta como siempre.
//   · `enrich` no es de pago: si el hub no responde se completa en local.
//   · Un juego que otro PC tiene en concesión se salta; sus datos llegan por
//     sync. Un fallo se cierra en la concesión con su motivo.
//   · Se trabaja de ENRICH_BATCH en ENRICH_BATCH y con un tope de lotes por
//     llamada, para que una biblioteca entera sin comprobaciones (p. ej. recién
//     importada) se complete poco a poco y no de una sola tacada.

/** Juegos que se piden a la base en cada lote. */
export const ENRICH_BATCH = 5;
/** Lotes como mucho por llamada a `run`. */
export const ENRICH_MAX_BATCHES = 10;

export interface EnrichPendingDeps {
  readonly claims: JobClaims;
  /** Hasta `limit` ids de juegos nunca preguntados (`selectGamesToEnrich`). */
  readonly select: (limit: number) => readonly string[];
  /** Completa UN juego. Devuelve el motivo si no se pudo (sin lanzar), o null si salió bien. */
  readonly enrich: (gameId: string) => Promise<string | null>;
  /** Las credenciales que hacen falta para preguntar (IGDB). Sin ellas no se intenta. */
  readonly canRun: () => boolean;
  readonly now?: () => number;
  readonly log?: (message: string) => void;
}

export interface EnrichSummary {
  readonly enriched: number;
  readonly failed: number;
  /** Otro PC los tiene en concesión. */
  readonly denied: number;
  /** Se detuvo porque no hay hub emparejado. */
  readonly noHub: boolean;
}

const EMPTY: EnrichSummary = { enriched: 0, failed: 0, denied: 0, noHub: false };

export interface EnrichRunner {
  /** Una pasada. Si ya hay una en marcha, pide otra al terminar y devuelve el resumen vacío. */
  run(): Promise<EnrichSummary>;
}

export function createEnrichRunner(deps: EnrichPendingDeps): EnrichRunner {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => {});
  // Juegos que no se vuelven a intentar hasta esa hora (ms): los denegados
  // hasta que caduque la concesión ajena, y los intentados hasta que caduque
  // la propia. Sin esto, un juego que no deja comprobación (fallo de red)
  // ocuparía siempre la cabeza de la lista.
  const skipUntil = new Map<string, number>();
  let running = false;
  let again = false;

  const pass = async (): Promise<EnrichSummary> => {
    if (!deps.canRun()) return EMPTY;
    const at = now();
    for (const [id, until] of skipUntil) if (until <= at) skipUntil.delete(id);
    const candidates = deps
      .select(ENRICH_BATCH + skipUntil.size)
      .filter((id) => !skipUntil.has(id))
      .slice(0, ENRICH_BATCH);

    let enriched = 0;
    let failed = 0;
    let denied = 0;
    for (const gameId of candidates) {
      try {
        const run = await runLeased(
          deps.claims,
          { kind: 'enrich', key: gameId, requireHub: true },
          () => deps.enrich(gameId),
          (reason) => reason,
        );
        if (!run.ran) {
          if (run.reason === 'skip_no_hub') return { enriched, failed, denied, noHub: true };
          denied++;
          skipUntil.set(
            gameId,
            run.claim.status === 'denied' ? run.claim.expiresAt : now() + JOB_TTL_SEC.enrich * 1000,
          );
          continue;
        }
        skipUntil.set(gameId, now() + JOB_TTL_SEC.enrich * 1000);
        if (run.value === null) enriched++;
        else failed++;
      } catch (error) {
        failed++;
        skipUntil.set(gameId, now() + JOB_TTL_SEC.enrich * 1000);
        log(`fallo completando un juego: ${error instanceof Error ? error.message : 'error'}`);
      }
    }
    if (enriched + failed + denied > 0) {
      log(`completados ${enriched}, fallidos ${failed}, de otro PC ${denied}`);
    }
    return { enriched, failed, denied, noHub: false };
  };

  return {
    async run() {
      if (running) {
        again = true;
        return EMPTY;
      }
      running = true;
      try {
        let total = EMPTY;
        for (let batch = 0; batch < ENRICH_MAX_BATCHES; batch++) {
          again = false;
          const summary = await pass();
          total = {
            enriched: total.enriched + summary.enriched,
            failed: total.failed + summary.failed,
            denied: total.denied + summary.denied,
            noHub: summary.noHub,
          };
          if (summary.noHub) break;
          // Otro lote si el anterior salió lleno (puede haber más) o si
          // llegaron juegos nuevos mientras se trabajaba.
          const full = summary.enriched + summary.failed + summary.denied >= ENRICH_BATCH;
          if (!full && !again) break;
        }
        return total;
      } finally {
        running = false;
        again = false;
      }
    },
  };
}
