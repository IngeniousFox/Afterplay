import type { QueryKey } from '@tanstack/react-query';
import type { DataChanged, Domain } from '../../../shared/ipc/dataChanged';
import { DOMAINS } from '../../../shared/ipc/dataChanged';
import { queryKeys } from './queryKeys';

// LA TABLA DOMINIO → CONSULTAS (AFTERPLAY-2.0.md §15.4). Es el único sitio que
// sabe qué consultas de la interfaz dependen de cada familia de datos: el
// main avisa de DOMINIOS (`data:changed`) y `useDataChangedSync` los traduce
// aquí. Una mutación nueva no tiene que acordarse de invalidar nada: si
// escribe por la puerta, su dominio ya está en esta tabla.
//
// TanStack invalida por prefijo (ver queryKeys.ts), así que basta la raíz de
// cada familia. Solo se refetchean las consultas ACTIVAS; las demás quedan
// marcadas como viejas y se piden al montarse.
//
// Los dominios que cambian algo DERIVADO lo traen escrito aquí: la lista de
// juegos lleva las horas, el estado, el gasto y la última vez jugada, así que
// sesiones, eventos de estado, gasto y playthroughs refrescan también
// `games.all`. Por eso las Estadísticas (que leen juegos, gasto y eventos de
// estado, más los agregados de sesiones de `stats.all`) se actualizan con
// cualquiera de los cinco.
//
// Las sesiones ya no se piden enteras (F-41): lo que sale de ellas —las de un
// juego, las abiertas, un rango, una página, los agregados de `stats`— cuelga
// de `sessions.all` / `stats.all`, y todo lo que cambia qué sesiones están
// vivas (juegos, playthroughs) las refresca también.
export const DOMAIN_QUERY_KEYS: Readonly<Record<Domain, readonly QueryKey[]>> = {
  games: [queryKeys.games.all, queryKeys.sessions.all, queryKeys.stats.all],
  sessions: [queryKeys.sessions.all, queryKeys.games.all, queryKeys.stats.all],
  playthroughs: [queryKeys.games.all, queryKeys.sessions.all, queryKeys.stats.all],
  stateEvents: [queryKeys.stateEvents.all, queryKeys.games.all, queryKeys.stats.all],
  spend: [queryKeys.spend.all, queryKeys.games.all, queryKeys.stats.all],
  // El Plan vive en `plan_entries`: entrar o salir del Plan cambia también qué
  // juegos salen en la biblioteca, así que cuelga de la misma raíz.
  plan: [queryKeys.games.all],
  achievements: [queryKeys.achievements.all],
  saves: [queryKeys.saves.all],
  // Un PC nuevo o renombrado da nombre a "Playing on PC-A" y a las partidas.
  devices: [queryKeys.devices.all, queryKeys.saves.all],
  memories: [queryKeys.memories.all],
  curiosities: [queryKeys.curiosities.all],
  emulators: [queryKeys.emulators.all],
  radar: [queryKeys.radar.all],
  external: [queryKeys.external.status],
};

/** Las consultas a invalidar para estos dominios, sin repetir y en orden estable. */
export const queryKeysForDomains = (domains: readonly Domain[]): QueryKey[] => {
  const keys = new Map<string, QueryKey>();
  for (const domain of DOMAINS) {
    if (!domains.includes(domain)) continue;
    for (const key of DOMAIN_QUERY_KEYS[domain]) keys.set(JSON.stringify(key), key);
  }
  return [...keys.values()];
};

/** Lo mismo para un aviso entero. */
export const queryKeysForChange = (change: DataChanged): QueryKey[] =>
  queryKeysForDomains(change.domains);
