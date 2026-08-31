// EL REPARTO DEL PLAN EN ESTANTERÍAS y la deuda de su cabecera
// (PLAN-TO-PLAY.md §2.1-§2.5), escritos una sola vez.
//
// Estaban escritos dos veces: en src/renderer/src/lib/plan.ts y, copiados a
// mano dentro de un useMemo, en web/src/screens/PlanScreen.tsx. Coincidían —
// incluida la parte que menos se adivina, la de que el horizonte NO es
// excluyente— pero nada lo vigilaba, y esa parte sutil ya costó un fallo real
// (fijar un juego que estaba en el horizonte lo hacía DESAPARECER de allí: desde
// el sofá parecía que la app se había comido la cuenta atrás). Una corrección
// así aplicada en un solo lado deja las dos pantallas repartiendo distinto el
// mismo plan.
//
// Genéricas sobre la forma del juego y con los accesos INYECTADOS: el
// escritorio maneja Date y PlannedGameItem, la PWA maneja los milisegundos que
// sobreviven a un JSON, y "¿ha salido ya?" es a su vez una pareja copiada que
// tiene su propio test de paridad (isUnreleased/releaseSortKey). Lo que se
// comparte aquí es el REPARTO, que es lo que ninguna de las dos mitades debe
// volver a decidir por su cuenta.

// Lo que hay que saber leer de un juego para colocarlo en su estantería.
export type PlanShelfReaders<T> = {
  // La marca del fijado, o null si no está en Up next.
  pinnedAt: (game: T) => number | null;
  title: (game: T) => string;
  unreleased: (game: T) => boolean;
  // Por dónde ordenar el horizonte: cuanto antes salga, más arriba.
  releaseSortKey: (game: T) => number;
};

// Desempate estable por título: sin él, dos juegos fijados el mismo
// milisegundo (o dos sin fecha de salida) bailan de sitio entre repintados.
const byTitle = <T>(a: T, b: T, read: PlanShelfReaders<T>): number =>
  read.title(a).localeCompare(read.title(b), 'en', { sensitivity: 'base' });

// Up next: los fijados a mano, en orden de fijado (el último al final) — §2.2.
// Las lentes NO los tocan: es una estantería que TÚ has colocado, y
// reordenarla al cambiar de pregunta le quitaría justo lo que la hace distinta
// de la cola.
export const sortUpNext = <T>(games: readonly T[], read: PlanShelfReaders<T>): T[] =>
  games
    .filter((game) => read.pinnedAt(game) !== null)
    .sort(
      (a, b) => (read.pinnedAt(a) as number) - (read.pinnedAt(b) as number) || byTitle(a, b, read),
    );

// El horizonte: lo que aún no ha salido (§2.5). Se calcula sobre TODOS los
// planeados sin salir, ESTÉN FIJADOS O NO — es la única de las tres que no es
// excluyente, y es deliberado. Fijar dice "este me importa", no "quítalo del
// calendario"; el calendario no es una estantería de la que se saca algo, es la
// vista de lo que todavía no puedes jugar.
export const sortHorizon = <T>(games: readonly T[], read: PlanShelfReaders<T>): T[] =>
  games
    .filter((game) => read.unreleased(game))
    .sort((a, b) => read.releaseSortKey(a) - read.releaseSortKey(b) || byTitle(a, b, read));

// La cola: lo jugable que no has fijado. Aquí el reparto sí es real (una fila no
// puede estar en dos estanterías de lo jugable a la vez), así que salen los
// fijados y los que no han salido.
//
// Sale en el ORDEN EN QUE ENTRA: quién manda dentro de la cola es una decisión
// de cada pantalla (el escritorio le pasa una lente, la PWA no tiene lentes y
// se queda con el alfabético que ya trae la consulta), no del reparto.
export const filterQueue = <T>(games: readonly T[], read: PlanShelfReaders<T>): T[] =>
  games.filter((game) => read.pinnedAt(game) === null && !read.unreleased(game));

// La deuda de la cabecera (§2.1): el mismo criterio que la card de Backlog debt
// de Stats — horas de Main Story de HowLongToBeat, sin inventar nada para los
// juegos que no la tienen (se cuentan aparte y se dicen en pequeño) y sin los
// endless, que no tienen final que alcanzar.
//
// OJO al reparto asimétrico, que es justo lo que una copia se deja: los endless
// NO suman horas pero SÍ cuentan en totalGames — están en tu plan, aunque no
// tengan meta.
export type PlanDebt = {
  totalGames: number;
  totalHours: number;
  withoutEstimate: number;
};

export type PlanDebtGame = {
  endless: boolean;
  hltbMain: number | null;
};

export const computePlanDebt = <T extends PlanDebtGame>(games: readonly T[]): PlanDebt => {
  const counted = games.filter((game) => !game.endless);
  const withEstimate = counted.filter((game) => game.hltbMain !== null);
  return {
    totalGames: games.length,
    totalHours: withEstimate.reduce((sum, game) => sum + (game.hltbMain ?? 0), 0),
    withoutEstimate: counted.length - withEstimate.length,
  };
};
