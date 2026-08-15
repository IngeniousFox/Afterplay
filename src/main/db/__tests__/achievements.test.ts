import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { achievementUnlocksTable } from '../schema';
import {
  cleanupDbs,
  freshDb,
  makeAchievement,
  makeGame,
  makeIteration,
  makeSession,
  makeUnlock,
  type TestDb,
} from './harness';

// Los logros, por las TRES puertas que los pintan: la ficha del juego
// (getGameAchievements), la pantalla de Sesiones (getSessionUnlocks) y el
// bloque de trofeos de Stats (getAchievementsOverview) — más el ESCRITOR que
// decide de qué sesión cuelga cada uno cuando ya están guardados
// (replaceUnlockPlacements, en steam/syncAchievements.ts). El escritor entró
// aquí y no en su carpeta porque lo que había que blindar es que respeta la
// misma regla que storeUnlocks y que la pantalla de Sesiones no acaba
// enseñando lo que él haya colgado mal: eso solo se ve cruzando los dos.
//
// Lo que se blinda aquí no es el SQL, es el FUNDIDO. La tabla guarda un
// desbloqueo por (logro, FUENTE) —ese es su UNIQUE—, así que el mismo trofeo
// puede constar por el crack y por Steam a la vez, y las tres pantallas tienen
// que contestar LO MISMO sobre él: cuándo cayó, en qué sesión, y que es UNO.
// Esa regla estuvo copiada a mano en tres consultas y AUSENTE en la cuarta
// (por eso el mismo logro salía colgado de dos sesiones y la suma de la
// pantalla no cuadraba con la de la ficha); hoy vive en mergeUnlocks.ts. Estos
// tests existen para que siga viviendo en un solo sitio después de cualquier
// refactor — y para que la decisión pendiente de RETROACHIEVEMENTS §8
// (hardcore vs softcore), que toca justo este desempate, se pueda mover
// sabiendo exactamente qué pantallas cambian de respuesta.

let db: TestDb;
let getGameAchievements: typeof import('../queries/achievements/getGameAchievements').getGameAchievements;
let getSessionUnlocks: typeof import('../queries/achievements/getSessionUnlocks').getSessionUnlocks;
let getAchievementsOverview: typeof import('../queries/achievements/getAchievementsOverview').getAchievementsOverview;
let replaceUnlockPlacements: typeof import('../../steam/syncAchievements').replaceUnlockPlacements;

before(async () => {
  ({ getGameAchievements } = await import('../queries/achievements/getGameAchievements'));
  ({ getSessionUnlocks } = await import('../queries/achievements/getSessionUnlocks'));
  ({ getAchievementsOverview } = await import('../queries/achievements/getAchievementsOverview'));
  // syncAchievements pide '../db' desde src/main/steam, que es EL MISMO módulo
  // que el andamio dobla como '../index': Node casa los mocks por URL
  // resuelta, así que su getDb()/withDbAccess caen en la base del test igual
  // que los de las consultas. Import dentro del before() por lo de siempre
  // (ver la cabecera de harness.ts): el doble tiene que estar puesto antes.
  ({ replaceUnlockPlacements } = await import('../../steam/syncAchievements'));
});
beforeEach(async () => {
  db = await freshDb();
});
after(() => cleanupDbs());

// ── Fábricas locales ───────────────────────────────────────────────────────
//
// Todas las fechas van a MEDIODÍA UTC a propósito: la vista global agrupa por
// año y por mes con getFullYear()/getMonth(), que leen en hora LOCAL. Una
// fecha pegada a la medianoche contaría en un año distinto según el huso de la
// máquina que corra la suite, y un test que falla según dónde se ejecute es
// peor que no tenerlo.

type LogroSpec = {
  api: string;
  // Rareza global de Steam. null = no consta (y entonces el logro no puede
  // entrar ni en el salón de la fama ni en el perfil de rareza).
  rareza?: number | null;
  oculto?: boolean;
  orden?: number;
  icono?: string | null;
  iconoApagado?: string | null;
  descripcion?: string | null;
};

// El catálogo de un juego: qué logros EXISTEN. Devuelve los ids en el mismo
// orden en el que se declaran, para que el test pueda desbloquear "el tercero"
// sin arrastrar variables sueltas.
const catalogo = async (gameId: number, specs: LogroSpec[]): Promise<number[]> => {
  const ids: number[] = [];
  for (const [index, spec] of specs.entries()) {
    ids.push(
      await makeAchievement(db, gameId, spec.api, {
        globalPercent: spec.rareza ?? null,
        hidden: spec.oculto ?? false,
        sortIndex: spec.orden ?? index,
        iconUrl: spec.icono ?? null,
        iconGrayUrl: spec.iconoApagado ?? null,
        description: spec.descripcion ?? null,
      }),
    );
  }
  return ids;
};

// "El trofeo consta por Steam el 10 de enero, y cayó en esta sesión."
// `fiable: false` es el rescate del crack: lo tienes, pero la fecha es la del
// rescate y no la de la hazaña.
const consta = async (
  achievementId: number,
  source: 'steam' | 'emu' | 'ra',
  unlockedAt: string,
  extra: { fiable?: boolean; sessionId?: number; iterationId?: number } = {},
): Promise<number> =>
  makeUnlock(db, achievementId, unlockedAt, {
    source,
    dateReliable: extra.fiable ?? true,
    sessionId: extra.sessionId ?? null,
    iterationId: extra.iterationId ?? null,
  });

// Un juego con los desbloqueos YA PREGUNTADOS. La regla 2 de LOGROS-IDEAS §1
// deja fuera de completados y de "almost there" a los juegos donde nunca se
// preguntó ("no sabemos" no es "0%"), así que casi todo test de porcentajes
// necesita esta marca puesta.
const juegoPreguntado = async (title = 'Juego preguntado'): Promise<number> =>
  makeGame(db, {
    title,
    achievementsUnlocksSyncedAt: new Date('2026-08-01T12:00:00Z'),
  });

// Un juego preguntado con `total` logros de los que `unlocked` están sacados:
// lo único que mira "almost there" es ese ratio.
const juegoAlRatio = async (unlocked: number, total: number, title: string): Promise<number> => {
  const gameId = await juegoPreguntado(title);
  const ids = await catalogo(
    gameId,
    Array.from({ length: total }, (_, index) => ({ api: `${title}_${index}` })),
  );
  for (const id of ids.slice(0, unlocked)) await consta(id, 'steam', '2026-03-15T12:00:00Z');
  return gameId;
};

const isoDe = (date: Date | null): string | null => date?.toISOString() ?? null;

// ══ LA FICHA: getGameAchievements ═════════════════════════════════════════

