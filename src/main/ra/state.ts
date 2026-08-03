import { app } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// La memoria de "qué consolas soportaba RA la última vez que miramos"
// (RETROACHIEVEMENTS.md §6, nivel 1): un JSON en userData, no en la DB — es
// una caché de estado del SERVICIO, no un dato del usuario, y no tiene por
// qué viajar a Turso ni mezclarse con la biblioteca.

type RaState = {
  // IDs de sistemas activos de la última comprobación. Vacío la primera vez:
  // entonces TODO es "nuevo" y el emparejado inicial cubre todas las
  // plataformas de golpe, que es justo lo que toca en el estreno.
  knownConsoleIds: number[];
};

const getFilePath = (): string => join(app.getPath('userData'), 'ra-state.json');

export const readRaState = (): RaState => {
  try {
    const parsed = JSON.parse(readFileSync(getFilePath(), 'utf-8')) as Partial<RaState>;
    return { knownConsoleIds: parsed.knownConsoleIds ?? [] };
  } catch {
    return { knownConsoleIds: [] };
  }
};

export const writeRaState = (state: RaState): void => {
  try {
    writeFileSync(getFilePath(), JSON.stringify(state, null, 2));
  } catch (error) {
    // Sin estado guardado, el próximo arranque re-detecta consolas "nuevas"
    // de más — inofensivo (el emparejado es idempotente), así que no es un
    // error que deba parar nada.
    console.warn('[ra] no se pudo guardar el estado de consolas:', error);
  }
};
