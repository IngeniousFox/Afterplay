// Escenarios con nombre de §17.3.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BOTTOM } from '../src/clock.ts'
import { DAY, HOUR, MIN, World } from '../src/harness.ts'
import { Hub } from '../src/hub.ts'
import { FULL_SCHEMA, gameIdForIgdb, withoutColumns } from '../src/schema.ts'
import { NodeSqlStorage } from '../src/storage.ts'
import type { SyncClient } from '../src/client.ts'

function allConverged(w: World) {
  const h = w.hubDump()
  for (const c of w.clients) assert.deepEqual(c.dump(), h, `${c.name} difiere del hub`)
  for (const c of w.clients) assert.equal(c.dirtyCount(), 0, `${c.name} con filas sucias`)
}

function syncAll(w: World, rounds = 2) {
  for (let i = 0; i < rounds; i++) for (const c of w.clients) c.sync(w.hub)
}

function seedGame(w: World, by: SyncClient, igdb: number, title: string) {
  const g = by.insert('games', { title, igdbId: igdb, addedAt: w.t }, gameIdForIgdb(igdb))
  const p = by.insert('playthroughs', { gameId: g })
  return { g, p }
}

test('E-03: A y B crean offline una sesión cada uno, de juegos distintos', () => {
  const w = new World()
  const A = w.client('A')
  const B = w.client('B')
  const g1 = seedGame(w, A, 1, 'Uno')
  const g2 = seedGame(w, A, 2, 'Dos')
  syncAll(w)
  w.advance(HOUR)
  const sA = A.insert('sessions', { playthroughId: g1.p, deviceId: 'A', startedAt: w.t, endedAt: w.t + HOUR, durationSec: 3600 })
  const sB = B.insert('sessions', { playthroughId: g2.p, deviceId: 'B', startedAt: w.t, endedAt: w.t + HOUR, durationSec: 3600 })
  syncAll(w)
  allConverged(w)
  for (const c of [A, B]) {
    assert.equal(c.read('sessions', sA)!.fields.playthroughId, g1.p)
    assert.equal(c.read('sessions', sB)!.fields.playthroughId, g2.p)
    assert.deepEqual(c.visibleIds('sessions').sort(), [sA, sB].sort())
  }
})

test('E-04: A y B añaden offline el mismo juego de IGDB', () => {
  const w = new World()
  const A = w.client('A')
  const B = w.client('B')
  const a = seedGame(w, A, 1942, 'Elden Ring')
  // A sigue editando offline ANTES de que B cree "su" juego (agujero H-2).
  w.advance(MIN)
  A.update('games', a.g, { notes: 'notas de A' })
  w.advance(MIN)
  const b = seedGame(w, B, 1942, 'ELDEN RING')
  assert.equal(a.g, b.g, 'id determinista')
  syncAll(w)
  allConverged(w)
  for (const c of [A, B]) {
    assert.equal(c.db.exec('SELECT count(*) n FROM games')[0].n, 1)
    const g = c.read('games', a.g)!
    assert.equal(g.fields.notes, 'notas de A', 'la creación de B no pisa las notas de A')
    assert.equal(g.fields.title, 'ELDEN RING', 'título: gana la escritura más reciente (la de B)')
    assert.equal(g.created < g.clocks.title, true, 'syncCreated = mínimo; el reloj del título queda materializado')
    const pts = c.db.exec('SELECT id FROM playthroughs WHERE gameId = ?', a.g).map((r) => r.id)
    assert.deepEqual(pts.sort(), [a.p, b.p].sort())
  }
})

test('E-05: A edita las notas; B refresca la carátula, ambos offline', () => {
  const w = new World()
  const A = w.client('A')
  const B = w.client('B')
  const { g } = seedGame(w, A, 7, 'Hades')
  syncAll(w)
  w.advance(MIN)
  A.update('games', g, { notes: 'muy bueno' })
  w.advance(MIN)
  B.update('games', g, { coverUrl: 'https://img/hades.jpg' })
  syncAll(w)
  allConverged(w)
  for (const c of [A, B]) {
    const r = c.read('games', g)!
    assert.equal(r.fields.notes, 'muy bueno')
    assert.equal(r.fields.coverUrl, 'https://img/hades.jpg')
  }
})

