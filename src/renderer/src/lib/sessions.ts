// Aplanar las sesiones de TODAS las vueltas de un juego. El "dónde lo dejé",
// el histórico y las métricas no entienden de playthroughs: quieren las
// sesiones sueltas, de nueva a vieja. Esto estaba copiado —con pequeñas
// variantes que ya habían empezado a divergir— en cuatro vistas de TV
// (TvGameDetail dos veces, TvDetailSessions, TvDetailNotes).
//
// Genérico sobre la forma mínima para no acoplarse al tipo exacto del detalle
// (que difiere entre pantallas): cualquier objeto con iterations que tengan
// sessions con startedAt/endedAt sirve.
type SessionLike = { startedAt: Date; endedAt: Date | null };
type GameLike<S extends SessionLike> = { iterations?: { sessions: S[] }[] } | null | undefined;

const flatten = <S extends SessionLike>(game: GameLike<S>): S[] =>
  (game?.iterations ?? []).flatMap((iteration) => iteration.sessions);

// Todas, de nueva a vieja (incluida la abierta, si la hay).
export const allSessions = <S extends SessionLike>(game: GameLike<S>): S[] =>
  flatten(game).sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

// Solo las CERRADAS: son las que tienen duración honesta, las que suman en
// métricas y llenan el histórico. La viva aún no cuenta.
export const closedSessions = <S extends SessionLike>(game: GameLike<S>): S[] =>
  allSessions(game).filter((session) => session.endedAt !== null);

// La sesión ABIERTA ahora mismo (el watcher tiene el juego en marcha), o null.
// Como mucho hay una por juego Y DISPOSITIVO (§10.4), así que con dos PCs
// jugando el mismo juego puede haber dos: para distinguirlas, `openSessions`.
export const liveSession = <S extends SessionLike>(game: GameLike<S>): S | null =>
  flatten(game).find((session) => session.endedAt === null) ?? null;

// Todas las abiertas, de nueva a vieja. Las de otros dispositivos también: la
// interfaz separa la propia (la que se puede parar) de las ajenas (§10.8).
export const openSessions = <S extends SessionLike>(game: GameLike<S>): S[] =>
  allSessions(game).filter((session) => session.endedAt === null);
