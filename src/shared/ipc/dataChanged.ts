// EL ÚNICO AVISO DE CAMBIO DE DATOS del main al renderer (AFTERPLAY-2.0.md
// §15.4, F-39). Lo emite el main desde tres sitios (la puerta de escritura
// tras cada transacción confirmada, el watcher a través de ella y cada página
// de bajada del sync que aplica algo) y un único oyente por ventana lo
// traduce a invalidaciones de consulta.
//
// Está en shared, y no en el main, para que el renderer comparta la lista
// cerrada de dominios. La tabla tabla → dominios es la pieza que vigila el
// test de `main/ipc/__tests__/dataChanged.test.ts`: una tabla sincronizada
// nueva sin dominio dejaría la pantalla con datos viejos hasta reiniciar.

/** Las familias de datos de la interfaz. Lista cerrada. */
export const DOMAINS = [
  'games',
  'sessions',
  'playthroughs',
  'stateEvents',
  'spend',
  'plan',
  'achievements',
  'saves',
  'devices',
  'memories',
  'curiosities',
  'emulators',
  'radar',
  'external',
] as const;

export type Domain = (typeof DOMAINS)[number];

export type DataChangeOrigin = 'local' | 'sync' | 'watcher';

export interface DataChanged {
  /** Dominios con filas cambiadas, sin repetir. */
  domains: Domain[];
  /** Ids de las filas tocadas, por dominio (de las tablas que le pertenecen). */
  ids?: Partial<Record<Domain, string[]>>;
  origin: DataChangeOrigin;
}

/** De qué dominios es cada tabla sincronizada. */
export const TABLE_DOMAINS: Readonly<Record<string, readonly Domain[]>> = {
  devices: ['devices'],
  games: ['games'],
  game_metadata: ['games'],
  external_checks: ['games', 'external'],
  game_installs: ['games'],
  emulators: ['emulators'],
  emulator_installs: ['emulators'],
  plan_entries: ['plan'],
  playthroughs: ['playthroughs'],
  state_events: ['stateEvents'],
  sessions: ['sessions'],
  spend_events: ['spend'],
  achievement_catalogs: ['achievements'],
  achievement_unlocks: ['achievements'],
  save_backups: ['saves'],
  game_curiosities: ['curiosities'],
  generated_memories: ['memories'],
  radar_games: ['radar'],
};

/**
 * El aviso para unas tablas cambiadas. Una tabla que no se conoce (la app es
 * más vieja que el hub, §8.7) avisa de TODOS los dominios: pasarse de refresco
 * cuesta unas consultas, quedarse corto deja datos viejos en pantalla.
 */
export function dataChangedFromTables(
  tables: readonly string[],
  ids: Readonly<Record<string, readonly string[]>>,
  origin: DataChangeOrigin,
): DataChanged {
  const touched = new Set<Domain>();
  const idsByDomain = new Map<Domain, Set<string>>();
  for (const table of tables) {
    const known = TABLE_DOMAINS[table];
    if (!known) return { domains: [...DOMAINS], origin };
    for (const domain of known) {
      touched.add(domain);
      let set = idsByDomain.get(domain);
      if (!set) idsByDomain.set(domain, (set = new Set()));
      for (const id of ids[table] ?? []) set.add(id);
    }
  }
  const result: DataChanged = { domains: DOMAINS.filter((domain) => touched.has(domain)), origin };
  const withIds: Partial<Record<Domain, string[]>> = {};
  let any = false;
  for (const [domain, set] of idsByDomain) {
    if (set.size === 0) continue;
    withIds[domain] = [...set];
    any = true;
  }
  if (any) result.ids = withIds;
  return result;
}
