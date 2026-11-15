import { app, dialog } from 'electron';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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

// Otra instalación usa el mismo id (§12.6, F-24): cuándo y dónde se vio.
export type DuplicateIdentity = {
  detectedAt: string;
  // Dónde estaba publicado un valor que no es el de esta instalación.
  where: 'devices' | 'bucket';
};

type MachineSavesFile = {
  version: 1;
  machineId: string;
  machineName: string;
  home: string;
  identity: MachineIdentity | null;
  // Clave: gameId como string (JSON no admite claves numéricas).
  saveLocationOverrides: Record<string, MachineSaveOverride>;
  // Valor aleatorio PROPIO de esta instalación (§12.6). Se publica junto al id
  // (en `devices.installNonce` y en machines/<id>.json): si el publicado no es
  // el nuestro, otra instalación usa este mismo id. Ausente en ficheros de
  // antes de la 2.0; se crea la primera vez que hace falta.
  installNonce?: string;
  // De qué Windows es el valor de arriba (MachineGuid). Es lo que distingue
  // "esta instalación" de "una copia de su carpeta de datos en otro PC": la
  // carpeta copiada trae el mismo fichero, pero el Windows es otro.
  installFingerprint?: string | null;
  // Detectado un id duplicado: poda y backups bloqueados hasta que el usuario
  // lo resuelva (§12.6).
  duplicate?: DuplicateIdentity | null;
};

const FILE_NAME = 'machine-saves.json';
const getFilePath = (): string => join(app.getPath('userData'), FILE_NAME);
// Copia de la última versión buena, escrita también de forma atómica: si el
// fichero principal no se deja leer, la identidad sale de aquí y no se inventa.
const getBackupPath = (): string => `${getFilePath()}.bak`;

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

// Escritura atómica (§12.6): a un temporal y renombrar. Un corte a mitad deja
// el fichero anterior entero, nunca uno a medias. Después, lo mismo con la
// copia .bak.
const writeAtomic = (path: string, content: string): void => {
  const temp = `${path}.tmp`;
  writeFileSync(temp, content);
  renameSync(temp, path);
};

const write = (file: MachineSavesFile): void => {
  cached = file;
  const content = `${JSON.stringify(file, null, 2)}\n`;
  writeAtomic(getFilePath(), content);
  try {
    writeAtomic(getBackupPath(), content);
  } catch (error) {
    // La copia es una red, no una condición: sin ella el principal sigue bien.
    console.warn('[saves] no se pudo escribir la copia de machine-saves.json:', error);
  }
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ReadAttempt =
  | { kind: 'ok'; file: MachineSavesFile }
  | { kind: 'missing' }
  | { kind: 'corrupt'; reason: string };

// Un fichero vale si es JSON y trae un machineId con forma de UUID. Lo demás
// (nombre, home, overrides) se puede rellenar; el id no se puede inventar.
const tryRead = (path: string): ReadAttempt => {
  if (!existsSync(path)) return { kind: 'missing' };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<MachineSavesFile> | null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { kind: 'corrupt', reason: 'not a JSON object' };
    }
    if (typeof parsed.machineId !== 'string' || !UUID_RE.test(parsed.machineId)) {
      return { kind: 'corrupt', reason: 'no valid machineId' };
    }
    const file = { ...createDefaults(), ...parsed } as MachineSavesFile;
    if (!file.saveLocationOverrides || typeof file.saveLocationOverrides !== 'object') {
      file.saveLocationOverrides = {};
    }
    return { kind: 'ok', file };
  } catch (error) {
    return { kind: 'corrupt', reason: error instanceof Error ? error.message : String(error) };
  }
};

// El id con el que se abrió por última vez la base 2.0 de esta carpeta de
// datos (`local_sync_state.shortDeviceIdFor`). Si machine-saves.json se
// pierde, es la identidad ANTERIOR de esta instalación: recuperarla no es
// inventar nada. Solo lectura y sin tocar el esquema; cualquier fallo es "no
// se sabe".
export const readStoredDeviceId = (userDataDir: string): string | null => {
  const path = join(userDataDir, 'Afterplay2.db');
  if (!existsSync(path)) return null;
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const row = db
      .prepare('SELECT "shortDeviceIdFor" AS id FROM "local_sync_state" WHERE "id" = 1')
      .get() as { id?: unknown } | undefined;
    return typeof row?.id === 'string' && UUID_RE.test(row.id) ? row.id : null;
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      // nada que hacer
    }
  }
};

export class MachineIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MachineIdentityError';
  }
}

// Qué hacer con un machine-saves.json dañado y sin copia buena. Se pregunta
// SIEMPRE: generar un id nuevo en silencio dejaría huérfanas las copias del
// bucket y las filas de este PC en la base (§12.6, F-24). Inyectable para los
// tests; el de verdad es un diálogo nativo, síncrono, antes de abrir la base.
export type CorruptIdentityChoice = 'use-stored' | 'create-new' | 'quit';
export type CorruptIdentityPrompt = (options: {
  storedDeviceId: string | null;
  reason: string;
}) => CorruptIdentityChoice;

