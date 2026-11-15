// Caché en memoria de las lecturas de la PWA (AFTERPLAY-2.0.md §9.7).
//
// Lo que cuesta cupo en un Durable Object son las FILAS LEÍDAS, y la PWA pide
// las mismas listas una y otra vez mientras nadie escribe. Cada resultado se
// guarda con la secuencia del inquilino con la que se calculó: mientras la
// secuencia no cambie, ninguna fila del inquilino ha cambiado (toda escritura,
// de un PC o del móvil, la sube), así que el resultado sigue valiendo. Basta
// UNA lectura de `tenant_meta` para saber si vale.
//
// Vive en la memoria del objeto: si el Durable Object se descarga, se recalcula
// y ya. Con tope de entradas y de bytes (expulsa la menos reciente) para que
// un inquilino con muchas fichas no crezca sin límite.

export const READ_CACHE_MAX_ENTRIES = 128;
export const READ_CACHE_MAX_BYTES = 4 * 1024 * 1024;

interface Entry {
  readonly value: unknown;
  readonly bytes: number;
}

export class ReadCache {
  private seq = -1;
  private entries = new Map<string, Entry>();
  private bytes = 0;

  constructor(
    private readonly maxEntries = READ_CACHE_MAX_ENTRIES,
    private readonly maxBytes = READ_CACHE_MAX_BYTES,
  ) {}

  /** Cuántas lecturas hay guardadas (para los tests). */
  get size(): number {
    return this.entries.size;
  }

  /** El resultado guardado con esta secuencia; con otra, la caché entera se vacía. */
  get(seq: number, key: string): unknown {
    this.rotate(seq);
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    // Más reciente: al final del orden de inserción.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(seq: number, key: string, value: unknown): void {
    this.rotate(seq);
    const bytes = JSON.stringify(value).length;
    // Uno solo que se comería media caché no merece la pena guardarlo.
    if (bytes > this.maxBytes / 2) return;
    const previous = this.entries.get(key);
    if (previous) {
      this.bytes -= previous.bytes;
      this.entries.delete(key);
    }
    this.entries.set(key, { value, bytes });
    this.bytes += bytes;
    for (const [oldest, entry] of this.entries) {
      if (this.entries.size <= this.maxEntries && this.bytes <= this.maxBytes) break;
      this.entries.delete(oldest);
      this.bytes -= entry.bytes;
    }
  }

  private rotate(seq: number): void {
    if (seq === this.seq) return;
    this.seq = seq;
    this.entries.clear();
    this.bytes = 0;
  }
}
