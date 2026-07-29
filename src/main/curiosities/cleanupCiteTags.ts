import { eq } from 'drizzle-orm';
import { getDb, withDbAccess } from '../db';
import { curiositiesTable } from '../db/schema';

// Limpieza de las curiosidades que Sonnet dejó con marcado de citas
// (<cite index="22-1">...</cite>) antes de que el generador aprendiera a
// quitarlo.
//
// Limpia EL TEXTO EN EL SITIO — no borra filas ni marca el juego como
// pendiente. La primera versión sí hacía eso último y fue un error caro: al
// quedarse enchufada en el arranque, cada reinicio reseteaba esos juegos, el
// backfill los regeneraba pagando otra vez, el modelo volvía a meter <cite> y
// vuelta a empezar. Un solo juego (Caravan SandWitch) se comió más de un euro
// en ese bucle.
//
// Así es idempotente y barata: si no queda nada con etiquetas no toca nada, y
// nunca provoca una llamada a la API.
const stripTags = (text: string): string => text.replace(/<\/?[a-z][^>]*>/gi, '').trim();

export const cleanupCiteTaggedCuriosities = async (): Promise<void> => {
  await withDbAccess(async () => {
    const db = getDb();
    const rows = await db
      .select({ id: curiositiesTable.id, text: curiositiesTable.text })
      .from(curiositiesTable);

    const dirty = rows
      .map((row) => ({ id: row.id, cleaned: stripTags(row.text), original: row.text }))
      .filter((row) => row.cleaned !== row.original && row.cleaned.length > 0);

    if (dirty.length === 0) {
      console.log('[curiosities] limpieza de <cite>: nada que limpiar.');
      return;
    }

    await db.transaction(async (tx) => {
      for (const row of dirty) {
        await tx
          .update(curiositiesTable)
          .set({ text: row.cleaned })
          .where(eq(curiositiesTable.id, row.id));
      }
    });

    console.log(
      `[curiosities] limpieza de <cite>: ${dirty.length} frase(s) limpiadas en el sitio.`,
    );
  });
};
