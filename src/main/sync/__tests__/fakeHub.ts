import { MAX_AHEAD_MS, maxClockOf } from '../../../shared/sync/clock';
import {
  canonical,
  fromWire,
  mergeRows,
  project,
  toWire,
  type RowState,
  type WireRow,
} from '../../../shared/sync/merge';
import {
  DEFAULT_LIMITS,
  SyncRequestError,
  type JobClaimResponse,
  type JobDoneResponse,
  type PullResponse,
  type PushRejection,
  type PushRequest,
  type PushResponse,
  type StatusResponse,
  type SyncLimits,
  type SyncTransport,
} from '../../../shared/sync/protocol';
import { syncTableByName } from '../tables';

// Un hub mínimo en memoria para probar el motor. NO es el núcleo del hub real
// (`hub/core/`): hace lo justo del protocolo (§8.4) con la misma fusión
// (`mergeRows`) y pasa todo por JSON, como en la red.

const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

interface StoredRow {
  state: RowState;
  seq: number;
}

export class FakeHub implements SyncTransport {
  hubId = 'hub-1';
  epoch = 1;
  seq = 0;
  /** La hora del hub (ms). Los tests la mueven. */
  time = 0;
  limits: SyncLimits = { ...DEFAULT_LIMITS };
  minSchema = 1;
  maxSchema = 99;
  readonly rows = new Map<string, StoredRow>();
  /** Registro de peticiones, para comprobar cuántas hubo y de qué tamaño. */
  readonly calls: { kind: 'status' | 'push' | 'pull'; rows: number; bytes: number }[] = [];
  readonly pushBodies: PushRequest[] = [];
  /** Se ejecuta antes de contestar a un push (para editar a mitad de la subida). */
  beforePushReply: (() => void) | null = null;
  /** Errores a lanzar en las próximas peticiones, en orden (null = sigue normal). */
  readonly failures: (SyncRequestError | null)[] = [];

  constructor(time: number) {
    this.time = time;
  }

  private maybeFail(): void {
    const next = this.failures.shift();
    if (next) throw next;
  }

  private key = (table: string, id: string): string => `${table}\u0000${id}`;

  get(table: string, id: string): RowState | undefined {
    return this.rows.get(this.key(table, id))?.state;
  }

  count(table: string): number {
    return [...this.rows.keys()].filter((k) => k.startsWith(`${table}\u0000`)).length;
  }

  /** Simula un hub restaurado de una copia más antigua o vacío. */
  wipe(options: { hubId?: string; epoch?: number } = {}): void {
    this.rows.clear();
    this.seq = 0;
    if (options.hubId) this.hubId = options.hubId;
    if (options.epoch) this.epoch = options.epoch;
  }

  /** Mete una fila tal cual (otro dispositivo que ya subió). */
  inject(row: WireRow): void {
    const table = syncTableByName(row.table);
    if (!table) throw new Error(`tabla desconocida ${row.table}`);
    this.merge(row);
  }

  private merge(incoming: WireRow): void {
    const table = syncTableByName(incoming.table)!;
    const key = this.key(incoming.table, incoming.id);
    const stored = this.rows.get(key);
    const merged = mergeRows(stored?.state, project(fromWire(incoming), table.shape));
    // §8.4: el hub no sube la secuencia si la fusión no cambia nada.
    if (stored && canonical(stored.state, table.shape) === canonical(merged, table.shape)) return;
    this.seq += 1;
    this.rows.set(key, { state: merged, seq: this.seq });
  }

  private identity(): { hubId: string; epoch: number } {
    return { hubId: this.hubId, epoch: this.epoch };
  }

  status(): Promise<StatusResponse> {
    this.maybeFail();
    this.calls.push({ kind: 'status', rows: 0, bytes: 0 });
    return Promise.resolve(
      wire({
        ...this.identity(),
        protocolVersion: 1,
        minSchema: this.minSchema,
        maxSchema: this.maxSchema,
        serverTime: this.time,
        seq: this.seq,
        limits: this.limits,
      }),
    );
  }

  push(request: PushRequest): Promise<PushResponse> {
    this.maybeFail();
    const body = wire(request);
    this.pushBodies.push(body);
    this.calls.push({
      kind: 'push',
      rows: body.rows.length,
      bytes: Buffer.byteLength(JSON.stringify(request), 'utf8'),
    });
    const accepted: { table: string; id: string }[] = [];
    const rejected: PushRejection[] = [];
    for (const row of body.rows) {
      const clocks = [row.created, ...Object.values(row.clocks)];
      const latest = maxClockOf(clocks);
      if (Number(latest.slice(0, 13)) > this.time + MAX_AHEAD_MS) {
        rejected.push({ table: row.table, id: row.id, reason: 'clock_ahead' });
        continue;
      }
      if (!syncTableByName(row.table)) {
        rejected.push({ table: row.table, id: row.id, reason: 'unknown_table' });
        continue;
      }
      this.merge(row);
      accepted.push({ table: row.table, id: row.id });
    }
    // El motor deja que el test edite una fila justo antes de recibir la respuesta.
    this.beforePushReply?.();
    this.beforePushReply = null;
    return Promise.resolve(
      wire({ ...this.identity(), accepted, rejected, seq: this.seq, serverTime: this.time }),
    );
  }

  pull(since: number, limit: number): Promise<PullResponse> {
    this.maybeFail();
    const newer = [...this.rows.entries()]
      .filter(([, row]) => row.seq > since)
      .sort((a, b) => a[1].seq - b[1].seq);
    const page = newer.slice(0, limit);
    const out = page.map(([key, row]) => toWire(key.split('\u0000')[0], row.state));
    this.calls.push({ kind: 'pull', rows: out.length, bytes: 0 });
    return Promise.resolve(
      wire({
        ...this.identity(),
        rows: out,
        next: page.length > 0 ? page[page.length - 1][1].seq : since,
        more: newer.length > limit,
        seq: this.seq,
      }),
    );
  }

  claimJob(): Promise<JobClaimResponse> {
    return Promise.reject(new Error('no usado en estos tests'));
  }

  doneJob(): Promise<JobDoneResponse> {
    return Promise.reject(new Error('no usado en estos tests'));
  }
}
