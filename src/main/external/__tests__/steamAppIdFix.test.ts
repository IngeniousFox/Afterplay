import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import type { AppIdCandidate } from '../steamAppIdFix';

// QUÉ JUEGO ES UN JUEGO, EN STEAM.
//
// Todo lo que se prueba aquí decide una sola cosa: qué appid acaba guardado en
// la columna steamAppId. Y de ese número cuelga casi todo lo que la ficha
// enseña de fuera —etiquetas, reseñas, logros, tiempos—, así que equivocarlo
// no deja un hueco: deja una ficha llena de datos de OTRO juego, que es mucho
// peor porque parece correcta.
//
// Se ataca el módulo real (external/steamAppIdFix.ts) y con él, sin dobles de
// por medio, findSteamAppIdCorrections y pickSteamAppId de igdb/api.ts —que no
// se exportan, y es donde vive de verdad la regla—. Lo único mockeado es
// igdbRequest, o sea la salida a la red: la puerta única hacia IGDB.
//
// REGLA DE ORO DEL ANDAMIO (ver db/__tests__/harness.ts): mock.module tiene que
// correr ANTES de que el módulo bajo prueba resuelva sus imports, y por eso
// steamAppIdFix se importa con await import() dentro de un before() y no arriba.
// Necesita --experimental-test-module-mocks (ya en el script `test`).

// ── El doble de IGDB ──────────────────────────────────────────────────────

// Una fila de external_games: el juego de IGDB al que cuelga, el appid (como
// CADENA, que así viaja por contrato) y el nombre en la tienda.
type SteamRow = { game: number; uid: string; name?: string };

let steamRows: SteamRow[] = [];
let gamesWithParent = new Set<number>();
// Ediciones por juego base (version_parent): el respaldo que sigue el MOTIVO 3
// cuando el base no tiene entrada de Steam propia — el patrón Horizon Zero
// Dawn, cuyo puerto de PC vive en su "Complete Edition".
let editionsOf = new Map<number, number[]>();
let igdbFailure: Error | null = null;
const requests: { endpoint: string; body: string }[] = [];

// Los ids que la query lleva EN EL CUERPO. El doble contesta solo por los
// juegos preguntados, como la API de verdad: si devolviera filas de juegos que
// nadie pidió, el test del juego sin entradas de Steam pasaría por el motivo
// equivocado y dejaría de vigilar nada.
const idsIn = (body: string): number[] => {
  const match = /=\s*\(([\d,\s]+)\)/.exec(body);
  return match === null ? [] : match[1].split(',').map(Number);
};

// El `limit N;` de la propia query, RESPETADO a propósito. El corte de filas no
// es un detalle del transporte: tocar el tope es lo que dispara una regla
// entera (ver el bloque del tope más abajo), y un doble que devolviera 600
// filas a una query con `limit 500` estaría probando un mundo que no existe.
const limitIn = (body: string): number => {
  const match = /limit (\d+);/.exec(body);
  return match === null ? Infinity : Number(match[1]);
};

mock.module('../../igdb/client', {
  namedExports: {
    igdbRequest: async (endpoint: string, body: string): Promise<unknown> => {
      requests.push({ endpoint, body });
      if (igdbFailure !== null) throw igdbFailure;
      const ids = idsIn(body);
      const limit = limitIn(body);
      // A `games` caen DOS consultas distintas y se separan por su cuerpo, que
      // es lo único que las distingue también para IGDB: "quién tiene juego
      // base" (parent_game) y "qué ediciones cuelgan de estos" (version_parent,
      // el respaldo del MOTIVO 3).
      if (endpoint === 'games') {
        if (body.includes('version_parent = (')) {
          return ids
            .flatMap((parentId) =>
              (editionsOf.get(parentId) ?? []).map((id) => ({ id, version_parent: parentId })),
            )
            .slice(0, limit);
        }
        return ids
          .filter((id) => gamesWithParent.has(id))
          .map((id) => ({ id, parent_game: 9000 + id }))
          .slice(0, limit);
      }
      return steamRows.filter((row) => ids.includes(row.game)).slice(0, limit);
    },
  },
});

