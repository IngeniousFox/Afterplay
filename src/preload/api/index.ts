import { gamesApi } from './games';
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
};

export type Api = typeof api;
