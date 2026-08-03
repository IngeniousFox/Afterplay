import { readFileSync } from 'node:fs';

// Parsers de los ficheros de desbloqueos que escriben los emuladores de Steam
// de los cracks (LOGROS.md §7). Cada crack guarda lo mismo —qué logro, cuándo—
// en un formato distinto, y este archivo los traduce todos a una única forma.
//
// Portados del Achievement System de Hydra (github.com/hydralauncher/hydra,
// MIT), que es el mapa validado por miles de usuarios de dónde y cómo escribe
// cada crack. Las rarezas que más cuesta descubrir a pelo, ya resueltas allí:
//
//   · OnlineFix y CreamAPI guardan a veces el tiempo en un formato de 7
//     dígitos que son segundos PARTIDOS POR MIL — hay que multiplicar por
//     1.000.000, no por 1.000 (comprobado con el fichero real de este PC:
//     TimeUnlocked = 1783855 -> agosto de 2026, no enero de 1970).
//   · RLD! y 3DM codifican estado y tiempo como uint32 little-endian EN HEX
//     dentro de un INI.
//   · Goldberg tiene dos formas de JSON (array y objeto por clave).
//   · SKIDROW mete todo en un solo valor separado por '@'.

export type EmuUnlock = {
  apiName: string;
  // null si el fichero no trae fecha utilizable — el desbloqueo cuenta igual.
  unlockedAt: Date | null;
};

type IniSections = Record<string, Record<string, string>>;

// INI mínimo, calcado del de Hydra: secciones [X], claves k=v, BOM fuera.
// Sin librería: los ficheros de los cracks son demasiado poco estándar para
// un parser estricto (comentarios ###, valores con '=' dentro...).
const parseIni = (filePath: string): IniSections => {
  const content = readFileSync(filePath, 'utf8');
  const lines = (content.charCodeAt(0) === 0xfeff ? content.slice(1) : content).split(/[\r\n]+/);

  const sections: IniSections = {};
  let current = '';
  for (const line of lines) {
    if (!line.length || line.startsWith('###') || line.startsWith(';')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      current = line.slice(1, -1);
      sections[current] = {};
      continue;
    }
    const [key, ...rest] = line.split('=');
    if (rest.length === 0) continue;
    (sections[current] ??= {})[key.trim()] = rest.join('=').trim();
  }
  return sections;
};

const toDate = (ms: number): Date | null => {
  // Un tiempo a 0 o disparatado (antes de 2000, después de mañana) es "sin
  // fecha", no una fecha — mejor null que un logro "desbloqueado en 1970".
  if (!Number.isFinite(ms) || ms < 946_684_800_000 || ms > Date.now() + 86_400_000) return null;
  return new Date(ms);
};

// Segundos con la rareza de OnlineFix/CreamAPI: 7 dígitos = segundos/1000.
const onlineFixSeconds = (raw: string): number =>
  raw.length === 7 ? Number(raw) * 1_000_000 : Number(raw) * 1000;

// uint32 little-endian escrito como hex ("a1b2c3d4") — RLD! y 3DM.
const hexLeUint32 = (raw: string): number => {
  const buffer = Buffer.from(raw, 'hex');
  if (buffer.length < 4) return 0;
  return buffer.readUInt32LE(0);
};

// ── Un parser por formato ──────────────────────────────────────────────────

// CODEX / RUNE / RLE: [ApiName] Achieved=1 UnlockTime=<segundos>.
export const parseDefaultIni = (filePath: string): EmuUnlock[] => {
  const unlocks: EmuUnlock[] = [];
  for (const [apiName, values] of Object.entries(parseIni(filePath))) {
    if (apiName === 'SteamAchievements') continue; // índice de RUNE, no un logro
    if (values.Achieved !== '1') continue;
    unlocks.push({ apiName, unlockedAt: toDate(Number(values.UnlockTime) * 1000) });
  }
  return unlocks;
};

// OnlineFix, en sus dos variantes de mayúsculas (achieved/timestamp y
// Achieved/TimeUnlocked con la rareza de los 7 dígitos).
export const parseOnlineFix = (filePath: string): EmuUnlock[] => {
  const unlocks: EmuUnlock[] = [];
  for (const [apiName, values] of Object.entries(parseIni(filePath))) {
    if (values.achieved === 'true') {
      unlocks.push({ apiName, unlockedAt: toDate(Number(values.timestamp) * 1000) });
    } else if (values.Achieved === 'true') {
      unlocks.push({ apiName, unlockedAt: toDate(onlineFixSeconds(values.TimeUnlocked ?? '0')) });
    }
  }
  return unlocks;
};

