import { and, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { gameInstalls, games, planEntries } from '../../schema';
import { alive } from '../../store';
import { liveGame } from '../common/alive';
import type { QueryContext } from '../common/context';
import type { OwnedGameRef } from '../../../../../shared/types';

// Lo que el escaneo de carpetas necesita saber de tu colección (sustituye a
// db/queries/games/getOwnedGames.ts): qué juegos existen ya —biblioteca Y
// Plan— para repartir cada carpeta entre "añadible", "ya lo tienes" y
// "estaba en tu plan". Consulta propia a propósito (ver la cabecera 1.x): no
// excluye los planeados.
//
// En 2.0: solo juegos vivos (uno borrado vuelve a ser "añadible"), y
// `planned` = entrada viva en `plan_entries`. La vinculación automática por
// escaneo (§11.2) necesita además la instalación de ESTE PC: si el juego ya
// tiene una no se toca, y su carpeta dice si el escaneo ya lo vinculó.
//
// Sin la vista común: el escaneo solo lee cuatro campos y no necesita ninguna
// de sus otras uniones.

const ownedPlan = alias(planEntries, 'owned_plan');
const ownedInstall = alias(gameInstalls, 'owned_inst');

/** Los juegos vivos de la colección, con si están en el Plan. Una consulta. */
export function getOwnedGames(ctx: QueryContext): OwnedGameRef<string>[] {
  const rows = ctx.db
    .select({
      id: games.id,
      igdbId: games.igdbId,
      title: games.title,
      planId: ownedPlan.id,
      installId: ownedInstall.id,
      installDirectory: ownedInstall.installDirectory,
    })
    .from(games)
    // Por la clave primaria (id de la entrada = gameId). La vida de la
    // entrada va en el ON, para que el LEFT siga siendo LEFT; el juego ya se
    // filtra vivo en el WHERE.
    .leftJoin(ownedPlan, and(eq(ownedPlan.id, games.id), alive(ownedPlan)))
    // La instalación de ESTE PC, viva.
    .leftJoin(
      ownedInstall,
      and(
        eq(ownedInstall.gameId, games.id),
        eq(ownedInstall.deviceId, ctx.deviceId),
        alive(ownedInstall),
      ),
    )
    .where(liveGame(games))
    .all();
  return rows.map(({ planId, installId, installDirectory, ...row }) => ({
    ...row,
    planned: planId !== null,
    hasLocalInstall: installId !== null,
    localInstallDirectory: installDirectory,
  }));
}
