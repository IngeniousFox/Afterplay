// HALLAZGOS: cada test reproduce, con el mínimo de pasos, un punto en el que el
// diseño TAL COMO ESTÁ ESCRITO pierde datos, no converge o se atasca, y
// comprueba que la decisión tomada en el spike lo evita.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatClock, HybridClock, parseClock } from '../src/clock.ts'
import { DAY, HOUR, MIN, World } from '../src/harness.ts'
import { type CompactRow, mergeLiteral, mergeRows, type RowState } from '../src/merge.ts'
import { FULL_SCHEMA, gameIdForIgdb, type TableDef } from '../src/schema.ts'

const ck = (ms: number, dev: string) => formatClock(ms, 0, dev)

test('H-1: la fusión literal de §8.3 (syncCreated = mínimo sin materializar relojes) NO converge', () => {
  // A y B crean el mismo juego (id determinista). B es posterior.
  const A: CompactRow = { created: ck(1000, 'aaaaaa'), fields: { title: 'Foo' }, syncFields: {} }
  const B: CompactRow = { created: ck(2000, 'bbbbbb'), fields: { title: 'FOO' }, syncFields: {} }
  // El hub recibe A y luego B: gana el título de B, syncCreated pasa a ser el de A,
  // y el título queda con reloj implícito = syncCreated = 1000 (¡ha "rejuvenecido"!).
  const hub = mergeLiteral(mergeLiteral(undefined, A), B)
  assert.equal(hub.fields.title, 'FOO')
  assert.deepEqual(hub.syncFields, {})
  // Una réplica C que solo tenía A recibe la fila del hub: 1000 vs 1000 → no cambia.
  const C = mergeLiteral(A, hub)
  assert.equal(C.fields.title, 'Foo', 'C se queda con el valor de A: divergencia permanente')
  assert.notDeepEqual(C.fields, hub.fields)

  // Con la fusión del spike (relojes explícitos + codificación normalizada) converge.
  const a: RowState = { id: 'x', created: A.created, fields: { title: 'Foo' }, clocks: { title: A.created } }
  const b: RowState = { id: 'x', created: B.created, fields: { title: 'FOO' }, clocks: { title: B.created } }
  const h = mergeRows(mergeRows(undefined, a), b)
  assert.equal(mergeRows(a, h).fields.title, 'FOO')
  assert.equal(h.created, A.created)
  assert.equal(h.clocks.title, B.created)
})

test('H-1b: "para cada columna c de E" — iterar solo las columnas de E y bajar syncCreated re-fecha las demás', () => {
  // Hub tiene coverUrl (escrita en la creación, reloj implícito 2000).
  const hubRow: CompactRow = { created: ck(2000, 'aaaaaa'), fields: { title: 'T', coverUrl: 'x.jpg' }, syncFields: {} }
  // Un cliente viejo (sin coverUrl) que creó la misma fila antes (1000).
  const old: CompactRow = { created: ck(1000, 'bbbbbb'), fields: { title: 'T' }, syncFields: {} }
  const merged = mergeLiteral(hubRow, old)
  // coverUrl sigue ahí, pero su reloj implícito es ahora 1000: cualquier
  // escritura de coverUrl con reloj entre 1000 y 2000 (p. ej. de un tercero que
  // no ha visto la fila del hub) le ganará, cuando antes perdía.
  assert.equal(merged.created, ck(1000, 'bbbbbb'))
  assert.equal(merged.syncFields.coverUrl, undefined, 'el reloj 2000 de coverUrl se ha perdido')
})

test('H-2: la creación con id determinista pisa con valores por defecto lo que el otro escribió antes', () => {
  for (const bottomForDefaults of [false, true]) {
    const w = new World()
    const A = w.client('A', { bottomForDefaults })
    const B = w.client('B', { bottomForDefaults })
    const g = A.insert('games', { title: 'Elden Ring', igdbId: 1942 }, gameIdForIgdb(1942))
    w.advance(MIN)
    A.update('games', g, { notes: 'notas de A', endless: 1 })
    w.advance(MIN)
    B.insert('games', { title: 'Elden Ring', igdbId: 1942 }, gameIdForIgdb(1942)) // B, offline, sin saber de A
    for (let i = 0; i < 2; i++) for (const c of [A, B]) c.sync(w.hub)
    const r = w.hub.get('games', g)!
    if (!bottomForDefaults) {
      assert.equal(r.fields.notes, null, 'literal (§7.3: syncCreated es el reloj de TODAS las columnas): se pierden las notas de A')
      assert.equal(r.fields.endless, 0)
    } else {
      assert.equal(r.fields.notes, 'notas de A', 'D-1b: lo no indicado al crear lleva reloj BOTTOM')
      assert.equal(r.fields.endless, 1)
    }
  }
})