// ── El módulo real, importado DESPUÉS de registrar el mock ────────────────

let findSteamAppIdFixes: typeof import('../steamAppIdFix').findSteamAppIdFixes;
let findSteamAppIdFix: typeof import('../steamAppIdFix').findSteamAppIdFix;

before(async () => {
  ({ findSteamAppIdFixes, findSteamAppIdFix } = await import('../steamAppIdFix'));
});

// ── Consola ───────────────────────────────────────────────────────────────
// No se silencia, se COMPRUEBA: el aviso por consola es hoy el único rastro de
// que a un juego le ha cambiado la identidad de Steam (el parte que ve el
// usuario sigue diciendo 'had-it'), así que es parte del comportamiento.

const logged: string[] = [];
const warned: string[] = [];
const realLog = console.log;
const realWarn = console.warn;
console.log = (...args: unknown[]): void => {
  logged.push(args.map(String).join(' '));
};
console.warn = (...args: unknown[]): void => {
  warned.push(args.map(String).join(' '));
};
after(() => {
  console.log = realLog;
  console.warn = realWarn;
});

// Convención de la casa: la consola de Windows no siempre usa UTF-8, así que
// los mensajes van en ASCII pelado o salen ilegibles justo cuando hacen falta.
const SOLO_ASCII = /^[\x20-\x7e]*$/;

// ── Fábricas ──────────────────────────────────────────────────────────────

// Una entrada de Steam colgada de una ficha de IGDB. El NOMBRE es lo único que
// separa un juego de su playtest, así que aquí nunca es opcional.
const entry = (igdbId: number, appId: number | string, name: string): SteamRow => ({
  game: igdbId,
  uid: String(appId),
  name,
});

// Un juego de la biblioteca tal y como llega desde el refresco: su ficha de
// IGDB y el appid que HOY tiene guardado en la base.
const stored = (igdbId: number, steamAppId: number, title: string): AppIdCandidate => ({
  igdbId,
  steamAppId,
  title,
});

beforeEach(() => {
  steamRows = [];
  gamesWithParent = new Set();
  editionsOf = new Map();
  igdbFailure = null;
  requests.length = 0;
  logged.length = 0;
  warned.length = 0;
});

// ══ Qué entrada de Steam es LA del juego ══════════════════════════════════

