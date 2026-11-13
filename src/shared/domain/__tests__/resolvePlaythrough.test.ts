import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  resolvePlaythroughForPlay,
  type PlaythroughDecision,
  type PlaythroughEventToWrite,
  type PlaythroughGameRow,
  type PlaythroughRow,
  type PlaythroughStateEventRow,
  type ResolvePlaythroughInput,
} from '../resolvePlaythrough';

// LA DECISIÓN PURA de "¿en qué playthrough cae jugar a este juego en `at`?".
//
// Estos tests cubren, rama por rama, lo mismo que
// src/main/db/__tests__/resolveIterationForPlay.test.ts —que sigue existiendo y
// prueba la EJECUCIÓN contra una base real—, pero sin base: entran filas, sale
// una decisión. Es lo que ahora comparten el escritorio y el Worker, así que
// un cambio de regla se ve aquí antes que en ninguno de los dos.
//
// Las fechas sin zona se parsean en hora LOCAL, que es con la que la decisión
// compara días ("¿esto es historia?"); las de con Z, en UTC. Con `now` por
// defecto igual a `at` se prueba la puerta del watcher/Play/cronómetro, que
// siempre juega AHORA.

type Ev = [iterationId: number, type: PlaythroughStateEventRow['type'], occurredAt: string];

const NORMAL: PlaythroughGameRow = { endless: false, isEmulated: false, officialPlatforms: null };

// Los ids de los eventos siguen el orden en que se escriben en la lista, igual
// que en una base: el empate de instante lo gana el escrito después.
const decide = (opts: {
  playthroughs?: (number | PlaythroughRow)[];
  events?: Ev[];
  game?: PlaythroughGameRow | null;
  at: string;
  now?: string;
}): PlaythroughDecision => {
  const input: ResolvePlaythroughInput = {
    playthroughs: (opts.playthroughs ?? []).map((p) =>
      typeof p === 'number' ? { id: p, label: `Playthrough ${p}` } : p,
    ),
    events: (opts.events ?? []).map(([iterationId, type, occurredAt], index) => ({
      id: index + 1,
      iterationId,
      type,
      occurredAt: new Date(occurredAt),
    })),
    game: opts.game === undefined ? NORMAL : opts.game,
    at: new Date(opts.at),
    now: new Date(opts.now ?? opts.at),
  };
  return resolvePlaythroughForPlay(input);
};

const started = (at: string): PlaythroughEventToWrite => ({
  type: 'started',
  occurredAt: new Date(at),
  datePrecision: 'datetime',
  note: null,
});
const completed = (at: string): PlaythroughEventToWrite => ({ ...started(at), type: 'completed' });

describe('resolvePlaythroughForPlay: cuando ya hay algo en marcha', () => {
  it('el activo en esa fecha se usa sin escribir nada', () => {
    assert.deepEqual(
      decide({
        playthroughs: [1],
        events: [[1, 'started', '2026-01-10T18:00:00Z']],
        at: '2026-01-12T21:00:00Z',
      }),
      { kind: 'use', iterationId: 1 },
    );
  });

  it('una pausa no es un final: on_hold y resting se reanudan con un started en `at`', () => {
    for (const pausa of ['on_hold', 'resting'] as const) {
      assert.deepEqual(
        decide({
          playthroughs: [1],
          events: [
            [1, 'started', '2026-01-10T18:00:00Z'],
            [1, pausa, '2026-01-20T23:00:00Z'],
          ],
          at: '2026-02-01T19:00:00Z',
        }),
        { kind: 'resume', iterationId: 1, events: [started('2026-02-01T19:00:00Z')] },
      );
    }
  });

  it('el playthrough sin un solo evento (recién dado de alta) se estrena, no se crea otro', () => {
    assert.deepEqual(decide({ playthroughs: [1], at: '2026-03-05T20:00:00Z' }), {
      kind: 'resume',
      iterationId: 1,
      events: [started('2026-03-05T20:00:00Z')],
    });
  });

  it('el activo manda sobre "la última" aunque no sea la de id más alto', () => {
    assert.deepEqual(
      decide({
        playthroughs: [1, 2],
        events: [
          [1, 'started', '2026-01-05T18:00:00Z'],
          [2, 'completed', '2026-01-04T18:00:00Z'],
        ],
        at: '2026-01-10T18:00:00Z',
      }),
      { kind: 'use', iterationId: 1 },
    );
  });

  it('no se fía del orden de entrada: la "última" es la de id más alto', () => {
    assert.deepEqual(decide({ playthroughs: [7, 3], at: '2026-03-05T20:00:00Z' }), {
      kind: 'resume',
      iterationId: 7,
      events: [started('2026-03-05T20:00:00Z')],
    });
  });
});

