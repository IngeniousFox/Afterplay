// Puente mínimo entre el watcher y quien necesite saber si un juego está
// corriendo AHORA. Existe para una regla concreta de las partidas guardadas
// (PARTIDAS-GUARDADAS.md §10bis.3): nunca restaurar con el juego abierto —
// escribir por debajo de un proceso vivo corrompe la partida, o el juego la
// sobrescribe al salir.
//
// Es una sonda inyectada y no un import directo del watcher a propósito: el
// watcher ya tiene el dato en memoria (su mapa de sesiones activas) y no
// hace falta ni consultar la BD ni escanear procesos otra vez. main/index.ts
// la conecta al crear el watcher.

let probe: (gameId: number) => boolean = () => false;

export const setRunningGamesProbe = (next: (gameId: number) => boolean): void => {
  probe = next;
};

export const isGameRunning = (gameId: number): boolean => {
  try {
    return probe(gameId);
  } catch {
    return false;
  }
};
