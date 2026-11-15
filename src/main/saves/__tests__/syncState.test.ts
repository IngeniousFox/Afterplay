import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeSaveSyncState,
  type LineageRow,
  type LocalSave,
  type SaveSyncInput,
} from '../syncState';

// Estado de la partida entre PCs (§12.4, F-25). La función es pura: aquí se
// recorre la tabla del diseño entera, desde los dos PCs. Datos inventados.

const PC_A = 'pc-a';
const PC_B = 'pc-b';

let counter = 0;

interface RowOptions {
  readonly parent?: string | null;
  readonly device?: string;
  readonly alive?: boolean;
  readonly order?: string;
  readonly createdAt?: Date;
  readonly id?: string;
}

/** Una fila del índice. El reloj de sync (`order`) crece con cada llamada. */
const row = (hash: string | null, options: RowOptions = {}): LineageRow => {
  counter += 1;
  const device = options.device ?? PC_A;
  return {
    id: options.id ?? `row-${counter}`,
    deviceId: device,
    deviceName: device === PC_A ? 'PC-A' : 'PC-B',
    contentHash: hash,
    parentContentHash: options.parent ?? null,
    alive: options.alive ?? true,
    createdAt: options.createdAt ?? new Date(Date.UTC(2026, 0, 1, 0, counter)),
    order: options.order ?? String(counter).padStart(6, '0'),
  };
};

const at = (hash: string): LocalSave => ({ kind: 'hash', hash });
const EMPTY: LocalSave = { kind: 'empty' };
const UNKNOWN: LocalSave = { kind: 'unknown' };

const compute = (
  rows: LineageRow[],
  local: LocalSave,
  lastSynced: string | null,
  selfDeviceId = PC_A,
): ReturnType<typeof computeSaveSyncState> =>
  computeSaveSyncState({ rows, local, lastSynced, selfDeviceId } satisfies SaveSyncInput);

describe('none', () => {
  it('sin copias en la nube', () => {
    const state = compute([], at('A'), 'A');
    assert.equal(state.status, 'none');
    assert.equal(state.head, null);
    assert.deepEqual(state.tips, []);
  });

  it('todas las copias con lápida cuentan como ninguna', () => {
    const state = compute([row('A', { alive: false }), row('B', { alive: false })], at('A'), 'A');
    assert.equal(state.status, 'none');
    assert.equal(state.head, null);
  });
});

