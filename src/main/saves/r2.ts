import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createWriteStream } from 'node:fs';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Upload } from '@aws-sdk/lib-storage';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { getConfigValue } from '../config/store';
import { devProfileBlocksBucket } from '../lib/devProfileRules';
import { storageTargetFromEnv, type StorageTarget } from './storageConfig';

// Cloudflare R2 (PARTIDAS-GUARDADAS.md §9). API compatible con S3 —el mismo
// SDK, solo cambia el endpoint— pero SIN coste de egress, que es justo lo
// que se paga al restaurar.
//
// Estructura de claves. El igdbId va delante porque es lo único que
// identifica al juego con independencia de la máquina y del título; el
// machineId, detrás, porque cada PC es dueño de su propia carpeta (el porqué,
// entero, en el comentario de gamePrefix — es la decisión central del módulo,
// y la versión sin él estaba rota de raíz):
//
//   saves/<igdbId>/<machineId>/mapping.yaml            <- índice de ESA carpeta
//   saves/<igdbId>/<machineId>/backup-<timestamp>.zip  <- una clave por versión
//   machines/<machineId>.json                          <- quién es ese PC
//
// El bucket es un ESPEJO de la carpeta local de backups de ese juego EN ESA
// MÁQUINA: lo que la retención de ludusavi se lleva en local, se borra también
// aquí — salvo lo que proteja el suelo de poda (pruneFloor en machine.ts).

let cached: {
  client: S3Client;
  bucket: string;
  target: StorageTarget;
  fingerprint: string;
} | null = null;
let migrationBarrier = false;
let activeWrites = 0;

const withActiveWrite = async <T>(work: () => Promise<T>): Promise<T> => {
  if (migrationBarrier) throw new Error('Cloud saves are being migrated; retry the backup later.');
  activeWrites++;
  try {
    return await work();
  } finally {
    activeWrites--;
  }
};

export const beginStorageMigration = async (): Promise<() => void> => {
  if (migrationBarrier) throw new Error('A storage migration is already running.');
  migrationBarrier = true;
  while (activeWrites > 0) await new Promise((resolve) => setTimeout(resolve, 50));
  return () => {
    migrationBarrier = false;
  };
};

const activeTarget = (): StorageTarget | null => {
  const target = storageTargetFromEnv(getConfigValue('saveStorageProvider'));
  // Un perfil de desarrollo es, para el bucket, un PC más: sube, lista y PODA.
  // Contra el bucket real sería un segundo PC fantasma borrando copias de
  // verdad, así que solo trabaja con un bucket de desarrollo; con cualquier
  // otro, la función queda como "sin configurar" (ver devProfileRules.ts).
  if (target && devProfileBlocksBucket(target.bucket)) return null;
  return target;
};

// La puerta de §9.2: sin las cuatro claves, la función entera queda
// deshabilitada. No hay modo degradado "solo local" a propósito — un backup
// que no sale de este PC no protege de nada de lo que esta función existe
// para proteger.
export const isR2Configured = (): boolean => activeTarget() !== null;

// Contra QUÉ bucket se reconcilió la identidad de esta máquina (ver
// saves/identity.ts). Es una cadena, no un booleano, a propósito: cambiar de
// bucket es cambiar de mundo — el de al lado puede tener otras máquinas y
// otros backups, así que hay que volver a mirar.
export const getBucketName = (): string | null => activeTarget()?.bucket ?? null;

export const getDestinationId = (): string | null => activeTarget()?.identity ?? null;

export const createStorageClient = (target: StorageTarget): S3Client =>
  new S3Client({
    region: target.region,
    endpoint: target.endpoint,
    credentials: {
      accessKeyId: target.accessKeyId,
      secretAccessKey: target.secretAccessKey,
    },
    ...(target.provider === 's3'
      ? {
          forcePathStyle: target.forcePathStyle,
          // Muchos servidores compatibles no implementan checksums opcionales
          // recientes del SDK; siguen verificándose los bytes en la migración.
          requestChecksumCalculation: 'WHEN_REQUIRED',
          responseChecksumValidation: 'WHEN_REQUIRED',
        }
      : {}),
  });

