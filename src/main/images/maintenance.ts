import { existsSync } from 'fs';
import { readdir, rm, stat } from 'fs/promises';
import { isNotNull } from 'drizzle-orm';
import { join } from 'path';
import { getDb } from '../db';
import { achievementsTable, gamesTable } from '../db/schema';
import type { ImageCacheType, ImageCacheUsage, ImageRedownloadEvent } from '../../shared/types';
import {
  IMAGE_CACHE_TYPES,
  cacheImage,
  cachedFilePathFor,
  forgetPermanentFailures,
  getImageCacheDir,
} from './cache';

// Mantenimiento de la caché de imágenes: cuánto ocupa, qué sobra y volver a
// bajarlo todo. Es local del todo — estas carpetas viven en userData, no
// viajan a Turso, así que nada de lo que se haga aquí toca a la biblioteca.
//
// La idea de fondo: la caché NO es un dato tuyo, es una copia de algo que
// está en internet. Borrarla no pierde nada, solo obliga a volver a
// descargar. Por eso los dos botones pueden ser tan directos.

// Una imagen "en uso" es una a la que apunta HOY la base de datos. Solo hay
// tres sitios de los que salgan URLs guardadas: la carátula y el hero de
// cada juego, y los dos iconos (color y gris) de cada logro.
type UsedImage = { url: string; type: ImageCacheType };