describe('una sola punta', () => {
  it('synced: L = S = H', () => {
    const rows = [row('A'), row('B', { parent: 'A' })];
    const state = compute(rows, at('B'), 'B');
    assert.equal(state.status, 'synced');
    assert.equal(state.head?.contentHash, 'B');
    assert.equal(state.tips.length, 1);
    assert.equal(state.localChanges, false);
    assert.equal(state.localVerified, true);
  });

  it('local-changes: S = H y L distinto', () => {
    const rows = [row('A'), row('B', { parent: 'A' })];
    const state = compute(rows, at('X'), 'B');
    assert.equal(state.status, 'local-changes');
    assert.equal(state.localChanges, true);
  });

  it('disco sin partida con S = H: se ofrece la nube (available) y localChanges es true', () => {
    const state = compute([row('A')], EMPTY, 'A');
    // Sin partida en el disco se ofrece la de la nube, no "hay cambios".
    assert.equal(state.status, 'available');
    assert.equal(state.localChanges, true);
  });

  it('behind: S es antepasado de H y L = S', () => {
    const rows = [row('A'), row('B', { parent: 'A', device: PC_B })];
    const state = compute(rows, at('A'), 'A');
    assert.equal(state.status, 'behind');
    assert.equal(state.head?.contentHash, 'B');
    assert.equal(state.head?.deviceName, 'PC-B');
    assert.equal(state.head?.isOwn, false);
    assert.equal(state.localChanges, false);
  });

  it('behind: S antepasado lejano de H (a través de varios pasos)', () => {
    const rows = [
      row('A'),
      row('B', { parent: 'A', device: PC_B }),
      row('C', { parent: 'B', device: PC_B }),
    ];
    assert.equal(compute(rows, at('A'), 'A').status, 'behind');
  });

  it('behind: con L desconocido (no se pudo leer el disco) se fía de S', () => {
    const rows = [row('A'), row('B', { parent: 'A', device: PC_B })];
    const state = compute(rows, UNKNOWN, 'A');
    assert.equal(state.status, 'behind');
    assert.equal(state.localVerified, false);
    assert.equal(state.localChanges, null);
  });

  it('diverged: S antepasado de H pero el disco cambió (L distinto de S)', () => {
    const rows = [row('A'), row('B', { parent: 'A', device: PC_B })];
    const state = compute(rows, at('X'), 'A');
    assert.equal(state.status, 'diverged');
    assert.equal(state.head?.contentHash, 'B');
    assert.equal(state.tips.length, 1);
    assert.equal(state.localChanges, true);
  });

  it('diverged: S antepasado de H y el disco vacío NO es divergencia (se ofrece la nube)', () => {
    const rows = [row('A'), row('B', { parent: 'A', device: PC_B })];
    assert.equal(compute(rows, EMPTY, 'A').status, 'available');
  });

  it('available: este PC no ha subido ni restaurado nada', () => {
    const rows = [row('A', { device: PC_B })];
    const state = compute(rows, at('X'), null);
    assert.equal(state.status, 'available');
    assert.equal(state.head?.contentHash, 'A');
    assert.equal(state.localChanges, null);
  });

  it('available: el disco está vacío, haya o no S', () => {
    const rows = [row('A', { device: PC_B })];
    assert.equal(compute(rows, EMPTY, null).status, 'available');
    assert.equal(compute(rows, EMPTY, 'A').status, 'available');
  });

  it('available: sin S y con el disco ilegible', () => {
    const state = compute([row('A', { device: PC_B })], UNKNOWN, null);
    assert.equal(state.status, 'available');
    assert.equal(state.localVerified, false);
  });

  it('L = H es synced aunque S sea otra cosa o no exista', () => {
    const rows = [row('A'), row('B', { parent: 'A', device: PC_B })];
    // S desconocido (la partida se copió a mano).
    assert.equal(compute(rows, at('B'), null).status, 'synced');
    // S de un estado antiguo.
    assert.equal(compute(rows, at('B'), 'A').status, 'synced');
    // S de un estado que ni consta.
    assert.equal(compute(rows, at('B'), 'zzz').status, 'synced');
  });

  it('S = H con el disco ilegible: no se afirma nada contra el disco, synced', () => {
    const state = compute([row('A')], UNKNOWN, 'A');
    assert.equal(state.status, 'synced');
    assert.equal(state.localVerified, false);
  });

  it('S descendiente de una cabeza que ya no está viva: local-changes', () => {
    // A -> B; B se borró (era lo último de este PC). La nube solo tiene A.
    const rows = [row('A'), row('B', { parent: 'A', alive: false })];
    const state = compute(rows, at('B'), 'B');
    assert.equal(state.status, 'local-changes');
    assert.equal(state.head?.contentHash, 'A');
    // Y con L ≠ S también.
    assert.equal(compute(rows, at('X'), 'B').status, 'local-changes');
  });

  it('S que no cuelga del grafo y distinto de H: unlinked, sin afirmar nada', () => {
    const rows = [row('A', { device: PC_B })];
    const state = compute(rows, at('Y'), 'S-ajeno');
    assert.equal(state.status, 'unlinked');
    assert.equal(state.head?.contentHash, 'A');
  });

  it('cabeza de una huella con varias filas: se nombra la copia más reciente', () => {
    const older = row('A', { device: PC_A, id: 'old' });
    const newer = row('A', { device: PC_B, id: 'new' });
    const state = compute([older, newer], at('A'), 'A');
    assert.equal(state.status, 'synced');
    assert.equal(state.head?.backupId, 'new');
    assert.equal(state.head?.deviceId, PC_B);
    assert.equal(state.tips.length, 1);
  });
});

