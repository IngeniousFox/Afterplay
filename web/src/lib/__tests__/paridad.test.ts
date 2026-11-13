import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PlannedGame, SessionWithGame, StateType } from '../../api';
import * as movilFormato from '../format';
import * as movilRelease from '../releaseDate';
import * as movilCubos from '../sessionGroups';
import * as movilPaleta from '../status';
import * as estanterias from '../../../../src/shared/planShelves';
import type { PlanShelfReaders } from '../../../../src/shared/planShelves';
import type { PlannedGameItem } from '../../../../src/shared/types';
import * as pcFormato from '../../../../src/renderer/src/lib/format';
import * as pcEstado from '../../../../src/renderer/src/lib/gameStatus';
import * as pcPlan from '../../../../src/renderer/src/lib/plan';
import * as pcRelease from '../../../../src/renderer/src/lib/releaseDate';
import * as pcCubos from '../../../../src/renderer/src/lib/sessionGroups';

// Solo quedan aquí las comparaciones entre DOS piezas de código distintas: los
// adaptadores de la PWA (milisegundos, 24h fijo, etiquetas sin el recap del
// diario, sus propios iconos de Lucide) contra los del escritorio, y el reparto
// del Plan contra la copia que todavía vive en src/renderer/src/lib/plan.ts.
//
// Los casos "A contra A" —las dos mitades re-exportando la MISMA función de
// src/shared— se mudaron, con su valor esperado y en las dos monedas (Date y
// ms), a src/shared/domain/__tests__/presentationRules.test.ts: comparar f(x)
// con f(x) no puede fallar, y un fallo compartido estaría de acuerdo consigo
// mismo. Los de la vista previa del buzón viven en planOrder.test.ts.

// ── Utilidades ─────────────────────────────────────────────────────────────

// Las dos mitades tienen que decir lo MISMO. `esperado`, cuando se pone, fija
// además QUÉ dicen.
const mismo = (movil: unknown, escritorio: unknown, esperado?: unknown): void => {
  assert.deepEqual(movil, escritorio, 'el móvil y el escritorio no dicen lo mismo');
  if (esperado !== undefined) assert.deepEqual(movil, esperado);
};

// El mismo instante en las dos monedas: el escritorio maneja Date y la PWA
// milisegundos, que es lo que sobrevive a un JSON. Cada caso se escribe UNA vez
// y se gasta en los dos lados.
//
// Sin 'Z' a propósito: todo lo que se compara aquí (los cubos por día, el mes
// de calendario, la medianoche) razona en hora LOCAL. Como las dos mitades
// corren en el mismo reloj, la comparación entre ellas es cierta en cualquier
// zona horaria; lo que sí supone hora española son los textos esperados, y por
// eso todos caen a mediodía, lejos de cualquier frontera de día.
const instante = (iso: string): { date: Date; ms: number } => {
  const date = new Date(iso);
  return { date, ms: date.getTime() };
};

// The desktop exposes diary metadata; mobile consumes only the label.
const cuboPC = (date: Date, now: Date): string => pcCubos.getSessionGroup(date, now).label;
// Una fila de sesión con lo único que la agrupación mira: cuándo empezó.
let siguienteSesion = 1;
const sesion = (empezo: string): SessionWithGame =>
  ({ id: siguienteSesion++, startedAt: new Date(empezo).getTime() }) as unknown as SessionWithGame;

// Un juego del Plan en las dos monedas. Solo lleva de verdad lo que el reparto
// mira —fijado, título, salida, endless y la estimación de HLTB—; el resto de
// campos de PlannedGameItem (que es GameListItem entero más los extras de la
// pantalla del Plan) no lo toca nadie aquí, así que no se rellenan.
type PlanGemelo = { movil: PlannedGame; pc: PlannedGameItem };

