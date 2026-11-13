// Fusión por campo (§8.3). LA MISMA función la usan hub y cliente.
//
// Representación en memoria y en tránsito: relojes EXPLÍCITOS para cada columna
// presente (`clocks[c]` siempre existe si existe `fields[c]`). La forma
// compacta de §7.3 (syncFields solo con lo que difiere de syncCreated) es solo
// la codificación en disco y se recalcula SIEMPRE tras fusionar (encodeStored).
//
// DECISIÓN D-1 (agujero H-1 del documento): tras fusionar, syncCreated = mínimo,
//   y eso cambia el reloj implícito de toda columna que no esté en syncFields.
//   Por eso la codificación se normaliza: syncFields[c] existe si y solo si el
//   reloj de c ≠ syncCreated. Sin esto, la fusión "literal" de §8.3 no converge
//   (ver test H-1).
// DECISIÓN D-2: empate de reloj con valores distintos (no debería pasar, pero
//   puede: ids cortos de dispositivo que colisionan, migraciones) → gana el
//   mayor `valueKey`. Así la función es conmutativa en TODOS los casos.
// DECISIÓN D-3: syncDeleted es una columna más (valor = reloj de la lápida o
//   null, con su propio reloj). Se fusiona exactamente igual que las demás.

import { BOTTOM, type Clock, maxClock } from './clock.ts'
import type { SqlRow, SqlValue } from './storage.ts'

export interface RowState {
  id: string
  created: Clock
  fields: Record<string, SqlValue>
  clocks: Record<string, Clock>
}

export interface WireRow extends RowState {
  table: string
}

export function valueKey(v: SqlValue): string {
  if (v === null) return '0:'
  if (typeof v === 'number') return `1:${v}`
  return `2:${v}`
}

/** >0 si (cb, vb) gana a (ca, va). */
function cmpCell(ca: Clock, va: SqlValue, cb: Clock, vb: SqlValue): number {
  if (cb !== ca) return cb > ca ? 1 : -1
  const ka = valueKey(va)
  const kb = valueKey(vb)
  return kb === ka ? 0 : kb > ka ? 1 : -1
}

export function mergeRows(a: RowState | undefined, e: RowState): RowState {
  if (!a) return cloneRow(e)
  if (a.id !== e.id) throw new Error('merge de filas distintas')
  const out: RowState = {
    id: a.id,
    created: a.created < e.created ? a.created : e.created,
    fields: {},
    clocks: {}
  }
  // Unión de columnas: las que solo tiene uno se conservan (§8.3.5, E-14).
  const cols = new Set([...Object.keys(a.fields), ...Object.keys(e.fields)])
  for (const c of cols) {
    const inA = c in a.fields
    const inE = c in e.fields
    if (inA && (!inE || cmpCell(e.clocks[c], e.fields[c], a.clocks[c], a.fields[c]) >= 0)) {
      out.fields[c] = a.fields[c]
      out.clocks[c] = a.clocks[c]
    } else {
      out.fields[c] = e.fields[c]
      out.clocks[c] = e.clocks[c]
    }
  }
  return out
}

export function cloneRow(r: RowState): RowState {
  return { id: r.id, created: r.created, fields: { ...r.fields }, clocks: { ...r.clocks } }
}

export function rowMaxClock(r: RowState): Clock {
  let m = r.created
  for (const c of Object.values(r.clocks)) m = maxClock(m, c)
  return m
}

/** Proyecta una fila a las columnas que conoce esta réplica (cliente viejo). */
export function project(r: RowState, columns: string[]): RowState {
  const out: RowState = { id: r.id, created: r.created, fields: {}, clocks: {} }
  for (const c of columns) {
    if (c in r.fields) {
      out.fields[c] = r.fields[c]
      out.clocks[c] = r.clocks[c]
    }
  }
  return out
}

// ---------- Codificación en disco (§7.3) ----------

export interface StoredSync {
  syncCreated: Clock
  syncUpdated: Clock
  syncFields: string
  syncDeleted: Clock | null
}

export function encodeStored(r: RowState, columns: string[]): StoredSync & Record<string, SqlValue> {
  const sf: Record<string, Clock> = {}
  const out: Record<string, SqlValue> = {}
  for (const c of columns) {
    // Columna que la réplica conoce pero la fila no trae → valor por defecto
    // con reloj BOTTOM (nadie la ha escrito).
    const v = c in r.fields ? r.fields[c] : null
    const k = c in r.clocks ? r.clocks[c] : BOTTOM
    if (c !== 'syncDeleted') out[c] = v
    if (k !== r.created) sf[c] = k
  }
  const sorted: Record<string, Clock> = {}
  for (const k of Object.keys(sf).sort()) sorted[k] = sf[k]
  return {
    ...out,
    syncCreated: r.created,
    syncUpdated: rowMaxClock(r),
    syncFields: JSON.stringify(sorted),
    syncDeleted: (r.fields.syncDeleted ?? null) as Clock | null
  }
}

export function decodeStored(row: SqlRow, columns: string[]): RowState {
  const created = row.syncCreated as Clock
  const sf = JSON.parse((row.syncFields as string) || '{}') as Record<string, Clock>
  const r: RowState = { id: row.id as string, created, fields: {}, clocks: {} }
  for (const c of columns) {
    r.fields[c] = (row[c] ?? null) as SqlValue
    r.clocks[c] = sf[c] ?? created
  }
  return r
}

/** Forma canónica para comparar réplicas y para saber si una fusión cambió algo. */
export function canonical(r: RowState, columns: string[]): string {
  const enc = encodeStored(r, columns)
  return JSON.stringify(columns.map((c) => [c, c === 'syncDeleted' ? enc.syncDeleted : enc[c]]).concat([
    ['syncCreated', enc.syncCreated],
    ['syncFields', enc.syncFields]
  ]))
}

// ---------- Fusión "literal" del documento (solo para demostrar H-1) ----------

/** Fila en la forma compacta de §7.3, tal cual se guarda. */
export interface CompactRow {
  created: Clock
  fields: Record<string, SqlValue>
  syncFields: Record<string, Clock>
}

/**
 * Lectura literal de §8.3: "para cada columna c de E … si el de E es mayor, se
 * toma el valor y el reloj de E" + "syncCreated es el menor de los dos".
 * El reloj de E se copia a syncFields solo si E lo tenía explícito (si era
 * implícito = E.syncCreated, la implementación natural no lo materializa).
 */
export function mergeLiteral(a: CompactRow | undefined, e: CompactRow): CompactRow {
  if (!a) return { created: e.created, fields: { ...e.fields }, syncFields: { ...e.syncFields } }
  const out: CompactRow = { created: a.created, fields: { ...a.fields }, syncFields: { ...a.syncFields } }
  for (const c of Object.keys(e.fields)) {
    const ce = e.syncFields[c] ?? e.created
    const ca = a.syncFields[c] ?? a.created
    if (ce > ca) {
      out.fields[c] = e.fields[c]
      if (c in e.syncFields) out.syncFields[c] = e.syncFields[c]
      else delete out.syncFields[c]
    }
  }
  out.created = a.created < e.created ? a.created : e.created
  return out
}