// CreamAPI: achieved=true + unlocktime con la misma rareza de 7 dígitos.
export const parseCreamApi = (filePath: string): EmuUnlock[] => {
  const unlocks: EmuUnlock[] = [];
  for (const [apiName, values] of Object.entries(parseIni(filePath))) {
    if (values.achieved !== 'true') continue;
    unlocks.push({ apiName, unlockedAt: toDate(onlineFixSeconds(values.unlocktime ?? '0')) });
  }
  return unlocks;
};

// SKIDROW: [Achievements] ApiName=1@...@<segundos> (el último campo).
export const parseSkidrow = (filePath: string): EmuUnlock[] => {
  const unlocks: EmuUnlock[] = [];
  const achievements = parseIni(filePath).Achievements ?? {};
  for (const [apiName, value] of Object.entries(achievements)) {
    const parts = value.split('@');
    if (parts[0] !== '1') continue;
    unlocks.push({ apiName, unlockedAt: toDate(Number(parts[parts.length - 1]) * 1000) });
  }
  return unlocks;
};

// Goldberg / GSE / EMPRESS: JSON en dos formas — array de objetos con `name`,
// u objeto con el apiName como clave. En ambas, earned + earned_time.
export const parseGoldbergJson = (filePath: string): EmuUnlock[] => {
  const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
  const unlocks: EmuUnlock[] = [];

  const push = (apiName: string, entry: unknown): void => {
    if (typeof entry !== 'object' || entry === null) return;
    const record = entry as Record<string, unknown>;
    if (record.earned !== true) return;
    const seconds = typeof record.earned_time === 'number' ? record.earned_time : 0;
    unlocks.push({ apiName, unlockedAt: toDate(seconds * 1000) });
  };

  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      const name = (entry as Record<string, unknown>)?.name;
      if (typeof name === 'string') push(name, entry);
    }
  } else if (typeof parsed === 'object' && parsed !== null) {
    for (const [apiName, entry] of Object.entries(parsed)) push(apiName, entry);
  }
  return unlocks;
};

// RLD!: State y Time como uint32 LE en hex. State 1 = desbloqueado.
export const parseRld = (filePath: string): EmuUnlock[] => {
  const unlocks: EmuUnlock[] = [];
  for (const [apiName, values] of Object.entries(parseIni(filePath))) {
    if (apiName === 'Steam') continue;
    if (!values.State || hexLeUint32(values.State) !== 1) continue;
    unlocks.push({ apiName, unlockedAt: toDate(hexLeUint32(values.Time ?? '') * 1000) });
  }
  return unlocks;
};

// 3DM: secciones State/Time paralelas; "0101" = desbloqueado.
export const parse3Dm = (filePath: string): EmuUnlock[] => {
  const sections = parseIni(filePath);
  const states = sections.State ?? {};
  const times = sections.Time ?? {};
  const unlocks: EmuUnlock[] = [];
  for (const [apiName, state] of Object.entries(states)) {
    if (state !== '0101') continue;
    unlocks.push({ apiName, unlockedAt: toDate(hexLeUint32(times[apiName] ?? '') * 1000) });
  }
  return unlocks;
};

// user_stats.ini (junto al exe): [ACHIEVEMENTS] "Name"=(unlocked = true, time = N).
export const parseUserStats = (filePath: string): EmuUnlock[] => {
  const achievements = parseIni(filePath).ACHIEVEMENTS ?? {};
  const unlocks: EmuUnlock[] = [];
  for (const [rawName, value] of Object.entries(achievements)) {
    const time = Number(value.slice(1, -1).replace('unlocked = true, time = ', ''));
    if (Number.isNaN(time)) continue;
    unlocks.push({ apiName: rawName.replace(/"/g, ''), unlockedAt: toDate(time * 1000) });
  }
  return unlocks;
};

// Razor1911: texto plano, una línea por logro: "ApiName 1 <segundos>".
export const parseRazor1911 = (filePath: string): EmuUnlock[] => {
  const content = readFileSync(filePath, 'utf8');
  const lines = (content.charCodeAt(0) === 0xfeff ? content.slice(1) : content).split(/[\r\n]+/);
  const unlocks: EmuUnlock[] = [];
  for (const line of lines) {
    if (!line.length) continue;
    const [apiName, unlocked, seconds] = line.split(' ');
    if (unlocked !== '1') continue;
    unlocks.push({ apiName, unlockedAt: toDate(Number(seconds) * 1000) });
  }
  return unlocks;
};