test('H-3 (E-09 literal): el barrido con el reloj del hub pisa el cierre real hecho offline', () => {
  for (const mode of ['hub-now', 'low-clock'] as const) {
    const w = new World()
    const A = w.client('A')
    const g = A.insert('games', { title: 'X' }, gameIdForIgdb(5))
    const p = A.insert('playthroughs', { gameId: g })
    const s = A.insert('sessions', { playthroughId: p, deviceId: 'A', startedAt: w.t, lastSeenAt: w.t })
    A.sync(w.hub)
    w.advance(2 * HOUR)
    A.update('sessions', s, { endedAt: w.t, durationSec: 7200, closedBy: 'owner' }) // offline
    w.advance(28 * HOUR)
    w.hub.sweepAbandoned(mode)
    w.advance(MIN)
    A.sync(w.hub)
    A.sync(w.hub)
    const r = w.hub.get('sessions', s)!
    if (mode === 'hub-now') {
      assert.equal(r.fields.closedBy, 'janitor', '§10.5 literal: el cierre del dueño (anterior al barrido) PIERDE')
      assert.equal(r.fields.durationSec, 0, 'se pierden 2 h de juego')
    } else {
      assert.equal(r.fields.closedBy, 'owner')
      assert.equal(r.fields.durationSec, 7200)
    }
    assert.deepEqual(A.dump(), w.hubDump())
  }
})

test('H-4: FK diferidas "al final de la transacción" + una transacción por página = pull atascado', () => {
  for (const fkMode of ['deferred-per-page', 'off-during-pull'] as const) {
    const w = new World()
    const A = w.client('A')
    const g = A.insert('games', { title: 'X' }, gameIdForIgdb(5)) // seq 1
    A.sync(w.hub)
    const p = A.insert('playthroughs', { gameId: g }) // seq 2
    A.sync(w.hub)
    w.advance(MIN)
    A.update('games', g, { notes: 'editado' }) // el juego pasa a seq 3: ahora va DESPUÉS de su hijo
    A.sync(w.hub)
    const C = w.client('C', { fkMode })
    C.checkHub(w.hub)
    if (fkMode === 'deferred-per-page') {
      // Página de 1 fila: [playthrough(seq 2)] sin su padre → el COMMIT falla.
      assert.throws(() => C.pullPage(w.hub, 1), /FOREIGN KEY/)
      assert.equal(C.cursor, 0, 'el cursor no avanza')
      assert.throws(() => C.pullPage(w.hub, 1), /FOREIGN KEY/, 'y cada reintento falla igual: sync atascado')
    } else {
      C.pull(w.hub, 1)
      assert.equal(C.orphans, 0)
      assert.equal(C.read('playthroughs', p)!.fields.gameId, g)
      assert.deepEqual(C.dump(), w.hubDump())
    }
  }
})

test('H-5: limpiar syncDirty sin comparar syncUpdated pierde una edición hecha durante la subida', () => {
  for (const safe of [false, true]) {
    const w = new World()
    const A = w.client('A')
    const g = A.insert('games', { title: 'X' }, gameIdForIgdb(5))
    A.sync(w.hub)
    A.update('games', g, { notes: 'v1' })
    const batch = A.preparePush(100)
    const res = w.hub.push(JSON.parse(JSON.stringify(batch.rows)))
    A.update('games', g, { notes: 'v2' }) // el usuario edita mientras la petición está en vuelo
    if (safe) A.ackPush(batch.snap, res)
    else A.db.exec('UPDATE games SET syncDirty = 0 WHERE id = ?', g)
    A.sync(w.hub)
    assert.equal(w.hub.get('games', g)!.fields.notes, safe ? 'v2' : 'v1', safe ? '' : 'v2 nunca sube')
    assert.equal(A.read('games', g)!.fields.notes, 'v2', 'el eco de v1 no pisa v2 en local')
  }
})

test('H-6: migración que añade columna sin reloj BOTTOM: el valor por defecto EMPATA con el real', () => {
  const NEW: TableDef[] = FULL_SCHEMA.map((t) =>
    t.name === 'games' ? { ...t, columns: [...t.columns, { name: 'platform', type: 'TEXT' as const, default: 'pc' }] } : t
  )
  for (const stampBottom of [false, true]) {
    const w = new World(undefined, 'hub-1', NEW)
    const A = w.client('A') // ya en el esquema nuevo
    const B = w.client('B', {}, FULL_SCHEMA) // todavía en el viejo
    // A crea el juego indicando platform; el reloj de platform = syncCreated (implícito).
    const g = A.insert('games', { title: 'Mario 64', platform: 'n64' }, gameIdForIgdb(64))
    A.sync(w.hub)
    B.sync(w.hub)
    B.upgradeSchema(NEW, stampBottom)
    B.update('games', g, { notes: 'tras actualizar' }) // fila sucia: B la sube entera
    for (let i = 0; i < 2; i++) for (const c of [A, B]) c.sync(w.hub)
    const v = w.hub.get('games', g)!.fields.platform
    if (!stampBottom) {
      // 'pc'@created vs 'n64'@created: empate de reloj, decide el desempate por valor.
      assert.equal(v, 'pc', 'se pierde n64: el valor por defecto de la migración ganó el desempate')
    } else {
      assert.equal(v, 'n64')
    }
    assert.deepEqual(A.dump(), w.hubDump())
    assert.deepEqual(B.dump(), w.hubDump())
  }
})