describe('resolvePlaythroughForPlay: cuando el último terminó', () => {
  it('tras un Beaten o un Dropped, crea el siguiente con su started', () => {
    for (const fin of ['completed', 'dropped'] as const) {
      assert.deepEqual(
        decide({
          playthroughs: [1],
          events: [
            [1, 'started', '2026-01-10T18:00:00Z'],
            [1, fin, '2026-02-01T23:30:00Z'],
          ],
          at: '2026-02-10T19:00:00Z',
        }),
        {
          kind: 'create',
          playthrough: {
            label: 'Playthrough 2',
            playedPlatform: 'PC',
            origin: 'Purchased',
            format: 'digital',
          },
          events: [started('2026-02-10T19:00:00Z')],
        },
      );
    }
  });

  it('sin ningún playthrough estrena Playthrough 1', () => {
    const decision = decide({ at: '2026-05-01T17:00:00Z' });
    assert.equal(decision.kind, 'create');
    assert.equal(decision.kind === 'create' && decision.playthrough.label, 'Playthrough 1');
    assert.deepEqual(decision.kind === 'create' && decision.events, [
      started('2026-05-01T17:00:00Z'),
    ]);
  });

  it('la plataforma del nuevo: Emulated manda, luego la primera oficial, luego PC (también sin fila de juego)', () => {
    const platformOf = (game: PlaythroughGameRow | null): string | false => {
      const decision = decide({ game, at: '2026-06-01T18:00:00Z' });
      return decision.kind === 'create' && decision.playthrough.playedPlatform;
    };
    assert.equal(
      platformOf({ ...NORMAL, isEmulated: true, officialPlatforms: ['Super Nintendo'] }),
      'Emulated',
    );
    assert.equal(
      platformOf({ ...NORMAL, officialPlatforms: ['PlayStation 4', 'PC'] }),
      'PlayStation 4',
    );
    assert.equal(platformOf(NORMAL), 'PC');
    assert.equal(platformOf(null), 'PC');
  });

  it('la etiqueta sale del número más alto usado, con el recuento como suelo', () => {
    const labelOf = (labels: string[]): string | false => {
      const decision = decide({
        playthroughs: labels.map((label, index) => ({ id: index + 1, label })),
        events: labels.map((_, index): Ev => [index + 1, 'completed', '2026-01-20T22:00:00Z']),
        at: '2026-03-01T18:00:00Z',
      });
      return decision.kind === 'create' && decision.playthrough.label;
    };
    assert.equal(labelOf(['Playthrough 1', 'Playthrough 3']), 'Playthrough 4');
    assert.equal(labelOf(['Primera vuelta', 'NG+']), 'Playthrough 3');
  });

  it('un endless no tiene playthroughs discretos: ni un Dropped le abre otro', () => {
    assert.deepEqual(
      decide({
        playthroughs: [1],
        events: [
          [1, 'started', '2026-01-05T18:00:00Z'],
          [1, 'dropped', '2026-03-01T21:00:00Z'],
        ],
        game: { ...NORMAL, endless: true },
        at: '2026-07-01T18:00:00Z',
      }),
      { kind: 'resume', iterationId: 1, events: [started('2026-07-01T18:00:00Z')] },
    );
  });

  it('un plan_to_play posterior no borra el desenlace: el Beaten sigue mandando', () => {
    const decision = decide({
      playthroughs: [1],
      events: [
        [1, 'started', '2026-01-10T18:00:00Z'],
        [1, 'completed', '2026-02-01T22:00:00Z'],
        [1, 'plan_to_play', '2026-03-01T10:00:00Z'],
      ],
      at: '2026-03-10T18:00:00Z',
    });
    assert.equal(decision.kind, 'create');
  });
});

