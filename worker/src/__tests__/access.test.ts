// QUE BLINDA: la regla 4 del §5.2 — authenticate verifica el JWT de Access
// de VERDAD, no solo lee un email de la cabecera. En concreto: el algoritmo
// esta FIJADO a RS256 (un token que dice "alg: none" se rechaza sin llegar a
// mirar la firma), un token firmado para OTRA aplicacion (aud distinto) no
// abre esta, un token caducado mas alla del margen de reloj de 60s no vale
// aunque este bien firmado, y sin token no hay identidad. El camino feliz
// (firma, aud, iss y caducidad correctos) cierra el circulo: si el resto de
// tests fallaran por una firma que en realidad nunca se comprueba, este es
// el que lo destaparia.
//
// QUE ES REAL Y QUE ES DOBLE: el par de claves RSA es de VERDAD (WebCrypto,
// generado una vez para todo el fichero) y los JWT se firman de verdad con
// el, byte a byte, igual que Access. Lo UNICO doblado es `fetch`: en vez de
// pedir las claves publicas a Cloudflare, se sirve el JWKS con nuestra propia
// clave publica — es la unica pieza que en produccion cruza la red.
import assert from 'node:assert/strict';
import { after, before, describe, it, mock } from 'node:test';
import type { Env } from '../env';
import { AccessError, authenticate } from '../access';

const TEAM_DOMAIN = 'test-team.cloudflareaccess.com';
const AUD = 'test-aud-1234';
const KID = 'test-kid-1';

const bytesToBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const encodeJson = (value: unknown): string =>
  bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));

let privateKey: CryptoKey;
let publicJwk: { kty: string; n: string; e: string };

// Firma un JWT de verdad con la clave privada del test. `alg` es
// configurable para poder mandar un header que MIENTE sobre el algoritmo
// (el caso "none") sin dejar de firmar con RS256 por debajo — igual que
// haria un atacante: la firma es valida, lo que esta amanado es el header.
const signToken = async (
  payload: Record<string, unknown>,
  { alg = 'RS256', kid = KID }: { alg?: string; kid?: string } = {},
): Promise<string> => {
  const signingInput = `${encodeJson({ alg, kid })}.${encodeJson(payload)}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${bytesToBase64Url(new Uint8Array(signature))}`;
};

const request = (headers: Record<string, string> = {}): Request =>
  new Request('https://example.com/api', { headers });

const baseEnv = (overrides: Partial<Env> = {}): Env => ({
  ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
  ACCESS_AUD: AUD,
  ...overrides,
});

before(async () => {
  // El tipo de generateKey en @cloudflare/workers-types no distingue por
  // algoritmo (siempre `CryptoKey | CryptoKeyPair`): RSA con un array de usos
  // de longitud 2 SIEMPRE da un par, nunca una clave suelta.
  const keyPair = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  privateKey = keyPair.privateKey;
  publicJwk = (await crypto.subtle.exportKey('jwk', keyPair.publicKey)) as unknown as {
    kty: string;
    n: string;
    e: string;
  };

  // El unico doble de todo el fichero: la llamada de red que en produccion
  // trae el JWKS publico del equipo de Access. Sirve NUESTRA clave publica
  // bajo el mismo kid con el que firmamos arriba.
  mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === `https://${TEAM_DOMAIN}/cdn-cgi/access/certs`) {
      return new Response(
        JSON.stringify({
          keys: [{ kid: KID, kty: publicJwk.kty, n: publicJwk.n, e: publicJwk.e }],
        }),
        { status: 200 },
      );
    }
    throw new Error(`fetch inesperado en el test de authenticate: ${url}`);
  });
});

after(() => {
  mock.restoreAll();
});

describe('authenticate', () => {
  it('sin token en la cabecera ni en la cookie, lanza sin llegar a validar nada', async () => {
    await assert.rejects(() => authenticate(request(), baseEnv(), Date.now()), AccessError);
  });

  it('el algoritmo esta FIJADO a RS256: un token "none" se rechaza sin mirar la firma', async () => {
    const now = Date.now();
    const token = await signToken(
      {
        email: 'a@x.com',
        aud: AUD,
        iss: `https://${TEAM_DOMAIN}`,
        exp: Math.floor(now / 1000) + 3600,
      },
      { alg: 'none' },
    );
    await assert.rejects(
      () => authenticate(request({ 'cf-access-jwt-assertion': token }), baseEnv(), now),
      /algoritmo/,
    );
  });

  it('un token firmado para OTRA aplicacion (aud distinto) no abre esta', async () => {
    const now = Date.now();
    const token = await signToken({
      email: 'a@x.com',
      aud: 'otra-aplicacion-del-mismo-equipo',
      iss: `https://${TEAM_DOMAIN}`,
      exp: Math.floor(now / 1000) + 3600,
    });
    await assert.rejects(
      () => authenticate(request({ 'cf-access-jwt-assertion': token }), baseEnv(), now),
      /no es para esta aplicaci/,
    );
  });

  it('un token caducado mas alla del margen de reloj no vale, aunque este bien firmado', async () => {
    const now = Date.now();
    const token = await signToken({
      email: 'a@x.com',
      aud: AUD,
      iss: `https://${TEAM_DOMAIN}`,
      exp: Math.floor(now / 1000) - 120, // 2 minutos caducado: el margen es de 60s
    });
    await assert.rejects(
      () => authenticate(request({ 'cf-access-jwt-assertion': token }), baseEnv(), now),
      /caducado/,
    );
  });

  it('con firma, aud, iss y caducidad correctos, devuelve el email en minusculas', async () => {
    const now = Date.now();
    const token = await signToken({
      email: 'Alguien@X.COM',
      aud: AUD,
      iss: `https://${TEAM_DOMAIN}`,
      exp: Math.floor(now / 1000) + 3600,
    });
    const identity = await authenticate(
      request({ 'cf-access-jwt-assertion': token }),
      baseEnv(),
      now,
    );
    assert.deepEqual(identity, { email: 'alguien@x.com' });
  });
});
