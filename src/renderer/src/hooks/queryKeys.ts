import type { GetSgdbImagesInput } from '../../../shared/types';

// TanStack Query invalida por PREFIJO: invalidar ['games'] invalida también
// ['games', 5], ['games', 5, 'spend']... cualquier key que empiece igual.
// Por eso casi ninguna mutation necesita saber la key exacta de lo que
// afecta — con invalidar games.all (['games']) ya cascada a todo lo demás.
export const queryKeys = {
  games: {
    all: ['games'] as const,
    detail: (id: number) => ['games', id] as const,
    spend: (gameId: number) => ['games', gameId, 'spend'] as const,
  },
  sessions: {
    all: ['sessions'] as const,
  },
  spend: {
    all: ['spend'] as const,
  },
  stateEvents: {
    all: ['stateEvents'] as const,
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
  settings: {
    openAtLogin: ['settings', 'openAtLogin'] as const,
    timeFormat: ['settings', 'timeFormat'] as const,
  },
};
