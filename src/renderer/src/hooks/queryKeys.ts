import type { GetSgdbImagesInput } from '../../../shared/types';

// TanStack Query invalida por PREFIJO: invalidar ['games'] invalida también
// ['games', 5], ['games', 5, 'spend']... cualquier key que empiece igual.
// Por eso casi ninguna mutation necesita saber la key exacta de lo que
// afecta — con invalidar games.all (['games']) ya cascada a todo lo demás.
export const queryKeys = {
  games: {
    all: ['games'] as const,
    detail: (id: number) => ['games', id] as const,
    // Bajo el prefijo ['games'] a propósito: cualquier mutation que ya
    // invalide games.all refresca también la lista del Plan sin tocarla.
    planned: ['games', 'planned'] as const,
  },
  sessions: {
    all: ['sessions'] as const,
    // Bajo el prefijo ['sessions'] a propósito — cualquier invalidación de
    // sessions.all (mutations, useWatcherSync) refresca también la bandeja.
    pending: ['sessions', 'pending'] as const,
  },
  emulators: {
    all: ['emulators'] as const,
  },
  spend: {
    all: ['spend'] as const,
  },
  stateEvents: {
    all: ['stateEvents'] as const,
  },
  // Partidas guardadas. `game(id)` cuelga del prefijo ['saves'] a propósito:
  // cualquier mutation que invalide saves.all refresca también la sección
  // abierta del juego que se esté mirando.
  saves: {
    all: ['saves'] as const,
    status: ['saves', 'status'] as const,
    legal: ['saves', 'legal'] as const,
    usage: ['saves', 'usage'] as const,
    localUsage: ['saves', 'localUsage'] as const,
    identityNeeded: ['saves', 'identityNeeded'] as const,
    game: (gameId: number) => ['saves', 'game', gameId] as const,
  },
  // El resultado del escaneo de "Game saves" en Ajustes — FUERA del árbol de
  // saves.* a propósito: no tiene queryFn de verdad (no hay "dame el último
  // escaneo" en el main, ver useSavesScanResults), así que si viviera bajo
  // saves.all, cualquiera de las muchas mutations que invalidan ese prefijo
  // entero (backup, detect, restore...) lo marcaría "stale" y el próximo
  // remount lo pisaría con el hueco vacío en vez de conservar el escaneo.
  savesLibraryScan: {
    results: ['savesLibraryScan', 'results'] as const,
  },
  igdb: {
    search: (query: string) => ['igdb', 'search', query] as const,
    details: (igdbId: number | null) => ['igdb', 'details', igdbId] as const,
    // Los juegos de una saga. La key es la lista de colecciones YA ordenada
    // (ver useCollectionGames): la misma pregunta, una sola entrada.
    collection: (collectionIds: number[]) => ['igdb', 'collection', collectionIds] as const,
  },
  // Datos externos de la biblioteca (PLAN-TO-PLAY.md 5): el estado que
  // pinta la tarjeta de Ajustes. Los datos en si no viven aqui — van en la
  // fila de cada juego, bajo ['games'].
  // El radar de secuelas (PLAN-TO-PLAY.md 4): los descubrimientos de la
  // pasada semanal, que alimentan la segunda fuente del horizonte del Plan.
  radar: {
    all: ['radar'] as const,
  },
  external: {
    status: ['external', 'status'] as const,
    // El ultimo evento de progreso de la pasada. No es una query de verdad
    // (no hay nada que "pedir": su unico origen es el evento del main) — vive
    // en la cache porque la cache SOBREVIVE a los desmontajes, que es justo
    // lo que le faltaba al estado local: cerrar Ajustes o cambiar de pantalla
    // no puede perder de vista una pasada que dura minutos.
    activity: ['external', 'activity'] as const,
  },
  hltb: {
    times: (title: string, releaseYear: number | null) => ['hltb', title, releaseYear] as const,
  },
  sgdb: {
    images: (input: GetSgdbImagesInput) => ['sgdb', 'images', input] as const,
  },
  scan: {
    folders: ['scan', 'folders'] as const,
    // Sin las carpetas dentro de la key: el resultado ya no depende de lo
    // que se le pase al escaneo, sale de una caché en el main que el propio
    // main mantiene al día (scan/watcher.ts). Cambiar las carpetas invalida
    // esta key a mano, igual que hace el aviso 'scan:changed'.
    results: ['scan', 'results'] as const,
  },
  // Curiosidades de juego (modo ambiente). `status` bajo el mismo prefijo:
  // invalidar curiosities.all refresca también la tarjeta de Ajustes.
  curiosities: {
    all: ['curiosities'] as const,
    status: ['curiosities', 'status'] as const,
  },
  // Recaps del Loop (AFTERPLAY-LOOP.md §3) — misma gramática que curiosities:
  // `status` bajo el prefijo para que invalidar memories.all refresque
  // también la tarjeta de Ajustes.
  memories: {
    all: ['memories'] as const,
    status: ['memories', 'status'] as const,
  },
  // Logros (LOGROS.md) — misma gramática: `game(id)` y `status` cuelgan del
  // prefijo para que invalidar achievements.all los refresque de una vez.
  achievements: {
    all: ['achievements'] as const,
    status: ['achievements', 'status'] as const,
    game: (gameId: number) => ['achievements', 'game', gameId] as const,
    // Bajo el prefijo ['achievements'] a propósito: la invalidación de la
    // raíz (useAchievementsActivitySync) la refresca sin saber que existe.
    // El año en la key: cada filtro de Stats es su propia consulta cacheada.
    overview: (year: number | 'all') => ['achievements', 'overview', year] as const,
    sessionUnlocks: ['achievements', 'sessionUnlocks'] as const,
  },
  // Caché local de imágenes (Ajustes → Images). Solo el peso en disco: las
  // imágenes en sí no pasan por TanStack Query, las resuelve useImageSrc.
  images: {
    usage: ['images', 'usage'] as const,
  },
  settings: {
    openAtLogin: ['settings', 'openAtLogin'] as const,
    timeFormat: ['settings', 'timeFormat'] as const,
    ambientIdleMinutes: ['settings', 'ambientIdleMinutes'] as const,
    credentials: ['settings', 'credentials'] as const,
    syncFailure: ['settings', 'syncFailure'] as const,
  },
};
