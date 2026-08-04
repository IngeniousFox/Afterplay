import type { CloudMachine, IdentityCheck } from './contracts';
import {
  getMachineHome,
  getMachineId,
  getMachineIdentity,
  getMachineName,
  markIdentityReconciled,
  setMachineId,
} from './machine';
import * as r2 from './r2';

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
};

// Puerta BARATA: puro local, sin una sola llamada a R2. Es lo que permite
// que el caso normal (abrir la app un día cualquiera) no gaste operaciones
// —y lo que respeta §10bis.4, que prohíbe comprobar nada de fondo—. Solo
// cuando esto dice que sí se ofrece mirar la nube, y siempre a petición.
export const needsIdentityCheck = (): boolean => {
  const bucket = r2.getBucketName();
  if (!bucket) return false;
  return getMachineIdentity()?.reconciledBucket !== bucket;
};

const describeSelf = (): MachineManifest => ({
  machineId: getMachineId(),
  machineName: getMachineName(),
  home: getMachineHome(),
  updatedAt: new Date().toISOString(),
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
  if (!bucket) throw new r2.R2NotConfiguredError();

  console.log(`[saves] adoptando la identidad ${machineId} en el bucket "${bucket}"...`);
  setMachineId(machineId, bucket);
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
  if (!bucket) throw new r2.R2NotConfiguredError();

  console.log(`[saves] registrando esta maquina en el bucket "${bucket}"...`);
  await publishMachineManifest();
  markIdentityReconciled(bucket);
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
    if (check.machines.length === 0) markIdentityReconciled(check.bucket);
  } catch (error) {
    // Nunca puede tumbar un backup: sin identidad reconciliada se sube con
    // el id actual, que es exactamente lo que se hacía antes de todo esto.
    console.warn('[saves] no se pudo reconciliar la identidad de la maquina:', error);
  }
};
