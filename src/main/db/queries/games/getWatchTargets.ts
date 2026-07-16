import { and, eq, isNotNull } from 'drizzle-orm';
import { basename } from 'path';
import { getDb } from '../..';
import { emulatorsTable, gamesTable } from '../../schema';

// Lo que el watcher necesita para reconocer un proceso vigilado — un juego
// nativo o un emulador (EMULADORES.md §4: para el watcher un emulador es un
// .exe más, mismo barrido de dos fases; lo único distinto es qué pasa al
// detectarlo, y eso lo decide `kind`).
export type WatchTarget = {
  // Clave única entre las dos familias ("game:12" / "emu:3") — es la clave
  // del mapa de sesiones activas del watcher, donde juegos y emuladores
  // conviven sin pisarse.
  key: string;
  kind: 'game' | 'emulator';
  // id del juego o del emulador, según kind.
  refId: number;
  title: string;
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
//
// Excepción: los juegos de Plan to Play (planned) — un juego planeado no
// tiene sesiones (por definición aún no lo juegas dentro de la app), así que
// el watcher no debe abrirle una aunque tuviera un exe configurado.
//
// Y ADEMÁS todos los emuladores registrados (Ajustes) — al detectar uno, la
// sesión nace sin juego asignado (ver createEmulatorSession).
export const getWatchTargets = async (): Promise<WatchTarget[]> => {
  const db = getDb();

  const games = await db
    .select({
      id: gamesTable.id,
      title: gamesTable.title,
      executablePath: gamesTable.executablePath,
    })
    .from(gamesTable)
    .where(and(isNotNull(gamesTable.executablePath), eq(gamesTable.planned, false)));

  const emulators = await db
    .select({
      id: emulatorsTable.id,
      name: emulatorsTable.name,
      executablePath: emulatorsTable.executablePath,
    })
    .from(emulatorsTable);

  const targets: WatchTarget[] = [];
  for (const game of games) {
    if (!game.executablePath) continue;
    targets.push({
      key: `game:${game.id}`,
      kind: 'game',
      refId: game.id,
      title: game.title,
      exeName: basename(game.executablePath).toLowerCase(),
      exePath: game.executablePath.toLowerCase(),
    });
  }
  for (const emulator of emulators) {
    targets.push({
      key: `emu:${emulator.id}`,
      kind: 'emulator',
      refId: emulator.id,
      title: emulator.name,
      exeName: basename(emulator.executablePath).toLowerCase(),
      exePath: emulator.executablePath.toLowerCase(),
    });
  }

  return targets;
};