const planeado = (spec: {
  id: number;
  title: string;
  // ISO del fijado, o null si está en la cola.
  fijado?: string | null;
  // Las fechas de salida van MUY lejos a propósito (1994 / 2099): isUnreleased
  // pregunta por el reloj de verdad, y un caso "sale la semana que viene"
  // caducaría solo.
  sale?: { iso: string; precision: 'year' | 'month' | 'day' } | null;
  hltbMain?: number | null;
  endless?: boolean;
}): PlanGemelo => {
  const fijado = spec.fijado ? new Date(spec.fijado) : null;
  const sale = spec.sale ? new Date(spec.sale.iso) : null;
  // Cada uno con SU día de alta, y distinto: la cola del escritorio pasa por
  // una lente, y la de "longest waiting" ordena justo por esto.
  const anadido = new Date(2026, 0, spec.id);
  const comun = {
    id: spec.id,
    title: spec.title,
    releaseYear: sale ? sale.getFullYear() : null,
    releaseDatePrecision: spec.sale ? spec.sale.precision : null,
    hltbMain: spec.hltbMain ?? null,
    endless: spec.endless ?? false,
  };
  return {
    movil: {
      ...comun,
      pinnedAt: fijado ? fijado.getTime() : null,
      releaseDate: sale ? sale.getTime() : null,
      addedAt: anadido.getTime(),
    } as unknown as PlannedGame,
    pc: {
      ...comun,
      planPinnedAt: fijado,
      releaseDate: sale,
      addedAt: anadido,
    } as unknown as PlannedGameItem,
  };
};

// Los mismos cuatro accesos que usa PlanScreen.tsx, y su gemelo del escritorio.
// Aquí es donde se ve que lo único distinto entre las dos mitades es la MONEDA
// (milisegundos contra Date), no el reparto.
const LEE_MOVIL: PlanShelfReaders<PlannedGame> = {
  pinnedAt: (game) => game.pinnedAt,
  title: (game) => game.title,
  unreleased: (game) => movilRelease.isUnreleased(game),
  releaseSortKey: (game) => movilRelease.releaseSortKey(game),
};

const LEE_PC: PlanShelfReaders<PlannedGameItem> = {
  pinnedAt: (game) => game.planPinnedAt?.getTime() ?? null,
  title: (game) => game.title,
  unreleased: (game) => pcRelease.isUnreleased(game),
  releaseSortKey: (game) => pcRelease.releaseSortKey(game),
};

const ids = <T extends { id: number }>(games: T[]): number[] => games.map((game) => game.id);

// El icono de un estado, por NOMBRE y no por identidad. Por identidad no se
// puede: la PWA resuelve lucide-react desde web/node_modules y el escritorio
// desde el de la raíz, así que el mismo dibujo son dos objetos distintos y un
// `assert.equal` fallaría siempre. Lo que identifica al icono es el nombre que
// lucide le pone a la función de dentro ('Play', 'Trophy'…), que es justo lo
// que cambia si alguien elige otro dibujo para un estado.
const nombreIcono = (Icon: unknown): string => {
  const icono = Icon as { displayName?: string; render?: { displayName?: string; name?: string } };
  return icono.displayName ?? icono.render?.displayName ?? icono.render?.name ?? '?';
};

// ══ FORMATO DE FECHAS ══════════════════════════════════════════════════════

