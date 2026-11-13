// games:update en 2.0. El patch del modal de editar (`UpdateGamePatch`) ya lo
// reparte `common/updateGame.ts`, que se reexporta tal cual: no se reescribe.
//
// El patch INTERNO de partidas guardadas (el que hoy `ipc/saves.ts` manda por
// `updateGame` con el tipo abierto `GamePatch`) NO está aquí: es
// `saves/updateSaveSettings` con el tipo cerrado `SaveSettingsPatch` de
// `shared/types.ts`, más las funciones por handler de `saves/saveGames.ts`.
// Hubo una segunda copia en este paquete (`updateGameSaves`); se quitó en la
// integración para que las columnas `save*` tengan un solo escritor.
export { updateGame } from '../common';
