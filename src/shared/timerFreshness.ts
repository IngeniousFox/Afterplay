// LA REGLA DE FRESCURA DEL CRONÓMETRO (REMOTO.md §7.4), en UN solo sitio.
//
// Vive en shared porque la aplican dos barredores distintos contra dos bases
// distintas: el watcher del escritorio (sweepStaleTimerSessions, contra el
// SQLite local) y el Worker (getActiveTimer, contra Turso). Los dos tienen que
// contestar lo mismo a "¿esta sesión sigue viva?", porque si no el PC cierra
// por rancia una sesión que la web sigue pintando LIVE.
//
// Estuvo escrito DOS veces y con dos formas distintas —`6 * 3_600_000` en el
// Worker y un `private static readonly TIMER_STALE_HOURS = 6` en el watcher—,
// y esa segunda copia era imposible de comprobar desde ningún test: al ser
// privada no se podía importar. O sea que bajarla a 3 dejaba la suite entera
// en verde y, a partir de ahí, el PC cerraba a las tres horas lo que la web
// seguía dando por vivo otras tres. Ahora es un import compartido: la
// divergencia ya no se puede escribir.

// Cuánto puede callarse un cronómetro antes de darlo por abandonado.
//
// GENEROSO a propósito, y no los pocos minutos que sugeriría un latido de uno
// por minuto. El §7.5 avisa de por qué: los navegadores móviles suspenden las
// pestañas de fondo sin piedad, así que es normal que el latido se pare
// MIENTRAS SIGUES JUGANDO. Con un umbral corto, una tarde de consola con el
// móvil en el bolsillo se cortaría por la mitad.
//
// El precio es el opuesto y está asumido (§7.6): dormirse con el cronómetro
// puesto suma hasta seis horas de más. Pero eso se corrige después editando la
// sesión, y perder tiempo real no se corrige con nada.
export const TIMER_STALE_MS = 6 * 3_600_000;

// Lo mínimo que hace falta saber de una sesión para juzgar su frescura. Un
// structural type y no la fila entera: el watcher le pasa su OpenSession y el
// Worker las suyas, que son SELECTs recortados y distintos en cada consulta.
export type TimerFreshness = { startedAt: Date; lastHeartbeatAt: Date | null };

// El último latido, o el arranque si nunca llegó a latir (la pestaña murió en
// el primer minuto). Es a la vez la vara de la regla y la hora en la que se
// cierra la sesión si está rancia: cerrarla en `startedAt` daría duración cero
// y cerrarla AHORA regalaría las horas de silencio.
export const timerLastBeat = (session: TimerFreshness): Date =>
  session.lastHeartbeatAt ?? session.startedAt;

// Rancia = abandonada. El borde va con `>=`, así que seis horas clavadas ya
// son rancias; los dos lados lo heredan de aquí y no pueden discrepar ni en el
// número ni en el lado del borde.
export const isTimerStale = (session: TimerFreshness, now: number): boolean =>
  now - timerLastBeat(session).getTime() >= TIMER_STALE_MS;
