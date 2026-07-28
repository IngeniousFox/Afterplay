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

// Contra qué bucket se comprobó ya la identidad de esta máquina. Existe
// porque el machineId se MINA mucho antes de que haya credenciales de R2:
// nace la primera vez que algo lo pide (abrir la sección Saves de un juego
// basta), así que "adoptar una identidad existente justo antes de generarla"
// nunca llegaría a dispararse — cuando metes las claves, el UUID ya está
// escrito. Separando minar de reconciliar, el disparo pasa a ser "hay R2 y
// su bucket no es el que ya miré", que sí cubre poner las claves después.
//
// Es una CADENA y no un booleano porque cambiar de bucket es cambiar de
// mundo: el nuevo puede tener otras máquinas y otros backups, y toca volver
// a mirar. Y comparar dos cadenas en local no cuesta ni una llamada, así que
// abrir y cerrar la app mil veces sin tocar nada sigue siendo gratis.
export type MachineIdentity = {
  reconciledBucket: string;
  reconciledAt: string;
  // Fecha a partir de la cual esta instalación puede podar en la nube.
  //
  // Existe por un fallo MUY caro: el espejo a R2 borra todo objeto remoto que
  // no esté en la carpeta local de backups (así se replica la retención de
  // ludusavi). Tras reinstalar, esa carpeta está VACÍA — así que al reclamar
  // la carpeta de la instalación anterior, el primer backup daba por
  // "caducadas" todas las versiones viejas y las borraba del bucket. La
  // adopción, cuyo objetivo es salvar esos backups, los destruía.
  //
  // Con esto, lo anterior a la adopción queda protegido: esta instalación no
  // vio nunca esas versiones en local, así que no tiene autoridad para
  // afirmar que la retención las descartó. El coste es algo de espacio (y se
  // pueden borrar a mano desde la lista de versiones); la alternativa era
  // pérdida de datos irreversible.
  pruneFloor?: string | null;
};

type MachineSavesFile = {
  version: 1;
  machineId: string;
  machineName: string;
  home: string;
  identity: MachineIdentity | null;
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
  // Recién minada: todavía no se ha contrastado con ningún bucket. Los
  // ficheros de antes de este campo entran por aquí al hacer el merge de
  // read(), que es justo lo que queremos — una instalación vieja también
  // tiene que pasar la reconciliación una vez.
  identity: null,
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
export const getMachineIdentity = (): MachineIdentity | null => read().identity;

// Adoptar la identidad que esta misma máquina ya tenía en el bucket (una
// reinstalación recuperando su carpeta). Solo lo llama identity.ts, y solo
// mientras el id actual no haya escrito nada todavía: cambiarlo después
// dejaría huérfano lo ya subido.
export const setMachineId = (machineId: string, bucket: string): void => {
  const file = read();
  const now = new Date().toISOString();
  write({
    ...file,
    machineId,
    // La carpeta viene de otra instalación: TODO lo que ya hay ahí es
    // anterior a nosotros y queda protegido de la poda (ver pruneFloor).
    identity: { reconciledBucket: bucket, reconciledAt: now, pruneFloor: now },
  });
};

// Suelo de poda de la nube: null = sin restricción (instalación con historia
// local continua, la poda replica la retención como siempre).
export const getPruneFloor = (): Date | null => {
  const floor = read().identity?.pruneFloor;
  if (!floor) return null;
  const parsed = new Date(floor);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

// Tras recuperar el índice desde el bucket pasa lo mismo que al adoptar: el
// índice conoce versiones que esta máquina no tiene en local, y la poda las
// borraría por "caducadas".
export const setPruneFloor = (when: Date): void => {
  const file = read();
  if (!file.identity) return;
  write({ ...file, identity: { ...file.identity, pruneFloor: when.toISOString() } });
};

// "Ya he mirado este bucket y me quedo como estoy" — PC nuevo de verdad, o
// el usuario dice que ninguna de las máquinas de ahí es esta.
export const markIdentityReconciled = (bucket: string): void => {
  const file = read();
  write({
    ...file,
    identity: { reconciledBucket: bucket, reconciledAt: new Date().toISOString() },
  });
};

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