test('E-06: A borra un juego; B, offline, le añade una sesión', () => {
  const w = new World()
  const A = w.client('A')
  const B = w.client('B')
  const { g, p } = seedGame(w, A, 9, 'Celeste')
  syncAll(w)
  w.advance(MIN)
  A.remove('games', g)
  assert.equal(A.read('playthroughs', p)!.fields.syncDeleted !== null, true, 'A marca a los hijos')
  w.advance(MIN)
  const s = B.insert('sessions', { playthroughId: p, deviceId: 'B', startedAt: w.t, endedAt: w.t + HOUR, durationSec: 3600 })
  // B también crea un playthrough nuevo bajo el juego que A ya borró.
  const p2 = B.insert('playthroughs', { gameId: g })
  // B edita el juego DESPUÉS del borrado: la edición no "des-borra" (§8.3.3).
  w.advance(MIN)
  B.update('games', g, { notes: 'editado tras el borrado' })
  syncAll(w)
  allConverged(w)
  for (const c of [A, B]) {
    assert.notEqual(c.read('games', g)!.fields.syncDeleted, null, 'el juego queda borrado')
    assert.equal(c.read('games', g)!.fields.notes, 'editado tras el borrado', 'la edición no se pierde')
    assert.equal(c.read('sessions', s)!.fields.syncDeleted, null, 'la sesión existe como fila…')
    assert.equal(c.isVisible('sessions', s), false, '…pero no aparece (regla de lectura)')
    assert.equal(c.isVisible('playthroughs', p2), false)
    assert.equal(c.orphans, 0)
  }
})

test('E-09: A estuvo 30 h offline con una sesión que cerró bien; el hub ya la había cerrado', () => {
  const w = new World()
  const A = w.client('A')
  const B = w.client('B')
  const { p } = seedGame(w, A, 11, 'Hollow Knight')
  const start = w.t
  const s = A.insert('sessions', { playthroughId: p, deviceId: 'A', startedAt: start, lastSeenAt: start })
  syncAll(w)
  // A se queda offline. Juega 2 h y cierra bien la sesión (sin red).
  w.advance(2 * HOUR)
  A.update('sessions', s, { endedAt: w.t, durationSec: 7200, closedBy: 'owner', lastSeenAt: w.t })
  // A las 25 h desde la última señal que vio el hub, el barrido la cierra.
  w.advance(23 * HOUR)
  assert.equal(w.hub.sweepAbandoned('low-clock'), 1)
  B.sync(w.hub)
  assert.equal(B.read('sessions', s)!.fields.closedBy, 'janitor')
  assert.equal(B.read('sessions', s)!.fields.durationSec, 0)
  // A vuelve a las 30 h y sube su cierre real.
  w.advance(5 * HOUR)
  syncAll(w)
  allConverged(w)
  for (const c of [A, B]) {
    const r = c.read('sessions', s)!
    assert.equal(r.fields.closedBy, 'owner', 'gana el cierre de A')
    assert.equal(r.fields.durationSec, 7200)
    assert.equal(r.fields.endedAt, start + 2 * HOUR)
  }
})

