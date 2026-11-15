import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// Un bucket de mentira en memoria para los tests de orquestación, identidad y
// recuperación. Sustituye a `../r2` entero: nada de red ni de credenciales.
// Datos inventados.

export interface FakeBucket {
  /** clave -> contenido. */
  readonly objects: Map<string, Buffer>;
  /** Todo lo que se ha escrito o borrado, en orden (para comprobar que NO se tocó nada). */
  readonly writes: { op: 'upload' | 'delete'; key: string }[];
  /** Cuántas lecturas de cada clase se han hecho. */
  readonly reads: { readJsonStrict: number; readText: number; list: number };
  config: { bucket: string | null; destination: string | null };
  /** Errores a lanzar la próxima vez (una sola) por operación. */
  failNext: Partial<
    Record<'readJsonStrict' | 'listKeys' | 'uploadFile' | 'uploadText' | 'deleteKeys', Error>
  >;
  put(key: string, body: string | Buffer): void;
  text(key: string): string | null;
  keys(prefix?: string): string[];
  writesOf(op: 'upload' | 'delete'): string[];
  resetWrites(): void;
  /** Las exportaciones que tiene que tener el módulo `../r2` de mentira. */
  r2Exports(): Record<string, unknown>;
}

export function createFakeBucket(): FakeBucket {
  const objects = new Map<string, Buffer>();
  const writes: FakeBucket['writes'] = [];
  const reads = { readJsonStrict: 0, readText: 0, list: 0 };

  const bucket: FakeBucket = {
    objects,
    writes,
    reads,
    config: { bucket: 'bucket-de-prueba', destination: 'destino-de-prueba' },
    failNext: {},
    put: (key, body) => {
      objects.set(key, Buffer.from(body));
    },
    text: (key) => objects.get(key)?.toString('utf-8') ?? null,
    keys: (prefix = '') => [...objects.keys()].filter((key) => key.startsWith(prefix)).sort(),
    writesOf: (op) => writes.filter((write) => write.op === op).map((write) => write.key),
    resetWrites: () => {
      writes.length = 0;
    },
    r2Exports: () => {
      const take = (name: keyof FakeBucket['failNext']): void => {
        const error = bucket.failNext[name];
        if (error) {
          delete bucket.failNext[name];
          throw error;
        }
      };
      class R2NotConfiguredError extends Error {
        constructor() {
          super('Cloud save storage credentials are missing.');
          this.name = 'R2NotConfiguredError';
        }
      }
      const MACHINES_PREFIX = 'machines/';
      return {
        R2NotConfiguredError,
        MACHINES_PREFIX,
        machineKey: (machineId: string) => `${MACHINES_PREFIX}${machineId}.json`,
        getBucketName: () => bucket.config.bucket,
        getDestinationId: () => bucket.config.destination,
        isR2Configured: () => bucket.config.bucket !== null,
        listKeys: async (prefix: string) => {
          reads.list++;
          take('listKeys');
          return bucket.keys(prefix).map((key) => ({
            key,
            size: (objects.get(key) as Buffer).length,
          }));
        },
        uploadFile: async (key: string, filePath: string) => {
          take('uploadFile');
          const body = readFileSync(filePath);
          objects.set(key, body);
          writes.push({ op: 'upload', key });
          return statSync(filePath).size;
        },
        uploadText: async (key: string, body: string) => {
          take('uploadText');
          objects.set(key, Buffer.from(body));
          writes.push({ op: 'upload', key });
        },
        uploadJson: async (key: string, value: unknown) => {
          objects.set(key, Buffer.from(`${JSON.stringify(value, null, 2)}\n`));
          writes.push({ op: 'upload', key });
        },
        readText: async (key: string) => {
          reads.readText++;
          return bucket.text(key);
        },
        readJson: async (key: string) => {
          const text = bucket.text(key);
          if (!text) return null;
          try {
            return JSON.parse(text);
          } catch {
            return null;
          }
        },
        readJsonStrict: async (key: string) => {
          reads.readJsonStrict++;
          take('readJsonStrict');
          const text = bucket.text(key);
          if (text === null) return null;
          try {
            return JSON.parse(text);
          } catch {
            return null;
          }
        },
        downloadFile: async (key: string, destination: string) => {
          const body = objects.get(key);
          if (!body) throw new Error(`NoSuchKey: ${key}`);
          mkdirSync(dirname(destination), { recursive: true });
          writeFileSync(destination, body);
        },
        deleteKeys: async (keys: string[]) => {
          if (keys.length === 0) return;
          take('deleteKeys');
          for (const key of keys) {
            objects.delete(key);
            writes.push({ op: 'delete', key });
          }
        },
      };
    },
  };
  return bucket;
}
