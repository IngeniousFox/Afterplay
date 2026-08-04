import { watch, type FSWatcher } from 'node:fs';
import { getConfigValue } from '../config/store';
import {
  dropCachedEntries,
  getCachedEntries,
  getCachedEntry,
  needsDescribe,
  needsMatch,
  pathKey,
  putCachedEntries,
  type CacheEntry,
} from './cache';
import { byFolderName, describeFolders, listGameFolders, type FolderRef } from './folders';
import { matchFolderNames } from './matcher';

// Vigilancia de las carpetas de juegos. La idea: la app se entera sola de
// que has instalado algo y lo tiene ya cruzado con IGDB para cuando abras
// "Add Game", en vez de hacerte esperar diez segundos a un escaneo entero
// cada vez.
//
// Dos disparadores para el mismo trabajo, porque ninguno de los dos basta:
//
//   - fs.watch sobre cada raíz. Es lo que da la reacción inmediata. NO es
//     recursivo a propósito: así solo avisa de lo que nos importa (aparece o
//     desaparece una carpeta de primer nivel) y no de cada uno de los miles
//     de ficheros que escribe un instalador dentro.
//   - Un barrido lento. fs.watch no es de fiar en unidades de red, se muere
//     en silencio si desenchufas el disco, y no existe para lo que pasó
//     mientras la app estaba cerrada. El barrido es un readdir por raíz —
//     milisegundos— así que puede correr cada pocos minutos sin que se note,
//     y es lo que hace que el sistema se recupere solo de todo lo anterior.
//
// Lo caro (recorrer la carpeta para el tamaño y el .exe, y preguntar a IGDB)
// se paga SOLO por lo que la caché no sabe todavía.

// Silencio que se exige tras el último evento antes de mirar. Un instalador
// crea, renombra y borra carpetas temporales a ráfagas; sin esperar, cada
// ráfaga sería un escaneo.
const DEBOUNCE_MS = 20_000;

// Cada cuánto corre la red de seguridad.
const SWEEP_INTERVAL_MS = 5 * 60_000;

// Tope de carpetas que se cruzan con IGDB de una tacada. Señalar por error
// la raíz de un disco no puede convertirse en mil búsquedas.
const MAX_FOLDERS = 300;

// Carpetas nuevas que se describen y buscan en un mismo ciclo. Lo que pase
// de aquí se queda para el ciclo siguiente: instalar un juego son una o dos
// carpetas, y un número alto solo aparece la primera vez que señalas una
// biblioteca entera — que no tiene por qué resolverse de golpe.
const MAX_NEW_PER_CYCLE = 25;

// Instancia única, al estilo de setRunningGamesProbe/setSavesNotifier: la
// crea el arranque (main/index.ts) y la consultan los handlers IPC para que
// el botón de Scan entre por la MISMA cola que el vigilante.
let instance: ScanWatcher | null = null;

export const setScanWatcher = (watcher: ScanWatcher | null): void => {
  instance = watcher;
};

export const getScanWatcher = (): ScanWatcher | null => instance;