const KEEP_LABEL = "Keep this PC's identity (recommended)";
const CREATE_LABEL = 'Create a new identity';
const QUIT_LABEL = 'Quit';

const nativeCorruptPrompt: CorruptIdentityPrompt = ({ storedDeviceId, reason }) => {
  const buttons = storedDeviceId
    ? [KEEP_LABEL, CREATE_LABEL, QUIT_LABEL]
    : [CREATE_LABEL, QUIT_LABEL];
  const choice = dialog.showMessageBoxSync({
    type: 'warning',
    title: 'Afterplay',
    message: "This PC's cloud-save identity file is damaged.",
    detail:
      `machine-saves.json could not be read (${reason}). A copy of it was kept aside.\n\n` +
      (storedDeviceId
        ? "Afterplay found this PC's previous identity in its database and can keep using it. " +
          'Creating a new identity makes this PC look like a different one: the cloud saves and ' +
          'sessions it already made would belong to "another PC".'
        : 'No previous identity was found. Creating a new identity makes this PC look like a ' +
          'different one: the cloud saves it already made would belong to "another PC".'),
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
    noLink: true,
  });
  const label = buttons[choice];
  if (label === CREATE_LABEL) return 'create-new';
  if (label === KEEP_LABEL) return 'use-stored';
  return 'quit';
};

let corruptPrompt: CorruptIdentityPrompt = nativeCorruptPrompt;

/** Solo para tests. */
export const setCorruptIdentityPrompt = (prompt: CorruptIdentityPrompt | null): void => {
  corruptPrompt = prompt ?? nativeCorruptPrompt;
};

/** Solo para tests: olvida lo leído para volver a leer del disco. */
export const resetMachineCacheForTests = (): void => {
  cached = null;
  fingerprintChecked = false;
};

// Recuperar un id sin el resto del fichero pierde el suelo de poda y la marca
// de reconciliación. Se pone el suelo AHORA (lo que ya hay en el bucket queda
// protegido) y la reconciliación vuelve a pedirse: ante la duda, no podar.
const recoveredFile = (machineId: string): MachineSavesFile => {
  const now = new Date().toISOString();
  return {
    ...createDefaults(),
    machineId,
    identity: { reconciledBucket: '', reconciledAt: now, pruneFloor: now },
  };
};

