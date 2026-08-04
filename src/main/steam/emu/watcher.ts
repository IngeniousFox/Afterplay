import { watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { and, isNotNull } from 'drizzle-orm';
import { getDb, withDbAccess } from '../../db';
import { gamesTable } from '../../db/schema';
import { existingEmuBases } from './locations';
import { readEmuUnlocksForGame } from './readUnlocks';
import { storeUnlocks } from '../syncAchievements';
import { maybeCelebrateCompletion } from '../notifications/complete';
import { enqueueAchievementToasts } from '../notifications/overlay';
import { notifyAchievementsActivity } from '../notify';

// Enterarse de un logro EN EL MOMENTO en que lo sacas (LOGROS.md §8.1).
//
// Vigila los FICHEROS, no los procesos. La primera versión colgaba de "se
// cerró una sesión", y falló por lo obvio en cuanto se probó: 007 First Light
// está marcado como completado, se abrió un rato, y no hubo sesión que cerrar
// — así que los logros no aparecieron hasta reiniciar la app. Detectar el
// juego tampoco es fiable del todo: los anti-cheat bloquean la introspección
// de procesos (ya pasó con Neverness to Everness).
//
// El fichero, en cambio, no miente: cuando el crack apunta un logro, escribe.
// Y son cuatro o cinco carpetas locales, no una por juego, así que vigilarlas
// cuesta cuatro FSWatcher del sistema operativo — cero sondeo.
//
// Mismo patrón que scan/watcher.ts, y por los mismos motivos.

// Los cracks escriben el fichero en varias pasadas (truncar + escribir), y
// cada una dispara su evento. Sin este freno se releería el mismo fichero
// tres veces por logro.
const DEBOUNCE_MS = 900;

let watchers: FSWatcher[] = [];
let debounce: ReturnType<typeof setTimeout> | null = null;
// true mientras flush() está en vuelo. Sin esto, un segundo flush del debounce
// podía arrancar mientras el primero aún esperaba en la DB o en la red, y —vía
// el snapshot no atómico de storeUnlocks— los dos daban el mismo logro por
// "nuevo": doble toast y doble tarjeta del 100%.
let flushing = false;
// Los appid tocados desde el último vaciado. Se acumulan a propósito: sacar
// varios logros seguidos toca el mismo fichero varias veces, y lo que
// interesa es releerlo UNA vez cuando pare.
const dirtyAppIds = new Set<number>();

// De la ruta relativa que da fs.watch al appid. Los eventos llegan como
// "3768760\\achievements.json" o "3768760" — el appid siempre es el primer
// segmento, que es justo cómo están organizadas todas estas carpetas.
const appIdFromEvent = (relativePath: string | null): number | null => {
  if (!relativePath) return null;
  const first = relativePath.split(/[\\/]/)[0];
  const appId = Number(first);
  return Number.isInteger(appId) && appId > 0 ? appId : null;
};

const flush = async (): Promise<void> => {
  // Ya hay un vaciado en curso: reprograma y sal, sin tocar dirtyAppIds — que
  // el que está corriendo lo procese, o esta re-programación lo recoja luego.
  if (flushing) {
    schedule();
    return;
  }

  const appIds = [...dirtyAppIds];
  dirtyAppIds.clear();
  if (appIds.length === 0) return;

  flushing = true;
  try {
    const games = await withDbAccess(async () =>
      getDb()
        .select({
          id: gamesTable.id,
          title: gamesTable.title,
          steamAppId: gamesTable.steamAppId,
          executablePath: gamesTable.executablePath,
          heroUrl: gamesTable.heroUrl,
        })
        .from(gamesTable)
        .where(and(isNotNull(gamesTable.steamAppId), isNotNull(gamesTable.achievementsSyncedAt))),
    );

    for (const appId of appIds) {
      // Cada appid en su try/catch. Antes, un solo fallo (la DB en pleno swap,
      // un fichero a medio escribir) abortaba el lote ENTERO — y como
      // dirtyAppIds ya se vació arriba y el vigilante es puramente por-evento
      // (un crack que ya terminó de escribir no genera más eventos), esos
      // logros se perdían hasta un sync manual completo. Ahora el que falla se
      // re-encola para el próximo debounce y los demás siguen.
      try {
        const game = games.find((candidate) => candidate.steamAppId === appId);
        // Un appid que no está en la biblioteca (o cuyo catálogo aún no se ha
        // traído): no hay dónde colgar sus logros. Se ignora en silencio.
        if (!game) continue;

        const emu = readEmuUnlocksForGame(appId, game.executablePath);
        if (emu.unlocks.length === 0) continue;

        const fresh = await storeUnlocks(game.id, 'emu', emu.unlocks, new Date());
        if (fresh.length === 0) continue;

        // Solo ASCII en los console.log, misma convencion que watcher/watcher.ts.
        console.log(`[steam] ${fresh.length} logro(s) nuevo(s) en vivo: ${game.title}`);
        enqueueAchievementToasts(
          fresh.map((toast) => ({ ...toast, gameTitle: game.title, gameHeroUrl: game.heroUrl })),
        );
        // ¿Acaba de caer el último? El broche dorado del 100%.
        maybeCelebrateCompletion(game.id, game.title, game.heroUrl);
        // Y que la ficha abierta se entere sin recargar nada.
        notifyAchievementsActivity({
          kind: 'synced',
          gameId: game.id,
          catalogCount: 0,
          unlockedCount: fresh.length,
        });
      } catch (error) {
        console.warn(
          `[steam] fallo leyendo logros en vivo del appid ${appId} (se reintenta):`,
          error,
        );
        dirtyAppIds.add(appId);
      }
    }
  } catch (error) {
    // Un fallo ANTES del bucle (la lectura de la lista de juegos): se re-encola
    // todo lo que había, que si no se perdería igual que arriba.
    console.warn('[steam] fallo leyendo logros en vivo:', error);
    for (const appId of appIds) dirtyAppIds.add(appId);
  } finally {
    flushing = false;
    // Llegaron eventos nuevos mientras vaciábamos, o quedaron appids
    // re-encolados por un fallo: otra pasada cuando amaine.
    if (dirtyAppIds.size > 0) schedule();
  }
};

const schedule = (): void => {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => {
    debounce = null;
    void flush();
  }, DEBOUNCE_MS);
};