const getClient = (): { client: S3Client; bucket: string; target: StorageTarget } | null => {
  const target = activeTarget();
  if (!target) {
    cached = null;
    return null;
  }

  // Las credenciales se pueden cambiar en caliente desde Ajustes, así que el
  // cliente cacheado se tira si dejaron de ser las mismas — mismo problema
  // que ya tenían el token de Twitch y el cliente de SGDB.
  const fingerprint = `${target.identity}|${target.region}|${target.forcePathStyle}|${target.accessKeyId}|${target.secretAccessKey}`;
  if (cached?.fingerprint === fingerprint)
    return { client: cached.client, bucket: cached.bucket, target: cached.target };

  const client = createStorageClient(target);
  cached = { client, bucket: target.bucket, target, fingerprint };
  return { client, bucket: target.bucket, target };
};

export const resetR2Client = (): void => {
  cached = null;
};

export class R2NotConfiguredError extends Error {
  constructor() {
    super('Cloud save storage credentials are missing.');
    this.name = 'R2NotConfiguredError';
  }
}

const requireClient = (): { client: S3Client; bucket: string; target: StorageTarget } => {
  const client = getClient();
  if (!client) throw new R2NotConfiguredError();
  return client;
};

// El prefijo lleva la MÁQUINA dentro, y esa "/" es la decisión más
// importante de este archivo.
//
// La versión sin ella (saves/<igdbId>/) parecía más limpia y estaba rota de
// raíz: el mapping.yaml es el índice de la carpeta de backups de UNA
// máquina, así que el segundo PC que respaldara ese juego habría
// sobrescrito el índice del primero, dejando sus zips ahí ocupando espacio y
// sin forma de restaurarlos; y la poda de "lo que ya no está en local"
// habría borrado del bucket los backups del otro PC.
//
// Con un prefijo por máquina, cada una es dueña absoluta de su carpeta: sube
// y poda dentro de la suya sin tocar la ajena. Quién tiene qué se responde
// desde la tabla save_backups, que sí sincroniza y sí ve todas las máquinas.
export const gamePrefix = (igdbId: number, machineId: string): string =>
  `saves/${igdbId}/${machineId}/`;

// Registro de máquinas, FUERA de saves/ y con un objeto diminuto por PC.
//
// Es lo que hace que el bucket sepa explicarse solo. El machineId va en la
// ruta de cada backup, pero el NOMBRE del PC y su %USERPROFILE% viven en
// machine-saves.json, que es local y nunca sincroniza — sin ellos, un bucket
// recuperado a pelo no puede decir de quién es cada carpeta ni generar los
// redirects al restaurar en otro sitio.
//
// Aparte de saves/ y no dentro para que enumerar máquinas cueste UN listado,
// en vez de recorrer la carpeta de cada juego (ListObjectsV2 es Clase A, la
// cuota escasa de R2: 1M/mes frente a 10M de lecturas).
export const MACHINES_PREFIX = 'machines/';

export const machineKey = (machineId: string): string => `${MACHINES_PREFIX}${machineId}.json`;

// Subida de un fichero SIN leerlo entero en memoria (§12.7). Antes, con R2,
// el zip se cargaba completo en el heap (`readFile`) y se mandaba de una vez.
// Ahora los dos proveedores van por `Upload` de lib-storage: lee el fichero en
// trozos de `partSize` y, como mucho, tiene `queueSize` trozos a la vez en
// memoria (32 MB). Un fichero menor que un trozo se sube con un único
// PutObject; uno mayor, por partes (multipart, que R2 admite con partes de
// 5 MB o más salvo la última). Cada trozo viaja como Buffer, no como stream,
// así que el SDK calcula su checksum por adelantado igual que antes.
const UPLOAD_PART_BYTES = 16 * 1024 * 1024;

export const uploadFile = async (key: string, filePath: string): Promise<number> =>
  withActiveWrite(async () => {
    const { client, bucket } = requireClient();
    const size = (await stat(filePath)).size;
    await new Upload({
      client,
      params: {
        Bucket: bucket,
        Key: key,
        Body: createReadStream(filePath),
        ContentLength: size,
        ContentType: contentType(key),
      },
      queueSize: 2,
      partSize: UPLOAD_PART_BYTES,
      leavePartsOnError: false,
    }).done();
    return size;
  });

// Subir un texto que solo existe en memoria. Lo pide el mapping.yaml del
// espejo: se sube FUSIONADO con el que ya hubiera arriba (orchestrator.ts), o
// sea que lo que va al bucket no es el fichero local sino algo compuesto, y
// escribirlo en disco para reusar uploadFile sería pisar el índice que
// mantiene ludusavi.
export const uploadText = async (key: string, body: string): Promise<void> =>
  withActiveWrite(async () => {
    const { client, bucket } = requireClient();
    await client.send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType(key) }),
    );
  });