describe('la regla del playtest: cuál de las entradas de Steam es el juego', () => {
  it('el playtest pierde contra la entrada de verdad, salga en el orden que salga', async () => {
    // Atomic Heart es el caso que puso la regla: 668580 es el juego y 2026960
    // una beta cerrada sin página de tienda, sin etiquetas y sin logros.
    // Quedarse con esa deja el juego mudo, y el orden de las filas lo decidía
    // IGDB: era una moneda al aire. Por eso aquí van los DOS órdenes a la vez —
    // si alguien vuelve a "el primero que salga", uno de los dos se cae.
    steamRows = [
      entry(1, 2026960, 'Atomic Heart Playtest'),
      entry(1, 668580, 'Atomic Heart'),
      entry(2, 220, 'Half-Life 2'),
      entry(2, 2222220, 'Half-Life 2 Playtest'),
    ];

    const fixes = await findSteamAppIdFixes([
      stored(1, 2026960, 'Atomic Heart'),
      stored(2, 2222220, 'Half-Life 2'),
    ]);

    assert.deepEqual(
      [...fixes],
      [
        [1, 668580],
        [2, 220],
      ],
    );
  });

  it('cuando la UNICA entrada se llama beta, esa es la buena (A Hat in Time)', async () => {
    // IGDB llama "A Hat in Time - Beta Build" a la única entrada de Steam de
    // ese juego, y es la buena. Descartar por nombre sin mirar si queda
    // alternativa dejaría al juego sin appid —sin etiquetas, sin reseñas y sin
    // logros—, o sea peor que el problema que la regla venía a arreglar. Un
    // nombre feo no es motivo para tirar el único dato que hay.
    steamRows = [entry(3, 253230, 'A Hat in Time - Beta Build')];

    const fixes = await findSteamAppIdFixes([stored(3, 253230, 'A Hat in Time')]);

    assert.equal(fixes.size, 0);
    // Y ni siquiera se avisa: no ha cambiado nada que contar.
    assert.deepEqual(logged, []);
  });

  it('playtest, demo, beta y test server son pruebas; la palabra tiene que ir suelta', async () => {
    // El vocabulario completo de la regla y su límite: se mira la PALABRA, no
    // las letras. Un "Betatest Brigade" no es la prueba de nada, es un juego
    // con esas letras dentro — descartarlo sería inventarse un playtest que no
    // existe y, si fuera el único candidato limpio, dejar al juego sin appid.
    steamRows = [
      entry(4, 400001, 'Nombre Playtest'),
      entry(4, 400002, 'Nombre Demo'),
      entry(4, 400003, 'NOMBRE BETA'),
      entry(4, 400004, 'Nombre Test Server'),
      entry(4, 400005, 'Betatest Brigade'),
    ];

    const fixes = await findSteamAppIdFixes([stored(4, 400001, 'Nombre')]);

    assert.deepEqual([...fixes], [[4, 400005]]);
  });

  it('un uid que no es un appid no llega jamas a la base de datos', async () => {
    // El uid viaja como CADENA por contrato porque otras tiendas meten ahí
    // slugs y ASINs de Amazon. Un appid corrupto guardado es peor que uno
    // equivocado: ya no hay a quién preguntarle nada, y el juego queda
    // "comprobado" para siempre. El cero entra por la misma puerta.
    steamRows = [entry(5, 'B08XKQ7T4M', 'Juego (Amazon)'), entry(5, 0, 'Juego (sin appid)')];

    const fixes = await findSteamAppIdFixes([stored(5, 424242, 'Juego')]);

    assert.equal(fixes.size, 0);
  });
});

// ══ El rescate de los appids ya guardados mal ═════════════════════════════

