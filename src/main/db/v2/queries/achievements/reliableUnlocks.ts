import type { ChapterUnlock } from '../../../../../shared/memory/chapters';
import type { QueryContext } from '../common/context';
import { loadCatalogProgress } from './progress';

// Los desbloqueos con fecha FIABLE de toda la biblioteca, uno por logro y con
// su nombre, descripción y rareza del catálogo: la materia prima de logros de
// los recaps del Loop (`loop/getMemoryFacts`, `ChapterUnlock`).
//
// Antes de la integración el Loop tenía su propio lector (no podía importar
// este paquete). Se sustituye por este, que sale del MISMO progreso que el
// resumen de Stats y la tarjeta de Ajustes (`loadCatalogProgress`), así que
// un logro cuenta igual en los tres sitios:
//
// - Fundido por logro `(gameId, source, apiName)` con la regla de la casa
//   ("fecha fiable gana; empatadas, la más temprana"): de los fiables sale el
//   más temprano, que es lo que daba el `min()` del lector del Loop. Un logro
//   que solo consta con fechas no fiables no sale.
// - Solo logros de un catálogo vivo de un juego vivo (la 1.x hacía inner join
//   con `achievements`), y un desbloqueo sin su logro en el catálogo no sale.
// - En el orden del lector anterior (juego, fuente, apiName, por unidades de
//   código, el del `GROUP BY` de SQLite), para que la lista no cambie al
//   sustituirlo. `buildChapter` desempata además por juego y nombre.

const byCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Los desbloqueos fiables, fundidos por logro, de catálogos vivos de juegos vivos. */
export function getReliableUnlocks(ctx: QueryContext): ChapterUnlock<string>[] {
  const rows: { source: string; apiName: string; unlock: ChapterUnlock<string> }[] = [];
  for (const progress of loadCatalogProgress(ctx)) {
    for (const unlocked of progress.unlocked) {
      if (!unlocked.dateReliable) continue;
      rows.push({
        source: progress.source,
        apiName: unlocked.item.apiName,
        unlock: {
          gameId: progress.gameId,
          name: unlocked.item.displayName,
          description: unlocked.item.description,
          globalPercent: unlocked.item.globalPercent,
          unlockedAt: unlocked.unlockedAt,
        },
      });
    }
  }
  return rows
    .sort(
      (a, b) =>
        byCodeUnits(a.unlock.gameId, b.unlock.gameId) ||
        byCodeUnits(a.source, b.source) ||
        byCodeUnits(a.apiName, b.apiName),
    )
    .map((row) => row.unlock);
}
