import type { Env } from './env';
import { isDevelopment } from './env';

// §5.2 regla 4 — verificar el JWT de Access, NO fiarse de la cabecera del
// email.
//
// Cloudflare Access pone `Cf-Access-Authenticated-User-Email` en las
// peticiones que pasan por él, y es tentador leerla y ya. El problema: si
// alguien golpea la URL del Worker DIRECTAMENTE (los *.workers.dev son
// públicos y adivinables), esa cabecera es texto libre que el atacante
// escribe. O sea que "confiar en la cabecera" es "dejar que cualquiera diga
// quién es" — y en un despliegue multiinquilino eso es elegir la base de
// datos del otro.
//
// Lo que sí es infalsificable es el token firmado: Access lo mete en
// `Cf-Access-Jwt-Assertion` (y en la cookie CF_Authorization), firmado con
// una clave cuya pareja pública publica el equipo. Verificarlo es lo único
// que demuestra que la petición pasó de verdad por Access.

type Jwk = {
  kid: string;
  kty: string;
  alg?: string;
  n: string;
  e: string;
};

type AccessPayload = {
  aud?: string | string[];
  email?: string;
  iss?: string;
  exp?: number;
  nbf?: number;
  iat?: number;
};

export type Identity = { email: string };

export class AccessError extends Error {}

// Estas dos comen texto que viene del cliente y que puede ser cualquier cosa,
// así que sus fallos tienen que salir como AccessError.
//
// Sin el try, un `atob` sobre una cookie truncada lanzaba InvalidCharacterError
// —o JSON.parse un SyntaxError— y el router, que solo mapea AccessError a 401,
// lo convertía en un 500 `internal`. Y ese código la PWA SÍ lo reintenta (no
// está en su lista de no-reintentables), así que a alguien con la cookie
// caducada se le decía que era un problema de red, dos veces por consulta, y
// nunca que volviera a entrar.
const base64UrlToBytes = (input: string): Uint8Array => {
  try {
    const padded = input.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    throw new AccessError('el token de Access no se puede leer');
  }
};

const decodeJson = <T>(segment: string): T => {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment))) as T;
  } catch (error) {
    // El AccessError de arriba se deja pasar tal cual: ya dice lo suyo.
    if (error instanceof AccessError) throw error;
    throw new AccessError('el token de Access está malformado');
  }
};

// Caché de las claves PÚBLICAS del equipo, a nivel de módulo y a propósito.
//
// Ojo con la regla 1 del §5.2 (nada de estado de módulo): esa regla existe
// porque los isolates se reutilizan entre peticiones de inquilinos DISTINTOS,
// así que cachear algo que pertenece a un inquilino es servírselo al otro.
// Estas claves no pertenecen a nadie: son públicas, iguales para todos, y
// están publicadas en una URL abierta. Cachearlas no filtra nada — y evita un
// viaje de red por cada petición, que a 10 ms de CPU es la diferencia entre ir
// bien e ir justo.
let jwksCache: { keys: Jwk[]; fetchedAt: number; teamDomain: string } | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000;

const fetchJwks = async (
  teamDomain: string,
  now: number,
  { bypassCache = false }: { bypassCache?: boolean } = {},
): Promise<Jwk[]> => {
  if (
    !bypassCache &&
    jwksCache &&
    jwksCache.teamDomain === teamDomain &&
    now - jwksCache.fetchedAt < JWKS_TTL_MS
  ) {
    return jwksCache.keys;
  }

  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!response.ok) {
    throw new AccessError(`no se pudieron leer las claves de Access (${response.status})`);
  }

  const { keys } = (await response.json()) as { keys: Jwk[] };
  jwksCache = { keys, fetchedAt: now, teamDomain };
  return keys;
};

// La clave que firmó ESTE token, releyendo el JWKS si el `kid` no está.
//
// Sin el reintento, rotar la clave de Access dejaba fuera a todo el mundo
// hasta una hora: cada isolate caliente conservaba su foto vieja del JWKS, un
// kid nuevo no aparecía, y se lanzaba 401 sin volver a preguntar. Encima la
// PWA no reintenta los 'unauthenticated' (App.tsx), así que se quedaba muerta
// en pantalla. Un kid desconocido es justo la señal de que la caché caducó
// antes de tiempo, así que se relee una vez y ya.
const findSigningKey = async (
  teamDomain: string,
  kid: string,
  now: number,
): Promise<Jwk | undefined> => {
  const cached = await fetchJwks(teamDomain, now);
  const hit = cached.find((key) => key.kid === kid);
  if (hit) return hit;

  const fresh = await fetchJwks(teamDomain, now, { bypassCache: true });
  return fresh.find((key) => key.kid === kid);
};

