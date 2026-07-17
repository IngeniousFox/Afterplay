// Solo el TIPO se importa estático (se borra en compilación) — el valor en
// runtime se carga con import() dinámico más abajo. "steamgriddb" es un
// paquete puramente ESM ("type":"module"), y el build del proceso main de
// electron-vite deja los node_modules externalizados como require() — un
// require() de un paquete ESM puro revienta o (como pasó aquí, comprobado en
// vivo en la app empaquetada) devuelve el objeto namespace del módulo entero
// en vez de la clase, así que `new SGDB(...)` fallaba con "SGDB is not a
// constructor". import() dinámico sí sabe cargar ESM desde código CJS.
import type SGDB from 'steamgriddb';

let cachedClient: SGDB | null = null;

const getApiKey = (): string => {
  const key = process.env.STEAMGRIDDB_API_KEY;
  if (!key) {
    throw new Error('Falta la clave de SteamGridDB — configúrala en Ajustes.');
  }
  return key;
};

// El cliente captura la clave al construirse — si se cambia desde Ajustes
// hay que tirar el cacheado para que la siguiente llamada use la nueva.
export const resetSgdbClient = (): void => {
  cachedClient = null;
};

// Lazy por el mismo motivo que getDb(): así el .env ya está cargado cuando
// de verdad se use el cliente, en vez de asumirlo en el momento de importar
// este módulo.
export const getSgdbClient = async (): Promise<SGDB> => {
  if (!cachedClient) {
    const { default: SGDBCtor } = await import('steamgriddb');
    cachedClient = new SGDBCtor(getApiKey());
  }
  return cachedClient;
};