describe('formato: una fecha se pinta con la precisión que de verdad se sabe', () => {
  it('con precisión de año o de mes no se inventa el día ni la hora', () => {
    // Un evento con precisión de AÑO se guarda como el día 1 a medianoche. Sin
    // esta regla se enseñaría "January 1, 2021 · 00:00", que es un dato
    // inventado con pinta de dato exacto.
    const { date, ms } = instante('2021-01-01T00:00');
    mismo(movilFormato.formatDateOnly(ms, 'year'), pcFormato.formatDateOnly(date, 'year'), '2021');
    mismo(
      movilFormato.formatDateOnly(ms, 'month'),
      pcFormato.formatDateOnly(date, 'month'),
      'January 2021',
    );
    mismo(
      movilFormato.formatDateOnly(ms, 'day'),
      pcFormato.formatDateOnly(date, 'day'),
      'January 1, 2021',
    );
  });

  it('formatByPrecision escribe el mismo evento igual en las dos pantallas', () => {
    const { date, ms } = instante('2026-01-10T18:30');
    for (const precision of ['year', 'month', 'day', 'datetime'] as const) {
      mismo(
        movilFormato.formatByPrecision(ms, precision),
        pcFormato.formatByPrecision(date, precision, '24h'),
      );
    }
    mismo(
      movilFormato.formatByPrecision(ms, 'datetime'),
      pcFormato.formatByPrecision(date, 'datetime', '24h'),
      'Jan 10, 2026 · 18:30',
    );
  });

  it('la PWA pinta siempre en 24h, que es el DEFAULT del escritorio (y no es un descuido)', () => {
    // Se miró como sospecha de divergencia y NO lo es: la asimetría está bien
    // así, y lo que faltaba era escribirla (ya está, en la cabecera de
    // formatTime en web/src/lib/format.ts).
    //
    // El escritorio pasa un TimeFormat obligatorio a formatTime/
    // formatByPrecision porque tiene un slider 12h/24h en Settings. La PWA no
    // recibe ese parámetro y no puede: el ajuste no es un dato de la
    // biblioteca, es configuración de UNA máquina —vive en el electron-store
    // del PC, junto a las medidas de la ventana— y nunca entra en Turso, que
    // es lo único que la PWA lee (REMOTO.md §1.1). Traerlo sería montar una
    // sincronización de preferencias de escritorio para elegir dos puntos.
    //
    // Lo que sí importa es que la PWA clave el MISMO default que el escritorio
    // ('24h', src/main/config/store.ts): mientras nadie mueva el slider las dos
    // pantallas dicen exactamente lo mismo, y eso es lo que se fija aquí. Si
    // alguien cambia ese default en el escritorio, este test se cae — y hay que
    // mover los dos, o la divergencia pasa a ser la del que NO tocó nada.
    const { date, ms } = instante('2026-01-10T18:30');
    mismo(
      movilFormato.formatByPrecision(ms, 'datetime'),
      pcFormato.formatByPrecision(date, 'datetime', '24h'),
      'Jan 10, 2026 · 18:30',
    );
    // Y con el slider en 12h el escritorio sí cambia: la diferencia existe, es
    // conocida y solo la ve quien lo ha cambiado a mano en su PC.
    assert.equal(pcFormato.formatByPrecision(date, 'datetime', '12h'), 'Jan 10, 2026 · 06:30 PM');
  });
});

// ══ AGRUPACIÓN DE SESIONES POR DÍA ═════════════════════════════════════════