describe('el rescate: los tres unicos motivos por los que se cambia un appid guardado', () => {
  it('un appid que no figura entre las entradas del juego apunta a otro producto y se sustituye', async () => {
    // MOTIVO 2, y la cicatriz: "Trails in the Sky 2nd Chapter" —el remake, sin
    // salir— llevaba el appid del original de 2015, así que la ficha enseñaba
    // su fecha de estreno futura y, debajo, tres mil reseñas. Un juego que no
    // ha salido no tiene reseñas: ese número no era un hueco, era una mentira
    // con aplomo. Los cinco casos de la biblioteca real eran el mismo patrón,
    // el appid del juego VIEJO en la ficha del NUEVO.
    steamRows = [entry(10, 3005430, 'The Legend of Heroes: Trails in the Sky 2nd Chapter')];

    const fixes = await findSteamAppIdFixes([stored(10, 251150, 'Trails in the Sky 2nd Chapter')]);

    assert.deepEqual([...fixes], [[10, 3005430]]);
  });

  it('un appid que figura y no es una prueba es identidad del juego: no se toca nunca', async () => {
    // La regla de oro del rescate PARA UN JUEGO SIN PADRE (con padre manda el
    // appid del base, ver el MOTIVO 3 más abajo), y el test que impide que
    // "mejorarlo" vuelva a ser una tentación: aquí pickSteamAppId habría elegido 620, pero NO SE
    // LE LLEGA A PREGUNTAR. Un mismo juego de IGDB tiene a veces varias
    // entradas legítimas (ediciones, paquetes regionales) y elegir entre ellas
    // es cambiarle el producto a un juego que estaba bien — el primer intento
    // desempataba por appid más bajo y movía 45 juegos en vez de 38, entre
    // ellos Far Cry 5.
    steamRows = [entry(11, 620, 'Portal 2'), entry(11, 6060, 'Portal 2 - Edicion regional')];

    const fixes = await findSteamAppIdFixes([stored(11, 6060, 'Portal 2')]);

    assert.equal(fixes.size, 0);
    assert.deepEqual(logged, []);
  });

  it('un juego del que IGDB no conoce ninguna entrada de Steam se queda como esta', async () => {
    // "Sin filas" no es "apunta a otro producto": es no saber. Si esto cayera
    // por el motivo 2, cualquier juego que IGDB todavía no haya cruzado con
    // Steam perdería su appid bueno en la primera pasada de biblioteca — y los
    // dados de alta solo con Steam son justo los que llegan así.
    steamRows = [entry(21, 620, 'Portal 2')];

    const fixes = await findSteamAppIdFixes([stored(20, 730, 'Juego sin entrada en IGDB')]);

    assert.equal(fixes.size, 0);
  });

  it('a un juego con juego base no se le aplica el motivo 2 (Binding of Isaac: Repentance)', async () => {
    // Para una expansión con ficha propia, resolveAchievementsSteamAppId guarda
    // A PROPÓSITO el appid del JUEGO BASE: es donde vive el catálogo de logros.
    // El propio de Repentance (1426300) existe, pero GetSchemaForGame lo
    // devuelve VACÍO; los suyos están todos en Rebirth (250900). Ese appid del
    // padre no aparece jamás entre las filas del hijo, así que sin la consulta
    // de parent_game el motivo 2 lo declaraba "de otro producto" y estampaba el
    // propio: deshacía a traición la otra regla, y con ella los logros.
    //
    // Aquí el padre NO tiene appid conocido (no hay fila suya en el doble), que
    // es lo que deja este caso en manos de la exención en vez del MOTIVO 3.
    steamRows = [entry(109241, 1426300, 'The Binding of Isaac: Repentance')];
    gamesWithParent = new Set([109241]);
    const repentance = stored(109241, 250900, 'The Binding of Isaac: Repentance');

    assert.equal((await findSteamAppIdFixes([repentance])).size, 0);

    // Y lo que lo salva es TENER padre, no cualquier otra cosa del escenario:
    // el mismo juego sin padre sí entra por el motivo 2.
    gamesWithParent = new Set();
    assert.deepEqual([...(await findSteamAppIdFixes([repentance]))], [[109241, 1426300]]);
  });

  it('al hijo se le sigue mirando el playtest: la exencion es solo del motivo 2', async () => {
    // Tener padre exime de "no figura entre sus filas", que en un hijo es lo
    // normal. No exime de lo otro: si el appid guardado ES una de sus filas y
    // resulta ser una prueba, sigue siendo un appid sin tienda ni logros.
    // (Otra vez con el padre sin appid conocido: teniéndolo, mandaría el suyo.)
    steamRows = [entry(30, 300100, 'Expansion Playtest'), entry(30, 300101, 'Expansion')];
    gamesWithParent = new Set([30]);

    const fixes = await findSteamAppIdFixes([stored(30, 300100, 'Expansion')]);

    assert.deepEqual([...fixes], [[30, 300101]]);
  });

  it('si sus unicas entradas son pruebas, el motivo 2 no estampa ninguna: se queda como esta', async () => {
    // ARREGLADO. Antes esto devolvía Map{40 => 400900}, o sea guardaba una DEMO
    // como identidad del juego.
    //
    // El respaldo de "si no queda alternativa limpia, coge la que hay" nació
    // para el momento de RESOLVER un hueco (A Hat in Time: mejor una beta que
    // nada), y ahí sigue valiendo. Sobrescribiendo no vale: cambiaba un appid
    // equivocado por otro equivocado, y encima por uno sin tienda, sin reseñas
    // y sin logros del juego real. La cabecera de pickSteamAppId ya prometía
    // exactamente esto para el caso Stanley Parable ("no hay sibling limpio y
    // se queda como está") mientras el código hacía lo contrario; ahora el
    // rescate pasa allowPlaytestFallback: false y las dos cosas coinciden.
    steamRows = [entry(40, 400900, 'Juego Demo')];

    const fixes = await findSteamAppIdFixes([stored(40, 111111, 'Juego')]);

    assert.equal(fixes.size, 0);
    // Y ni aviso, porque no ha cambiado nada que contar.
    assert.deepEqual(logged, []);
  });

  it('el respaldo de la prueba sigue vivo al RESOLVER: solo se corta al sobrescribir', async () => {
    // El borde contrario del arreglo de arriba, y la razón de que la guarda sea
    // un parámetro y no un borrado: A Hat in Time llega por el mismo
    // pickSteamAppId cuando hay que RELLENAR un hueco, y ahí su única entrada
    // ("Beta Build") es la buena. Si alguien "simplifica" quitando el respaldo,
    // ese juego se queda sin appid — sin etiquetas, sin reseñas y sin logros.
    //
    // Aquí se comprueba desde fuera lo que se puede: el rescate NO toca al que
    // ya lleva esa beta (es su identidad), o sea que la ruta de resolver sigue
    // pudiendo elegirla.
    steamRows = [entry(41, 410900, 'Juego - Beta Build')];

    assert.equal((await findSteamAppIdFixes([stored(41, 410900, 'Juego')])).size, 0);
  });

  it('MOTIVO 3: al hijo se le pone el appid del juego base, aunque el suyo sea limpio', async () => {
    // ARREGLADO, y era una divergencia con dientes: para un juego CON padre,
    // resolveAchievementsSteamAppId manda A PROPÓSITO el appid del BASE, porque
    // el propio devuelve el catálogo de logros VACÍO. Pero el rescate se
    // plantaba antes de llegar ("figura en la ficha y no es una prueba"), así
    // que Repentance guardado con su propio 1426300 —limpio, suyo, y sin un
    // solo logro dentro— no salía de ahí jamás por su cuenta. El tercer estado
    // que motivó todo el rescate seguía existiendo justo para este subgrupo.
    //
    // Ahora las dos rutas deciden lo mismo: lo guardado es lo que la resolución
    // habría elegido hoy.
    steamRows = [
      entry(109241, 1426300, 'The Binding of Isaac: Repentance'),
      entry(118241, 250900, 'The Binding of Isaac: Rebirth'),
    ];
    gamesWithParent = new Set([109241]); // el doble le da como padre 9000 + id

    const fixes = await findSteamAppIdFixes([
      stored(109241, 1426300, 'The Binding of Isaac: Repentance'),
    ]);

    assert.deepEqual([...fixes], [[109241, 250900]]);
  });

  it('MOTIVO 3: si el hijo ya lleva el appid del base no se toca, y no se avisa de nada', async () => {
    // El caso mayoritario y el que no puede moverse: la inmensa mayoría de los
    // hijos ya están bien porque la resolución los dejó así. Un rescate que los
    // "corrigiera" a algo escribiría —y avisaría— en cada pasada de biblioteca.
    steamRows = [
      entry(109241, 1426300, 'The Binding of Isaac: Repentance'),
      entry(118241, 250900, 'The Binding of Isaac: Rebirth'),
    ];
    gamesWithParent = new Set([109241]);

    const fixes = await findSteamAppIdFixes([
      stored(109241, 250900, 'The Binding of Isaac: Repentance'),
    ]);

    assert.equal(fixes.size, 0);
    assert.deepEqual(logged, []);
  });

  it('MOTIVO 3: al hijo sin entradas propias tambien le llega el appid del base', async () => {
    // Un DLC no suele tener entrada de Steam propia, y "sin filas" cortaba el
    // bucle antes de mirar nada. Para un huérfano eso es lo correcto (no saber
    // no es motivo para escribir), pero para un hijo cuyo padre SÍ tiene appid
    // no hay nada que no sepamos: ese es el appid que le toca.
    steamRows = [entry(9042, 420900, 'Juego Base')];
    gamesWithParent = new Set([42]); // padre 9042

    const fixes = await findSteamAppIdFixes([stored(42, 111111, 'Expansion sin ficha en Steam')]);

    assert.deepEqual([...fixes], [[42, 420900]]);
  });

  it('MOTIVO 3: si el base no esta en Steam pero si una EDICION suya, es esa la que le llega', async () => {
    // ARREGLADO, y era la última grieta de la paridad que promete la cabecera
    // de findSteamAppIdCorrections. Para un hijo, resolveAchievementsSteamAppId
    // prueba el appid directo del padre y DESPUÉS sus ediciones (el patrón
    // Horizon Zero Dawn: el juego base no tiene entrada de Steam, la
    // "Complete Edition" sí). El rescate se paraba en el directo, así que este
    // hijo se caía al MOTIVO 1 y acababa con su appid PROPIO escrito — el que
    // esta casa descarta porque GetSchemaForGame lo devuelve vacío. O sea: las
    // dos no solo dejaban de coincidir, escribían cosas DISTINTAS.
    steamRows = [
      entry(44, 440100, 'Juego Hijo'),
      entry(44, 440900, 'Juego Hijo Playtest'),
      // El padre (9044) no tiene ninguna fila: no está en Steam por su cuenta.
      entry(9144, 1151640, 'Juego Base - Complete Edition'),
    ];
    gamesWithParent = new Set([44]);
    editionsOf = new Map([[9044, [9144]]]);

    const fixes = await findSteamAppIdFixes([stored(44, 440900, 'Juego Hijo')]);

    assert.deepEqual([...fixes], [[44, 1151640]]);
  });

  it('MOTIVO 3: la edicion del base tampoco puede ser una prueba', async () => {
    // La misma guarda del respaldo, ahora también en la puerta de las
    // ediciones: sobrescribir un appid guardado con la demo de una edición del
    // padre sería cambiar un equivocado por otro peor. Sin candidata limpia por
    // ahí, el juego sigue por los otros dos motivos — aquí el 1, que le deja su
    // propia entrada limpia.
    steamRows = [
      entry(45, 450100, 'Juego Hijo'),
      entry(45, 450900, 'Juego Hijo Playtest'),
      entry(9145, 1151641, 'Juego Base - Complete Edition Demo'),
    ];
    gamesWithParent = new Set([45]);
    editionsOf = new Map([[9045, [9145]]]);

    const fixes = await findSteamAppIdFixes([stored(45, 450900, 'Juego Hijo')]);

    assert.deepEqual([...fixes], [[45, 450100]]);
  });

  it('MOTIVO 3: si las unicas entradas del base son pruebas, al hijo no se le escribe una', async () => {
    // La misma guarda del respaldo, en la puerta del padre: el appid propio del
    // hijo será estéril para los logros, pero la demo del padre es peor todavía
    // —ni tienda, ni reseñas, ni logros de nadie—. Sin candidato limpio no se
    // sobrescribe, y el juego se queda con lo que tenía.
    steamRows = [entry(43, 430100, 'Expansion'), entry(9043, 430900, 'Juego Base Playtest')];
    gamesWithParent = new Set([43]);

    const fixes = await findSteamAppIdFixes([stored(43, 430100, 'Expansion')]);

    assert.equal(fixes.size, 0);
  });
});