describe('getGameAchievements — el fundido de fuentes (LOGROS §2)', () => {
  it('una fuente fiable gana a una que no, aunque su fecha sea posterior', async () => {
    // El caso REAL que puso la regla: al darle a Goldberg el catálogo que le
    // faltaba, el juego re-reportó de golpe los logros que ya tenías y el
    // emulador los selló todos con el segundo en que los recibió. Esa fecha es
    // la del rescate, no la de la hazaña — así que la de Steam manda aunque
    // sea un año más tarde. Si el desempate se invirtiera, la ficha diría que
    // el logro es de 2025 y el Journey se llenaría de tardes inventadas.
    const gameId = await juegoPreguntado();
    const [logro] = await catalogo(gameId, [{ api: 'SUMMIT' }]);
    await consta(logro, 'emu', '2025-03-01T12:00:00Z', { fiable: false });
    await consta(logro, 'steam', '2026-02-01T12:00:00Z', { fiable: true });

    const [entry] = (await getGameAchievements(gameId)).entries;
    assert.equal(isoDe(entry.unlockedAt), '2026-02-01T12:00:00.000Z');
    assert.equal(entry.dateReliable, true);
  });

  it('empatadas en fiabilidad manda la MÁS TEMPRANA — y con ella viajan su sesión y su vuelta', async () => {
    // "¿Cuándo hiciste esto por primera vez?" es la pregunta que contesta la
    // ficha, y la respuesta no cambia porque después lo repitieras en otra
    // vuelta. Lo que se blinda además es el EQUIPAJE de la fila ganadora: el
    // historial de sesiones cuelga el trofeo del rato correcto porque viaja el
    // sessionId de la ganadora, no el de una cualquiera.
    const gameId = await juegoPreguntado();
    const primeraVuelta = await makeIteration(db, gameId, { label: 'Playthrough 1' });
    const segundaVuelta = await makeIteration(db, gameId, { label: 'Playthrough 2' });
    const nocheVieja = await makeSession(db, primeraVuelta, '2026-01-10T18:00:00Z', 2);
    const nocheNueva = await makeSession(db, segundaVuelta, '2026-02-01T18:00:00Z', 2);
    const [logro] = await catalogo(gameId, [{ api: 'SUMMIT' }]);
    await consta(logro, 'steam', '2026-02-01T19:00:00Z', {
      sessionId: nocheNueva,
      iterationId: segundaVuelta,
    });
    await consta(logro, 'ra', '2026-01-10T19:00:00Z', {
      sessionId: nocheVieja,
      iterationId: primeraVuelta,
    });

    const [entry] = (await getGameAchievements(gameId)).entries;
    assert.equal(isoDe(entry.unlockedAt), '2026-01-10T19:00:00.000Z');
    assert.equal(entry.sessionId, nocheVieja);
    assert.equal(entry.iterationId, primeraVuelta);
  });

  it('entre dos fechas NO fiables también gana la más temprana, y el logro sigue marcado como no fiable', async () => {
    // Dos rescates: ninguna fecha vale, pero hay que elegir una fila para
    // representar al trofeo y el desempate no puede quedar al azar del orden
    // de lectura. Lo importante es que dateReliable NO se cure por juntar dos
    // fuentes malas — es lo que apaga el momento en el Journey.
    const gameId = await juegoPreguntado();
    const [logro] = await catalogo(gameId, [{ api: 'SUMMIT' }]);
    await consta(logro, 'emu', '2026-05-01T12:00:00Z', { fiable: false });
    await consta(logro, 'ra', '2026-03-01T12:00:00Z', { fiable: false });

    const [entry] = (await getGameAchievements(gameId)).entries;
    assert.equal(isoDe(entry.unlockedAt), '2026-03-01T12:00:00.000Z');
    assert.equal(entry.dateReliable, false);
  });

  it('las fuentes se acumulan TODAS, gane la que gane', async () => {
    // La ficha necesita la lista completa aunque solo pinte algo cuando
    // ninguna es Steam (el sello "local" / "RA" de AchievementsSection): si
    // `sources` se quedara solo con la ganadora, un logro sacado en el
    // emulador y confirmado luego por Steam perdería el rastro de que también
    // lo hiciste fuera.
    const gameId = await juegoPreguntado();
    const [logro] = await catalogo(gameId, [{ api: 'SUMMIT' }]);
    await consta(logro, 'emu', '2025-03-01T12:00:00Z', { fiable: false });
    await consta(logro, 'steam', '2026-02-01T12:00:00Z');
    await consta(logro, 'ra', '2026-04-01T12:00:00Z');

    const [entry] = (await getGameAchievements(gameId)).entries;
    // Ordenadas para no atarse al orden de lectura de SQLite, que no está
    // garantizado sin ORDER BY: lo que se blinda es que están las tres.
    assert.deepEqual([...entry.sources].sort(), ['emu', 'ra', 'steam']);
    assert.equal(isoDe(entry.unlockedAt), '2026-02-01T12:00:00.000Z');
  });

  it('un logro sin desbloquear sale con unlockedAt null, sin fuentes y sin sesión', async () => {
    // La mitad de la vitrina son logros que no tienes: tienen que llegar como
    // "no lo tienes" y no como "lo tienes en fecha desconocida". dateReliable
    // en true es el DEFECTO del bloqueado (no hay fecha que desconfiar); si un
    // refactor lo pusiera en false, la vitrina pintaría el aviso de "fecha no
    // fiable" sobre todo lo que aún no has sacado.
    const gameId = await juegoPreguntado();
    const [sacado, pendiente] = await catalogo(gameId, [{ api: 'FIRST' }, { api: 'LAST' }]);
    await consta(sacado, 'steam', '2026-02-01T12:00:00Z');

    const { entries } = await getGameAchievements(gameId);
    const bloqueado = entries.find((entry) => entry.id === pendiente);
    assert.equal(bloqueado?.unlockedAt, null);
    assert.deepEqual(bloqueado?.sources, []);
    assert.equal(bloqueado?.sessionId, null);
    assert.equal(bloqueado?.iterationId, null);
    assert.equal(bloqueado?.dateReliable, true);
  });

  it('la vitrina va en el orden de Steam (sortIndex), no en el de los ids ni el de las fechas', async () => {
    // El orden de la vitrina es el mismo que ves en la web de Steam, y eso es
    // parte de la lectura (los logros de la historia van seguidos). Un ORDER
    // BY perdido en un refactor devolvería el orden de inserción y nadie lo
    // notaría hasta ver la ficha de un juego resincronizado.
    const gameId = await juegoPreguntado();
    await catalogo(gameId, [
      { api: 'TERCERO', orden: 2 },
      { api: 'PRIMERO', orden: 0 },
      { api: 'SEGUNDO', orden: 1 },
    ]);

    const { entries } = await getGameAchievements(gameId);
    assert.deepEqual(
      entries.map((entry) => entry.apiName),
      ['PRIMERO', 'SEGUNDO', 'TERCERO'],
    );
  });

  it('los desbloqueos de OTRO juego no se cuelan aunque compartan el nombre interno', async () => {
    // apiName solo es único DENTRO de un juego: "ACHIEVEMENT_1" lo usan medio
    // Steam. Si el cruce se hiciera por nombre en vez de por id del logro, la
    // ficha se llenaría de trofeos de otra gente.
    const mio = await juegoPreguntado('El mío');
    const otro = await juegoPreguntado('El otro');
    const [logroMio] = await catalogo(mio, [{ api: 'ACHIEVEMENT_1' }]);
    const [logroOtro] = await catalogo(otro, [{ api: 'ACHIEVEMENT_1' }]);
    await consta(logroOtro, 'steam', '2026-02-01T12:00:00Z');

    const { entries } = await getGameAchievements(mio);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].id, logroMio);
    assert.equal(entries[0].unlockedAt, null);
  });

  it('a un logro oculto NO se le tapa la descripción: Steam ya no la manda', async () => {
    // CARACTERIZACIÓN de una decisión, no un descuido: Steam nunca devuelve la
    // descripción de un oculto por la Web API —ni siquiera de los que ya
    // tienes—, así que aquí llega null de origen y el filtro "escóndela hasta
    // desbloquearla" era código muerto. Si alguien lo "restaura", este test le
    // recuerda que el spoiler ya lo tapa el origen.
    const gameId = await juegoPreguntado();
    await catalogo(gameId, [{ api: 'SECRETO', oculto: true, descripcion: 'Mata al dragón' }]);

    const [entry] = (await getGameAchievements(gameId)).entries;
    assert.equal(entry.hidden, true);
    assert.equal(entry.description, 'Mata al dragón');
  });

  it('un juego sin catálogo devuelve sus sellos de sincronización y cero entradas', async () => {
    // Hay juegos en Steam SIN logros, y eso es una respuesta legítima: la
    // ficha tiene que poder distinguir "sincronizado y no tiene" de "todavía
    // no se ha preguntado", y para eso necesita los sellos aunque no haya
    // ninguna entrada que pintar.
    const gameId = await makeGame(db, {
      steamAppId: 620,
      achievementsSyncedAt: new Date('2026-02-01T12:00:00Z'),
      achievementsUnlocksSyncedAt: new Date('2026-02-02T12:00:00Z'),
    });

    const result = await getGameAchievements(gameId);
    assert.deepEqual(result.entries, []);
    assert.equal(result.steamAppId, 620);
    assert.equal(isoDe(result.syncedAt), '2026-02-01T12:00:00.000Z');
    assert.equal(isoDe(result.unlocksSyncedAt), '2026-02-02T12:00:00.000Z');
  });

  it('un juego que no existe no revienta: contesta vacío', async () => {
    // La ficha se pide por id desde el renderer y una carrera con un borrado
    // (o un id viejo en una vista de TV que no se refrescó) no puede tumbar el
    // main con un TypeError sobre undefined.
    assert.deepEqual(await getGameAchievements(9999), {
      gameId: 9999,
      steamAppId: null,
      syncedAt: null,
      unlocksSyncedAt: null,
      entries: [],
    });
  });
});

