// Estado de la partida de un juego entre PCs (AFTERPLAY-2.0.md §12.4).
//
// Función PURA: recibe el índice del juego (todas las filas, también las
// borradas), la huella del disco y la última huella que este PC subió o
// restauró, y dice en qué situación está la ficha. Sin base, sin disco y sin
// red, para poder probarla a fondo (F-25) y para que la decisión no dependa de
// relojes de pared.
//
// Los tres datos de §12.4:
//
// - `L`: la huella del disco ahora (`local`).
// - `S`: la última huella que este PC subió o restauró (`lastSynced`).
// - Las PUNTAS: las partidas de las que no desciende ninguna otra.
//
// El grafo. Cada fila dice "vengo de `parentContentHash`" y "soy
// `contentHash`": una arista padre → hijo entre dos ESTADOS de la partida (dos
// filas con la misma huella son el mismo nodo, vengan del PC que vengan). Las
// filas borradas cuentan para las aristas, porque las lápidas no se purgan
// (§7.7) y una versión podada sigue diciendo de quién descendía; pero una punta
// tiene que ser una partida VIVA, que se pueda restaurar. Por eso "punta" es:
// una huella viva de la que no desciende (transitivamente, a través de lo que
// haga falta, vivo o podado) ninguna otra huella viva.
//
// Ciclos. Volver exactamente a un estado anterior (restaurar una versión vieja
// y que ludusavi la vuelva a copiar, o deshacer a mano un cambio) cierra un
// ciclo: A → B → A. Dos huellas que descienden una de otra son la misma línea,
// así que no pueden ser dos puntas: del grupo se queda la que tenga la fila
// más reciente por el reloj de sync.
//
// Sin linaje. Una fila sin `parentContentHash` (las de la 1.x, las recuperadas
// del bucket y el primer backup de cada PC) es un eslabón que falta: no se
// sabe de quién viene. Dos puntas solo están "divergidas" si se DEMUESTRA que
// salen de un antepasado común; si no se puede demostrar, el estado es
// informativo (`unlinked`) y se compara por fecha, sin afirmar nada (§12.4).

/** Una fila del índice, tal como la necesita el cálculo. */
export interface LineageRow {
  /** Id de la copia (`save_backups.id`). */
  readonly id: string;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly contentHash: string | null;
  readonly parentContentHash: string | null;
  /** False = la fila tiene lápida (podada o borrada): cuenta para el linaje, no como punta. */
  readonly alive: boolean;
  /** Hora de pared del backup (la que se enseña: "hace 3 h"). */
  readonly createdAt: Date;
  /** Reloj de sync de la creación (`syncCreated`): el orden entre versiones (§12.5). */
  readonly order: string;
}

/** Lo que hay en el disco de este PC (`L`). */
export type LocalSave =
  /** Huella calculada. */
  | { readonly kind: 'hash'; readonly hash: string }
  /** No hay ningún archivo de partida donde mira ludusavi. */
  | { readonly kind: 'empty' }
  /** No se pudo calcular (sin ludusavi, archivo bloqueado, partida con registro…). */
  | { readonly kind: 'unknown' };

export type SaveSyncStatus =
  /** No hay ninguna copia en la nube. */
  | 'none'
  /** L = S = H: "Al día". */
  | 'synced'
  /** Una punta, S = H y L ≠ S: "Hay cambios sin copiar". */
  | 'local-changes'
  /** Una punta, S antepasado de H y L = S: "Hay una partida más nueva de PC-A". */
  | 'behind'
  /** Más de una punta, o una punta con S antepasado de H y L ≠ S. */
  | 'diverged'
  /** Este PC no ha subido ni restaurado nada (o no tiene partida): "Hay una partida de PC-A". */
  | 'available'
  /** Falta un eslabón del linaje: informativo, por fecha (§12.4). */
  | 'unlinked';

/** Una partida que la ficha puede nombrar y ofrecer restaurar. */
export interface SaveTip {
  /** La copia más reciente (por reloj de sync) con esa huella. */
  readonly backupId: string;
  /** null solo en `unlinked` cuando ni la más reciente tiene huella. */
  readonly contentHash: string | null;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly isOwn: boolean;
  readonly createdAt: Date;
}

export interface SaveSyncState {
  readonly status: SaveSyncStatus;
  /**
   * La partida a la que se refiere el texto: la cabeza en el caso de una punta
   * (la que se ofrece restaurar en `behind` y `diverged`), la más reciente por
   * fecha en `unlinked`, la punta más reciente en `diverged` con varias. null
   * en `none`.
   */
  readonly head: SaveTip | null;
  /** Todas las puntas, la más reciente primero (más de una = divergencia). */
  readonly tips: readonly SaveTip[];
  /** L ≠ S, si se sabe; null si no hay L o no hay S. */
  readonly localChanges: boolean | null;
  /** False si la huella del disco no se pudo calcular: el estado no mira el disco. */
  readonly localVerified: boolean;
}

export interface SaveSyncInput {
  readonly rows: readonly LineageRow[];
  readonly local: LocalSave;
  /** `local_save_state.lastSyncedHash` de este PC para el juego. */
  readonly lastSynced: string | null;
  readonly selfDeviceId: string;
}

const newestFirst = (a: LineageRow, b: LineageRow): number =>
  a.order < b.order ? 1 : a.order > b.order ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0;