const keepAside = (path: string): void => {
  try {
    copyFileSync(path, `${path}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  } catch (error) {
    console.warn('[saves] no se pudo apartar el machine-saves.json dañado:', error);
  }
};

const resolveFile = (): MachineSavesFile => {
  const main = tryRead(getFilePath());
  if (main.kind === 'ok') return main.file;

  const backup = tryRead(getBackupPath());
  if (backup.kind === 'ok') {
    console.warn(
      `[saves] machine-saves.json ${main.kind === 'missing' ? 'no está' : `está dañado (${main.reason})`}: se recupera la identidad de la copia .bak`,
    );
    if (main.kind === 'corrupt') keepAside(getFilePath());
    return backup.file;
  }

  const stored = readStoredDeviceId(app.getPath('userData'));
  if (main.kind === 'missing') {
    if (stored) {
      // El fichero falta pero la base de esta carpeta sabe quién era este PC:
      // se recupera esa identidad en vez de inventar otra.
      console.warn(
        `[saves] falta machine-saves.json: se recupera la identidad de la base (${stored.slice(0, 8)}…)`,
      );
      return recoveredFile(stored);
    }
    // Primer arranque de verdad: no hay nada que recuperar.
    return createDefaults();
  }

  keepAside(getFilePath());
  const choice = corruptPrompt({ storedDeviceId: stored, reason: main.reason });
  if (choice === 'use-stored' && stored) {
    console.warn('[saves] machine-saves.json dañado: se conserva la identidad de la base');
    return recoveredFile(stored);
  }
  if (choice === 'create-new') {
    console.warn('[saves] machine-saves.json dañado: el usuario crea una identidad nueva');
    return createDefaults();
  }
  throw new MachineIdentityError(
    'The file that identifies this PC for cloud saves (machine-saves.json) is damaged. ' +
      'A copy was kept next to it so it can be repaired by hand.',
  );
};

const read = (): MachineSavesFile => {
  if (cached) return cached;
  const file = resolveFile();
  // El home puede haber cambiado (cuenta de Windows renombrada, perfil
  // movido) — manda siempre el del sistema, porque es el que se usa para
  // generar los redirects de restauración.
  file.home = toSlashes(homedir());
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

// Lo llaman los dos sitios en los que la carpeta local deja de ser un relato
// completo de lo que hay arriba, que es la premisa de la que vive la poda:
//
//   - recovery.ts, al recuperar el índice desde el bucket: pasa lo mismo que
//     al adoptar, el índice conoce versiones que esta máquina no tiene en
//     local y la poda las borraría por "caducadas".
//   - localUsage.ts, al vaciar save-backups/ para liberar disco: eso no es la
//     retención de ludusavi hablando, es el usuario, y esta instalación deja
//     de tener autoridad para afirmar que lo de antes caducó.
export const setPruneFloor = (when: Date): void => {
  const file = read();
  const floor = when.toISOString();
  write({
    ...file,
    // Recuperar el índice desde la nube puede pasar ANTES de reconciliar la
    // identidad (una reinstalación que pulsa "recuperar de la nube" sin haber
    // pasado aún por el flujo de identidad). Antes, con identity === null,
    // esto salía sin hacer nada: el suelo no se ponía y el siguiente backup
    // podaba justo lo recién recuperado — la pérdida irreversible que el
    // pruneFloor existe para impedir. Se crea una identidad mínima con
    // reconciledBucket vacío, que nunca casa con un bucket real, así que
    // needsIdentityCheck sigue pidiendo la reconciliación de verdad después.
    identity: file.identity
      ? { ...file.identity, pruneFloor: floor }
      : { reconciledBucket: '', reconciledAt: floor, pruneFloor: floor },
  });
};

// "Ya he mirado este bucket y me quedo como estoy" — PC nuevo de verdad, o
// el usuario dice que ninguna de las máquinas de ahí es esta.
export const markIdentityReconciled = (bucket: string): void => {
  const file = read();
  write({
    ...file,
    identity: {
      reconciledBucket: bucket,
      reconciledAt: new Date().toISOString(),
      // Conserva el suelo de poda: reconciliar ("ninguna es esta" / PC nuevo)
      // NO es motivo para desproteger versiones ya recuperadas. Sin esto, un
      // recover que puso el suelo y luego una reconciliación lo borraba, y el
      // siguiente backup podaba el bucket entero.
      pruneFloor: file.identity?.pruneFloor ?? null,
    },
  });
};

// Los destinos que la 1.x guardaba aquí, por id numérico de juego. Solo los
// lee el primer arranque de la 2.0 para pasarlos a local_save_state
// (db/v2/appDb.ts); desde entonces el destino vive en la base.
export const listLegacySaveLocationOverrides = (): [string, string][] =>
  Object.entries(read().saveLocationOverrides).map(([gameId, override]) => [
    gameId,
    override.target,
  ]);

// ── Instalación (§12.6, F-24) ──────────────────────────────────────────────

// MachineGuid de Windows: cambia al reinstalar Windows o en otro equipo, no al
// renombrar el PC ni la cuenta. null si no se puede leer (otro sistema, la
// consulta falla): entonces no se decide nada con él.
const readMachineGuid = (): string | null => {
  if (process.platform !== 'win32') return null;
  try {
    const output = execFileSync(
      'reg',
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
      { encoding: 'utf-8', windowsHide: true, timeout: 5000 },
    );
    const match = /MachineGuid\s+REG_SZ\s+(\S+)/i.exec(output);
    return match ? `guid:${match[1].toLowerCase()}` : null;
  } catch {
    return null;
  }
};

let fingerprintReader: () => string | null = readMachineGuid;
let fingerprintChecked = false;

/** Solo para tests. */
export const setFingerprintReader = (reader: (() => string | null) | null): void => {
  fingerprintReader = reader ?? readMachineGuid;
  fingerprintChecked = false;
};

const newNonce = (): string => randomBytes(16).toString('hex');

/**
 * El valor propio de esta instalación. Se crea la primera vez. Si el fichero
 * viene de OTRO Windows (la carpeta de datos se copió), esta es otra
 * instalación y recibe un valor nuevo: al compararlo con el publicado se
 * descubre el id duplicado. Si el Windows no se puede leer, no se cambia nada.
 */
export const getInstallNonce = (): string => {
  const file = read();
  if (!fingerprintChecked) {
    fingerprintChecked = true;
    const current = fingerprintReader();
    const stored = file.installFingerprint ?? null;
    if (!file.installNonce) {
      write({ ...file, installNonce: newNonce(), installFingerprint: current });
    } else if (current && stored && current !== stored) {
      console.warn(
        '[saves] machine-saves.json viene de otro Windows: esta instalación recibe un valor propio',
      );
      write({ ...file, installNonce: newNonce(), installFingerprint: current });
    } else if (current && !stored) {
      write({ ...file, installFingerprint: current });
    }
  }
  return read().installNonce as string;
};

/** El id duplicado detectado, si lo hay: poda y backups bloqueados (§12.6). */
export const getDuplicateIdentity = (): DuplicateIdentity | null => read().duplicate ?? null;

export const markDuplicateIdentity = (where: DuplicateIdentity['where']): void => {
  const file = read();
  if (file.duplicate) return;
  write({ ...file, duplicate: { detectedAt: new Date().toISOString(), where } });
};

export const clearDuplicateIdentity = (): void => {
  const file = read();
  if (!file.duplicate) return;
  write({ ...file, duplicate: null });
};

/**
 * "Este PC es otro": una identidad NUEVA, a propósito (§12.6). Lo que ya hay
 * con el id anterior sigue siendo de la otra instalación. La base se abre con
 * el id nuevo en el siguiente arranque, así que quien llama reinicia la app.
 */
export const startNewIdentity = (): string => {
  const file = read();
  const machineId = randomUUID();
  write({
    ...file,
    machineId,
    identity: null,
    installNonce: newNonce(),
    installFingerprint: fingerprintReader(),
    duplicate: null,
  });
  return machineId;
};
