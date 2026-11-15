// Qué familias de datos de la interfaz dependen de cada tabla sincronizada
// (AFTERPLAY-2.0.md §15.4). Cuando una descarga de sync cambia filas, el
// proceso principal avisa de las TABLAS; el renderer traduce estos ámbitos a
// sus claves de TanStack Query (hooks/syncChanges.ts) y refresca solo lo que
// toca.
//
// Está aquí, y no en el renderer, para que un test del proceso principal pueda
// comprobar que NINGUNA tabla sincronizada se queda sin ámbito: una tabla
// nueva sin esta línea dejaría la pantalla con datos viejos hasta reiniciar.

export type ChangeScope =
  | 'games'
  | 'sessions'
  | 'stateEvents'
  | 'spend'
  | 'emulators'
  | 'saves'
  | 'achievements'
  | 'curiosities'
  | 'memories'
  | 'radar'
  | 'external';

export const SYNC_TABLE_SCOPES: Readonly<Record<string, readonly ChangeScope[]>> = {
  // Un dispositivo nuevo o renombrado sale en la identidad y en las partidas.
  devices: ['saves'],
  games: ['games'],
  game_metadata: ['games'],
  external_checks: ['games', 'external'],
  game_installs: ['games'],
  emulators: ['emulators'],
  emulator_installs: ['emulators'],
  plan_entries: ['games'],
  // La lista de juegos lleva el estado y las horas derivados de estas tablas.
  playthroughs: ['games'],
  state_events: ['stateEvents', 'games'],
  sessions: ['sessions', 'games'],
  spend_events: ['spend', 'games'],
  achievement_catalogs: ['achievements'],
  achievement_unlocks: ['achievements'],
  save_backups: ['saves'],
  game_curiosities: ['curiosities'],
  generated_memories: ['memories'],
  radar_games: ['radar'],
};

/**
 * Los ámbitos a refrescar para un aviso de cambio. Una tabla que no se conoce
 * (la app es más vieja que el hub, §8.7) refresca TODO: pasarse de refresco
 * cuesta unas consultas, quedarse corto deja datos viejos en pantalla.
 */
export function scopesForTables(tables: readonly string[]): ReadonlySet<ChangeScope> {
  const scopes = new Set<ChangeScope>();
  for (const table of tables) {
    const known = SYNC_TABLE_SCOPES[table];
    if (!known) return new Set(ALL_SCOPES);
    for (const scope of known) scopes.add(scope);
  }
  return scopes;
}

export const ALL_SCOPES: readonly ChangeScope[] = [
  'games',
  'sessions',
  'stateEvents',
  'spend',
  'emulators',
  'saves',
  'achievements',
  'curiosities',
  'memories',
  'radar',
  'external',
];