const importKey = (jwk: Jwk): Promise<CryptoKey> =>
  crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );

const readToken = (request: Request): string | null => {
  const header = request.headers.get('cf-access-jwt-assertion');
  if (header) return header;

  // La cookie es el otro sitio donde Access lo deja — la usa el navegador al
  // navegar normal, mientras que la cabecera aparece en las llamadas de la
  // propia PWA.
  const cookies = request.headers.get('cookie');
  if (!cookies) return null;
  const match = cookies.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return match ? match[1] : null;
};

// Devuelve la identidad, o LANZA. Nunca devuelve un "invitado por defecto":
// esa es la regla 2 (fallar cerrado) aplicada a la autenticación.
export const authenticate = async (request: Request, env: Env, now: number): Promise<Identity> => {
  // En desarrollo no hay Access delante: wrangler dev sirve en localhost. El
  // atajo está atado a ENVIRONMENT, que solo existe en .dev.vars y por tanto
  // NO PUEDE llegar a producción (ver env.ts). Aun así exige DEV_EMAIL
  // explícito: ni siquiera en local se entra sin decir quién eres.
  if (isDevelopment(env)) {
    if (!env.DEV_EMAIL) {
      throw new AccessError('modo desarrollo sin DEV_EMAIL: añádelo a worker/.dev.vars');
    }
    return { email: env.DEV_EMAIL.toLowerCase() };
  }

  const { ACCESS_TEAM_DOMAIN, ACCESS_AUD } = env;
  // Sin configuración de Access no se sirve NADA. Es el caso más peligroso de
  // todos —un despliegue a medio configurar— y por eso es un error duro y no
  // un aviso: un Worker con datos de dos personas y sin puerta no debe
  // responder ni una vez.
  if (!ACCESS_TEAM_DOMAIN || !ACCESS_AUD) {
    throw new AccessError('Access no está configurado en este despliegue');
  }

  const token = readToken(request);
  if (!token) throw new AccessError('falta el token de Access');

  const parts = token.split('.');
  if (parts.length !== 3) throw new AccessError('token de Access malformado');
  const [rawHeader, rawPayload, rawSignature] = parts;

  const header = decodeJson<{ kid?: string; alg?: string }>(rawHeader);
  // Fijar el algoritmo esperado, no leerlo del token: aceptar el `alg` que
  // venga es la vulnerabilidad clásica de JWT (un token con alg "none", o
  // firmado con HMAC usando la clave pública como secreto).
  if (header.alg !== 'RS256') throw new AccessError('algoritmo de firma inesperado');
  if (!header.kid) throw new AccessError('token de Access sin kid');

  const jwk = await findSigningKey(ACCESS_TEAM_DOMAIN, header.kid, now);
  if (!jwk) throw new AccessError('el token no lo firmó ninguna clave conocida del equipo');

  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    await importKey(jwk),
    base64UrlToBytes(rawSignature),
    new TextEncoder().encode(`${rawHeader}.${rawPayload}`),
  );
  if (!valid) throw new AccessError('la firma del token no es válida');

  const payload = decodeJson<AccessPayload>(rawPayload);

  // Un margen de 60 s para el reloj: sin él, un desfase mínimo entre el
  // servidor que firmó y el que verifica rechaza tokens perfectamente buenos.
  const SKEW_S = 60;
  const nowSeconds = Math.floor(now / 1000);
  if (typeof payload.exp !== 'number' || payload.exp + SKEW_S < nowSeconds) {
    throw new AccessError('el token de Access ha caducado');
  }
  if (typeof payload.nbf === 'number' && payload.nbf - SKEW_S > nowSeconds) {
    throw new AccessError('el token de Access todavía no es válido');
  }

  // El `aud` ata el token a ESTA aplicación. Sin comprobarlo, un token válido
  // de cualquier otra aplicación del mismo equipo de Access abriría esta.
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(ACCESS_AUD)) {
    throw new AccessError('el token no es para esta aplicación');
  }

  if (payload.iss !== `https://${ACCESS_TEAM_DOMAIN}`) {
    throw new AccessError('el token no lo emitió el equipo esperado');
  }

  if (!payload.email) throw new AccessError('el token no trae email');
  return { email: payload.email.toLowerCase() };
};
