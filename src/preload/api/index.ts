import { gamesApi } from './games';
import { igdbApi } from './igdb';
import { iterationsApi } from './iterations';
import { sessionsApi } from './sessions';
import { spendApi } from './spend';
import { stateEventsApi } from './stateEvents';
import { windowApi } from './window';

export const api = {
  window: windowApi,
  games: gamesApi,
  iterations: iterationsApi,
  sessions: sessionsApi,
  stateEvents: stateEventsApi,
  spend: spendApi,
  igdb: igdbApi,
};

export type Api = typeof api;