test('H-7: reloj de pared ATRASADO — contador desbordado y ediciones offline que pierden', () => {
  // (a) Con el ms congelado (pared < último visto) todo va al contador de 4 dígitos.
  let wall = 1_000
  const c = new HybridClock('aaaaaa', () => wall, formatClock(5_000_000, 0, 'bbbbbb'))
  let prev = c.now()
  for (let i = 0; i < 25_000; i++) {
    const n = c.now()
    assert.ok(n > prev, 'estrictamente creciente')
    assert.match(n, /^\d{13}-\d{4}-[0-9a-z]{6}$/)
    prev = n
  }
  assert.ok(parseClock(prev).ms > 5_000_000, 'D-8: al desbordar el contador avanza el ms')
  wall = 2_000

  // (b) B va 1 día atrasado y edita offline DESPUÉS (en tiempo real) que A: pierde.
  const w = new World()
  const A = w.client('A')
  const B = w.client('B')
  const g = A.insert('games', { title: 'X' }, gameIdForIgdb(5))
  for (const x of [A, B]) x.sync(w.hub)
  w.skew.set('B', -DAY)
  w.advance(MIN)
  A.update('games', g, { notes: 'A, 12:01' })
  A.sync(w.hub)
  w.advance(MIN)
  B.update('games', g, { notes: 'B, 12:02 (reloj atrasado)' }) // B NO ha visto la de A
  for (let i = 0; i < 2; i++) for (const x of [A, B]) x.sync(w.hub)
  assert.equal(w.hub.get('games', g)!.fields.notes, 'A, 12:01', 'converge, pero gana A aunque B fue posterior')
  // Pero tras ver la de A, el reloj de B queda arrastrado: sus ediciones ya ganan.
  B.update('games', g, { notes: 'B después de sincronizar' })
  B.sync(w.hub)
  assert.equal(w.hub.get('games', g)!.fields.notes, 'B después de sincronizar')
})

test('H-8: filas modificadas en el hub a mitad de un pull paginado', () => {
  const w = new World()
  const A = w.client('A')
  const ids: string[] = []
  for (let i = 0; i < 10; i++) ids.push(A.insert('games', { title: `G${i}` }, gameIdForIgdb(i)))
  A.sync(w.hub)
  const C = w.client('C')
  C.checkHub(w.hub)
  C.pullPage(w.hub, 3) // C tiene 3 juegos (los 3 primeros por secuencia)
  const delivered = new Set(C.db.exec('SELECT id FROM games').map((r) => r.id))
  w.advance(MIN)
  A.update('games', ids[1], { notes: 'ya entregada, cambia' }) // se mueve al final
  A.update('games', ids[7], { notes: 'aún no entregada, cambia' }) // se mueve al final
  A.remove('games', ids[5])
  A.sync(w.hub)
  C.pull(w.hub, 3)
  assert.deepEqual(C.dump(), w.hubDump())
  const again = [ids[1], ids[7], ids[5]].filter((id) => delivered.has(id)).length
  assert.equal(C.stats.pulledRows, 10 + again, 'lo ya entregado que cambia llega otra vez; lo pendiente que cambia, una sola vez')
})

test('H-9: volver a añadir (id determinista) un juego borrado lo resucita; sus hijos siguen borrados', () => {
  const w = new World()
  const A = w.client('A')
  const B = w.client('B')
  const g = A.insert('games', { title: 'X' }, gameIdForIgdb(5))
  const p = A.insert('playthroughs', { gameId: g })
  for (let i = 0; i < 2; i++) for (const x of [A, B]) x.sync(w.hub)
  w.advance(MIN)
  A.remove('games', g)
  w.advance(MIN)
  B.insert('games', { title: 'X' }, gameIdForIgdb(5)) // B ya lo tenía: upsert sin cambios…
  assert.equal(B.isDirty('games', g), false, '…así que no escribe nada')
  for (let i = 0; i < 2; i++) for (const x of [A, B]) x.sync(w.hub)
  assert.equal(B.isVisible('games', g), false)
  w.advance(MIN)
  B.insert('games', { title: 'X' }, gameIdForIgdb(5)) // ahora sí: re-alta después del borrado
  for (let i = 0; i < 2; i++) for (const x of [A, B]) x.sync(w.hub)
  assert.equal(A.isVisible('games', g), true)
  assert.equal(A.isVisible('playthroughs', p), false)
})
