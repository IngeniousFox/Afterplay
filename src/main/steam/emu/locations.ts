import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { EmuUnlock } from './parsers';
import {
  parse3Dm,
  parseCreamApi,
  parseDefaultIni,
  parseGoldbergJson,
  parseOnlineFix,
  parseRazor1911,
  parseRld,
  parseSkidrow,
  parseUserStats,
} from './parsers';

// Dónde escribe cada emulador de Steam sus desbloqueos (LOGROS.md §7).
// Portado del mapa de Hydra (find-achievement-files.ts, MIT) — años de prueba
// y error de su comunidad sobre dónde guarda cada crack sus cosas.
//
// Dos familias de rutas:
//   · Por APPID en carpetas del sistema (la mayoría): <base>/<appid>/...
//   · Junto al EXE del juego (userstats, 3DM): <carpeta del exe>/...
//
// App solo-Windows, así que las bases salen de las variables de entorno de
// Windows directamente — sin capa multiplataforma que aquí no aplica.

export type EmuFile = {
  emu: string;
  filePath: string;
  parse: (filePath: string) => EmuUnlock[];
};

type AppIdLocation = {
  emu: string;
  base: string;
  // Segmentos tras <base>/<appid>/ hasta el fichero.
  tail: string[];
  parse: (filePath: string) => EmuUnlock[];
};

const env = (name: string): string => process.env[name] ?? '';

// Las bases se calculan en cada llamada (no como const de módulo) a
// propósito: es barato, y así un test puede manipular el entorno.
const appIdLocations = (): AppIdLocation[] => {
  const appData = env('APPDATA');
  const localAppData = env('LOCALAPPDATA');
  const programData = env('ProgramData');
  const publicDocs = join(env('PUBLIC') || 'C:\\Users\\Public', 'Documents');
  const documents = join(env('USERPROFILE'), 'Documents');

  return [
    {
      emu: 'CODEX',
      base: join(publicDocs, 'Steam', 'CODEX'),
      tail: ['achievements.ini'],
      parse: parseDefaultIni,
    },
    {
      emu: 'CODEX',
      base: join(appData, 'Steam', 'CODEX'),
      tail: ['achievements.ini'],
      parse: parseDefaultIni,
    },
    {
      emu: 'RUNE',
      base: join(publicDocs, 'Steam', 'RUNE'),
      tail: ['achievements.ini'],
      parse: parseDefaultIni,
    },
    { emu: 'RLE', base: join(appData, 'RLE'), tail: ['achievements.ini'], parse: parseDefaultIni },
    { emu: 'RLE', base: join(appData, 'RLE'), tail: ['Achievements.ini'], parse: parseDefaultIni },
    {
      emu: 'OnlineFix',
      base: join(publicDocs, 'OnlineFix'),
      tail: ['Stats', 'Achievements.ini'],
      parse: parseOnlineFix,
    },
    {
      emu: 'OnlineFix',
      base: join(publicDocs, 'OnlineFix'),
      tail: ['Achievements.ini'],
      parse: parseOnlineFix,
    },
    {
      emu: 'Goldberg',
      base: join(appData, 'Goldberg SteamEmu Saves'),
      tail: ['achievements.json'],
      parse: parseGoldbergJson,
    },
    {
      emu: 'GSE',
      base: join(appData, 'GSE Saves'),
      tail: ['achievements.json'],
      parse: parseGoldbergJson,
    },
    {
      emu: 'EMPRESS',
      base: join(appData, 'EMPRESS', 'remote'),
      tail: ['achievements.json'],
      parse: parseGoldbergJson,
    },
    { emu: 'RLD!', base: join(programData, 'RLD!'), tail: ['achievements.ini'], parse: parseRld },
    {
      emu: 'RLD!',
      base: join(programData, 'Steam', 'Player'),
      tail: ['stats', 'achievements.ini'],
      parse: parseRld,
    },
    {
      emu: 'RLD!',
      base: join(programData, 'Steam', 'RLD!'),
      tail: ['stats', 'achievements.ini'],
      parse: parseRld,
    },
    {
      emu: 'DODI',
      base: join(programData, 'Steam', 'dodi'),
      tail: ['stats', 'achievements.ini'],
      parse: parseRld,
    },
    {
      emu: 'SKIDROW',
      base: join(documents, 'SKIDROW'),
      tail: ['SteamEmu', 'UserStats', 'achiev.ini'],
      parse: parseSkidrow,
    },
    {
      emu: 'SKIDROW',
      base: join(documents, 'Player'),
      tail: ['SteamEmu', 'UserStats', 'achiev.ini'],
      parse: parseSkidrow,
    },
    {
      emu: 'SKIDROW',
      base: join(localAppData, 'SKIDROW'),
      tail: ['SteamEmu', 'UserStats', 'achiev.ini'],
      parse: parseSkidrow,
    },
    {
      emu: 'CreamAPI',
      base: join(appData, 'CreamAPI'),
      tail: ['stats', 'CreamAPI.Achievements.cfg'],
      parse: parseCreamApi,
    },
    {
      emu: 'SmartSteamEmu',
      base: join(appData, 'SmartSteamEmu'),
      tail: ['User', 'Achievements.ini'],
      parse: parseDefaultIni,
    },
    {
      emu: 'Razor1911',
      base: join(appData, '.1911'),
      tail: ['achievement'],
      parse: parseRazor1911,
    },
  ];
};

// EMPRESS tiene una segunda forma con el appid repetido:
// <publicDocs>/EMPRESS/<appid>/remote/<appid>/achievements.json — se trata
// aparte porque el <appid> aparece dos veces y el modelo de tail no lo cubre.
const empressPublicFile = (appId: number): string =>
  join(
    env('PUBLIC') || 'C:\\Users\\Public',
    'Documents',
    'EMPRESS',
    String(appId),
    'remote',
    String(appId),
    'achievements.json',
  );

// Las carpetas base que EXISTEN en este PC, sin repetir. Es lo que hay que
// vigilar para enterarse en vivo de un desbloqueo: son cuatro o cinco rutas
// locales, no una por juego.
export const existingEmuBases = (): string[] => {
  const bases = new Set<string>();
  for (const location of appIdLocations()) {
    if (existsSync(location.base)) bases.add(location.base);
  }
  return [...bases];
};

// Los ficheros de desbloqueos que existen AHORA MISMO para un juego concreto.
export const findEmuFilesForGame = (appId: number, executablePath: string | null): EmuFile[] => {
  const files: EmuFile[] = [];

  for (const location of appIdLocations()) {
    const filePath = join(location.base, String(appId), ...location.tail);
    if (existsSync(filePath)) files.push({ emu: location.emu, filePath, parse: location.parse });
  }

  const empress = empressPublicFile(appId);
  if (existsSync(empress))
    files.push({ emu: 'EMPRESS', filePath: empress, parse: parseGoldbergJson });

  // Las dos fuentes que viven JUNTO AL EXE, no en carpetas del sistema.
  if (executablePath) {
    const exeDir = dirname(executablePath);
    const userStats = join(exeDir, 'SteamData', 'user_stats.ini');
    if (existsSync(userStats)) {
      files.push({ emu: 'userstats', filePath: userStats, parse: parseUserStats });
    }
    const threeDm = join(exeDir, '3DMGAME', 'Player', 'stats', 'achievements.ini');
    if (existsSync(threeDm)) files.push({ emu: '3DM', filePath: threeDm, parse: parse3Dm });
  }

  return files;
};
