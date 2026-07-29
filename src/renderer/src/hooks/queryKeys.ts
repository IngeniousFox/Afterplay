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
    identityNeeded: ['saves', 'identityNeeded'] as const,
    game: (gameId: number) => ['saves', 'game', gameId] as const,
  },
  igdb: {
    search: (query: string) => ['igdb', 'search', query] as const,
    details: (igdbId: number | null) => ['igdb', 'details', igdbId] as const,
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
  settings: {
    openAtLogin: ['settings', 'openAtLogin'] as const,
    timeFormat: ['settings', 'timeFormat'] as const,
    ambientIdleMinutes: ['settings', 'ambientIdleMinutes'] as const,
    credentials: ['settings', 'credentials'] as const,
  },
};