// Subir/leer un objeto JSON pequeño sin pasar por disco — el registro de
// máquinas es un puñado de bytes y no tiene por qué materializarse en un
// fichero temporal solo para reusar uploadFile.
export const uploadJson = async (key: string, value: unknown): Promise<void> =>
  withActiveWrite(async () => {
    const { client, bucket } = requireClient();
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: `${JSON.stringify(value, null, 2)}\n`,
        ContentType: 'application/json',
      }),
    );
  });

// Contenido de un objeto pequeño como texto, sin pasar por disco (el
// mapping.yaml de un juego son unos pocos KB). null si no está o falla: la
// recuperación recorre carpetas ajenas y una ilegible solo debe hacer que esa
// se salte, no tumbar el barrido entero.
export const readText = async (key: string): Promise<string | null> => {
  const { client, bucket } = requireClient();
  try {
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return (await response.Body?.transformToString()) ?? null;
  } catch {
    return null;
  }
};

// Como readText, pero distinguiendo "no existe" (null) de "no se pudo leer"
// (lanza). Hace falta donde un fallo de red no puede confundirse con un
// objeto ausente: el manifiesto que dice qué instalación usa un id (§12.6) no
// se reescribe porque una lectura haya fallado.
export const readTextStrict = async (key: string): Promise<string | null> => {
  const { client, bucket } = requireClient();
  try {
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return (await response.Body?.transformToString()) ?? '';
  } catch (error) {
    const failure = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (failure.name === 'NoSuchKey' || failure.$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
};

// null si no existe o no es JSON; lanza si no se pudo leer. Un JSON ilegible
// no dice nada de quién lo escribió, así que se trata como ausente.
export const readJsonStrict = async <T>(key: string): Promise<T | null> => {
  const text = await readTextStrict(key);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    console.warn(`[saves] ${key} no es JSON valido: se trata como ausente`);
    return null;
  }
};

// null si no está o si es ilegible: un manifiesto corrupto no puede tumbar el
// arranque de la reconciliación — como mucho esa máquina sale sin describir y
// se la trata como desconocida, que es exactamente la situación de partida.
export const readJson = async <T>(key: string): Promise<T | null> => {
  const text = await readText(key);
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
};

const contentType = (key: string): string =>
  key.endsWith('.zip')
    ? 'application/zip'
    : key.endsWith('.yaml')
      ? 'text/yaml'
      : 'application/octet-stream';

export const downloadFile = async (key: string, destinationPath: string): Promise<void> => {
  const { client, bucket } = requireClient();
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) throw new Error(`El almacenamiento devolvió un objeto vacío: ${key}`);
  // Por streaming y no en memoria: un backup grande (InZOI son 56 MB que
  // además no comprimen) no tiene por qué pasar entero por el heap.
  await pipeline(response.Body as Readable, createWriteStream(destinationPath));
};

export const listKeys = async (prefix: string): Promise<{ key: string; size: number }[]> => {
  const { client, bucket } = requireClient();
  const keys: { key: string; size: number }[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const object of response.Contents ?? []) {
      if (object.Key) keys.push({ key: object.Key, size: object.Size ?? 0 });
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
};

export const deleteKeys = async (keys: string[]): Promise<void> => {
  if (keys.length === 0) return;
  return withActiveWrite(async () => {
    const { client, bucket } = requireClient();
    // DeleteObjects acepta 1000 claves por llamada; con la retención de §9.1
    // nunca se llega ni de lejos, pero trocear es una línea y evita un fallo
    // sorpresa el día que alguien limpie un bucket entero.
    for (let index = 0; index < keys.length; index += 1000) {
      const response = await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: keys.slice(index, index + 1000).map((key) => ({ Key: key })) },
        }),
      );
      // DeleteObjects responde HTTP 200 aunque claves concretas fallen: los
      // fallos van en response.Errors, no en el status. Sin mirarlos, un borrado
      // fallido pasaba por bueno y el llamador soltaba la fila del índice — el
      // zip se quedaba en el bucket, ya sin índice: invisible, imposible de
      // restaurar y cobrándose igual, justo el huérfano que el orden
      // "borra-objeto-antes-que-índice" existe para evitar. Al lanzar, el
      // llamador conserva la fila y lo reintenta en la próxima pasada.
      if (response.Errors && response.Errors.length > 0) {
        const first = response.Errors[0];
        throw new Error(
          `No se pudieron borrar ${response.Errors.length} objeto(s): ${first.Key ?? '?'} (${first.Code ?? 'sin código'})`,
        );
      }
    }
  });
};