const collectUsedImages = async (): Promise<UsedImage[]> => {
  const db = getDb();
  const games = await db
    .select({ coverUrl: gamesTable.coverUrl, heroUrl: gamesTable.heroUrl })
    .from(gamesTable);
  const achievements = await db
    .select({ iconUrl: achievementsTable.iconUrl, iconGrayUrl: achievementsTable.iconGrayUrl })
    .from(achievementsTable)
    .where(isNotNull(achievementsTable.iconUrl));

  const used: UsedImage[] = [];
  for (const game of games) {
    if (game.coverUrl) used.push({ url: game.coverUrl, type: 'covers' });
    if (game.heroUrl) used.push({ url: game.heroUrl, type: 'heroes' });
  }
  for (const achievement of achievements) {
    if (achievement.iconUrl) used.push({ url: achievement.iconUrl, type: 'achievements' });
    if (achievement.iconGrayUrl) used.push({ url: achievement.iconGrayUrl, type: 'achievements' });
  }

  // El mismo icono se repite entre juegos (los grises por defecto de Steam,
  // sobre todo) y dos juegos pueden compartir carátula: sin esto, el total
  // de la redescarga contaría dos veces ficheros que son uno solo.
  const seen = new Set<string>();
  return used.filter((image) => {
    const key = `${image.type}:${image.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// Cada huérfano viaja con su tamaño: el borrado de cleanUnusedImages ya lo
// sabe de este recorrido y no tiene que volver a preguntárselo al disco (eran
// 2.606 stat() repetidos en la biblioteca real).
type Orphan = { path: string; size: number };

type FolderScan = {
  type: ImageCacheType;
  bytes: number;
  files: number;
  orphans: Orphan[];
  orphanBytes: number;
};

// El stat() de cada fichero va en TANDAS, no de uno en uno. Medido sobre la
// carpeta real de logros (49.725 ficheros): en serie 4.496 ms, en tandas de
// 256 son 631 ms — 7x. No es que el disco vaya más rápido: es que un `await
// stat()` dentro de un bucle gasta una vuelta entera del bucle de eventos por
// fichero para un trabajo que libuv hace en su pool de hilos, así que se pasa
// casi todo el tiempo esperando a despachar el siguiente en vez de leyendo.
// Lanzarlos todos de golpe (50k promesas vivas) da 803 ms; la tanda gana
// porque no infla el pool ni la memoria. 256 es la meseta: con 64 son 773 ms
// y con 1024, 644 — dentro del ruido de medida.
const STAT_BATCH = 256;

const sizesOf = async (paths: string[]): Promise<number[]> => {
  const sizes: number[] = [];
  for (let i = 0; i < paths.length; i += STAT_BATCH) {
    const batch = await Promise.all(
      paths.slice(i, i + STAT_BATCH).map((path) => stat(path).then(({ size }) => size)),
    );
    sizes.push(...batch);
  }
  return sizes;
};

// Recorre una carpeta comparando por RUTA, no por URL: el nombre del fichero
// es un hash, así que desde la carpeta no se puede volver a la URL — pero sí
// ir de cada URL de la base de datos a la ruta que le tocaría.
const scanFolder = async (type: ImageCacheType, used: Set<string>): Promise<FolderScan> => {
  const scan: FolderScan = { type, bytes: 0, files: 0, orphans: [], orphanBytes: 0 };
  const dir = getImageCacheDir(type);
  if (!existsSync(dir)) return scan;

  const entries = await readdir(dir, { withFileTypes: true });
  const paths = entries.filter((entry) => entry.isFile()).map((entry) => join(dir, entry.name));
  const sizes = await sizesOf(paths);

  for (const [index, filePath] of paths.entries()) {
    const size = sizes[index];
    scan.files++;
    scan.bytes += size;
    // Las capturas no salen nunca de la base de datos: se piden a IGDB al
    // abrir la ficha, así que aquí no hay forma de saber cuáles siguen
    // siendo las buenas. Todas cuentan como prescindibles — es la única
    // carpeta puramente desechable, y se rehace sola al mirar un juego.
    if (type === 'screenshots' || !used.has(filePath)) {
      scan.orphans.push({ path: filePath, size });
      scan.orphanBytes += size;
    }
  }
  return scan;
};

type CacheScan = { used: UsedImage[]; folders: FolderScan[] };

const scanCache = async (): Promise<CacheScan> => {
  const used = await collectUsedImages();
  const paths = new Set(used.map((image) => cachedFilePathFor(image.url, image.type)));
  return { used, folders: await Promise.all(IMAGE_CACHE_TYPES.map((t) => scanFolder(t, paths))) };
};

const toUsage = ({ used, folders }: CacheScan): ImageCacheUsage => ({
  totalBytes: folders.reduce((sum, folder) => sum + folder.bytes, 0),
  totalFiles: folders.reduce((sum, folder) => sum + folder.files, 0),
  unusedBytes: folders.reduce((sum, folder) => sum + folder.orphanBytes, 0),
  unusedFiles: folders.reduce((sum, folder) => sum + folder.orphans.length, 0),
  usedImages: used.length,
  byType: folders.map(({ type, bytes, files }) => ({ type, bytes, files })),
});

export const getImageCacheUsage = async (): Promise<ImageCacheUsage> => toUsage(await scanCache());

// Borra lo que ya no apunta a nada y devuelve el hueco liberado, junto con
// el estado en el que queda la caché — así la tarjeta se actualiza con la
// respuesta misma, sin una segunda pasada por las carpetas.
//
// Lo de "sin una segunda pasada" lo decía este comentario desde el principio,
// pero el código hacía justo lo contrario: `toUsage(await scanCache())` al
// final era un recorrido ENTERO más (54.290 stat() sobre la biblioteca real,
// ~5,6 s antes de las tandas de sizesOf y ~1,0 s después) para recalcular
// algo que ya se sabe — lo que queda es lo que había MENOS lo que se acaba de
// borrar, fichero a fichero y con su tamaño. Ahora se descuenta.
export const cleanUnusedImages = async (): Promise<{
  files: number;
  bytes: number;
  usage: ImageCacheUsage;
}> => {
  const scan = await scanCache();

  let files = 0;
  let bytes = 0;
  // Por carpeta, no en un `flatMap` de todas: cada borrado tiene que
  // descontarse de SU tipo para que el desglose de `byType` siga cuadrando.
  const folders: FolderScan[] = [];
  for (const folder of scan.folders) {
    const survivors: Orphan[] = [];
    for (const orphan of folder.orphans) {
      try {
        await rm(orphan.path);
        files++;
        bytes += orphan.size;
      } catch (error) {
        console.warn(`[images] no se pudo borrar ${orphan.path}:`, error);
        // Sigue ocupando sitio y sigue sin usarse: no puede desaparecer del
        // recuento de prescindibles solo porque el borrado fallara.
        survivors.push(orphan);
      }
    }
    const removed = folder.orphanBytes - survivors.reduce((sum, o) => sum + o.size, 0);
    folders.push({
      ...folder,
      bytes: folder.bytes - removed,
      files: folder.files - (folder.orphans.length - survivors.length),
      orphans: survivors,
      orphanBytes: folder.orphanBytes - removed,
    });
  }

  console.log(`[images] limpieza: ${files} ficheros, ${bytes} bytes liberados`);
  return { files, bytes, usage: toUsage({ used: scan.used, folders }) };
};

// ── Redescarga ────────────────────────────────────────────────────────────
// Tira la copia local de cada imagen EN USO y la vuelve a bajar. Es para
// cuando la caché tiene ficheros a medias, o de cuando una URL apuntaba a
// otra cosa: al terminar, lo que hay en disco es lo que hay hoy en el origen.

const REDOWNLOAD_CONCURRENCY = 6;

let redownloading = false;
let notifier: ((event: ImageRedownloadEvent) => void) | null = null;

export const setImagesNotifier = (fn: (event: ImageRedownloadEvent) => void): void => {
  notifier = fn;
};

const emit = (event: ImageRedownloadEvent): void => notifier?.(event);

// Devuelve cuántas imágenes entraron en la pasada; el progreso viaja por
// 'images:activity', porque miles de descargas no caben en un invoke.
export const redownloadUsedImages = async (): Promise<number> => {
  // Dos pasadas a la vez se pisarían el mismo fichero: la segunda lo borra
  // justo cuando la primera lo está escribiendo.
  if (redownloading) return 0;
  redownloading = true;

  // TODO lo que puede fallar va dentro del try, incluido collectUsedImages()
  // (que lee la DB y puede rechazar en pleno swap de conexión): si reventaba
  // ANTES del try, redownloading se quedaba en true para siempre y el botón
  // parecía muerto —cada clic devolvía 0 sin emitir nada— hasta reiniciar.
  let total = 0;
  let done = 0;
  let failed = 0;
  try {
    // Las que fallaron con un 4xx están vetadas en memoria hasta reiniciar la
    // app, y este botón es precisamente el "vuelve a intentarlo todo".
    forgetPermanentFailures();

    const pending = await collectUsedImages();
    total = pending.length;
    emit({ running: true, done: 0, total, failed: 0 });

    const worker = async (): Promise<void> => {
      for (;;) {
        const image = pending.pop();
        if (!image) return;
        try {
          await rm(cachedFilePathFor(image.url, image.type), { force: true });
          await cacheImage(image.url, image.type);
        } catch {
          // Una imagen que ya no exista en origen no debe abortar la pasada:
          // getImageSrc ya sabe apañárselas cuando falta el fichero.
          failed++;
        }
        done++;
        // Un evento por imagen serían miles de mensajes por el puente IPC para
        // mover una barra que avanza de píxel en píxel.
        if (done % 25 === 0 || done === total) emit({ running: true, done, total, failed });
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(REDOWNLOAD_CONCURRENCY, total) }, () => worker()),
    );
  } finally {
    // Siempre: libera el candado y avisa al renderer de que la pasada acabó
    // (aunque acabara por un fallo temprano, con total=0) para que la tarjeta
    // deje de mostrarse ocupada.
    redownloading = false;
    emit({ running: false, done, total, failed });
    console.log(`[images] redescarga: ${done - failed} de ${total} al día (${failed} fallidas)`);
  }
  return total;
};
