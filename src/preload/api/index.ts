import { dialogApi } from './dialog';
import { gamesApi } from './games';
import { hltbApi } from './hltb';
import { igdbApi } from './igdb';
import { imagesApi } from './images';
import { iterationsApi } from './iterations';
import { sessionsApi } from './sessions';
import { settingsApi } from './settings';
import { sgdbApi } from './sgdb';
import { spendApi } from './spend';
import { stateEventsApi } from './stateEvents';
import { watcherApi } from './watcher';
import { windowApi } from './window';

export const api = {
  window: windowApi,
  dialog: dialogApi,
  games: gamesApi,
  iterations: iterationsApi,
  sessions: sessionsApi,
  stateEvents: stateEventsApi,
  spend: spendApi,
  igdb: igdbApi,
  hltb: hltbApi,
  sgdb: sgdbApi,
  images: imagesApi,
  watcher: watcherApi,
  settings: settingsApi,
};

export type Api = typeof api;
