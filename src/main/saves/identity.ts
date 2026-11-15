import { appCtx } from '../db/v2/appDb';
import {
  checkInstallNonce,
  clearAllLastSyncedHashes,
  forcePublishInstallNonce,
} from '../db/v2/queries/saves';
import type { CloudMachine, IdentityCheck, InstallIdentityStatus } from './contracts';
import {
  clearDuplicateIdentity,
  getDuplicateIdentity,
  getInstallNonce,
  getMachineHome,
  getMachineId,
  getMachineIdentity,
  getMachineName,
  markDuplicateIdentity,
  markIdentityReconciled,
  setMachineId,
  startNewIdentity,
} from './machine';
import * as r2 from './r2';
import { getConfigValue } from '../config/store';

// Identidad de esta máquina frente al bucket (PARTIDAS-GUARDADAS.md §7.2 y
// §9). Existe por un fallo real del diseño anterior:
//
// El machineId es un UUID que solo vive en machine-saves.json, que NUNCA
// sincroniza. Como las claves de R2 son saves/<igdbId>/<machineId>/, una
// reinstalación minaba un UUID nuevo y empezaba a subir a un prefijo
// distinto: el viejo dejaba de podarse (la retención solo toca el prefijo
// propio), duplicaba espacio para siempre y aparecía en la UI como si fuera
// otro PC. Y sin Turso, además, el índice se perdía entero y esos objetos
// quedaban invisibles e imborrables desde la app, pagándose igual.
//
// La solución es que el bucket sepa quién es cada uno: un objeto minúsculo
// por máquina en machines/<id>.json con lo único que no se puede deducir de
// las claves ni del mapping.yaml (el nombre del PC y su %USERPROFILE%). Con
// eso, una instalación nueva puede reconocer su propia carpeta y reclamarla
// en vez de abandonarla.

export type MachineManifest = {
  machineId: string;
  machineName: string;
  home: string;
  updatedAt: string;
  // El valor propio de la instalación que publicó esto (§12.6). Ausente en los
  // manifiestos de la 1.x.
  installNonce?: string;
};

// Puerta BARATA: puro local, sin una sola llamada a R2. Es lo que permite
// que el caso normal (abrir la app un día cualquiera) no gaste operaciones
// —y lo que respeta §10bis.4, que prohíbe comprobar nada de fondo—. Solo
// cuando esto dice que sí se ofrece mirar la nube, y siempre a petición.
export const needsIdentityCheck = (): boolean => {
  const bucket = r2.getBucketName();
  const destination = r2.getDestinationId();
  if (!bucket || !destination) return false;
  const reconciled = getMachineIdentity()?.reconciledBucket;
  // Los usuarios existentes guardaron solo el nombre del bucket. En R2 esa
  // marca sigue siendo válida y la actualización no les fuerza una nueva
  // reconciliación. Las marcas nuevas incluyen proveedor, servidor y bucket.
  if (getConfigValue('saveStorageProvider') === 'cloudflare' && reconciled === bucket) return false;
  return reconciled !== destination;
};

const describeSelf = (): MachineManifest => ({
  machineId: getMachineId(),
  machineName: getMachineName(),
  home: getMachineHome(),
  updatedAt: new Date().toISOString(),
  installNonce: getInstallNonce(),
});

// Deja constancia de esta máquina en el bucket. Un PUT diminuto (Clase A)
// que se hace al reconciliar, no en cada backup: lo que describe solo cambia
// si renombras el PC o la cuenta de Windows.
export const publishMachineManifest = async (): Promise<void> => {
  const self = describeSelf();
  console.log(`[saves] publicando manifiesto de maquina en ${r2.machineKey(self.machineId)}...`);
  await r2.uploadJson(r2.machineKey(self.machineId), self);
  console.log('[saves] manifiesto de maquina publicado');
};

// Qué máquinas conoce el bucket. Un LIST del prefijo machines/ (Clase A) y
// un GET por manifiesto (Clase B, la cuota holgada) — con uno o tres PCs
// esto es literalmente un puñado de operaciones.
const listCloudMachines = async (): Promise<MachineManifest[]> => {
  const keys = await r2.listKeys(r2.MACHINES_PREFIX);
  const manifests: MachineManifest[] = [];
  for (const { key } of keys) {
    if (!key.endsWith('.json')) continue;
    const manifest = await r2.readJson<MachineManifest>(key);
    // Un manifiesto ilegible no invalida la lista: esa máquina sale sin
    // describir, que es la situación de la que venimos de todos modos.
    if (manifest?.machineId) manifests.push(manifest);
  }
  return manifests;
};

// ¿Ha escrito ya algo el id actual? Se pregunta al BUCKET y no al índice
// local a propósito: el caso que más duele es justamente el de un índice
// vacío (reinstalación sin Turso), y ahí el índice diría "no hay nada"
// mientras el bucket está lleno.
const hasWrittenAnything = async (machineId: string): Promise<boolean> => {
  const own = await r2.listKeys(`saves/`);
  return own.some((object) => object.key.includes(`/${machineId}/`));
};