test('E-14: B tiene una versión anterior (desconoce games.coverUrl y playthroughs.rating)', () => {
  const w = new World()
  const old = withoutColumns(FULL_SCHEMA, { games: ['coverUrl'], playthroughs: ['rating'] })
  const A = w.client('A')
  const B = w.client('B', {}, old)
  const { g, p } = seedGame(w, A, 21, 'Outer Wilds')
  A.update('games', g, { coverUrl: 'https://img/ow.jpg' })
  A.update('playthroughs', p, { rating: 5 })
  syncAll(w)
  assert.equal(B.read('games', g)!.fields.coverUrl, undefined, 'B no la conoce')
  // B edita otras columnas de esas mismas filas y crea filas nuevas.
  w.advance(MIN)
  B.update('games', g, { notes: 'desde B viejo' })
  B.update('playthroughs', p, { customLabel: 'NG+' })
  const g2 = B.insert('games', { title: 'Nuevo desde B', igdbId: 22, addedAt: w.t }, gameIdForIgdb(22))
  // Y A, a la vez, cambia la carátula otra vez.
  w.advance(MIN)
  A.update('games', g, { coverUrl: 'https://img/ow2.jpg' })
  syncAll(w)
  const hubG = w.hub.get('games', g)!
  assert.equal(hubG.fields.coverUrl, 'https://img/ow2.jpg', 'el hub conserva lo que B no entiende')
  assert.equal(hubG.fields.notes, 'desde B viejo')
  assert.equal(w.hub.get('playthroughs', p)!.fields.rating, 5)
  assert.equal(w.hub.get('games', g2)!.clocks.coverUrl, BOTTOM, 'fila creada por B: la columna desconocida queda "sin escribir"')
  assert.deepEqual(A.dump(), w.hubDump())
  assert.deepEqual(B.dump(), w.hubDump(old), 'B coincide con la proyección del hub')
  assert.equal(B.lastError, null)
})

test('E-23: el reloj de A está adelantado un día', () => {
  const w = new World()
  const A = w.client('A')
  const B = w.client('B')
  const { g } = seedGame(w, A, 31, 'Tunic')
  syncAll(w)
  w.skew.set('A', DAY)
  w.advance(MIN)
  A.update('games', g, { notes: 'A (reloj +1 día)' })
  A.sync(w.hub)
  assert.match(A.lastError ?? '', /CLOCK_AHEAD/, 'A lo muestra')
  assert.equal(w.hub.get('games', g)!.fields.notes, null, 'el hub rechaza su cambio')
  assert.equal(A.isDirty('games', g), true, 'el cambio no se pierde: sigue pendiente')
  // B edita lo mismo más tarde en tiempo real: no debe perder contra el reloj futuro de A.
  w.advance(MIN)
  B.update('games', g, { notes: 'B (hora correcta)' })
  B.sync(w.hub)
  A.sync(w.hub)
  assert.equal(w.hub.get('games', g)!.fields.notes, 'B (hora correcta)', 'A no "gana siempre"')
  // A corrige su reloj: su reloj híbrido sigue en el futuro hasta que se recupera.
  w.skew.set('A', 0)
  w.advance(MIN)
  A.sync(w.hub)
  assert.equal(A.lastError, null)
  assert.equal(A.stats.recoveries, 1)
  syncAll(w)
  allConverged(w)
  // Decisión D-7: la edición de A se re-fecha al momento de la recuperación.
  assert.equal(w.hub.get('games', g)!.fields.notes, 'A (reloj +1 día)')
})

test('E-24: hub vacío; un PC con todos los datos sincroniza', () => {
  const w = new World()
  const A = w.client('A')
  const B = w.client('B')
  for (let i = 0; i < 30; i++) {
    const { p } = seedGame(w, i % 2 ? A : B, 100 + i, `Juego ${i}`)
    ;(i % 2 ? A : B).insert('sessions', { playthroughId: p, deviceId: i % 2 ? 'A' : 'B', startedAt: w.t, endedAt: w.t + HOUR })
  }
  A.remove('games', gameIdForIgdb(101))
  syncAll(w)
  allConverged(w)
  const before = A.dump()
  // El hub desaparece; se despliega uno nuevo y vacío (otro hubId).
  const hub2 = new Hub(new NodeSqlStorage(), FULL_SCHEMA, { hubId: 'hub-2', now: () => w.t })
  A.sync(hub2)
  assert.deepEqual(w.hubDump(FULL_SCHEMA, hub2), before, 'el hub queda completo')
  B.sync(hub2)
  A.sync(hub2)
  assert.deepEqual(B.dump(), before)
  assert.equal(A.dirtyCount() + B.dirtyCount(), 0)
})