// ══ LA PANTALLA DE SESIONES: getSessionUnlocks ════════════════════════════

describe('getSessionUnlocks — un trofeo, UNA sesión (LOGROS-IDEAS §2.1)', () => {
  it('el mismo trofeo no puede aparecer en dos sesiones: cuelga de la fuente ganadora', async () => {
    // LA cicatriz de esta consulta. Antes se deduplicaba por (sesión, logro),
    // que junta las dos fuentes solo si cayeron en la MISMA sesión: un logro
    // sacado con el crack en 2025 y otra vez en Steam en 2026 salía en las dos
    // filas de sesión —dos trofeos donde hay uno— y la suma de la pantalla
    // dejaba de cuadrar con los logros del juego.
    const gameId = await juegoPreguntado();
    const iteration = await makeIteration(db, gameId);
    const nocheDelCrack = await makeSession(db, iteration, '2025-05-01T18:00:00Z', 2);
    const nocheDeSteam = await makeSession(db, iteration, '2026-02-01T18:00:00Z', 2);
    const [logro] = await catalogo(gameId, [{ api: 'SUMMIT' }]);
    await consta(logro, 'emu', '2025-05-01T19:00:00Z', {
      fiable: false,
      sessionId: nocheDelCrack,
    });
    await consta(logro, 'steam', '2026-02-01T19:00:00Z', { sessionId: nocheDeSteam });

    const unlocks = await getSessionUnlocks();
    assert.equal(unlocks.length, 1);
    assert.equal(unlocks[0].sessionId, nocheDeSteam);
    assert.equal(unlocks[0].achievementId, logro);
  });

  it('la sesión del trofeo es exactamente la misma que enseña la ficha', async () => {
    // DIVERGENCIA: la ficha (getGameAchievements → SessionHistoryList) y la
    // pantalla global de Sesiones responden a la misma pregunta por caminos
    // distintos, y la respuesta tiene que ser la misma o el usuario ve el
    // trofeo en un rato en un sitio y en otro rato en el otro. Este test
    // compara las dos salidas en el caso que las hizo divergir: dos fuentes,
    // dos sesiones, empate de fiabilidad.
    const gameId = await juegoPreguntado();
    const iteration = await makeIteration(db, gameId);
    const temprana = await makeSession(db, iteration, '2026-01-10T18:00:00Z', 2);
    const tardia = await makeSession(db, iteration, '2026-03-10T18:00:00Z', 2);
    const [logro] = await catalogo(gameId, [{ api: 'SUMMIT' }]);
    await consta(logro, 'steam', '2026-03-10T19:00:00Z', { sessionId: tardia });
    await consta(logro, 'ra', '2026-01-10T19:00:00Z', { sessionId: temprana });

    const [entry] = (await getGameAchievements(gameId)).entries;
    const [unlock] = await getSessionUnlocks();
    assert.equal(unlock.sessionId, entry.sessionId);
    assert.equal(unlock.sessionId, temprana);
  });

  it('si la fuente ganadora no cayó en ninguna sesión, el trofeo no cuelga de ninguna fila', async () => {
    // El caso "con fecha, sin sesión" es el MAYORITARIO del pasado (regla 3 de
    // LOGROS-IDEAS §1): casi todo el historial de Steam es anterior a la app.
    // Aquí la perdedora sí tiene sesión, y aun así el trofeo desaparece de la
    // pantalla de Sesiones — a propósito: si la perdedora representara al
    // trofeo por el mero hecho de tener sesión, esta pantalla volvería a dar
    // una respuesta distinta a la de la ficha. Y la ficha también dice null.
    //
    // Se revisó como posible fallo por su efecto visible —tras una sincro, una
    // fila de sesión PIERDE un trofeo que ya enseñaba, sin que el usuario haya
    // hecho nada— y se confirma que el comportamiento bueno es este. Lo que
    // aprendió la sincro es que el logro ya era tuyo en 2019; el 2026 de la
    // otra fuente es la marca del rescate, no la hazaña. Colgarlo de la sesión
    // de la perdedora sería pintar en una noche de 2026 un trofeo fechado en
    // 2019, y encima contradiciendo a la ficha, que sigue diciendo null: una
    // pantalla enseñándolo y la otra no es peor que un contador que baja.
    // Si algún día se toca el desempate (RETROACHIEVEMENTS §8, hardcore vs
    // softcore), este test es el que avisa de que el cambio no mueve solo
    // fechas: mueve trofeos de fila y vacía filas.
    const gameId = await juegoPreguntado();
    const iteration = await makeIteration(db, gameId);
    const nocheDelCrack = await makeSession(db, iteration, '2026-05-01T18:00:00Z', 2);
    const [logro] = await catalogo(gameId, [{ api: 'SUMMIT' }]);
    await consta(logro, 'emu', '2026-05-01T19:00:00Z', {
      fiable: false,
      sessionId: nocheDelCrack,
    });
    // La de Steam es fiable y gana, pero es de antes de que existiera la app.
    await consta(logro, 'steam', '2019-07-04T12:00:00Z');

    assert.deepEqual(await getSessionUnlocks(), []);
    const [entry] = (await getGameAchievements(gameId)).entries;
    assert.equal(entry.sessionId, null);
  });

  it('los desbloqueos huérfanos (sin sesión en ninguna fuente) no salen', async () => {
    // Regla 3 del documento: no pertenecen a ninguna fila. Además es lo que
    // permite el acotado de la consulta —sin él era un escaneo de las 39.602
    // filas de producción con su join, y esto lo pide el HUD del overlay EN
    // PLENA PARTIDA—, así que el día que alguien quite la subconsulta este
    // test tiene que seguir verde por la otra puerta.
    const gameId = await juegoPreguntado();
    const [logro] = await catalogo(gameId, [{ api: 'VIEJO' }]);
    await consta(logro, 'steam', '2019-07-04T12:00:00Z');

    assert.deepEqual(await getSessionUnlocks(), []);
  });

  it('cada fila trae lo justo para pintarse, y llega de cualquier juego (la pantalla es global)', async () => {
    const uno = await juegoPreguntado('Celeste');
    const otro = await juegoPreguntado('Hollow Knight');
    const iterUno = await makeIteration(db, uno);
    const iterOtro = await makeIteration(db, otro);
    const sesionUno = await makeSession(db, iterUno, '2026-01-10T18:00:00Z', 2);
    const sesionOtra = await makeSession(db, iterOtro, '2026-01-11T18:00:00Z', 2);
    const [logroUno] = await catalogo(uno, [
      { api: 'SUMMIT', rareza: 1.8, icono: 'https://icono/summit.jpg' },
    ]);
    const [logroOtro] = await catalogo(otro, [{ api: 'PANTHEON' }]);
    await consta(logroUno, 'steam', '2026-01-10T19:00:00Z', { sessionId: sesionUno });
    await consta(logroOtro, 'steam', '2026-01-11T19:00:00Z', { sessionId: sesionOtra });

    const unlocks = await getSessionUnlocks();
    assert.equal(unlocks.length, 2);
    assert.deepEqual(
      unlocks.find((unlock) => unlock.achievementId === logroUno),
      {
        sessionId: sesionUno,
        achievementId: logroUno,
        displayName: 'SUMMIT',
        iconUrl: 'https://icono/summit.jpg',
        globalPercent: 1.8,
      },
    );
  });

  it('tres fuentes en tres sesiones distintas siguen siendo UNA fila', async () => {
    // La invariante llevada al extremo que permite el UNIQUE (logro, fuente):
    // steam + emu + ra son tres filas del MISMO trofeo, y la pantalla de
    // Sesiones no puede sumar tres. Gana la más temprana de las fiables — el
    // rescate no compite aunque su sesión sea posterior.
    const gameId = await juegoPreguntado();
    const iteration = await makeIteration(db, gameId);
    const enero = await makeSession(db, iteration, '2026-01-10T18:00:00Z', 2);
    const febrero = await makeSession(db, iteration, '2026-02-10T18:00:00Z', 2);
    const marzo = await makeSession(db, iteration, '2026-03-10T18:00:00Z', 2);
    const [logro] = await catalogo(gameId, [{ api: 'SUMMIT' }]);
    await consta(logro, 'emu', '2026-01-10T19:00:00Z', { fiable: false, sessionId: enero });
    await consta(logro, 'ra', '2026-02-10T19:00:00Z', { sessionId: febrero });
    await consta(logro, 'steam', '2026-03-10T19:00:00Z', { sessionId: marzo });

    const unlocks = await getSessionUnlocks();
    assert.deepEqual(
      unlocks.map((unlock) => unlock.sessionId),
      [febrero],
    );
  });

  it('esta consulta se fía de sessionId: la regla del rescate la aplica QUIEN ESCRIBE', async () => {
    // El reparto de responsabilidades, fijado. La regla 1 de LOGROS-IDEAS §1
    // dice que un dateReliable=false no cuenta "ni en 'logros de 2026', ni en
    // sesiones, ni en heatmaps", y esta consulta NO la comprueba: para ella
    // colgar de una sesión es una relación ya resuelta en la base (sessionId),
    // no una lectura de la fecha. Y tiene que seguir así, porque la ficha
    // (getGameAchievements) tampoco la comprueba: si esta filtrara por su
    // cuenta, las dos pantallas volverían a contestar distinto sobre el mismo
    // trofeo, que es la divergencia que persigue todo este fichero.
    //
    // Lo que hace legítima esa confianza es que AMBOS escritores de la columna
    // respeten la regla. storeUnlocks siempre lo hizo; replaceUnlockPlacements
    // recolocaba TODAS las filas del juego mirando solo la fecha, y los 25
    // logros de un rescate de Goldberg llevan el segundo en que el juego los
    // re-reportó —un segundo DENTRO de la sesión que estabas jugando—, así que
    // una sola llamada al canal 'achievements:replacePlacements' se los colgaba
    // a esa noche. Arreglado en el escritor (ver el describe de abajo), que es
    // donde estaba el fallo: una fila así ya no la crea nadie, y si aparece
    // (una base tocada a mano, una versión vieja) esta pantalla la enseña
    // igual que la ficha en vez de inventarse un criterio propio.
    const gameId = await juegoPreguntado();
    const iteration = await makeIteration(db, gameId);
    const sesion = await makeSession(db, iteration, '2026-05-01T18:00:00Z', 2);
    const [logro] = await catalogo(gameId, [{ api: 'RESCATADO' }]);
    await consta(logro, 'emu', '2026-05-01T19:00:00Z', { fiable: false, sessionId: sesion });

    const unlocks = await getSessionUnlocks();
    assert.deepEqual(
      unlocks.map((unlock) => unlock.sessionId),
      [sesion],
    );
  });
});

