import { and, eq, not, sql, type SQL } from 'drizzle-orm';
import { games } from '../../schema';
import { alive } from '../../store';
import type { QueryContext } from '../common/context';
import { hasLivePlan } from './shared';

// ¿Se puede devolver este juego de la biblioteca al Plan? (CONSULTAS.md §2.2,
// nota 1; sustituye a `canMoveToPlanWhere` de db/queries/games/moveToPlan.ts).
//
// La idea de la 1.x se conserva: solo vuelve al Plan un juego que, de hecho,
// no se ha jugado. "Unplayed" por sí solo no basta: puede tener horas,
// sesiones, logros o copias aunque nunca se eligiera un estado.
//
// Lo que cambia con el 2.0:
//   - La 1.x exigía EXACTAMENTE una iteración (la vacía que dejaba el alta).
//     En 2.0 el alta normal crea un playthrough con plataforma, origen y
//     formato, que no está "vacío" en aquel sentido, y un juego puede no tener
//     ninguno. Se admite como mucho UNO vivo, sin horas manuales, sin
//     valoración y sin contenido extra. Al moverlo, P2 le pone lápida.
//   - Ya no hay `plan_to_play` que perdonar: cualquier evento de estado vivo
//     bloquea, también el papeleo del alta (`'unknown'`): dar de alta un juego
//     como "jugando" ya dice algo de él, igual que en la 1.x.
//   - Solo cuenta lo vivo, con la regla F-11: la sesión o el evento de un
//     playthrough con lápida no bloquean (están borrados).
//   - Los logros son `achievement_unlocks` vivos del juego (el catálogo es
//     caché y no cuenta); las copias, `save_backups` vivas.
//   - Las compras (`purchase`) siguen sin bloquear: comprar y no jugar es
//     exactamente el caso del Plan.
//
// SQL con alias propios y nombres literales, como en la 1.x: es una
// condición para el WHERE de una consulta sobre `games`, y con alias no se
// confunde con ninguna tabla de la consulta de fuera.
//
// NOTA PARA LA INTEGRACIÓN: P2 (`queries/games/moveToPlan`) necesita esta
// MISMA condición dentro de su transacción, para autorizar el cambio con lo
// que hay en la base y no con lo que enseñaba la ficha. Tiene que ser una
// sola definición (que el gesto y la escritura no puedan discrepar): o P2
// importa esta, o se mueve a `common/` en P9.

/**
 * La condición, para el WHERE de una consulta sobre `games`. No comprueba que
 * el juego esté vivo ni que no esté ya planeado: eso lo añade quien la usa
 * (ver `canMoveToPlan`).
 */
export function canMoveToPlanCondition(gameId: string): SQL {
  return sql`(
    (select count(*) from "playthroughs" as "cmp_pt"
      where "cmp_pt"."gameId" = ${gameId} and "cmp_pt"."syncDeleted" is null) <= 1
    and not exists (
      select 1 from "playthroughs" as "cmp_pt"
      where "cmp_pt"."gameId" = ${gameId} and "cmp_pt"."syncDeleted" is null
        and (coalesce("cmp_pt"."manualHours", 0) <> 0
          or "cmp_pt"."rating" is not null
          or "cmp_pt"."extraContent" <> 0)
    )
    and not exists (
      select 1 from "sessions" as "cmp_s"
      join "playthroughs" as "cmp_pt" on "cmp_pt"."id" = "cmp_s"."playthroughId"
      where "cmp_pt"."gameId" = ${gameId} and "cmp_pt"."syncDeleted" is null
        and "cmp_s"."syncDeleted" is null
    )
    and not exists (
      select 1 from "state_events" as "cmp_se"
      join "playthroughs" as "cmp_pt" on "cmp_pt"."id" = "cmp_se"."playthroughId"
      where "cmp_pt"."gameId" = ${gameId} and "cmp_pt"."syncDeleted" is null
        and "cmp_se"."syncDeleted" is null
    )
    and not exists (
      select 1 from "spend_events" as "cmp_sp"
      where "cmp_sp"."gameId" = ${gameId} and "cmp_sp"."syncDeleted" is null
        and "cmp_sp"."type" <> 'purchase'
    )
    and not exists (
      select 1 from "achievement_unlocks" as "cmp_u"
      where "cmp_u"."gameId" = ${gameId} and "cmp_u"."syncDeleted" is null
    )
    and not exists (
      select 1 from "save_backups" as "cmp_sb"
      where "cmp_sb"."gameId" = ${gameId} and "cmp_sb"."syncDeleted" is null
    )
  )`;
}

/**
 * Si el juego se puede devolver al Plan: existe, está vivo, no está ya en el
 * Plan y cumple `canMoveToPlanCondition`. False en cualquier otro caso
 * (también si no existe). Una consulta.
 */
export function canMoveToPlan(ctx: QueryContext, gameId: string): boolean {
  const row = ctx.db
    .select({ id: games.id })
    .from(games)
    .where(
      and(
        eq(games.id, gameId),
        alive(games),
        not(hasLivePlan(games.id)),
        canMoveToPlanCondition(gameId),
      ),
    )
    .get();
  return row !== undefined;
}