export const checkIdentity = async (): Promise<IdentityCheck | null> => {
  const bucket = r2.getBucketName();
  if (!bucket) return null;

  const currentMachineId = getMachineId();
  const name = getMachineName();
  const home = getMachineHome();

  const manifests = await listCloudMachines();
  const claimed = await hasWrittenAnything(currentMachineId);
  console.log(
    `[saves] identidad contra "${bucket}": ${manifests.length} manifiestos, id actual ${currentMachineId.slice(0, 8)}… ${claimed ? 'CON' : 'sin'} datos subidos`,
  );

  const machines: CloudMachine[] = manifests
    .filter((manifest) => manifest.machineId !== currentMachineId)
    .map((manifest) => ({
      machineId: manifest.machineId,
      machineName: manifest.machineName,
      home: manifest.home,
      updatedAt: manifest.updatedAt ?? null,
      sameName: manifest.machineName === name,
      sameHome: manifest.home === home,
    }));

  return {
    bucket,
    currentMachineId,
    // Con datos ya subidos bajo el id actual, adoptar otro los dejaría
    // huérfanos — la UI lo usa para no ofrecer el cambio a la ligera.
    claimed,
    // Ya registrada en el bucket: si esta máquina no está ni en machines/,
    // nadie podría reconocerla después de una reinstalación.
    published: manifests.some((manifest) => manifest.machineId === currentMachineId),
    machines,
  };
};

// Reclamar la carpeta que este mismo PC dejó en el bucket. Solo desde una
// decisión explícita del usuario: dos ordenadores clonados (mismo nombre de
// equipo y misma cuenta) son indistinguibles desde aquí, y adoptar a ciegas
// los haría escribir en el mismo prefijo y podarse mutuamente — el desastre
// exacto que el prefijo por máquina existe para evitar.
export const adoptMachine = async (machineId: string): Promise<void> => {
  const bucket = r2.getBucketName();
  const destination = r2.getDestinationId();
  if (!bucket || !destination) throw new r2.R2NotConfiguredError();

  console.log(`[saves] adoptando la identidad ${machineId} en el bucket "${bucket}"...`);
  setMachineId(machineId, destination);
  // El manifiesto se reescribe con el nombre y el home ACTUALES: la carpeta
  // es la de antes, pero la cuenta de Windows puede haberse renombrado y lo
  // que vale para los redirects es lo de ahora.
  await publishMachineManifest();
  console.log('[saves] identidad adoptada');
};

// "Ninguna de esas es esta" — se conserva el id actual y se publica para que
// la próxima instalación sí pueda reconocerlo.
export const keepCurrentIdentity = async (): Promise<void> => {
  const bucket = r2.getBucketName();
  const destination = r2.getDestinationId();
  if (!bucket || !destination) throw new r2.R2NotConfiguredError();

  console.log(`[saves] registrando esta maquina en el bucket "${bucket}"...`);
  await publishMachineManifest();
  markIdentityReconciled(destination);
  console.log('[saves] identidad reconciliada — este aviso no volvera a salir');
};

// Red de seguridad del primer backup: si nunca se miró este bucket, mirarlo
// AHORA, que es la última ventana en la que cambiar de id sale gratis —
// todavía no hemos escrito nada bajo él, así que no hay nada que huerfanar.
//
// NUNCA adopta sola, ni siquiera con una única coincidencia exacta de
// nombre+home. Ese caso es indistinguible entre dos cosas opuestas:
//   - una REINSTALACIÓN (reclamar la carpeta es lo correcto), y
//   - un PC CLONADO todavía vivo (mismo nombre de equipo y misma cuenta), donde
//     reclamar hace que las DOS máquinas escriban en el mismo prefijo y se
//     poden mutuamente los backups — "el desastre exacto" que documenta
//     adoptMachine, y pérdida de datos irreversible entre máquinas.
// Y no hay señal local fiable para separarlos: el manifiesto casi nunca se
// re-publica (solo al renombrar el PC/cuenta, ver publishMachineManifest), así
// que su updatedAt no dice si la máquina sigue viva. Por eso adoptar es
// SIEMPRE una decisión explícita del usuario en Ajustes (needsIdentityCheck
// destapa el aviso -> checkIdentity -> adoptMachine). Aquí solo se publica el
// manifiesto para que esta máquina sea reconocible desde el otro PC. El coste
// de no auto-adoptar es un clic manual tras reinstalar; el de auto-adoptar mal
// es perder partidas de otro ordenador sin vuelta atrás.
export const ensureIdentityBeforeUpload = async (): Promise<void> => {
  if (!needsIdentityCheck()) return;

  try {
    const check = await checkIdentity();
    if (!check) return;

    // Sin tocar el id: se publica el manifiesto — sin él, la SIGUIENTE
    // reinstalación tendría el mismo problema y sin nada con lo que
    // reconocerse.
    await publishMachineManifest();
    // Bucket sin otras máquinas: no hay a quién confundirse con, se marca
    // visto para no volver a preguntar. Con otras presentes se deja sin marcar
    // para que Ajustes ofrezca la reconciliación explícita.
    const destination = r2.getDestinationId();
    if (check.machines.length === 0 && destination) markIdentityReconciled(destination);
  } catch (error) {
    // Nunca puede tumbar un backup: sin identidad reconciliada se sube con
    // el id actual, que es exactamente lo que se hacía antes de todo esto.
    console.warn('[saves] no se pudo reconciliar la identidad de la maquina:', error);
  }
};