// ══ EL ESCRITOR: replaceUnlockPlacements ══════════════════════════════════

// De dónde cuelga cada desbloqueo lo escriben DOS funciones (storeUnlocks al
// sincronizar, replaceUnlockPlacements al recolocar sin red) y la columna es
// la misma, así que la regla tiene que ser la misma en las dos o la segunda
// deshace la honestidad de la primera. Aquí se prueba la de recolocar, que es
// la que se la saltaba.

// Cómo quedó colgada una fila concreta, leída de la base y no de lo que
// devuelva la función.
const colgadoDe = async (
  unlockId: number,
): Promise<{ sessionId: number | null; iterationId: number | null }> => {
  const [row] = await db
    .select({
      sessionId: achievementUnlocksTable.sessionId,
      iterationId: achievementUnlocksTable.iterationId,
    })
    .from(achievementUnlocksTable)
    .where(eq(achievementUnlocksTable.id, unlockId));
  return row;
};

describe('replaceUnlockPlacements — recolocar sin inventarse momentos', () => {
  it('un rescate NO se cuelga de la sesión aunque su segundo caiga dentro', async () => {
    // EL caso que arregló esta función. Goldberg re-reporta de golpe los
    // logros que ya tenías y los sella con el mismo segundo — el segundo en
    // que le diste al refresco, o sea, un instante que cae DENTRO de la sesión
    // que estabas jugando. storeUnlocks los guarda con dateReliable=false y
    // sin sesión, correctamente; recolocar miraba solo la fecha y se los
    // colgaba a esa noche, y a partir de ahí la pantalla de Sesiones enseñaba
    // veinticinco trofeos en una fila de dos horas. Los que SÍ tienen fecha
    // buena siguen recolocándose: de eso va la función.
    const gameId = await juegoPreguntado();
    const iteration = await makeIteration(db, gameId);
    const sesion = await makeSession(db, iteration, '2026-05-01T18:00:00Z', 2);
    const [deVerdad, rescateUno, rescateDos] = await catalogo(gameId, [
      { api: 'DE_VERDAD' },
      { api: 'RESCATE_1' },
      { api: 'RESCATE_2' },
    ]);
    const filaBuena = await consta(deVerdad, 'steam', '2026-05-01T18:40:00Z');
    const filaRescateUno = await consta(rescateUno, 'emu', '2026-05-01T19:00:00Z', {
      fiable: false,
    });
    const filaRescateDos = await consta(rescateDos, 'emu', '2026-05-01T19:00:00Z', {
      fiable: false,
    });

    const placed = await replaceUnlockPlacements(gameId);

    assert.equal(placed, 1);
    assert.deepEqual(await colgadoDe(filaBuena), { sessionId: sesion, iterationId: iteration });
    assert.deepEqual(await colgadoDe(filaRescateUno), { sessionId: null, iterationId: null });
    assert.deepEqual(await colgadoDe(filaRescateDos), { sessionId: null, iterationId: null });
  });

  it('descuelga el rescate que una recolocación vieja hubiera colgado mal', async () => {
    // El null se ESCRIBE, no se salta la fila: si la base ya venía con un
    // rescate colgado (una versión anterior de esta función, una fila tocada a
    // mano), pasar por aquí lo repara en vez de dejarlo enquistado. Sin esto,
    // el arreglo solo valdría para las bases nuevas.
    const gameId = await juegoPreguntado();
    const iteration = await makeIteration(db, gameId);
    const sesion = await makeSession(db, iteration, '2026-05-01T18:00:00Z', 2);
    const [logro] = await catalogo(gameId, [{ api: 'RESCATADO' }]);
    const fila = await consta(logro, 'emu', '2026-05-01T19:00:00Z', {
      fiable: false,
      sessionId: sesion,
      iterationId: iteration,
    });

    const placed = await replaceUnlockPlacements(gameId);

    assert.equal(placed, 0);
    assert.deepEqual(await colgadoDe(fila), { sessionId: null, iterationId: null });
  });

  it('recolocar no le mete a la pantalla de Sesiones trofeos que no jugaste ese rato', async () => {
    // El escritor y el lector, cruzados: es donde se ve el daño de verdad. La
    // noche buena enseña SU trofeo y solo ese, no los veinticinco del rescate.
    const gameId = await juegoPreguntado();
    const iteration = await makeIteration(db, gameId);
    const sesion = await makeSession(db, iteration, '2026-05-01T18:00:00Z', 2);
    const [deVerdad, rescate] = await catalogo(gameId, [{ api: 'DE_VERDAD' }, { api: 'RESCATE' }]);
    await consta(deVerdad, 'steam', '2026-05-01T18:40:00Z');
    await consta(rescate, 'emu', '2026-05-01T19:00:00Z', { fiable: false });

    await replaceUnlockPlacements(gameId);

    const unlocks = await getSessionUnlocks();
    assert.deepEqual(
      unlocks.map((unlock) => [unlock.sessionId, unlock.displayName]),
      [[sesion, 'DE_VERDAD']],
    );
  });

  it('un desbloqueo fiable fuera de toda sesión sigue sin colgar de ninguna', async () => {
    // El otro borde de la guarda: la fecha es buena, pero no cae en ningún
    // rato registrado (lo sacaste antes de usar la app, o en otro PC). Que la
    // función sepa decir "no sé" es lo que la hace segura de llamar a menudo.
    const gameId = await juegoPreguntado();
    const iteration = await makeIteration(db, gameId);
    await makeSession(db, iteration, '2026-05-01T18:00:00Z', 2);
    const [logro] = await catalogo(gameId, [{ api: 'VIEJO' }]);
    const fila = await consta(logro, 'steam', '2019-07-04T12:00:00Z');

    assert.equal(await replaceUnlockPlacements(gameId), 0);
    assert.deepEqual(await colgadoDe(fila), { sessionId: null, iterationId: null });
  });
});