describe('linaje con filas podadas o borradas', () => {
  it('A -> B(borrada) -> C: C desciende de A aunque falte B', () => {
    const rows = [
      row('A'),
      row('B', { parent: 'A', alive: false }),
      row('C', { parent: 'B', device: PC_B }),
    ];
    const state = compute(rows, at('A'), 'A');
    assert.equal(state.status, 'behind');
    assert.equal(state.head?.contentHash, 'C');
    // A no es punta: C desciende de él a través de B.
    assert.deepEqual(
      state.tips.map((tip) => tip.contentHash),
      ['C'],
    );
  });

  it('una punta borrada no es punta: la anterior viva pasa a serlo', () => {
    const rows = [row('A'), row('B', { parent: 'A', alive: false })];
    const state = compute(rows, at('A'), 'A');
    assert.equal(state.status, 'synced');
    assert.deepEqual(
      state.tips.map((tip) => tip.contentHash),
      ['A'],
    );
  });

  it('una rama muerta no genera divergencia', () => {
    // A -> B (viva) y A -> C (borrada): solo B es punta.
    const rows = [
      row('A'),
      row('B', { parent: 'A' }),
      row('C', { parent: 'A', alive: false, device: PC_B }),
    ];
    const state = compute(rows, at('B'), 'B');
    assert.equal(state.status, 'synced');
    assert.equal(state.tips.length, 1);
  });
});

describe('varias puntas', () => {
  // A (raíz) -> B (PC-A) y A -> C (PC-B): dos PCs partieron de la misma partida.
  const fork = (): LineageRow[] => [
    row('A'),
    row('B', { parent: 'A', device: PC_A }),
    row('C', { parent: 'A', device: PC_B }),
  ];

  it('diverged con antepasado común, visto desde el PC que NO subió último', () => {
    const rows = fork();
    // PC-A sube B; después PC-B sube C: PC-A es el que NO hizo la última copia.
    const state = compute(rows, at('B'), 'B', PC_A);
    assert.equal(state.status, 'diverged');
    assert.equal(state.tips.length, 2);
    assert.deepEqual(
      state.tips.map((tip) => tip.contentHash),
      ['C', 'B'],
    );
    assert.equal(state.head?.contentHash, 'C');
  });

  it('diverged con antepasado común, visto desde el PC que SÍ subió último (E-17)', () => {
    const rows = fork();
    // Mismas filas, desde PC-B: L = S = C, la punta más reciente. Sigue habiendo
    // una divergencia: el otro PC tiene una partida que este no ha visto.
    const fromB = compute(rows, at('C'), 'C', PC_B);
    const fromA = compute(rows, at('B'), 'B', PC_A);
    assert.equal(fromB.status, 'diverged');
    assert.deepEqual(
      fromB.tips.map((tip) => tip.contentHash),
      fromA.tips.map((tip) => tip.contentHash),
    );
    // La misma historia vista desde los dos lados: lo único que cambia es isOwn.
    assert.deepEqual(
      fromB.tips.map((tip) => tip.isOwn),
      [true, false],
    );
    assert.deepEqual(
      fromA.tips.map((tip) => tip.isOwn),
      [false, true],
    );
  });

  it('diverged aunque el disco ya coincida con una de las puntas', () => {
    const rows = fork();
    assert.equal(compute(rows, at('C'), null, PC_A).status, 'diverged');
    assert.equal(compute(rows, EMPTY, null, PC_A).status, 'diverged');
    assert.equal(compute(rows, UNKNOWN, 'B', PC_A).status, 'diverged');
  });

  it('el antepasado común puede estar borrado (podado)', () => {
    const rows = [
      row('A', { alive: false }),
      row('B', { parent: 'A', device: PC_A }),
      row('C', { parent: 'A', device: PC_B }),
    ];
    assert.equal(compute(rows, at('B'), 'B').status, 'diverged');
  });

  it('el antepasado común puede estar a varios pasos de una de las puntas', () => {
    const rows = [
      row('A'),
      row('B', { parent: 'A', device: PC_A }),
      row('B2', { parent: 'B', device: PC_A }),
      row('C', { parent: 'A', device: PC_B }),
    ];
    const state = compute(rows, at('B2'), 'B2');
    assert.equal(state.status, 'diverged');
    assert.deepEqual(state.tips.map((tip) => tip.contentHash).sort(), ['B2', 'C']);
  });

  it('tres puntas, solo dos con antepasado demostrable: diverged', () => {
    const rows = [
      row('A'),
      row('B', { parent: 'A' }),
      row('C', { parent: 'A', device: PC_B }),
      row('Z', { device: 'pc-c' }), // sin padre: no se sabe de quién viene
    ];
    const state = compute(rows, at('B'), 'B');
    assert.equal(state.status, 'diverged');
    assert.equal(state.tips.length, 3);
  });

  it('sin antepasado común demostrable (filas de la 1.x, sin padre): unlinked, no diverged', () => {
    const rows = [row('B', { parent: null }), row('C', { parent: null, device: PC_B })];
    const state = compute(rows, at('B'), 'B');
    assert.equal(state.status, 'unlinked');
    assert.equal(state.tips.length, 2);
    // Informativo: se nombra la más reciente.
    assert.equal(state.head?.contentHash, 'C');
  });

  it('padres distintos que no se enlazan entre sí: unlinked', () => {
    const rows = [row('B', { parent: 'P1' }), row('C', { parent: 'P2', device: PC_B })];
    assert.equal(compute(rows, at('B'), 'B').status, 'unlinked');
  });

  it('una punta con linaje y otra sin él: unlinked', () => {
    const rows = [row('A'), row('B', { parent: 'A' }), row('Z', { device: 'pc-c' })];
    assert.equal(compute(rows, at('B'), 'B').status, 'unlinked');
  });

  it('las puntas salen de la más reciente a la más antigua por el reloj de sync, no por la hora de pared', () => {
    // El PC con el reloj adelantado años NO adelanta su copia (§12.5).
    const rows = [
      row('A', { order: '000001' }),
      row('B', {
        parent: 'A',
        order: '000002',
        createdAt: new Date(Date.UTC(2030, 0, 1)),
      }),
      row('C', {
        parent: 'A',
        device: PC_B,
        order: '000003',
        createdAt: new Date(Date.UTC(2026, 0, 1)),
      }),
    ];
    const state = compute(rows, at('B'), 'B');
    assert.deepEqual(
      state.tips.map((tip) => tip.contentHash),
      ['C', 'B'],
    );
    assert.equal(state.head?.contentHash, 'C');
  });

  it('con el mismo reloj de sync desempata el id, siempre igual', () => {
    const rows = [
      row('A', { order: '000001' }),
      row('B', { parent: 'A', order: '000005', id: 'id-1' }),
      row('C', { parent: 'A', order: '000005', id: 'id-2', device: PC_B }),
    ];
    const one = compute(rows, at('B'), 'B');
    const two = compute([...rows].reverse(), at('B'), 'B');
    assert.deepEqual(
      one.tips.map((tip) => tip.contentHash),
      two.tips.map((tip) => tip.contentHash),
    );
  });
});

