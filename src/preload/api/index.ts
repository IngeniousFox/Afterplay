import { achievementsApi } from './achievements';
import { backupApi } from './backup';
import { curiositiesApi } from './curiosities';
import { cutoverApi } from './cutover';
import { dataChangedApi } from './dataChanged';
import { devicesApi } from './devices';
import { dialogApi } from './dialog';
import { emulatorsApi } from './emulators';
import { externalApi } from './external';
import { gamesApi } from './games';
import { hltbApi } from './hltb';
import { igdbApi } from './igdb';
import { imagesApi } from './images';
import { iterationsApi } from './iterations';
import { memoriesApi } from './memories';
import { overlayApi } from './overlay';
import { radarApi } from './radar';
import { savesApi } from './saves';
import { scanApi } from './scan';
import { sessionsApi } from './sessions';
import { settingsApi } from './settings';
import { sgdbApi } from './sgdb';
import { spendApi } from './spend';
import { stateEventsApi } from './stateEvents';
import { statsApi } from './stats';
import { syncApi } from './sync';
import { windowApi } from './window';

export const api = {
  window: windowApi,
  dialog: dialogApi,
  devices: devicesApi,
  backup: backupApi,
  games: gamesApi,
  emulators: emulatorsApi,
  iterations: iterationsApi,
  sessions: sessionsApi,
  stateEvents: stateEventsApi,
  stats: statsApi,
  spend: spendApi,
  igdb: igdbApi,
  external: externalApi,
  hltb: hltbApi,
  sgdb: sgdbApi,
  images: imagesApi,
  saves: savesApi,
  scan: scanApi,
  dataChanged: dataChangedApi,
  settings: settingsApi,
  curiosities: curiositiesApi,
  memories: memoriesApi,
  achievements: achievementsApi,
  radar: radarApi,
  overlay: overlayApi,
  sync: syncApi,
  cutover: cutoverApi,
};

export type Api = typeof api;
