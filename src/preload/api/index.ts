import { backupApi } from './backup';
import { curiositiesApi } from './curiosities';
import { dialogApi } from './dialog';
import { emulatorsApi } from './emulators';
import { gamesApi } from './games';
import { hltbApi } from './hltb';
import { igdbApi } from './igdb';
import { imagesApi } from './images';
import { iterationsApi } from './iterations';
import { savesApi } from './saves';
import { scanApi } from './scan';
import { sessionEpiloguesApi } from './sessionEpilogues';
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
  backup: backupApi,
  games: gamesApi,
  emulators: emulatorsApi,
  iterations: iterationsApi,
  sessions: sessionsApi,
  sessionEpilogues: sessionEpiloguesApi,
  stateEvents: stateEventsApi,
  spend: spendApi,
  igdb: igdbApi,
  hltb: hltbApi,
  sgdb: sgdbApi,
  images: imagesApi,
  saves: savesApi,
  scan: scanApi,
  watcher: watcherApi,
  settings: settingsApi,
  curiosities: curiositiesApi,
};

export type Api = typeof api;