describe('ciclos', () => {
  it('volver a un estado anterior (A -> B -> A) no es divergencia', () => {
    const rows = [row('A'), row('B', { parent: 'A' }), row('A', { parent: 'B' })];
    const state = compute(rows, at('A'), 'A');
    assert.equal(state.status, 'synced');
    assert.equal(state.tips.length, 1);
  });

  it('en un ciclo la punta es la fila más reciente', () => {
    const first = row('A', { id: 'first-a' });
    const middle = row('B', { parent: 'A', id: 'middle-b' });
    const last = row('A', { parent: 'B', id: 'last-a' });
    const state = compute([first, middle, last], at('A'), 'A');
    assert.equal(state.head?.backupId, 'last-a');
    // La inversa: el ciclo termina en B.
    const again = row('A', { parent: 'B', id: 'again-a' });
    const back = row('B', { parent: 'A', id: 'last-b' });
    const state2 = compute([first, middle, again, back], at('B'), 'B');
    assert.equal(state2.head?.backupId, 'last-b');
    assert.equal(state2.tips.length, 1);
  });

  it('un ciclo con una rama que cuelga de él: la rama es la cabeza, no hay divergencia', () => {
    const rows = [
      row('A'),
      row('B', { parent: 'A' }),
      row('A', { parent: 'B' }),
      row('C', { parent: 'A', device: PC_B }),
    ];
    const state = compute(rows, at('A'), 'A');
    assert.equal(state.status, 'behind');
    assert.deepEqual(
      state.tips.map((tip) => tip.contentHash),
      ['C'],
    );
  });

  it('un ciclo con dos ramas que cuelgan de él sí diverge', () => {
    const rows = [
      row('A'),
      row('B', { parent: 'A' }),
      row('A', { parent: 'B' }),
      row('C', { parent: 'A', device: PC_B }),
      row('D', { parent: 'B', device: PC_A }),
    ];
    const state = compute(rows, at('A'), 'A');
    assert.equal(state.status, 'diverged');
    assert.equal(state.tips.length, 2);
  });

  it('una fila que dice ser su propio padre se ignora', () => {
    const rows = [row('A', { parent: 'A' })];
    const state = compute(rows, at('A'), 'A');
    assert.equal(state.status, 'synced');
    assert.equal(state.tips.length, 1);
  });

  it('un ciclo largo (A -> B -> C -> A) no se queda colgado', () => {
    const rows = [
      row('A'),
      row('B', { parent: 'A' }),
      row('C', { parent: 'B' }),
      row('A', { parent: 'C' }),
    ];
    const state = compute(rows, at('A'), 'A');
    assert.equal(state.status, 'synced');
    assert.equal(state.tips.length, 1);
  });
});