export const startEmuWatcher = (): void => {
  stopEmuWatcher();

  for (const base of existingEmuBases()) {
    try {
      // recursive: en Windows sí está soportado, y hace falta porque el
      // fichero cuelga de <base>/<appid>/... — sin él solo llegarían los
      // eventos de crear/borrar la carpeta del appid, no los de escribir
      // dentro.
      const watcher = watch(base, { recursive: true }, (_event, filename) => {
        const appId = appIdFromEvent(filename ? String(filename) : null);
        if (appId === null) return;
        dirtyAppIds.add(appId);
        schedule();
      });
      watcher.on('error', (error) => {
        console.warn(`[steam] vigilancia de ${base} caida:`, error);
      });
      watchers.push(watcher);
    } catch (error) {
      // Una carpeta que desaparece o sin permisos no puede tumbar al resto.
      console.warn(`[steam] no se pudo vigilar ${base}:`, error);
    }
  }

  if (watchers.length > 0) {
    console.log(
      `[steam] vigilando ${watchers.length} carpeta(s) de emuladores para logros en vivo`,
    );
  }
};

export const stopEmuWatcher = (): void => {
  if (debounce) clearTimeout(debounce);
  debounce = null;
  for (const watcher of watchers) {
    try {
      watcher.close();
    } catch {
      // Ya cerrado: nada que hacer.
    }
  }
  watchers = [];
  dirtyAppIds.clear();
};
