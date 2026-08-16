import { ipcMain } from 'electron';
import { withDbAccess } from '../db';

type IpcHandler = Parameters<typeof ipcMain.handle>[1];

// Igual que ipcMain.handle, para los dominios que tocan la DB: el handler
// corre dentro de withDbAccess(), así cuenta como query en vuelo y espera si
// hay un swap de conexión en curso (reconexión con Turso en caliente — ver
// attemptSyncUpgrade en db/index.ts). Los dominios sin DB (window, dialog,
// igdb...) siguen usando ipcMain.handle directamente.
// LO QUE AQUÍ NO SE HACE, Y POR QUÉ (para que no se intente otra vez): NO se
// cachea ni se fusiona nada. Es tentador — un 'games:changed' llega a las DOS
// ventanas (la principal y el HUD del overlay, cachés independientes) y cada
// una pide games:getAll por su cuenta: dos veces la misma consulta y 2 x 212 KB
// de clone por evento. Fusionar las llamadas que llegan mientras otra está en
// vuelo ahorraría ~13 ms y 212 KB, y a cambio rompería el contrato de la casa
// ("todo el que escribe avisa"): una mutation que confirma DESPUÉS de que
// arranque la lectura en vuelo dejaría al que invalidó leyendo datos de antes
// de su propia escritura, y la pantalla se quedaría mintiendo hasta el
// siguiente aviso. 13 ms no pagan eso. El ahorro de verdad está en no mandar
// lo que nadie lee (ver la medición en ipc/games.ts), no en mandarlo menos
// veces.
export const handleDb = (channel: string, handler: IpcHandler): void => {
  ipcMain.handle(channel, (event, ...args) => withDbAccess(async () => handler(event, ...args)));
};
