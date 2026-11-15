// Reparto de las rutas de la PWA (ver types.ts).

import { IGDB_ROUTES } from './igdb';
import { READS_ROUTES } from './reads';
import type { RouteParams, WebMethod, WebRoute } from './types';
import { WRITES_ROUTES } from './writes';

export const WEB_ROUTES: readonly WebRoute[] = [...READS_ROUTES, ...WRITES_ROUTES, ...IGDB_ROUTES];

/** Compara `/games/:id` con `/games/abc`. Un segmento vacío o mal codificado no casa. */
function matchPattern(pattern: string, path: string): RouteParams | null {
  const want = pattern.split('/');
  const got = path.split('/');
  if (want.length !== got.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    if (want[i].startsWith(':')) {
      if (got[i] === '') return null;
      try {
        params[want[i].slice(1)] = decodeURIComponent(got[i]);
      } catch {
        return null;
      }
    } else if (want[i] !== got[i]) {
      return null;
    }
  }
  return params;
}

export type RouteMatch =
  | { kind: 'found'; route: WebRoute; params: RouteParams }
  | { kind: 'method'; allow: WebMethod[] }
  | { kind: 'none' };

export function matchRoute(
  routes: readonly WebRoute[],
  method: WebMethod,
  path: string,
): RouteMatch {
  const allow: WebMethod[] = [];
  for (const route of routes) {
    const params = matchPattern(route.pattern, path);
    if (!params) continue;
    if (route.method === method) return { kind: 'found', route, params };
    allow.push(route.method);
  }
  return allow.length > 0 ? { kind: 'method', allow } : { kind: 'none' };
}
