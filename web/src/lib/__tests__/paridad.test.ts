import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SessionWithGame, StateType } from '../../api';
import * as movilFormato from '../format';
import * as movilCubos from '../sessionGroups';
import * as movilPaleta from '../status';
import * as pcFormato from '../../../../src/renderer/src/lib/format';
import * as pcEstado from '../../../../src/renderer/src/lib/gameStatus';
import * as pcCubos from '../../../../src/renderer/src/lib/sessionGroups';

// Solo quedan aquí las comparaciones entre DOS piezas de código distintas: los
// adaptadores de la PWA (milisegundos, 24h fijo, etiquetas sin el recap del
// diario, sus propios iconos de Lucide) contra los del escritorio.
//
// Los casos "A contra A" —las dos mitades re-exportando la MISMA función de
// src/shared— se mudaron, con su valor esperado y en las dos monedas (Date y
// ms), a src/shared/domain/__tests__/presentationRules.test.ts: comparar f(x)
// con f(x) no puede fallar, y un fallo compartido estaría de acuerdo consigo
// mismo. Los de la vista previa del buzón viven en planOrder.test.ts.
//
// El reparto del Plan también dejó de tener dos lados: el escritorio ya no
// tiene copia en lib/plan.ts y llama a src/shared/planShelves como la PWA. Sus
// casos, con valores escritos y en las dos monedas, están en
// src/shared/__tests__/planShelves.test.ts; lo que el escritorio pone encima
// (la lente sobre la cola) en src/renderer/src/lib/__tests__/plan.test.ts.

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