describe('copias sin huella', () => {
  it('solo filas sin contentHash: unlinked, se nombra la más reciente', () => {
    const rows = [row(null, { id: 'old' }), row(null, { id: 'new', device: PC_B })];
    const state = compute(rows, at('A'), 'A');
    assert.equal(state.status, 'unlinked');
    assert.equal(state.head?.backupId, 'new');
    assert.equal(state.head?.contentHash, null);
    assert.equal(state.tips.length, 1);
  });

  it('las filas sin huella con lápida no cuentan', () => {
    const rows = [row(null, { alive: false })];
    assert.equal(compute(rows, at('A'), 'A').status, 'none');
  });

  it('una fila sin huella junto a una con huella no estorba', () => {
    const rows = [row(null), row('A', { device: PC_B })];
    const state = compute(rows, at('A'), 'A');
    assert.equal(state.status, 'synced');
    assert.equal(state.head?.contentHash, 'A');
  });
});

describe('localVerified y localChanges', () => {
  const rows = (): LineageRow[] => [row('A'), row('B', { parent: 'A' })];

  it('con huella y S: localChanges compara L con S', () => {
    assert.equal(compute(rows(), at('B'), 'B').localChanges, false);
    assert.equal(compute(rows(), at('X'), 'B').localChanges, true);
    assert.equal(compute(rows(), at('B'), 'B').localVerified, true);
  });

  it('sin S no se sabe', () => {
    assert.equal(compute(rows(), at('B'), null).localChanges, null);
    assert.equal(compute(rows(), EMPTY, null).localChanges, null);
  });

  it('sin partida en el disco y con S: hay cambios (se perdió)', () => {
    const state = compute(rows(), EMPTY, 'B');
    assert.equal(state.localChanges, true);
    assert.equal(state.localVerified, true);
  });

  it('con el disco ilegible no se verifica y no se afirma nada', () => {
    const state = compute(rows(), UNKNOWN, 'B');
    assert.equal(state.localVerified, false);
    assert.equal(state.localChanges, null);
  });

  it('los campos acompañan a todos los estados, también a none', () => {
    const none = compute([], UNKNOWN, null);
    assert.equal(none.localVerified, false);
    assert.equal(none.localChanges, null);
  });
});

describe('isOwn y la punta', () => {
  it('isOwn depende del PC que mira', () => {
    const rows = [row('A', { device: PC_A })];
    assert.equal(compute(rows, at('A'), 'A', PC_A).head?.isOwn, true);
    assert.equal(compute(rows, at('A'), 'A', PC_B).head?.isOwn, false);
  });

  it('la punta lleva el nombre del PC y la fecha del backup', () => {
    const when = new Date(Date.UTC(2026, 5, 1, 12, 0));
    const rows = [row('A', { device: PC_B, createdAt: when })];
    const head = compute(rows, at('Z'), null).head;
    assert.equal(head?.deviceName, 'PC-B');
    assert.equal(head?.deviceId, PC_B);
    assert.equal(head?.createdAt.getTime(), when.getTime());
  });
});

