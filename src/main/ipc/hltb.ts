import { ipcMain } from 'electron';
import { eq } from 'drizzle-orm';
import { getDb, withDbAccess } from '../db';
import { gamesTable } from '../db/schema';
import { getHltbTimes } from '../hltb/api';

export const registerHltbHandlers = (): void => {
  ipcMain.handle('hltb:getTimes', async (_event, title: string, releaseYear: number | null) => {
    return getHltbTimes(title, releaseYear);
  });

  // Volver a preguntarle a HowLongToBeat por UN juego ya dado de alta.
  //
  // Hace falta porque estos tiempos se piden UNA sola vez en la vida del
  // juego, en el alta (resolveGameEnrichment), y ahí se quedan: no hay
  // pasada de arranque ni "Sync now" que los toque nunca. Y sí se mueven —
  // un juego recién salido tiene una media inestable (pocos envíos) que se
  // asienta con los meses, y uno que recibe contenido grande sube. Esa cifra
  // alimenta además la Deuda del Backlog, así que arrastrar estimaciones
  // tempranas de todo el plan desvía el total.
  //
  // Es una sola petición sin clave ni límites agresivos, así que va directa
  // (nada de cola como en los logros) y devuelve ya el resultado.
  //
  // Los DOS tramos que tocan la DB van cada uno en su withDbAccess, con la
  // petición de red FUERA — misma regla que el ciclo del watcher: HLTB puede
  // tardar segundos y retener el candado ahí bloquearía un swap de conexión
  // en caliente (ver attemptSyncUpgrade en db/index.ts) por una espera que no
  // tiene nada que ver con la base de datos.
  ipcMain.handle('hltb:refreshGame', async (_event, gameId: number) => {
    const [game] = await withDbAccess(async () =>
      getDb()
        .select({ title: gamesTable.title, releaseYear: gamesTable.releaseYear })
        .from(gamesTable)
        .where(eq(gamesTable.id, gameId))
        .limit(1),
    );
    if (!game) return null;

    const times = await getHltbTimes(game.title, game.releaseYear);
    // Sin match con confianza suficiente: NO se pisa lo que ya había con
    // tres nulls. Que hoy HLTB no lo reconozca no invalida lo que sí
    // encontramos el día del alta — borrarlo sería perder un dato bueno a
    // cambio de nada.
    if (!times) return null;

    await withDbAccess(async () =>
      getDb()
        .update(gamesTable)
        .set({
          hltbMain: times.hltbMain,
          hltbMainExtras: times.hltbMainExtras,
          hltbCompletionist: times.hltbCompletionist,
        })
        .where(eq(gamesTable.id, gameId)),
    );

    return times;
  });
};
