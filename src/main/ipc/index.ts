import { registerGamesHandlers } from './games';
import { registerIterationsHandlers } from './iterations';
import { registerSessionsHandlers } from './sessions';
import { registerSpendHandlers } from './spend';
import { registerStateEventsHandlers } from './stateEvents';
import { registerWindowHandlers } from './window';

// Punto de entrada único: main/index.ts llama a esto una vez y listo.
// Dominio nuevo (igdb...) = archivo propio con su registerXxxHandlers() +
// añadirlo aquí abajo.
export function registerIpcHandlers(): void {
  registerWindowHandlers();
  registerGamesHandlers();
  registerIterationsHandlers();
  registerSessionsHandlers();
  registerStateEventsHandlers();
  registerSpendHandlers();
}