describe('sesiones: los mismos cubos de fecha en la lista del PC y en la del móvil', () => {
  it('los cortes de cubo caen en el mismo día, uno a uno', () => {
    // Recorrido día a día por los bordes de la tabla (0, 1, 7/8, 14/15) y por
    // los cubos gruesos. Cada uno se compara con el gemelo REAL del escritorio
    // (importado, ya no recortado del .tsx), no con una tabla escrita aquí.
    const ahora = new Date('2026-08-13T12:00');
    for (const dias of [0, 1, 2, 7, 8, 14, 15, 20, 25, 30, 40, 60, 120, 220, 400, 800]) {
      const fecha = new Date(ahora.getTime() - dias * 86_400_000);
      mismo(movilCubos.getSessionGroup(fecha, ahora), cuboPC(fecha, ahora));
    }
    // Y los bordes con nombre propio, fijados.
    const hoy = new Date('2026-08-13T09:00');
    const ayer = new Date('2026-08-12T23:30');
    const haceSiete = new Date('2026-08-06T12:00');
    const haceOcho = new Date('2026-08-05T12:00');
    mismo(movilCubos.getSessionGroup(hoy, ahora), cuboPC(hoy, ahora), 'Today');
    mismo(movilCubos.getSessionGroup(ayer, ahora), cuboPC(ayer, ahora), 'Yesterday');
    mismo(movilCubos.getSessionGroup(haceSiete, ahora), cuboPC(haceSiete, ahora), 'This Week');
    mismo(movilCubos.getSessionGroup(haceOcho, ahora), cuboPC(haceOcho, ahora), 'Last Week');
  });

  it('el ORDEN de los cubos manda: 10 días atrás es "Last Week" aunque sea el mismo mes', () => {
    // La tabla se lee de arriba abajo y el primer cubo que encaja gana. Una
    // sesión del 3 de agosto vista el 13 de agosto es del mes en curso, pero
    // sale como "Last Week" porque la semana se mira antes. Reordenar los ifs
    // en una sola de las dos mitades cambiaría la lista entera de una pantalla.
    const ahora = new Date('2026-08-13T12:00');
    const haceDiez = new Date('2026-08-03T12:00');
    mismo(movilCubos.getSessionGroup(haceDiez, ahora), cuboPC(haceDiez, ahora), 'Last Week');

    // Pasados los 14 días, ahí sí manda el mes.
    const finDeAgosto = new Date('2026-08-31T12:00');
    const principio = new Date('2026-08-05T12:00');
    mismo(
      movilCubos.getSessionGroup(principio, finDeAgosto),
      cuboPC(principio, finDeAgosto),
      'This Month',
    );
  });

  it('un mes anterior del mismo año va solo; uno de otro año lleva el año detrás', () => {
    // Los años pasados NO se apelotonan en un cubo por año: siempre desglosados
    // por mes. Y el año solo aparece cuando hace falta para no confundirlos.
    const ahora = new Date('2026-08-13T12:00');
    const junio = new Date('2026-06-14T12:00');
    const julioPasado = new Date('2025-07-09T12:00');
    mismo(movilCubos.getSessionGroup(junio, ahora), cuboPC(junio, ahora), 'June');
    mismo(movilCubos.getSessionGroup(julioPasado, ahora), cuboPC(julioPasado, ahora), 'July 2025');
  });

  it('en enero, diciembre sigue siendo "Last Month" aunque cambie el año', () => {
    // El mes anterior se calcula con new Date(año, mes - 1, 1), que en enero da
    // diciembre del año pasado. Es el caso que una resta de meses a pelo
    // (mes - 1 sin tocar el año) rompe una vez al año, en la semana en la que
    // nadie está mirando.
    const enero = new Date('2026-01-15T12:00');
    const diciembre = new Date('2025-12-16T12:00');
    const noviembre = new Date('2025-11-16T12:00');
    mismo(movilCubos.getSessionGroup(diciembre, enero), cuboPC(diciembre, enero), 'Last Month');
    mismo(movilCubos.getSessionGroup(noviembre, enero), cuboPC(noviembre, enero), 'November 2025');
  });

  it('una sesión con fecha futura cae en "Today", no en un cubo inventado', () => {
    // Pasa de verdad: un reloj adelantado, o una sesión manual mal escrita. Los
    // días salen negativos y la primera rama (diffDays <= 0) los recoge. Si una
    // mitad usara === 0 en vez de <= 0, esa fila se quedaría sin cabecera.
    const ahora = new Date('2026-08-13T12:00');
    const manana = new Date('2026-08-16T12:00');
    mismo(movilCubos.getSessionGroup(manana, ahora), cuboPC(manana, ahora), 'Today');
  });

  it('la página abre cubo nuevo en su primera fila, aunque repita etiqueta', () => {
    // groupPageByDate agrupa UNA PÁGINA, no la lista entera: la cabecera de la
    // primera fila siempre se pinta. Sin esto, pasar de página podía dejar una
    // tanda de filas "This Week" arrancando a mitad sin ningún titulito encima.
    // Y filas del mismo cubo NO contiguas abren dos grupos, que es justo lo que
    // permite que un mes partido en dos páginas enseñe su tarjeta en las dos.
    const ahora = new Date('2026-08-13T12:00');
    const pagina = [
      sesion('2026-08-13T10:00'),
      sesion('2026-08-13T08:00'),
      sesion('2026-08-11T20:00'),
      sesion('2026-08-13T02:00'),
    ];
    const grupos = movilCubos.groupPageByDate(pagina, ahora);
    assert.deepEqual(
      grupos.map((grupo) => [grupo.label, grupo.sessions.length]),
      [
        ['Today', 2],
        ['This Week', 1],
        ['Today', 1],
      ],
    );
    // Ninguna sesión se pierde ni se cuenta dos veces al agrupar.
    assert.equal(
      grupos.reduce((total, grupo) => total + grupo.sessions.length, 0),
      pagina.length,
    );

    // Y ahora que el gemelo del escritorio se puede importar, se compara el
    // reparto ENTERO —no solo la tabla de etiquetas—: la misma página tiene que
    // partirse en los mismos grupos y con las mismas filas en cada uno. Antes
    // esto no podía comprobarse (la extracción del .tsx solo alcanzaba a
    // getSessionGroup) y groupPageByDate era una copia sin vigilar.
    const paginaPC = pagina.map((s) => ({ startedAt: new Date(s.startedAt) }));
    assert.deepEqual(
      pcCubos.groupPageByDate(paginaPC, ahora).map((grupo) => [grupo.label, grupo.sessions.length]),
      grupos.map((grupo) => [grupo.label, grupo.sessions.length]),
    );
  });

  it('el monthScopeKey del escritorio solo existe donde el cubo ES un mes cerrado', () => {
    // La otra mitad de la respuesta del escritorio, que la PWA no tiene (no
    // pinta el recap del diario) y que por eso ningún test miraba: la clave del
    // mes con la que generated_memories conoce el periodo (AFTERPLAY-LOOP.md
    // §5). Los cubos del presente van a null a propósito —el mes en curso no se
    // narra, y "This Week" no es un mes aunque alguna fila caiga en el
    // anterior—, así que un null de más apaga la tarjeta y uno de menos la
    // enseña en un cubo que no es un mes.
    const ahora = new Date('2026-08-13T12:00');
    const clave = (iso: string): string | null =>
      pcCubos.getSessionGroup(new Date(iso), ahora).monthScopeKey;
    assert.equal(clave('2026-08-13T09:00'), null); // Today
    assert.equal(clave('2026-08-06T12:00'), null); // This Week
    assert.equal(clave('2026-08-03T12:00'), null); // Last Week, y es de este mes
    assert.equal(clave('2026-08-01T12:00'), null); // This Month
    assert.equal(clave('2026-07-04T12:00'), '2026-07'); // Last Month
    assert.equal(clave('2026-06-14T12:00'), '2026-06'); // June
    assert.equal(clave('2025-07-09T12:00'), '2025-07'); // July 2025
  });
});

