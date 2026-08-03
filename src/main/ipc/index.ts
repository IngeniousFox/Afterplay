import { registerAchievementsHandlers } from './achievements';
import { registerBackupHandlers } from './backup';
import { registerCuriositiesHandlers } from './curiosities';
import { registerDialogHandlers } from './dialog';
import { registerEmulatorsHandlers } from './emulators';
import { registerGamesHandlers } from './games';
import { registerHltbHandlers } from './hltb';
import { registerIgdbHandlers } from './igdb';
import { registerImagesHandlers } from './images';
import { registerIterationsHandlers } from './iterations';
import { registerMemoriesHandlers } from './memories';
import { registerSavesHandlers } from './saves';
import { registerScanHandlers } from './scan';
import { registerSessionsHandlers } from './sessions';
import { registerSettingsHandlers } from './settings';
import { registerSgdbHandlers } from './sgdb';
import { registerSpendHandlers } from './spend';
import { registerStateEventsHandlers } from './stateEvents';
import { registerWindowHandlers } from './window';

// Punto de entrada único: main/index.ts llama a esto una vez y listo.
// Dominio nuevo (igdb...) = archivo propio con su registerXxxHandlers() +
// añadirlo aquí abajo.
export const registerIpcHandlers = (): void => {
  registerWindowHandlers();
  registerDialogHandlers();
  registerBackupHandlers();
  registerGamesHandlers();
  registerEmulatorsHandlers();
  registerIterationsHandlers();
  registerSessionsHandlers();
  registerStateEventsHandlers();
  registerSpendHandlers();
  registerIgdbHandlers();
  registerHltbHandlers();
  registerSgdbHandlers();
  registerImagesHandlers();
  registerSavesHandlers();
  registerScanHandlers();
  registerSettingsHandlers();
  registerCuriositiesHandlers();
  registerMemoriesHandlers();
  registerAchievementsHandlers();
};