// ══ LA VISTA GLOBAL: getAchievementsOverview ══════════════════════════════

describe('getAchievementsOverview — las dos reglas que cruzan todo (LOGROS-IDEAS §1)', () => {
  it('una fecha no fiable cuenta en el total pero JAMÁS en un año (regla 1)', async () => {
    // La columna dateReliable existe exactamente para esto: sigue siendo
    // cierto que tienes el logro, lo que no se sabe es cuándo. Si se colara en
    // los años, el gráfico diría que una tarde hiciste veinticinco logros de
    // James Bond en el mismo segundo.
    const gameId = await juegoPreguntado();
    const [real, rescatado] = await catalogo(gameId, [{ api: 'REAL' }, { api: 'RESCATADO' }]);
    await consta(real, 'steam', '2026-03-15T12:00:00Z');
    await consta(rescatado, 'emu', '2026-03-15T12:00:00Z', { fiable: false });

    const overview = await getAchievementsOverview(null);
    assert.equal(overview.totalUnlocked, 2);
    assert.deepEqual(overview.unlockedByYear, [{ year: 2026, total: 1, rare: 0, ultra: 0 }]);
  });

  it('el mismo logro por dos fuentes es UN desbloqueo, no dos', async () => {
    // La invariante que un refactor rompe sin enterarse: si el conteo pasara a
    // hacerse sobre las filas de achievement_unlocks en vez de sobre los
    // logros fundidos, el total de Stats subiría solo por resincronizar, y la
    // tarjeta de Ajustes volvería al "541 de 527".
    const gameId = await juegoPreguntado();
    const [logro] = await catalogo(gameId, [{ api: 'SUMMIT' }]);
    await consta(logro, 'emu', '2026-03-01T12:00:00Z');
    await consta(logro, 'steam', '2026-03-15T12:00:00Z');

    const overview = await getAchievementsOverview(null);
    assert.equal(overview.totalUnlocked, 1);
    assert.equal(overview.totalCatalog, 1);
    assert.deepEqual(overview.unlockedByYear, [{ year: 2026, total: 1, rare: 0, ultra: 0 }]);
  });

  it('la ficha y la vista global cuentan los mismos desbloqueos para el mismo juego', async () => {
    // DIVERGENCIA: dos consultas distintas, el mismo fundido. Con dos fuentes
    // por logro es donde se separaban las copias a mano de la regla.
    const gameId = await juegoPreguntado();
    // El tercero se queda sin desbloquear a propósito: así el conteo tiene que
    // salir de los logros con fuente y no del tamaño del catálogo.
    const [uno, dos] = await catalogo(gameId, [{ api: 'A' }, { api: 'B' }, { api: 'C' }]);
    await consta(uno, 'steam', '2026-01-10T12:00:00Z');
    await consta(uno, 'emu', '2025-01-10T12:00:00Z', { fiable: false });
    await consta(dos, 'ra', '2026-02-10T12:00:00Z');

    const enLaFicha = (await getGameAchievements(gameId)).entries.filter(
      (entry) => entry.unlockedAt !== null,
    ).length;
    const overview = await getAchievementsOverview(null);
    assert.equal(enLaFicha, 2);
    assert.equal(overview.totalUnlocked, enLaFicha);
  });

  it('un juego sin desbloqueos preguntados NO es un juego al 0% (regla 2)', async () => {
    // achievementsUnlocksSyncedAt null significa "no sabemos", no "no tienes
    // ninguno": meterlo en los rankings de completado los hundiría con ceros
    // falsos. Su catálogo sí cuenta en el total de la biblioteca — eso sí se
    // sabe, es información del juego y no tuya.
    const sinPreguntar = await makeGame(db, { title: 'Nunca preguntado' });
    await catalogo(sinPreguntar, [{ api: 'A' }, { api: 'B' }, { api: 'C' }, { api: 'D' }]);
    await juegoAlRatio(3, 4, 'Preguntado');

    const overview = await getAchievementsOverview(null);
    assert.equal(overview.totalCatalog, 8);
    assert.deepEqual(
      overview.almostThere.map((game) => game.title),
      ['Preguntado'],
    );
    assert.deepEqual(overview.perfectGames, []);
  });
});

