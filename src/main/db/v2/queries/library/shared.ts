import { sql, type SQL } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

// Piezas pequeñas que comparten las lecturas de este paquete.

/**
 * ¿Tiene el juego `gameId` una entrada VIVA en el Plan? Es lo que en 2.0
 * significa "planeado" (CONSULTAS.md §1.1.3), y sustituye a `games.planned`.
 *
 * Por la clave primaria: el id de `plan_entries` ES el `gameId` (store/ids.ts),
 * así que es una búsqueda por índice y no necesita un índice sobre
 * `plan_entries.gameId` (que no existe). Sin `gameIsAlive` dentro: quien la
 * usa ya filtra el juego vivo en su propia consulta, y una entrada viva de un
 * juego con lápida no la puede ver nadie.
 *
 * Va en el WHERE, donde Drizzle cualifica la columna con su tabla. Dentro de
 * la LISTA del SELECT de una consulta de una sola tabla Drizzle la escribe sin
 * tabla, y `"id"` a secas dentro de la subconsulta se resolvería contra la
 * propia `plan_entries` (la trampa documentada en getPlannedGames.ts de la
 * 1.x). Los tests de "los planeados no salen" lo vigilan.
 */
export const hasLivePlan = (gameId: AnySQLiteColumn): SQL =>
  sql`exists (select 1 from "plan_entries" as "lib_plan" where "lib_plan"."id" = ${gameId} and "lib_plan"."syncDeleted" is null)`;

// El orden de la biblioteca y del Plan: alfabético e insensible a mayúsculas,
// el `collate nocase` de la 1.x (getGames.ts, getPlannedGames.ts). La vista
// común (`gameViewRows`) ordena por creación, así que se ordena aquí, en
// memoria, sobre filas que ya están en JS.
//
// Imita `nocase` de SQLite: solo pliega A-Z (no acentos ni otros alfabetos,
// igual que SQLite) y compara por unidades de código. SQLite compara bytes
// UTF-8; los dos órdenes solo difieren entre caracteres por encima de U+E000
// y los de fuera del plano básico, que en títulos de juegos no aparecen.
// El `sort` de JS es estable: a igual título, queda el orden de creación que
// trae la vista, en vez del orden sin criterio que daba SQLite.
const foldAscii = (text: string): string => text.replace(/[A-Z]/g, (c) => c.toLowerCase());

export const compareTitlesNocase = (a: string, b: string): number => {
  const x = foldAscii(a);
  const y = foldAscii(b);
  return x < y ? -1 : x > y ? 1 : 0;
};
