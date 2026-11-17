import { eq } from 'drizzle-orm';
import { appMetaTable } from '../../../src/main/db/schema';
import type { TenantDb } from '../db';

// MODO MANTENIMIENTO del puente 1.8 (AFTERPLAY-2.0 §19.3 / §19.3.1).
//
// Cuando la 2.0 reclama el corte de una biblioteca deja una fila `cutover` en
// app_meta (en cualquier estado). Desde entonces el cronómetro y el buzón
// dejan de escribir: la biblioteca ya no es de la 1.x y lo que se escribiera
// aquí, o se perdería, o pisaría lo migrado. Las lecturas siguen.
//
// El Worker solo LEE app_meta. Nunca escribe `cutover` ni `hub`.
export const isInMaintenance = async (db: TenantDb): Promise<boolean> => {
  try {
    const rows = await db
      .select({ key: appMetaTable.key })
      .from(appMetaTable)
      .where(eq(appMetaTable.key, 'cutover'))
      .limit(1);
    return rows.length > 0;
  } catch (error) {
    // La base de este inquilino todavía no ha visto la migración de app_meta
    // (su escritorio aún no es la 1.8): no hay corte posible, y la petición
    // sigue como siempre. El resto de fallos sí se propagan — ante un error
    // real de la base se falla cerrado, no se abre.
    const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
    const cause = (error as { cause?: { message?: string } } | null)?.cause?.message ?? '';
    if (message.includes('no such table') || cause.toLowerCase().includes('no such table')) {
      return false;
    }
    throw error;
  }
};