describe('getAchievementsOverview — el muro del 100% (LOGROS-IDEAS §3.2)', () => {
  it('la fecha del cierre es la del ÚLTIMO logro', async () => {
    const gameId = await juegoPreguntado('Perfecto');
    const ids = await catalogo(gameId, [{ api: 'A' }, { api: 'B' }, { api: 'C' }]);
    await consta(ids[0], 'steam', '2026-01-10T12:00:00Z');
    await consta(ids[1], 'steam', '2026-06-20T12:00:00Z');
    await consta(ids[2], 'steam', '2026-03-15T12:00:00Z');

    const [perfecto] = (await getAchievementsOverview(null)).perfectGames;
    assert.equal(perfecto.title, 'Perfecto');
    assert.equal(perfecto.total, 3);
    assert.equal(isoDe(perfecto.completedAt), '2026-06-20T12:00:00.000Z');
  });

  it('con un solo rescate por medio el 100% se queda sin fecha, pero sigue en el muro', async () => {
    // El juego está perfecto y eso es un hecho; CUÁNDO lo cerraste, no — con
    // una fecha de rescate por medio el momento sería inventado, y en modo año
    // el muro se queda sin él a propósito ("perfeccionados ESE año" no puede
    // incluir un juego cuyo cierre no se sabe cuándo fue).
    const gameId = await juegoPreguntado('Medio rescatado');
    const ids = await catalogo(gameId, [{ api: 'A' }, { api: 'B' }]);
    await consta(ids[0], 'steam', '2026-01-10T12:00:00Z');
    await consta(ids[1], 'emu', '2026-06-20T12:00:00Z', { fiable: false });

    const todo = await getAchievementsOverview(null);
    assert.equal(todo.perfectGames.length, 1);
    assert.equal(todo.perfectGames[0].completedAt, null);

    const delAño = await getAchievementsOverview(2026);
    assert.deepEqual(delAño.perfectGames, []);
  });

  it('con año filtrado, el muro son los perfeccionados ESE año', async () => {
    const viejo = await juegoPreguntado('Cerrado en 2025');
    const nuevo = await juegoPreguntado('Cerrado en 2026');
    const [logroViejo] = await catalogo(viejo, [{ api: 'A' }]);
    const [logroNuevo] = await catalogo(nuevo, [{ api: 'A' }]);
    await consta(logroViejo, 'steam', '2025-06-20T12:00:00Z');
    await consta(logroNuevo, 'steam', '2026-06-20T12:00:00Z');

    const overview = await getAchievementsOverview(2026);
    assert.deepEqual(
      overview.perfectGames.map((game) => game.title),
      ['Cerrado en 2026'],
    );
  });

  it('el muro ordena por tamaño del catálogo: un 100% de 30 pesa más que uno de 2', async () => {
    // Sin esto el muro pone al mismo nivel el juego de dos logros que el de
    // treinta, y el muro deja de decir nada.
    await juegoAlRatio(2, 2, 'Pequeño');
    await juegoAlRatio(30, 30, 'Grande');

    const overview = await getAchievementsOverview(null);
    assert.deepEqual(
      overview.perfectGames.map((game) => game.title),
      ['Grande', 'Pequeño'],
    );
  });
});