// ══ TABLA DE ESTADOS ═══════════════════════════════════════════════════════

describe('estados: los adaptadores móvil y PC conservan la presentación', () => {
  it('los seis estados (y el "sin estado") tienen la misma etiqueta, color e icono', () => {
    // Both apps inject their local Lucide icons into the shared definition.
    const estados: (StateType | null)[] = [
      'started',
      'completed',
      'dropped',
      'on_hold',
      'resting',
      'plan_to_play',
      null,
    ];
    for (const estado of estados) {
      const movil = movilPaleta.statusOf(estado);
      const pc = pcEstado.getGameStatusMeta(estado);
      mismo(movil.label, pc.label);
      mismo(movil.color, pc.color);
      mismo(movil.filled, pc.filled);
      assert.equal(
        nombreIcono(movil.Icon),
        nombreIcono(pc.Icon),
        `otro icono para ${estado ?? 'unplayed'}`,
      );
    }
  });

  it('los tres hex que no son acentos de identidad siguen clavados', () => {
    // Estos tres no aparecen en colors.ts, así que el test de la paleta no los
    // alcanza: viven SOLO en la tabla de estados, en las dos copias.
    mismo(movilPaleta.statusOf('dropped').color, pcEstado.STATUS_META.dropped.color, '#e85d72');
    mismo(movilPaleta.statusOf('on_hold').color, pcEstado.STATUS_META.on_hold.color, '#8b93a3');
    mismo(movilPaleta.statusOf(null).color, pcEstado.STATUS_META.unplayed.color, '#888f8a');
  });
});

// ══ EL REPARTO DEL PLAN ════════════════════════════════════════════════════