// ══ El tope de filas de IGDB ══════════════════════════════════════════════

describe('el tope de 500 filas de la respuesta', () => {
  it('con la respuesta de external_games en el tope no se corrige NADA', async () => {
    // Aquí una fila que falta no es un silencio inofensivo como en las dos
    // consultas hermanas (allí "no hay appid" y el juego se queda igual): es
    // exactamente lo que dispara el motivo 2, o sea una ESCRITURA que cambia un
    // appid bueno por otro. Con la respuesta cortada no se decide nada, y se
    // avisa fuerte en vez de dejarlo pasar — el fallo mudo ya costó una tarde.
    steamRows = [
      entry(50, 500000, 'Juego Playtest'),
      entry(50, 500001, 'Juego'),
      ...Array.from({ length: 600 }, (_, i) => entry(50, 510000 + i, `Juego Edicion ${i}`)),
    ];

    const fixes = await findSteamAppIdFixes([stored(50, 500000, 'Juego')]);

    assert.equal(fixes.size, 0);
    assert.deepEqual(logged, []);
    assert.equal(warned.length, 1);
    assert.match(warned[0], /500 filas/);
    assert.match(warned[0], SOLO_ASCII);
  });

  it('con una fila menos que el tope si corrige: el corte es exacto', async () => {
    // El par del test de arriba. Un off-by-one aquí no se nota desde fuera: o
    // se deja de corregir un lote entero en silencio, o se corrige con datos
    // cortados. Ninguno de los dos avisa por su cuenta.
    steamRows = [
      entry(51, 500000, 'Juego Playtest'),
      entry(51, 500001, 'Juego'),
      ...Array.from({ length: 497 }, (_, i) => entry(51, 510000 + i, `Juego Edicion ${i}`)),
    ];

    const fixes = await findSteamAppIdFixes([stored(51, 500000, 'Juego')]);

    assert.deepEqual([...fixes], [[51, 500001]]);
    assert.deepEqual(warned, []);
  });

  it('con la respuesta de juegos base en el tope tampoco se corrige NADA, y se avisa', async () => {
    // ARREGLADO. Antes esto devolvía Map{el juego 501 => 777777}: la consulta de
    // external_games avisaba y se plantaba al tocar el tope, pero la de
    // parent_game —que corre justo antes y lleva el MISMO `limit 500`— no lo
    // miraba. Pasado ese número, los hijos que se quedaban fuera de la respuesta
    // pasaban por huérfanos y el motivo 2 les estampaba su propio appid: justo
    // el que a propósito no se usa porque su catálogo de logros va vacío. Y en
    // silencio.
    //
    // Lo único que separaba eso de un fallo real era APPID_BATCH_SIZE (150) en
    // refresh.ts: una constante de OTRO fichero, que un llamador nuevo con el
    // lote entero se salta sin enterarse. Ahora la regla se defiende sola.
    const games = Array.from({ length: 501 }, (_, i) => stored(60000 + i, 111111, `Juego ${i}`));
    gamesWithParent = new Set(games.map((game) => game.igdbId));
    // El 501 es el que la respuesta de padres deja fuera; tiene entradas propias
    // para que, si la guarda desapareciera, el motivo 2 volviera a dispararse.
    const cortado = games[500];
    steamRows = [entry(cortado.igdbId, 777777, 'Juego 500')];

    const fixes = await findSteamAppIdFixes(games);

    assert.equal(fixes.size, 0);
    assert.deepEqual(logged, []);
    assert.equal(warned.length, 1);
    assert.match(warned[0], /500 filas/);
    assert.match(warned[0], SOLO_ASCII);
    // Y se planta ANTES de gastar la petición de appids: la única que llegó a
    // salir es la de los padres.
    assert.deepEqual(
      requests.map((request) => request.endpoint),
      ['games'],
    );
  });

  it('con 500 juegos con padre justo por debajo del tope la exencion sigue en pie', async () => {
    // El par del test de arriba: el corte es exacto. Con 499 filas de padres la
    // respuesta está entera, así que se corrige lo que toque en vez de plantarse
    // — plantarse de más sería dejar de arreglar lotes enteros en silencio.
    const games = Array.from({ length: 499 }, (_, i) => stored(60000 + i, 111111, `Juego ${i}`));
    gamesWithParent = new Set(games.map((game) => game.igdbId));
    // Este hijo sí figura en la respuesta de padres, y su base tiene appid.
    steamRows = [entry(9000 + games[0].igdbId, 888888, 'Juego Base')];

    const fixes = await findSteamAppIdFixes(games);

    assert.deepEqual([...fixes], [[games[0].igdbId, 888888]]);
    assert.deepEqual(warned, []);
  });
});

