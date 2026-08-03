import { achievementsApi } from './achievements';
import { backupApi } from './backup';
import { curiositiesApi } from './curiosities';
import { dialogApi } from './dialog';
import { emulatorsApi } from './emulators';
import { gamesApi } from './games';
import { hltbApi } from './hltb';
import { igdbApi } from './igdb';
import { imagesApi } from './images';
import { iterationsApi } from './iterations';
import { memoriesApi } from './memories';
import { savesApi } from './saves';
import { scanApi } from './scan';
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
  memories: memoriesApi,
  achievements: achievementsApi,
};

export type Api = typeof api;