describe('getAchievementsOverview — almost there (LOGROS-IDEAS §4.1)', () => {
  it('el umbral es el 75% INCLUIDO, y el 100% ya no es "casi"', async () => {
    // 75 es una constante decidida (§7, abierta entre 75/80) para que la lista
    // no salga vacía en bibliotecas jóvenes. El borde exacto importa: 3 de 4
    // es el caso más común de la biblioteca y tiene que entrar.
    await juegoAlRatio(3, 4, 'Justo en el umbral');
    await juegoAlRatio(7, 10, 'Por debajo');
    await juegoAlRatio(4, 4, 'Perfecto');

    const overview = await getAchievementsOverview(null);
    assert.deepEqual(
      overview.almostThere.map((game) => game.title),
      ['Justo en el umbral'],
    );
    assert.deepEqual(overview.almostThere[0].unlocked, 3);
    assert.deepEqual(overview.almostThere[0].total, 4);
  });

  it('ordena por cercanía al 100% y se corta en seis juegos', async () => {
    // Es una lista para decidir a qué juegas ESTA noche, no un inventario: si
    // el corte se pierde, la card se convierte en una parrilla entera.
    await juegoAlRatio(6, 8, 'r750');
    await juegoAlRatio(7, 9, 'r778');
    await juegoAlRatio(8, 10, 'r800');
    await juegoAlRatio(9, 11, 'r818');
    await juegoAlRatio(7, 8, 'r875');
    await juegoAlRatio(8, 9, 'r889');
    await juegoAlRatio(9, 10, 'r900');

    const overview = await getAchievementsOverview(null);
    assert.deepEqual(
      overview.almostThere.map((game) => game.title),
      ['r900', 'r889', 'r875', 'r818', 'r800', 'r778'],
    );
  });

  it('lo que falta va de lo MÁS común a lo menos, cortado en cinco y con el icono apagado', async () => {
    // Lo que tiene más gente es lo más alcanzable: el plan para esta noche, no
    // el muro del 0.5%. Y el icono va en gris a propósito — aún no es tuyo.
    const gameId = await juegoPreguntado('Casi');
    const ids = await catalogo(gameId, [
      ...Array.from({ length: 18 }, (_, index) => ({ api: `HECHO_${index}` })),
      { api: 'FALTA_23', rareza: 23, icono: 'color-23', iconoApagado: 'gris-23' },
      { api: 'FALTA_22', rareza: 22, icono: 'color-22' },
      { api: 'FALTA_21', rareza: 21 },
      { api: 'FALTA_20', rareza: 20 },
      { api: 'FALTA_19', rareza: 19 },
      { api: 'FALTA_18', rareza: 18 },
    ]);
    for (const id of ids.slice(0, 18)) await consta(id, 'steam', '2026-03-15T12:00:00Z');

    const [casi] = (await getAchievementsOverview(null)).almostThere;
    assert.deepEqual(
      casi.missing.map((logro) => logro.displayName),
      ['FALTA_23', 'FALTA_22', 'FALTA_21', 'FALTA_20', 'FALTA_19'],
    );
    assert.equal(casi.missing[0].iconUrl, 'gris-23');
    // Sin icono apagado se cae al de color: mejor un icono encendido que un
    // hueco en la lista.
    assert.equal(casi.missing[1].iconUrl, 'color-22');
  });

  it('los ocultos siguen siendo spoiler: viaja el nombre, jamás la descripción', async () => {
    // Regla 4 del documento. El guardián de verdad son las CLAVES del objeto:
    // si alguien añade `description` al payload de lo que falta, la lista de
    // "te quedan estos 2" empezaría a contar el final del juego.
    const gameId = await juegoPreguntado('Con secretos');
    const ids = await catalogo(gameId, [
      { api: 'HECHO_1' },
      { api: 'HECHO_2' },
      { api: 'HECHO_3' },
      { api: 'SECRETO', oculto: true, descripcion: 'Mata al dragón final' },
    ]);
    for (const id of ids.slice(0, 3)) await consta(id, 'steam', '2026-03-15T12:00:00Z');

    const [casi] = (await getAchievementsOverview(null)).almostThere;
    assert.deepEqual(Object.keys(casi.missing[0]).sort(), [
      'displayName',
      'globalPercent',
      'hidden',
      'iconUrl',
    ]);
    assert.equal(casi.missing[0].hidden, true);
  });

  it('con un año filtrado, "almost there" viene vacío (es una foto de AHORA)', async () => {
    // No tiene lectura anual: "te faltan 2" es de hoy, no de 2026. El bloque
    // directamente no lo pinta cuando hay año.
    await juegoAlRatio(3, 4, 'Casi');

    const overview = await getAchievementsOverview(2026);
    assert.deepEqual(overview.almostThere, []);
  });
});

describe('getAchievementsOverview — fama y rareza (LOGROS-IDEAS §3.1, §3.3)', () => {
  it('el salón de la fama va de lo más raro a lo menos y se corta en diez', async () => {
    const gameId = await juegoPreguntado('Cazado');
    const ids = await catalogo(
      gameId,
      Array.from({ length: 12 }, (_, index) => ({ api: `P${index + 1}`, rareza: index + 1 })),
    );
    for (const id of ids) await consta(id, 'steam', '2026-03-15T12:00:00Z');

    const { hallOfFame } = await getAchievementsOverview(null);
    assert.equal(hallOfFame.length, 10);
    assert.deepEqual(
      hallOfFame.map((logro) => logro.globalPercent),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    );
    assert.equal(hallOfFame[0].gameTitle, 'Cazado');
  });

  it('un logro sin rareza conocida no entra en la fama, pero sí en el total', async () => {
    // globalPercent null es "no se pudo traer", no "0%": colarlo lo pondría el
    // primero de la lista de los más raros, que es justo el sitio donde más se
    // nota una mentira.
    const gameId = await juegoPreguntado();
    const [conRareza, sinRareza] = await catalogo(gameId, [
      { api: 'RARO', rareza: 2 },
      { api: 'DESCONOCIDO', rareza: null },
    ]);
    await consta(conRareza, 'steam', '2026-03-15T12:00:00Z');
    await consta(sinRareza, 'steam', '2026-03-16T12:00:00Z');

    const overview = await getAchievementsOverview(null);
    assert.equal(overview.totalUnlocked, 2);
    assert.deepEqual(
      overview.hallOfFame.map((logro) => logro.displayName),
      ['RARO'],
    );
    assert.deepEqual(overview.rarityProfile, { common: 0, rare: 0, ultra: 1 });
  });

  it('la fama enseña el logro pero no el momento cuando la fecha no es fiable', async () => {
    const gameId = await juegoPreguntado();
    const [logro] = await catalogo(gameId, [{ api: 'RESCATADO', rareza: 0.9 }]);
    await consta(logro, 'emu', '2026-03-15T12:00:00Z', { fiable: false });

    const [fama] = (await getAchievementsOverview(null)).hallOfFame;
    assert.equal(fama.displayName, 'RESCATADO');
    assert.equal(fama.unlockedAt, null);
  });

  it('el perfil de rareza corta en 10 y en 5 EXACTOS', async () => {
    // Los bordes de los tres cubos: 10 ya es común, 5 todavía es raro. Son las
    // dos constantes del documento y la barra apilada de Stats se lee entera
    // desde aquí.
    const gameId = await juegoPreguntado();
    const ids = await catalogo(gameId, [
      { api: 'COMUN', rareza: 10 },
      { api: 'RARO_ALTO', rareza: 9.9 },
      { api: 'RARO_BORDE', rareza: 5 },
      { api: 'ULTRA', rareza: 4.9 },
    ]);
    for (const id of ids) await consta(id, 'steam', '2026-03-15T12:00:00Z');

    const { rarityProfile } = await getAchievementsOverview(null);
    assert.deepEqual(rarityProfile, { common: 1, rare: 2, ultra: 1 });
  });

  it('"raro" significa LO MISMO en todas las cifras de la respuesta: el cubo del 5-10%', async () => {
    // Aquí vivía una divergencia entre dos campos del MISMO objeto:
    // yearTotals.rare (y los años, y los juegos del año) contaba "por debajo
    // del 10%" con los ultra dentro, mientras rarityProfile.rare y los meses
    // contaban solo el tramo 5-10%. Los dos números se pintan del mismo ámbar
    // en el mismo bloque de Stats, así que la tarjeta del año decía "2 raros"
    // y la barra apilada de al lado enseñaba un ámbar y un violeta: el color
    // no significaba lo mismo a dos centímetros de distancia. Ahora los cubos
    // son DISJUNTOS en toda la respuesta y "todo lo que baja del 10%" se
    // deriva sumando rare + ultra, que es lo que comprueba la última línea.
    const gameId = await juegoPreguntado();
    const ids = await catalogo(gameId, [
      { api: 'COMUN', rareza: 40 },
      { api: 'RARO', rareza: 7 },
      { api: 'ULTRA', rareza: 1 },
    ]);
    for (const id of ids) await consta(id, 'steam', '2026-03-15T12:00:00Z');

    const overview = await getAchievementsOverview(2026);
    assert.deepEqual(overview.yearTotals, { total: 3, rare: 1, ultra: 1 });
    assert.deepEqual(overview.rarityProfile, { common: 1, rare: 1, ultra: 1 });
    assert.deepEqual(overview.unlockedByYear, [{ year: 2026, total: 3, rare: 1, ultra: 1 }]);
    assert.deepEqual(
      overview.topGames?.map((game) => [game.total, game.rare, game.ultra]),
      [[3, 1, 1]],
    );
    // La misma cifra, contada por las cuatro puertas del bloque.
    const bajoDiez = (counts: { rare: number; ultra: number } | null | undefined): number | null =>
      counts ? counts.rare + counts.ultra : null;
    assert.equal(bajoDiez(overview.yearTotals), 2);
    assert.equal(bajoDiez(overview.rarityProfile), 2);
    assert.equal(bajoDiez(overview.unlockedByYear[0]), 2);
    assert.equal(bajoDiez(overview.unlockedByMonth?.[2]), 2);
  });
});