describe('resolvePlaythroughForPlay: la foto se toma en `at`, no hoy', () => {
  it('la sesión de julio cae en el playthrough abierto en julio aunque hoy esté Beaten', () => {
    assert.deepEqual(
      decide({
        playthroughs: [1],
        events: [
          [1, 'started', '2026-07-10T18:00:00Z'],
          [1, 'completed', '2026-08-01T23:00:00Z'],
        ],
        at: '2026-07-20T21:00:00Z',
        now: '2026-08-10T12:00:00Z',
      }),
      { kind: 'use', iterationId: 1 },
    );
  });

  it('un completed fechado después de `at` no bloquea: a esa fecha seguía activo', () => {
    assert.deepEqual(
      decide({
        playthroughs: [1],
        events: [
          [1, 'started', '2026-01-05T18:00:00Z'],
          [1, 'completed', '2026-06-01T18:00:00Z'],
        ],
        at: '2026-01-10T18:00:00Z',
      }),
      { kind: 'use', iterationId: 1 },
    );
  });

  it('si a esa fecha ya había terminado y es historia, el nuevo nace fechado en `at` Y cerrado', () => {
    assert.deepEqual(
      decide({
        playthroughs: [1],
        events: [
          [1, 'started', '2026-06-01T18:00:00Z'],
          [1, 'completed', '2026-07-01T22:00:00Z'],
        ],
        game: { ...NORMAL, isEmulated: true },
        at: '2026-07-20T21:00:00Z',
        now: '2026-08-13T12:00:00Z',
      }),
      {
        kind: 'create',
        playthrough: {
          label: 'Playthrough 2',
          playedPlatform: 'Emulated',
          origin: 'Purchased',
          format: 'digital',
        },
        // El orden importa: el ejecutor los escribe así y el id desempata.
        events: [started('2026-07-20T21:00:00Z'), completed('2026-07-20T21:00:00Z')],
      },
    );
  });

  it('la misma jugada, pero del mismo día natural (local), nace abierta', () => {
    const decision = decide({
      playthroughs: [1],
      events: [
        [1, 'started', '2026-06-01T18:00:00Z'],
        [1, 'completed', '2026-07-01T22:00:00Z'],
      ],
      at: '2026-08-13T17:00:00',
      now: '2026-08-13T22:30:00',
    });
    assert.equal(decision.kind, 'create');
    assert.deepEqual(decision.kind === 'create' && decision.events, [
      started('2026-08-13T17:00:00'),
    ]);
  });

  it('otra sesión vieja tras un cerrado al vuelo se cuelga de él sin escribir nada', () => {
    // La firma: exactamente started+completed en el MISMO instante.
    assert.deepEqual(
      decide({
        playthroughs: [1, 2],
        events: [
          [1, 'started', '2026-06-01T18:00:00Z'],
          [1, 'completed', '2026-07-01T22:00:00Z'],
          [2, 'started', '2026-07-20T21:00:00Z'],
          [2, 'completed', '2026-07-20T21:00:00Z'],
        ],
        at: '2026-07-21T20:00:00Z',
        now: '2026-08-13T12:00:00Z',
      }),
      { kind: 'use', iterationId: 2 },
    );
  });

  it('la firma depende del orden real, no del de entrada: completed antes en la lista también cuenta', () => {
    const decision = resolvePlaythroughForPlay({
      playthroughs: [{ id: 2, label: 'Playthrough 2' }],
      events: [
        { id: 11, iterationId: 2, type: 'completed', occurredAt: new Date('2026-07-20T21:00:00Z') },
        { id: 10, iterationId: 2, type: 'started', occurredAt: new Date('2026-07-20T21:00:00Z') },
      ],
      game: NORMAL,
      at: new Date('2026-07-21T20:00:00Z'),
      now: new Date('2026-08-13T12:00:00Z'),
    });
    assert.deepEqual(decision, { kind: 'use', iterationId: 2 });
  });

  it('el cerrado al vuelo NO se reutiliza si la jugada es de hoy: estrena otro abierto', () => {
    const decision = decide({
      playthroughs: [1],
      events: [
        [1, 'started', '2026-07-20T21:00:00Z'],
        [1, 'completed', '2026-07-20T21:00:00Z'],
      ],
      at: '2026-08-13T17:00:00',
      now: '2026-08-13T22:30:00',
    });
    assert.equal(decision.kind, 'create');
    assert.equal(decision.kind === 'create' && decision.events.length, 1);
  });

  it('un terminado A MANO (fechas distintas) no se reabre con una sesión vieja: crea otro', () => {
    const decision = decide({
      playthroughs: [1],
      events: [
        [1, 'started', '2026-07-01T18:00:00Z'],
        [1, 'completed', '2026-07-01T22:00:00Z'],
      ],
      at: '2026-07-20T21:00:00Z',
      now: '2026-08-13T12:00:00Z',
    });
    assert.equal(decision.kind, 'create');
  });

  it('el PRIMER playthrough de un juego nace abierto aunque la sesión sea vieja', () => {
    assert.deepEqual(decide({ at: '2026-08-05T21:00:00Z', now: '2026-08-13T12:00:00Z' }), {
      kind: 'create',
      playthrough: {
        label: 'Playthrough 1',
        playedPlatform: 'PC',
        origin: 'Purchased',
        format: 'digital',
      },
      events: [started('2026-08-05T21:00:00Z')],
    });
  });

  it('reanudar un pausado con una sesión vieja no lo cierra', () => {
    assert.deepEqual(
      decide({
        playthroughs: [1],
        events: [
          [1, 'started', '2026-05-01T18:00:00Z'],
          [1, 'on_hold', '2026-06-10T21:00:00Z'],
        ],
        at: '2026-07-20T21:00:00Z',
        now: '2026-08-13T12:00:00Z',
      }),
      { kind: 'resume', iterationId: 1, events: [started('2026-07-20T21:00:00Z')] },
    );
  });

  it('si el destino ya tiene un started en `at` o después, no se le escribe otro', () => {
    assert.deepEqual(
      decide({
        playthroughs: [1],
        events: [
          [1, 'started', '2026-08-01T18:00:00Z'],
          [1, 'completed', '2026-08-15T22:00:00Z'],
        ],
        at: '2026-07-20T21:00:00Z',
        now: '2026-08-20T12:00:00Z',
      }),
      { kind: 'use', iterationId: 1 },
    );
  });
});