/** Los nodos alcanzables desde cada huella (sus descendientes, sin ella salvo ciclo). */
function descendantsOf(rows: readonly LineageRow[]): (hash: string) => ReadonlySet<string> {
  const children = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.contentHash === null || row.parentContentHash === null) continue;
    if (row.contentHash === row.parentContentHash) continue;
    const set = children.get(row.parentContentHash) ?? new Set<string>();
    set.add(row.contentHash);
    children.set(row.parentContentHash, set);
  }
  const cache = new Map<string, Set<string>>();
  return (hash) => {
    const cached = cache.get(hash);
    if (cached) return cached;
    const seen = new Set<string>();
    const stack = [...(children.get(hash) ?? [])];
    while (stack.length > 0) {
      const next = stack.pop() as string;
      if (seen.has(next)) continue;
      seen.add(next);
      for (const child of children.get(next) ?? []) stack.push(child);
    }
    cache.set(hash, seen);
    return seen;
  };
}

/** Calcula el estado de la ficha (§12.4). */
export function computeSaveSyncState(input: SaveSyncInput): SaveSyncState {
  const { rows, local, lastSynced, selfDeviceId } = input;
  const localVerified = local.kind !== 'unknown';
  const localHash = local.kind === 'hash' ? local.hash : null;
  const localChanges =
    lastSynced === null || local.kind === 'unknown'
      ? null
      : local.kind === 'empty' || localHash !== lastSynced;

  const tipOf = (row: LineageRow): SaveTip => ({
    backupId: row.id,
    contentHash: row.contentHash,
    deviceId: row.deviceId,
    deviceName: row.deviceName,
    isOwn: row.deviceId === selfDeviceId,
    createdAt: row.createdAt,
  });
  const state = (
    status: SaveSyncStatus,
    head: SaveTip | null,
    tips: readonly SaveTip[],
  ): SaveSyncState => ({ status, head, tips, localChanges, localVerified });

  const alive = rows.filter((row) => row.alive).sort(newestFirst);
  if (alive.length === 0) return state('none', null, []);

  // La fila más reciente de cada huella viva: es la que se nombra y se ofrece.
  const newestByHash = new Map<string, LineageRow>();
  for (const row of alive) {
    if (row.contentHash !== null && !newestByHash.has(row.contentHash)) {
      newestByHash.set(row.contentHash, row);
    }
  }
  // Hay copias, pero ninguna con huella (todo de la 1.x sin recalcular): solo
  // se puede decir cuál es la más reciente.
  if (newestByHash.size === 0) {
    const latest = tipOf(alive[0]);
    return state('unlinked', latest, [latest]);
  }

  const reach = descendantsOf(rows);
  const hashes = [...newestByHash.keys()];
  const strictlyAfter = (from: string, to: string): boolean =>
    reach(from).has(to) && !reach(to).has(from);

  // Candidatas: huellas vivas sin ninguna huella viva estrictamente posterior.
  const candidates = hashes.filter((hash) => !hashes.some((other) => strictlyAfter(hash, other)));
  // Un ciclo deja varias candidatas que descienden unas de otras: son la misma
  // línea, y de ellas se queda la de fila más reciente.
  const tipHashes: string[] = [];
  for (const hash of candidates.sort((a, b) =>
    newestFirst(newestByHash.get(a) as LineageRow, newestByHash.get(b) as LineageRow),
  )) {
    const sameLine = tipHashes.some((kept) => reach(kept).has(hash) && reach(hash).has(kept));
    if (!sameLine) tipHashes.push(hash);
  }
  const tips = tipHashes.map((hash) => tipOf(newestByHash.get(hash) as LineageRow));

  // Antepasados de una huella: los nodos desde los que se llega a ella.
  const isAncestor = (ancestor: string, of: string): boolean =>
    ancestor !== of && reach(ancestor).has(of);

  if (tips.length > 1) {
    // Divergencia DEMOSTRADA: dos puntas con un antepasado común. Los nodos del
    // grafo son todas las huellas que aparecen en alguna fila.
    const nodes = new Set<string>();
    for (const row of rows) {
      if (row.contentHash !== null) nodes.add(row.contentHash);
      if (row.parentContentHash !== null) nodes.add(row.parentContentHash);
    }
    const proven = tipHashes.some((a, index) =>
      tipHashes
        .slice(index + 1)
        .some((b) => [...nodes].some((node) => isAncestor(node, a) && isAncestor(node, b))),
    );
    if (proven) return state('diverged', tips[0], tips);
    // Sin antepasado común conocido no se afirma nada: la más reciente por
    // reloj de sync, como información.
    return state('unlinked', tips[0], tips);
  }

  const head = tips[0];
  const H = head.contentHash as string;

  // El disco ya tiene exactamente la cabeza: al día, haya subido o restaurado
  // este PC o no (por ejemplo, tras copiar la partida a mano).
  if (localHash === H) return state('synced', head, tips);
  // Sin partida en el disco, o sin nada propio de lo que partir: lo que hay en
  // la nube se ofrece, sin más.
  if (local.kind === 'empty' || lastSynced === null) return state('available', head, tips);

  if (lastSynced === H) {
    if (local.kind === 'unknown') return state('synced', head, tips);
    return state('local-changes', head, tips);
  }
  if (isAncestor(lastSynced, H)) {
    // La nube va por delante de lo último que este PC tuvo.
    if (local.kind === 'unknown' || localHash === lastSynced) return state('behind', head, tips);
    return state('diverged', head, tips);
  }
  if (isAncestor(H, lastSynced)) {
    // Lo último de este PC es POSTERIOR a la cabeza, pero su copia ya no está
    // viva (la borraron): la nube no tiene ese estado.
    return state('local-changes', head, tips);
  }
  return state('unlinked', head, tips);
}