describe('getAchievementsOverview — el año filtrado (LOGROS-IDEAS §2.3, §3.4)', () => {
  it('con año, fama y totales solo miran ESE año y solo fechas fiables', async () => {
    const gameId = await juegoPreguntado();
    const [delAño, deAntes, rescatado] = await catalogo(gameId, [
      { api: 'DEL_AÑO', rareza: 2 },
      { api: 'DE_ANTES', rareza: 1 },
      { api: 'RESCATADO', rareza: 0.5 },
    ]);
    await consta(delAño, 'steam', '2026-03-15T12:00:00Z');
    await consta(deAntes, 'steam', '2025-06-10T12:00:00Z');
    // Rareza 0.5: si los no fiables entraran, este sería el primero de la fama
    // del año — y su fecha es la del rescate, no la de la hazaña.
    await consta(rescatado, 'emu', '2026-07-01T12:00:00Z', { fiable: false });

    const overview = await getAchievementsOverview(2026);
    assert.deepEqual(
      overview.hallOfFame.map((logro) => logro.displayName),
      ['DEL_AÑO'],
    );
    // Rareza 2 → cubo ultra, no el de raro: los cubos son disjuntos en toda
    // la respuesta (ver el test de "raro significa lo mismo").
    assert.deepEqual(overview.yearTotals, { total: 1, rare: 0, ultra: 1 });
    // Los totales de SIEMPRE no se mueven con el filtro: son la biblioteca.
    assert.equal(overview.totalUnlocked, 3);
    assert.equal(overview.totalCatalog, 3);
  });

  it('los doce meses SIEMPRE, con sus ceros y con los tres cubos de rareza', async () => {
    // La forma del año (tus rachas y tus sequías) se lee en los huecos tanto
    // como en las barras: si los meses vacíos se cayeran del array, la gráfica
    // apilada mentiría comprimiendo el año.
    const gameId = await juegoPreguntado();
    const ids = await catalogo(gameId, [
      { api: 'COMUN', rareza: 50 },
      { api: 'RARO', rareza: 7 },
      { api: 'ULTRA', rareza: 1 },
    ]);
    await consta(ids[0], 'steam', '2026-03-15T12:00:00Z');
    await consta(ids[1], 'steam', '2026-03-16T12:00:00Z');
    await consta(ids[2], 'steam', '2026-11-10T12:00:00Z');

    const meses = (await getAchievementsOverview(2026)).unlockedByMonth;
    assert.equal(meses?.length, 12);
    assert.deepEqual(meses?.[2], { month: 2, total: 2, common: 1, rare: 1, ultra: 0 });
    assert.deepEqual(meses?.[10], { month: 10, total: 1, common: 0, rare: 0, ultra: 1 });
    assert.deepEqual(meses?.[0], { month: 0, total: 0, common: 0, rare: 0, ultra: 0 });
    // Invariante de la barra apilada: los tres cubos suman el total del mes.
    for (const mes of meses ?? []) {
      assert.equal(mes.common + mes.rare + mes.ultra, mes.total);
    }
  });

  it('los juegos del año se ordenan por cantidad y desempatan por título', async () => {
    const muchos = await juegoPreguntado('Zelda');
    const pocosA = await juegoPreguntado('Braid');
    const pocosB = await juegoPreguntado('Alba');
    const idsMuchos = await catalogo(muchos, [{ api: 'A' }, { api: 'B', rareza: 7 }]);
    const [idA] = await catalogo(pocosA, [{ api: 'A' }]);
    const [idB] = await catalogo(pocosB, [{ api: 'A' }]);
    for (const id of [...idsMuchos, idA, idB]) await consta(id, 'steam', '2026-03-15T12:00:00Z');

    const overview = await getAchievementsOverview(2026);
    assert.deepEqual(
      overview.topGames?.map((game) => [game.title, game.total, game.rare, game.ultra]),
      [
        ['Zelda', 2, 1, 0],
        ['Alba', 1, 0, 0],
        ['Braid', 1, 0, 0],
      ],
    );
  });

  it('en All Time no hay lecturas anuales: yearTotals, meses y topGames vienen en null', async () => {
    const gameId = await juegoPreguntado();
    const [logro] = await catalogo(gameId, [{ api: 'A' }]);
    await consta(logro, 'steam', '2026-03-15T12:00:00Z');

    const overview = await getAchievementsOverview(null);
    assert.equal(overview.yearTotals, null);
    assert.equal(overview.unlockedByMonth, null);
    assert.equal(overview.topGames, null);
  });

  it('la gráfica de años sigue siendo de SIEMPRE aunque haya un año filtrado', async () => {
    // CARACTERIZACIÓN: el documento dice que la gráfica de años "queda solo en
    // All Time", y quien la esconde con un año puesto es el renderer — la
    // consulta la devuelve igual, entera. Si un día se acota aquí, esta
    // aserción lo canta antes de que la card se quede vacía en pantalla.
    const gameId = await juegoPreguntado();
    const ids = await catalogo(gameId, [{ api: 'VIEJO' }, { api: 'NUEVO' }]);
    await consta(ids[0], 'steam', '2024-05-10T12:00:00Z');
    await consta(ids[1], 'steam', '2026-03-15T12:00:00Z');

    const overview = await getAchievementsOverview(2026);
    assert.deepEqual(overview.unlockedByYear, [
      { year: 2024, total: 1, rare: 0, ultra: 0 },
      { year: 2026, total: 1, rare: 0, ultra: 0 },
    ]);
  });

  it('la biblioteca vacía contesta ceros y listas vacías, no undefined', async () => {
    // Stats se pinta en el primer arranque, antes de que haya nada: la card no
    // puede reventar por un .map sobre undefined.
    const overview = await getAchievementsOverview(null);
    assert.deepEqual(overview, {
      totalUnlocked: 0,
      totalCatalog: 0,
      yearTotals: null,
      topGames: null,
      unlockedByMonth: null,
      unlockedByYear: [],
      hallOfFame: [],
      perfectGames: [],
      almostThere: [],
      rarityProfile: { common: 0, rare: 0, ultra: 0 },
    });
  });
});
