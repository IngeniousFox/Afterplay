import { sql } from 'drizzle-orm';
import { getDb } from '.';

// VACUUM INTO — la forma segura de SQLite de sacar una copia consistente
// del fichero sin arriesgarse a copiar el WAL a medias. Compartido por
// dailyBackup.ts (automática, rotando) y manualBackup.ts (a demanda, en la
// carpeta que elija el usuario, sin límite).
//
// El destino va en el literal SQL — VACUUM INTO no acepta parámetros
// ligados para la ruta — de ahí el escapado manual de comillas simples.
export const vacuumInto = async (filePath: string): Promise<void> => {
  const escaped = filePath.replace(/'/g, "''");
  await getDb().run(sql.raw(`VACUUM INTO '${escaped}'`));
};
