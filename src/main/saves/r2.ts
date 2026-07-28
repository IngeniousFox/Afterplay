import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

// Cloudflare R2 (PARTIDAS-GUARDADAS.md §9). API compatible con S3 —el mismo
// SDK, solo cambia el endpoint— pero SIN coste de egress, que es justo lo
// que se paga al restaurar.
//
// Estructura de claves, indexada por igdbId porque ya es independiente de la
// máquina y del título:
//
//   saves/<igdbId>/mapping.yaml            <- índice, se sobrescribe siempre
//   saves/<igdbId>/backup-<timestamp>.zip  <- una clave por versión
//
// El bucket es un ESPEJO de la carpeta local de backups de ese juego: lo que
// la retención de ludusavi se lleva en local, se borra también aquí.

const R2_REGION = 'auto';

let cached: { client: S3Client; bucket: string; fingerprint: string } | null = null;

const credentials = (): {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
} | null => {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const bucket = process.env.R2_BUCKET?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { accountId, bucket, accessKeyId, secretAccessKey };
};

// La puerta de §9.2: sin las cuatro claves, la función entera queda
// deshabilitada. No hay modo degradado "solo local" a propósito — un backup
// que no sale de este PC no protege de nada de lo que esta función existe
// para proteger.
export const isR2Configured = (): boolean => credentials() !== null;

// Contra QUÉ bucket se reconcilió la identidad de esta máquina (ver
// saves/identity.ts). Es una cadena, no un booleano, a propósito: cambiar de
// bucket es cambiar de mundo — el de al lado puede tener otras máquinas y
// otros backups, así que hay que volver a mirar.
export const getBucketName = (): string | null => credentials()?.bucket ?? null;

const getClient = (): { client: S3Client; bucket: string } | null => {
  const creds = credentials();
  if (!creds) {
    cached = null;
    return null;
  }

  // Las credenciales se pueden cambiar en caliente desde Ajustes, así que el
  // cliente cacheado se tira si dejaron de ser las mismas — mismo problema
  // que ya tenían el token de Twitch y el cliente de SGDB.
  const fingerprint = `${creds.accountId}|${creds.bucket}|${creds.accessKeyId}|${creds.secretAccessKey}`;
  if (cached?.fingerprint === fingerprint) return { client: cached.client, bucket: cached.bucket };

  const client = new S3Client({
    region: R2_REGION,
    endpoint: `https://${creds.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey },
  });
  cached = { client, bucket: creds.bucket, fingerprint };
  return { client, bucket: creds.bucket };
};

export const resetR2Client = (): void => {
  cached = null;
};

export class R2NotConfiguredError extends Error {
  constructor() {
    super('Cloudflare R2 credentials are missing.');
    this.name = 'R2NotConfiguredError';
  }
}

const requireClient = (): { client: S3Client; bucket: string } => {
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

export const uploadFile = async (key: string, filePath: string): Promise<number> => {
  const { client, bucket } = requireClient();
  const body = await readFile(filePath);
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType(key) }),
  );
  return body.byteLength;
};

// Subir/leer un objeto JSON pequeño sin pasar por disco — el registro de
// máquinas es un puñado de bytes y no tiene por qué materializarse en un
// fichero temporal solo para reusar uploadFile.
export const uploadJson = async (key: string, value: unknown): Promise<void> => {
  const { client, bucket } = requireClient();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: `${JSON.stringify(value, null, 2)}\n`,
      ContentType: 'application/json',
    }),
  );
};

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
  if (!response.Body) throw new Error(`R2 devolvió un objeto vacío: ${key}`);
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
  const { client, bucket } = requireClient();
  // DeleteObjects acepta 1000 claves por llamada; con la retención de §9.1
  // nunca se llega ni de lejos, pero trocear es una línea y evita un fallo
  // sorpresa el día que alguien limpie un bucket entero.
  for (let index = 0; index < keys.length; index += 1000) {
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: keys.slice(index, index + 1000).map((key) => ({ Key: key })) },
      }),
    );
  }
};
