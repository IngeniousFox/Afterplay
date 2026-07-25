import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { toSlashes } from './paths';

// Capa POR MÁQUINA de las partidas guardadas (PARTIDAS-GUARDADAS.md §7.2):
// un fichero plano en userData que NO sincroniza nunca.
//
// Esta separación es la decisión estructural de toda la función. La BD de
// Afterplay viaja entre PCs por Turso, así que cualquier ruta que se guarde
// ahí aparece en el otro PC apuntando a una carpeta que no existe — y el
// backup falla en silencio o, peor, escribe donde no debe. Todo lo que sea
// un hecho sobre ESTE ordenador (su nombre de usuario, dónde tiene instalado
// un juego, cómo se llama la máquina) vive aquí y solo aquí.

export type MachineSaveOverride = {
  // Dónde viven las partidas de ese juego EN ESTA MÁQUINA. Al restaurar se
  // traduce con un redirect desde lo que traiga el backup, venga del PC que
  // venga (§10bis.5).
  target: string;
  setAt: string;
};

type MachineSavesFile = {
  version: 1;
  machineId: string;
  machineName: string;
  home: string;
  // Clave: gameId como string (JSON no admite claves numéricas).
  saveLocationOverrides: Record<string, MachineSaveOverride>;
};

const getFilePath = (): string => join(app.getPath('userData'), 'machine-saves.json');

const createDefaults = (): MachineSavesFile => ({
  version: 1,
  machineId: randomUUID(),
  // Nombre legible del PC — es lo que se enseña en "última copia desde
  // PC-Jon", que es toda la información que un humano necesita para decidir
  // en un conflicto. El uuid es para las comparaciones, no para la vista.
  machineName: process.env.COMPUTERNAME?.trim() || 'Este PC',
  home: toSlashes(homedir()),
  saveLocationOverrides: {},
});

let cached: MachineSavesFile | null = null;

const write = (file: MachineSavesFile): void => {
  cached = file;
  writeFileSync(getFilePath(), `${JSON.stringify(file, null, 2)}\n`);
};

const read = (): MachineSavesFile => {
  if (cached) return cached;

  let file: MachineSavesFile;
  try {
    const parsed = JSON.parse(readFileSync(getFilePath(), 'utf-8')) as Partial<MachineSavesFile>;
    file = { ...createDefaults(), ...parsed };
    // El home puede haber cambiado (cuenta de Windows renombrada, perfil
    // movido) — manda siempre el del sistema, porque es el que se usa para
    // generar los redirects de restauración.
    file.home = toSlashes(homedir());
  } catch {
    // Primer arranque o fichero corrupto: se regenera. Perder los overrides
    // solo significa que el usuario vuelve a elegir carpeta si hacía falta;
    // ninguna partida se pierde por esto.
    file = createDefaults();
  }
  write(file);
  return file;
};

export const getMachineId = (): string => read().machineId;
export const getMachineName = (): string => read().machineName;
export const getMachineHome = (): string => read().home;

export const getSaveLocationOverride = (gameId: number): MachineSaveOverride | null =>
  read().saveLocationOverrides[String(gameId)] ?? null;

export const setSaveLocationOverride = (gameId: number, target: string | null): void => {
  const file = read();
  const overrides = { ...file.saveLocationOverrides };
  if (target)
    overrides[String(gameId)] = { target: toSlashes(target), setAt: new Date().toISOString() };
  else delete overrides[String(gameId)];
  write({ ...file, saveLocationOverrides: overrides });
};