// ══ El aviso y el manejo del fallo ════════════════════════════════════════

describe('lo que se cuenta por consola y lo que se hace con un fallo de IGDB', () => {
  it('solo se avisa por consola de los juegos que cambian de identidad', async () => {
    // Hoy es el ÚNICO rastro visible de que a un juego le ha cambiado la
    // identidad de Steam —y con ella sus etiquetas, sus reseñas y sus logros—:
    // el parte que ve el usuario sigue diciendo 'had-it'. Un aviso de más, o de
    // menos, es la diferencia entre poder explicar un cambio y no poder.
    steamRows = [
      entry(70, 700001, 'Roto Playtest'),
      entry(70, 700002, 'Roto'),
      entry(71, 710001, 'Sano'),
    ];

    const fixes = await findSteamAppIdFixes([
      stored(70, 700001, 'Roto'),
      stored(71, 710001, 'Sano'),
      stored(72, 720001, 'Desconocido para IGDB'),
    ]);

    // El mapa trae SOLO los que hay que corregir, no una fila por juego mirado.
    assert.deepEqual([...fixes], [[70, 700002]]);
    assert.equal(logged.length, 1);
    assert.match(logged[0], /^\[steam\] Roto: el appid 700001 .* 700002$/);
    assert.match(logged[0], SOLO_ASCII);
  });

  it('la pasada de biblioteca NO se traga el fallo de IGDB; la de un juego suelto SI', async () => {
    // La divergencia es deliberada y hay que mantenerla. La pasada grande
    // escribe todo o nada al final y su try/catch ya convierte cualquier fallo
    // de IGDB en el evento de "no se pudo" sin haber tocado una fila: comerse
    // el error aquí sería decidir por ella. En la ficha, en cambio, cada fuente
    // se cae sola —que IGDB no conteste no puede llevarse por delante los
    // tiempos, las reseñas ni los logros— y no poder revisar el appid solo
    // significa dejarlo como estaba.
    igdbFailure = new Error('IGDB 503');

    await assert.rejects(() => findSteamAppIdFixes([stored(80, 800001, 'Juego')]), /IGDB 503/);
    assert.equal(await findSteamAppIdFix(stored(80, 800001, 'Juego')), undefined);
  });

  it('el atajo de un juego devuelve el appid corregido, y undefined si no hay nada que corregir', async () => {
    // Contrato deliberado: los dos botones de la ficha tratan igual el "no hay
    // nada" y el "no se pudo mirar" —dejar el appid como está—, así que
    // distinguirlos aquí solo daría trabajo a quien no lo necesita.
    steamRows = [entry(90, 900001, 'Juego Playtest'), entry(90, 900002, 'Juego')];

    assert.equal(await findSteamAppIdFix(stored(90, 900001, 'Juego')), 900002);
    assert.equal(await findSteamAppIdFix(stored(90, 900002, 'Juego')), undefined);
  });

  it('con la lista vacia no se le pregunta nada a IGDB', async () => {
    // No es una micro-optimización: sin la guarda, el cuerpo saldría con
    // `where game = ()` y sería IGDB quien contestara con un 400 a una pasada
    // de biblioteca en la que, por definición, no había nada que revisar.
    const fixes = await findSteamAppIdFixes([]);

    assert.equal(fixes.size, 0);
    assert.deepEqual(requests, []);
  });
});
