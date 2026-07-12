import { registerGamesHandlers } from './games';
import { registerWindowHandlers } from './window';

// Punto de entrada único: main/index.ts llama a esto una vez y listo.
// Dominio nuevo (iterations, sessions, spend, igdb...) = archivo propio con su
// registerXxxHandlers() + añadirlo aquí abajo.
export function registerIpcHandlers(): void {
  registerWindowHandlers();
  registerGamesHandlers();
}