describe('plan: las estanterías y la deuda se reparten igual en los dos', () => {
  // Un plan con los seis casos que separan una copia buena de una a medias.
  const juegos = [
    planeado({
      id: 2,
      title: 'Hollow Knight II',
      fijado: '2026-01-10T12:00',
      sale: { iso: '2099-06-15T00:00', precision: 'day' },
    }),
    planeado({
      id: 3,
      title: 'Celeste',
      sale: { iso: '2018-01-25T00:00', precision: 'day' },
      hltbMain: 8,
    }),
    planeado({
      id: 1,
      title: 'Zelda',
      fijado: '2026-01-10T10:00',
      sale: { iso: '2017-03-03T00:00', precision: 'day' },
      hltbMain: 20,
    }),
    planeado({
      id: 4,
      title: 'Silksong',
      sale: { iso: '2099-01-01T00:00', precision: 'month' },
      hltbMain: 12,
    }),
    planeado({
      id: 6,
      title: 'Tetris',
      sale: { iso: '1984-01-01T00:00', precision: 'year' },
      hltbMain: 100,
      endless: true,
    }),
    planeado({
      id: 5,
      title: 'Alan Wake',
      fijado: '2026-01-10T10:00',
      sale: { iso: '2010-05-18T00:00', precision: 'day' },
      hltbMain: 5,
    }),
  ];

  const movil = juegos.map((j) => j.movil);
  const pc = juegos.map((j) => j.pc);
  // La lente da igual para lo que se compara aquí (solo ordena la cola), pero
  // hay que elegir una: el escritorio no tiene reparto sin lente.
  const secciones = pcPlan.splitPlanSections(pc, 'oldest');

  it('Up next es el orden de fijado, y un empate al milisegundo lo parte el título', () => {
    // Zelda y Alan Wake se fijaron en el MISMO milisegundo — que es lo que pasa
    // cuando el escritorio drena de golpe dos pines del móvil. Sin desempate por
    // título la fila bailaría entre repintados.
    mismo(ids(estanterias.sortUpNext(movil, LEE_MOVIL)), ids(secciones.upNext), [5, 1, 2]);
    mismo(ids(estanterias.sortUpNext(pc, LEE_PC)), ids(secciones.upNext));
  });

  it('el horizonte NO es excluyente: un fijado sin salir sale en las DOS estanterías', () => {
    // LA PARTE SUTIL, y la que ya costó un fallo real: fijar un juego que estaba
    // en el horizonte lo hacía desaparecer de allí, y desde el sofá parecía que
    // la app se había comido la cuenta atrás. Hollow Knight II está fijado Y sin
    // salir, así que tiene que estar en upNext y en horizon a la vez.
    mismo(ids(estanterias.sortHorizon(movil, LEE_MOVIL)), ids(secciones.horizon), [4, 2]);
    mismo(ids(estanterias.sortHorizon(pc, LEE_PC)), ids(secciones.horizon));
    assert.ok(ids(secciones.upNext).includes(2), 'el fijado sin salir se perdió de Up next');
  });

  it('la cola es lo jugable sin fijar, y el orden lo pone quien la pinta', () => {
    // El reparto decide QUIÉNES están en la cola; el orden es de cada pantalla
    // (el escritorio le pasa una lente, la PWA se queda con el alfabético que ya
    // trae /api/plan). Por eso la pertenencia se compara con la cola ya
    // ordenada, y la lente se aplica encima para ver que sale la misma lista.
    const colaMovil = estanterias.filterQueue(movil, LEE_MOVIL);
    mismo([...ids(colaMovil)].sort(), [...ids(secciones.queue)].sort(), [3, 6]);
    mismo(
      ids(pcPlan.sortByLens(estanterias.filterQueue(pc, LEE_PC), 'oldest')),
      ids(secciones.queue),
    );
  });

  it('la deuda no cuenta las horas de un endless, pero sí cuenta el juego', () => {
    // El reparto asimétrico que una copia se deja por el camino: Tetris no tiene
    // final que alcanzar, así que sus 100 h no son deuda — pero está en tu plan,
    // así que cuenta en "across N games". Y Hollow Knight II, sin estimación, no
    // inventa horas: se dice aparte, en pequeño.
    mismo(estanterias.computePlanDebt(movil), pcPlan.computePlanDebt(pc), {
      totalGames: 6,
      totalHours: 45,
      withoutEstimate: 1,
    });
  });
});