// ── Id duplicado (§12.6, F-24) ────────────────────────────────────────────
// Si la carpeta de datos de un PC se copia a otro, los dos tienen el mismo id
// y escriben en el mismo prefijo del bucket: cada uno poda lo que el otro
// sube. Cada instalación tiene un valor propio (machine.ts: getInstallNonce) y
// lo publica en `devices` y en machines/<id>.json; quien encuentra publicado un
// valor que no es el suyo es la copia, y se bloquea: ni backups ni poda hasta
// que el usuario decida.

export class DuplicateIdentityError extends Error {
  constructor() {
    super(
      "Another Afterplay installation is using this PC's identity (its data folder was probably copied). " +
        'Cloud backups and cleanup are paused on this PC until you resolve it in Settings.',
    );
    this.name = 'DuplicateIdentityError';
  }
}

// El bucket se mira una vez por destino y proceso: es un GET pequeño, pero no
// hace falta en cada backup. Una copia que arranca después lo verá al empezar.
let bucketCheckedFor: string | null = null;

/** Solo para tests. */
export const resetIdentityChecksForTests = (): void => {
  bucketCheckedFor = null;
};

/**
 * Lo barato y local: el valor publicado en `devices`. Lo publica si no había
 * ninguno. No toca la red. Devuelve el estado para Ajustes.
 */
export const checkLocalInstallIdentity = (): InstallIdentityStatus => {
  if (!getDuplicateIdentity()) {
    const check = checkInstallNonce(appCtx(), getInstallNonce());
    if (check === 'conflict') {
      console.warn(
        '[saves] id duplicado: el valor publicado en devices no es el de esta instalación',
      );
      markDuplicateIdentity('devices');
    }
  }
  const duplicate = getDuplicateIdentity();
  return {
    duplicate: duplicate !== null,
    detectedAt: duplicate?.detectedAt ?? null,
    where: duplicate?.where ?? null,
  };
};

/**
 * La puerta de toda escritura en el bucket (backups y poda): lanza
 * `DuplicateIdentityError` si otra instalación usa este id. Mira `devices` y,
 * con almacenamiento configurado, el manifiesto de esta máquina en el bucket.
 * Un fallo de red al leer el manifiesto también corta: sin saber quién lo
 * publicó no se escribe encima.
 */
export const assertInstallIdentity = async (): Promise<void> => {
  if (checkLocalInstallIdentity().duplicate) throw new DuplicateIdentityError();
  const destination = r2.getDestinationId();
  if (!destination || bucketCheckedFor === destination) return;

  const nonce = getInstallNonce();
  const manifest = await r2.readJsonStrict<MachineManifest>(r2.machineKey(getMachineId()));
  if (manifest?.installNonce && manifest.installNonce !== nonce) {
    console.warn('[saves] id duplicado: el manifiesto del bucket es de otra instalación');
    markDuplicateIdentity('bucket');
    throw new DuplicateIdentityError();
  }
  // Sin manifiesto, o uno de antes de que existiera el valor: se publica el
  // nuestro para que una copia futura se reconozca.
  if (!manifest?.installNonce) await publishMachineManifest();
  bucketCheckedFor = destination;
};

/**
 * "Este PC es el original": publica su valor en `devices` y en el bucket,
 * aunque hubiera otro. La otra instalación, al ver que ya no es el suyo, se
 * bloqueará ella.
 */
export const resolveDuplicateKeepingThisPc = async (): Promise<void> => {
  const nonce = getInstallNonce();
  forcePublishInstallNonce(appCtx(), nonce);
  if (r2.getDestinationId()) await publishMachineManifest();
  clearDuplicateIdentity();
  bucketCheckedFor = r2.getDestinationId();
  console.log('[saves] id duplicado resuelto: esta instalación se queda con la identidad');
};

/**
 * "Este PC es otro": identidad nueva, a propósito. Las huellas de partida que
 * traía la carpeta copiada son de la otra instalación y se olvidan. La base se
 * abre con el id nuevo al reiniciar; quien llama reinicia la app.
 */
export const resolveDuplicateWithNewIdentity = (): string => {
  clearAllLastSyncedHashes(appCtx());
  const machineId = startNewIdentity();
  bucketCheckedFor = null;
  console.log(`[saves] id duplicado resuelto: identidad nueva ${machineId.slice(0, 8)}…`);
  return machineId;
};
