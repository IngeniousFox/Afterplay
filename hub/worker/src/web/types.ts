// La API de la PWA dentro del Durable Object (AFTERPLAY-2.0.md §13).
//
// El Worker autentica (Access) y resuelve el inquilino; todo lo demás llega al
// `TenantHub` por UNA llamada RPC (`web`) con esta forma, y aquí se reparte por
// rutas. Así cada grupo de rutas vive en su propio módulo (`reads.ts`,
// `writes.ts`, `igdb.ts`) y añadir una no toca la RPC, el enlace ni el router.

import type { Outcome } from '../outcome';
import type { TenantService } from '../tenantService';

export type WebMethod = 'GET' | 'POST';

/** Lo que el Worker manda al Durable Object: ya autenticado y sin cabeceras. */
export interface WebRequest {
  readonly method: WebMethod;
  /** La ruta tras `/api/v2`, p. ej. `/games/abc`. */
  readonly path: string;
  /** Parámetros de la query (el primero de cada nombre). */
  readonly query: Readonly<Record<string, string>>;
  /** Cuerpo JSON ya leído (con tope de tamaño), o null en un GET. */
  readonly body: unknown;
}

/** Los `:nombre` de la ruta, ya decodificados. */
export type RouteParams = Readonly<Record<string, string>>;

export type WebHandler = (
  service: TenantService,
  request: WebRequest,
  params: RouteParams,
) => Outcome<unknown> | Promise<Outcome<unknown>>;

export interface WebRoute {
  readonly method: WebMethod;
  /** Con segmentos `:nombre`, p. ej. `/games/:id/achievements`. */
  readonly pattern: string;
  readonly handler: WebHandler;
}
