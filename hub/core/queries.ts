// Las consultas del escritorio, ejecutadas en el hub (AFTERPLAY-2.0.md §13.2,
// §13.3, F-26).
//
// La PWA no tiene consultas propias: el hub corre las MISMAS funciones de
// `src/main/db/v2/queries` sobre sus tablas, que se generan de las mismas
// definiciones de Drizzle (schema.ts). Lo que hace falta para eso:
//
// - Una base Drizzle sobre el almacén del hub. La crea quien construye esto
//   (en el Durable Object, `drizzle-orm/durable-sqlite` sobre `ctx.storage`;
//   en los tests, `drizzle-orm/node-sqlite` sobre el `DatabaseSync`), porque
//   el núcleo no importa ni Cloudflare ni Node.
// - Para escribir, la puerta de escritura del cliente (`WriteStore`) tal cual,
//   firmando como el dispositivo `web` con su propio reloj, y con el
//   ejecutor de transacciones del almacén (un Durable Object no admite BEGIN).
//   Así el móvil cumple las mismas reglas que un PC: solo cambia lo que
//   cambia, lápidas y cascadas, dueño de las filas O, una sesión abierta por
//   objetivo y dispositivo.
// - Secuencia nueva para lo que escribe (`stampWritten`), en la misma
//   transacción: es lo que hace que los PCs lo bajen.
//
// Todo pasa dentro del Durable Object, que atiende una petición cada vez: la
// comprobación "¿hay ya una sesión en marcha?" de un cronómetro y su alta no
// pueden cruzarse con otra escritura (F-28).

import { HybridClock, type Clock } from '../../src/shared/sync/clock';
import { WEB_DEVICE_ID } from '../../src/shared/devices';
import { devices } from '../../src/main/db/v2/schema';
import { WriteStore, alive, type LocalDb, type StoreChange } from '../../src/main/db/v2/store';
import type { QueryContext } from '../../src/main/db/v2/queries/common/context';
import { and, eq } from 'drizzle-orm';
import type { TenantHub } from './hub';

/** Cómo se llama el móvil en la lista de dispositivos de los PCs. */
export const WEB_DEVICE_NAME = 'Phone';

/** Clave de `tenant_meta` con el último reloj que emitió el móvil. */
const WEB_CLOCK_KEY = 'webClock';

/** Lo que devuelve una escritura: el resultado de la consulta y la secuencia tras ella. */
export interface WriteOutcome<T> {
  readonly result: T;
  readonly seq: number;
}

export class HubQueries {
  private readonly clock: HybridClock;
  private readonly store: WriteStore;
  private readonly ctx: QueryContext;
  private changes: StoreChange[] = [];

  /**
   * @param db Base Drizzle síncrona sobre el MISMO almacén que `hub`. Se tipa
   *   como la del cliente porque las consultas la piden así; solo se usa su
   *   constructor de consultas, nunca `$client`, que es de node:sqlite y aquí
   *   no existe (la puerta no lo toca con `transactionRunner`).
   */
  constructor(
    private readonly hub: TenantHub,
    db: LocalDb,
  ) {
    const initial = hub.metaValue(WEB_CLOCK_KEY);
    this.clock = new HybridClock(
      hub.shortIdForDevice(WEB_DEVICE_ID),
      () => hub.hubNow(),
      typeof initial === 'string' ? (initial as Clock) : null,
    );
    this.store = new WriteStore({
      db,
      clock: this.clock,
      deviceId: WEB_DEVICE_ID,
      wall: () => hub.hubNow(),
      transactionRunner: (fn) => hub.transaction(fn),
    });
    this.store.onChange((change) => this.changes.push(change));
    this.ctx = {
      db,
      store: this.store,
      deviceId: WEB_DEVICE_ID,
      now: () => new Date(hub.hubNow()),
    };
  }

  /**
   * Una lectura. Si la consulta escribiera algo, se deshace y falla: una
   * escritura sin secuencia no bajaría nunca a los PCs.
   */
  read<T>(query: (ctx: QueryContext) => T): T {
    return this.hub.transaction(() => {
      this.changes = [];
      const result = query(this.ctx);
      if (this.changes.length > 0) {
        this.changes = [];
        throw new Error('HubQueries.read: la consulta ha escrito; usa write');
      }
      return result;
    });
  }

  /**
   * Una escritura del móvil, entera o nada: la consulta, el alta del
   * dispositivo `web` si aún no existe, la secuencia de cada fila tocada y el
   * reloj del móvil guardado para el siguiente arranque del Durable Object.
   */
  write<T>(query: (ctx: QueryContext) => T): WriteOutcome<T> {
    return this.hub.transaction(() => {
      this.changes = [];
      try {
        this.ensureWebDevice();
        const result = query(this.ctx);
        const touched = new Map<string, Set<string>>();
        for (const change of this.changes) {
          for (const [table, ids] of Object.entries(change.ids)) {
            const set = touched.get(table) ?? new Set<string>();
            for (const id of ids ?? []) set.add(id);
            touched.set(table, set);
          }
        }
        const seq = this.hub.stampWritten(
          [...touched].map(([table, ids]) => ({ table, ids: [...ids] })),
        );
        this.hub.setMetaValue(WEB_CLOCK_KEY, this.clock.peek());
        return { result, seq };
      } finally {
        this.changes = [];
      }
    });
  }

  /** La fila `devices` del móvil: la crea la primera escritura, una sola vez. */
  private ensureWebDevice(): void {
    const existing = this.ctx.db
      .select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.id, WEB_DEVICE_ID), alive(devices)))
      .get();
    if (existing) return;
    this.store.create('devices', {
      id: WEB_DEVICE_ID,
      name: WEB_DEVICE_NAME,
      kind: 'web',
      os: 'web',
      firstSeenAt: this.ctx.now(),
    });
  }
}
