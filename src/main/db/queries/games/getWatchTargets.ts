import { isNotNull } from 'drizzle-orm';
import { basename } from 'path';
import { getDb } from '../..';
import { gamesTable } from '../../schema';

// Lo que el watcher necesita para reconocer el proceso de un juego.
export type WatchTarget = {
  gameId: number;
  gameTitle: string;
  // Nombre del .exe en minúsculas (basename de executablePath) — Fase 1 del
  // barrido, comparado contra ps-list.
  exeName: string;
  // Ruta completa en minúsculas — Fase 2, verificada contra el cmd del pid.
  exePath: string;
};

// Se vigilan TODOS los juegos que tengan executablePath, sin filtrar por
// estado: nunca se sabe cuándo un juego en pausa/beaten/dropped se va a volver
// a abrir, y capturar esa sesión es justo el sentido de la app (SPEC sección
// 7: "da igual quién arrancó el proceso"). Al detectar el arranque, el watcher
// ya se encarga de poner el juego en "Playing" (ver startGameSession). Se
// recalcula cada ciclo (dato minúsculo) para recoger juegos recién añadidos
// sin reiniciar.
export const getWatchTargets = async (): Promise<WatchTarget[]> => {
  const db = getDb();

  const games = await db
    .select({
      id: gamesTable.id,
      title: gamesTable.title,
      executablePath: gamesTable.executablePath,
    })
    .from(gamesTable)
    .where(isNotNull(gamesTable.executablePath));

  const targets: WatchTarget[] = [];
  for (const game of games) {
    if (!game.executablePath) continue;
    targets.push({
      gameId: game.id,
      gameTitle: game.title,
      exeName: basename(game.executablePath).toLowerCase(),
      exePath: game.executablePath.toLowerCase(),
    });
  }

  return targets;
};