describe('resolvePlaythroughForPlay: como mucho un playthrough activo por juego', () => {
  it('con uno vivo HOY por un started posterior a `at`, la sesión cae en él', () => {
    assert.deepEqual(
      decide({
        playthroughs: [1, 2],
        events: [
          [1, 'started', '2026-01-10T18:00:00Z'],
          [1, 'completed', '2026-03-01T22:00:00Z'],
          [1, 'started', '2026-08-01T18:00:00Z'],
          [2, 'started', '2026-05-01T18:00:00Z'],
          [2, 'dropped', '2026-06-15T20:00:00Z'],
        ],
        at: '2026-07-20T21:00:00Z',
        now: '2026-08-13T12:00:00Z',
      }),
      { kind: 'use', iterationId: 1 },
    );
  });

  it('una jugada de ahora con un hermano activo cae en él y no estrena un tercero', () => {
    assert.deepEqual(
      decide({
        playthroughs: [1, 2],
        events: [
          [1, 'started', '2026-01-10T18:00:00Z'],
          [1, 'completed', '2026-02-20T22:00:00Z'],
          [2, 'started', '2026-03-01T18:00:00Z'],
        ],
        at: '2026-03-15T19:00:00Z',
      }),
      { kind: 'use', iterationId: 2 },
    );
  });

  it('los eventos de iteraciones ajenas al juego se ignoran', () => {
    assert.deepEqual(
      decide({
        playthroughs: [1],
        events: [[99, 'started', '2026-01-01T00:00:00Z']],
        at: '2026-03-05T20:00:00Z',
      }),
      { kind: 'resume', iterationId: 1, events: [started('2026-03-05T20:00:00Z')] },
    );
  });
});
