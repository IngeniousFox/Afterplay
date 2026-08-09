import type { Env } from './env';
import { isDevelopment } from './env';

// Las claves de IGDB (vía Twitch) de UN inquilino.
//
// Van dentro del inquilino y no en una variable global del Worker, que es como
// estaban al principio: con unas claves compartidas, las búsquedas de uno
// consumían la cuota de la aplicación de Twitch del otro, y el día que alguien
// se lleva su despliegue aparte (§5.3) se iría usando claves ajenas. El §6.4
// ya decía "con las claves del inquilino"; esto lo cumple.
export type IgdbCredentials = {
  clientId: string;
  clientSecret: string;
};

export type TenantCredentials = {
  url: string;
  authToken: string;
  // null = este inquilino no tiene IGDB configurado. NO es un error: la web
  // sigue funcionando entera menos lo que sale de IGDB (buscar por catálogo,
  // capturas y saga), y eso se degrada solo en vez de reventar.
  igdb: IgdbCredentials | null;
};

const readIgdb = (entry: Record<string, unknown>): IgdbCredentials | null => {
  const clientId = entry.twitchClientId;
  const clientSecret = entry.twitchClientSecret;
  if (typeof clientId !== 'string' || typeof clientSecret !== 'string') return null;
  if (clientId === '' || clientSecret === '') return null;
  return { clientId, clientSecret };
};

// §5.2 regla 2 — FALLAR CERRADO.
//
// El atajo que hay que no tomar nunca: "si no reconozco el email, uso la base
// del dueño por defecto". Suena inofensivo mientras solo lo usa el dueño, y es
// una fuga esperando su día — el primer email nuevo que entre (un alias, una
// cuenta de trabajo, alguien que Access deja pasar por una regla mal puesta)
// ve la biblioteca de otro. Email no reconocido => null => 403, sin excepción.
export const resolveTenant = (env: Env, email: string): TenantCredentials | null => {
  const key = email.toLowerCase();

  if (env.TENANTS) {
    let map: Record<string, Record<string, unknown>>;
    try {
      map = JSON.parse(env.TENANTS) as Record<string, Record<string, unknown>>;
    } catch {
      // Un TENANTS mal formado no puede degradar a "deja pasar a todos": si el
      // mapa no se puede leer, no se reconoce a nadie.
      return null;
    }

    const entry = map[key];
    if (typeof entry !== 'object' || entry === null) return null;
    if (typeof entry.url !== 'string' || typeof entry.authToken !== 'string') return null;
    if (entry.url === '' || entry.authToken === '') return null;

    return { url: entry.url, authToken: entry.authToken, igdb: readIgdb(entry) };
  }

  // Camino de desarrollo: un solo inquilino, el de .dev.vars. Depende de
  // ENVIRONMENT, que no existe fuera de ese fichero (env.ts explica por qué
  // eso es el mecanismo y no una convención). Y sigue exigiendo que el email
  // COINCIDA: ni en local se entra con uno cualquiera.
  if (isDevelopment(env) && env.TURSO_DATABASE_URL && env.TURSO_AUTH_TOKEN) {
    if (env.DEV_EMAIL?.toLowerCase() !== key) return null;
    return {
      url: env.TURSO_DATABASE_URL,
      authToken: env.TURSO_AUTH_TOKEN,
      igdb:
        env.TWITCH_CLIENT_ID && env.TWITCH_CLIENT_SECRET
          ? { clientId: env.TWITCH_CLIENT_ID, clientSecret: env.TWITCH_CLIENT_SECRET }
          : null,
    };
  }

  return null;
};
