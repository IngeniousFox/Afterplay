import SGDB from 'steamgriddb';

let cachedClient: SGDB | null = null;

const getApiKey = (): string => {
  const key = process.env.STEAMGRIDDB_API_KEY;
  if (!key) {
    throw new Error('Falta STEAMGRIDDB_API_KEY en el .env');
  }
  return key;
};

// Lazy por el mismo motivo que getDb(): así el .env ya está cargado cuando
// de verdad se use el cliente, en vez de asumirlo en el momento de importar
// este módulo.
export const getSgdbClient = (): SGDB => {
  if (!cachedClient) {
    cachedClient = new SGDB(getApiKey());
  }
  return cachedClient;
};