describe('divergencia que se cierra (§12.4, versiones superadas)', () => {
  it('E-17: B sube h2, restaura h1 de A y sube h3 (padre h1): una sola punta h3', () => {
    const rows = [
      row('h1', { device: PC_A }),
      row('h2', { parent: 'h1', device: PC_B }),
      row('h3', { parent: 'h1', device: PC_B }),
    ];
    const fromB = compute(rows, at('h3'), 'h3', PC_B);
    assert.equal(fromB.status, 'synced');
    assert.deepEqual(
      fromB.tips.map((tip) => tip.contentHash),
      ['h3'],
    );
    const fromA = compute(rows, at('h1'), 'h1', PC_A);
    assert.equal(fromA.status, 'behind');
    assert.equal(fromA.head?.contentHash, 'h3');
    assert.equal(fromA.head?.isOwn, false);
  });

  it('simétrico: A restaura la h2 de B y sigue jugando; su h1 anterior queda superada', () => {
    const rows = [
      row('h0', { device: PC_A }),
      row('h1', { parent: 'h0', device: PC_A }),
      row('h2', { parent: 'h0', device: PC_B }),
      row('h3', { parent: 'h2', device: PC_A }),
    ];
    const fromA = compute(rows, at('h3'), 'h3', PC_A);
    assert.equal(fromA.status, 'synced');
    assert.deepEqual(
      fromA.tips.map((tip) => tip.contentHash),
      ['h3'],
    );
    const fromB = compute(rows, at('h2'), 'h2', PC_B);
    assert.equal(fromB.status, 'behind');
    assert.equal(fromB.head?.contentHash, 'h3');
  });

  it('un PC que vuelve a su propia versión anterior (h1 -> h2 -> h1): la punta es h1', () => {
    const rows = [
      row('h1', { device: PC_A, id: 'first-h1' }),
      row('h2', { parent: 'h1', device: PC_A }),
      row('h1', { parent: 'h2', device: PC_A, id: 'again-h1' }),
    ];
    const state = compute(rows, at('h1'), 'h1', PC_A);
    assert.equal(state.status, 'synced');
    assert.equal(state.tips.length, 1);
    assert.equal(state.head?.contentHash, 'h1');
    assert.equal(state.head?.backupId, 'again-h1');
  });

  it('una huella que sigue vigente en OTRO PC no está superada', () => {
    const rows = [
      row('h0', { device: PC_A }),
      row('h1', { parent: 'h0', device: PC_A }),
      row('h1', { parent: 'h0', device: PC_B }), // B también termina en h1
      row('h3', { parent: 'h0', device: PC_A }), // A se va por otro lado
    ];
    const state = compute(rows, at('h3'), 'h3', PC_A);
    assert.equal(state.status, 'diverged');
    assert.deepEqual(state.tips.map((tip) => tip.contentHash).sort(), ['h1', 'h3']);
  });

  it('una versión posterior ya podada (con lápida) también supera a la anterior', () => {
    const rows = [
      row('h0', { device: PC_A }),
      row('h1', { parent: 'h0', device: PC_A }),
      row('h2', { parent: 'h0', device: PC_B }),
      row('h3', { parent: 'h0', device: PC_B, alive: false }),
    ];
    const state = compute(rows, at('h1'), 'h1', PC_A);
    assert.deepEqual(
      state.tips.map((tip) => tip.contentHash),
      ['h1'],
    );
  });

  it('una versión posterior que DESCIENDE de la anterior no la supera (es su continuación)', () => {
    const rows = [row('h1', { device: PC_A }), row('h2', { parent: 'h1', device: PC_A })];
    const state = compute(rows, at('h2'), 'h2', PC_A);
    assert.equal(state.status, 'synced');
    assert.deepEqual(
      state.tips.map((tip) => tip.contentHash),
      ['h2'],
    );
  });

  it('la versión superada sigue en las filas (historial) y no se modifica la entrada', () => {
    const rows = [
      row('h1', { device: PC_A }),
      row('h2', { parent: 'h1', device: PC_B, id: 'old-h2' }),
      row('h3', { parent: 'h1', device: PC_B }),
    ];
    const snapshot = JSON.stringify(rows);
    compute(rows, at('h3'), 'h3', PC_B);
    assert.equal(JSON.stringify(rows), snapshot);
    assert.ok(rows.some((r) => r.id === 'old-h2' && r.alive));
  });

  it('un S que apunta a una versión superada ya no enlaza con la cabeza: unlinked', () => {
    const rows = [
      row('h1', { device: PC_A }),
      row('h2', { parent: 'h1', device: PC_B }),
      row('h3', { parent: 'h1', device: PC_B }),
    ];
    // Este PC se quedó con la h2 que luego B abandonó.
    assert.equal(compute(rows, at('h2'), 'h2', PC_A).status, 'unlinked');
  });
});