export class ScanWatcher {
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly onChange: () => void;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  // true tras stop(). Un reconcile en vuelo al cerrar la app podía llamar a
  // schedule() DESPUÉS de stop() (la cadena de "quedan carpetas") y dejar un
  // timer vivo que stop() ya no vería.
  private stopped = false;
  // Cola de un solo carril: el botón de Scan y el vigilante escriben en el
  // mismo fichero de caché, así que nunca corren a la vez. Encadenar
  // promesas es todo el candado que hace falta estando en un solo proceso.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(onChange: () => void) {
    this.onChange = onChange;
  }

  start(): void {
    if (this.sweepTimer) return;
    this.stopped = false;

    this.bindRoots();
    // Un ciclo al arrancar: recoge todo lo que se instaló con la app
    // cerrada. Sin prisa — nada de esto bloquea el arranque.
    this.schedule(5_000);
    this.sweepTimer = setInterval(() => this.schedule(0), SWEEP_INTERVAL_MS);
  }

  stop(): void {
    this.stopped = true;
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.sweepTimer = null;
    this.debounceTimer = null;
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
  }

  // Las raíces han cambiado en caliente (el usuario añadió o quitó una
  // carpeta en Add Game). Se reengancha la vigilancia y se mira ya: acabar
  // de señalar una carpeta y que no pase nada durante cinco minutos sería
  // exactamente el momento en que esto parece roto.
  rootsChanged(): void {
    this.bindRoots();
    this.schedule(0);
  }

  // El botón de Scan. Rehace TODO sin mirar la caché — es la vía de escape
  // para cuando algo no cuadra, y por eso ignora todas las optimizaciones
  // de arriba a propósito.
  force(): Promise<void> {
    return this.enqueue(() => this.reconcile(true));
  }

  private bindRoots(): void {
    // Tras stop() no se reengancha nada: un reconcile que estuviera en cola
    // al cerrar la app volvería a crear aquí los FSWatcher que stop() acaba
    // de cerrar, y se quedarían vivos con la app "apagada".
    if (this.stopped) return;
    const roots = getConfigValue('scanFolders');

    for (const [root, watcher] of this.watchers) {
      if (roots.includes(root)) continue;
      watcher.close();
      this.watchers.delete(root);
    }

    for (const root of roots) {
      if (this.watchers.has(root)) continue;
      try {
        // Sin `recursive`: solo interesan las altas y bajas de carpetas de
        // primer nivel, que es justo lo que reporta el modo normal.
        const watcher = watch(root, { persistent: false }, () => this.schedule(DEBOUNCE_MS));
        // Disco desenchufado o carpeta borrada: se suelta y ya lo volverá a
        // enganchar un barrido cuando vuelva a existir.
        watcher.on('error', () => {
          watcher.close();
          this.watchers.delete(root);
        });
        this.watchers.set(root, watcher);
      } catch {
        // La raíz no existe ahora mismo. No es un error: el barrido lo
        // reintenta cada pocos minutos.
      }
    }
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.enqueue(() => this.reconcile(false));
    }, delayMs);
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    // Un ciclo que falla no puede envenenar la cola de los siguientes.
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async reconcile(force: boolean): Promise<void> {
    const roots = getConfigValue('scanFolders');
    if (roots.length === 0) return;

    // Reengancha raíces que hayan vuelto a aparecer (disco enchufado otra
    // vez) — barato y evita depender solo del evento que ya se perdió.
    this.bindRoots();

    const { folders: listed, unreadableRoots } = await listGameFolders(roots);
    const refs = listed.sort(byFolderName).slice(0, MAX_FOLDERS);
    if (listed.length > refs.length) {
      console.warn(
        `[scan] ${listed.length} carpetas encontradas; se procesan las ${MAX_FOLDERS} primeras`,
      );
    }

    let changed = false;

    // Bajas: lo que estaba cacheado bajo estas raíces y ya no está en disco
    // (juego desinstalado, carpeta renombrada). SOLO bajo las raíces que se
    // pudieron leer: un disco desenchufado hace que sus carpetas no salgan
    // en el listado, y sin esta distinción se borraban todas como si el
    // usuario hubiera desinstalado la biblioteca entera — y re-enchufarlo
    // costaba reescanearla y volver a pedírsela a IGDB.
    const readableRoots = roots.filter((root) => !unreadableRoots.includes(root));
    // "Sigue en disco" se decide con el listado COMPLETO, no con `refs` (que
    // está recortado a MAX_FOLDERS). El tope acota cuánto se procesa por
    // IGDB, nunca qué se considera presente: una carpeta real que caiga más
    // allá de la 300ª se veía como "desaparecida", se echaba de la caché y —
    // como nunca vuelve a entrar en refs— no se reescaneaba jamás. Las
    // carpetas de la cola se esfumaban de Add Game > Scan con el contador aún
    // por encima del tope.
    const live = new Set(listed.map((ref) => pathKey(ref.path)));
    const gone = getCachedEntries(readableRoots).filter(
      (entry) => !live.has(pathKey(entry.folder.path)),
    );
    if (gone.length > 0) {
      dropCachedEntries(gone.map((entry) => entry.folder.path));
      changed = true;
    }

    const now = Date.now();
    const pending = force
      ? refs
      : refs.filter((ref) => {
          const entry = getCachedEntry(ref.path);
          return needsDescribe(entry, now) || needsMatch(entry, now);
        });

    // El tope por ciclo NO se aplica al botón: quien lo pulsa está esperando
    // a que termine, y devolverle un tercio de su biblioteca diciendo
    // "listo" sería mentirle. En segundo plano sí se trocea, porque ahí
    // nadie espera y lo que importa es no dar un tirón de disco y de cuota
    // de IGDB la primera vez que se señala una carpeta llena.
    const batch = force ? pending : pending.slice(0, MAX_NEW_PER_CYCLE);
    const leftover = pending.length - batch.length;
    if (leftover > 0) {
      console.log(`[scan] ${pending.length} carpetas por revisar; ${batch.length} en este ciclo`);
    }

    if (batch.length > 0) {
      const scanned = await this.scanBatch(batch, force, now);
      if (scanned.length > 0) {
        putCachedEntries(scanned);
        changed = true;
      }
    }

    if (changed) this.onChange();
    // Quedan carpetas sin mirar: se sigue enseguida en vez de esperar cinco
    // minutos por tanda. Con una biblioteca recién señalada, esa espera
    // convertiría "unos segundos" en más de una hora.
    if (leftover > 0) this.schedule(15_000);
  }

  private async scanBatch(refs: FolderRef[], force: boolean, now: number): Promise<CacheEntry[]> {
    // Primero el disco, que es barato en comparación y no gasta cuota. Se
    // separa QUÉ hay que mirar por dentro de mirarlo, para que el recorrido
    // vaya por describeFolders — que limita cuántas carpetas se recorren a
    // la vez en lugar de soltarlas todas contra el disco de golpe.
    const withEntries = refs.map((ref) => ({ ref, entry: getCachedEntry(ref.path) }));
    const toDescribe = withEntries.filter(({ entry }) => force || needsDescribe(entry, now));
    const freshFolders = await describeFolders(toDescribe.map(({ ref }) => ref));
    const folderByPath = new Map(
      toDescribe.map(({ ref }, index) => [ref.path, freshFolders[index]]),
    );

    // Sin entrada previa, needsDescribe() devolvió true y la carpeta está en
    // el mapa — el filtro de abajo nunca tira nada real, solo convence al
    // compilador de que folder existe.
    const described = withEntries.flatMap(({ ref, entry }) => {
      const folder = folderByPath.get(ref.path) ?? entry?.folder;
      return folder ? [{ entry, folder }] : [];
    });

    // Solo se le pregunta a IGDB por lo que no tiene respuesta guardada. Al
    // instalar un juego esto es UNA búsqueda, no la biblioteca entera.
    const needed = described.filter(({ entry }) => force || needsMatch(entry, now));
    const found = await matchFolderNames(needed.map(({ folder }) => folder.folderName));
    const byPath = new Map(needed.map(({ folder }, index) => [folder.path, found[index]]));

    const stamp = new Date().toISOString();

    return described.map(({ entry, folder }) => {
      const fresh = byPath.get(folder.path);
      // Se guarda SIEMPRE lo que dice el disco: el tamaño y el .exe son
      // ciertos haya red o no. Lo de IGDB solo se pisa si de verdad
      // contestó — si falló, se conserva lo que hubiera y `matchedAt` se
      // queda como estaba, que es lo que hará que se reintente enseguida en
      // vez de dar la carpeta por "no es un juego".
      const answered = fresh !== undefined && !fresh.failed;

      return {
        // La primera vez que se vio NO se pisa: es el ancla de la ventana de
        // "instalación a medias" (needsDescribe) y actualizarla la volvería
        // infinita.
        firstSeenAt: entry?.firstSeenAt ?? entry?.scannedAt ?? stamp,
        scannedAt: stamp,
        folder,
        matches: answered ? fresh.matches : (entry?.matches ?? []),
        matchedAt: answered ? stamp : (entry?.matchedAt ?? null),
      };
    });
  }
}
