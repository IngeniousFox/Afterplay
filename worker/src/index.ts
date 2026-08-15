import { eq } from 'drizzle-orm';
import { gamesTable } from '../../src/main/db/schema';
import { AccessError, authenticate } from './access';
import { openTenantDb } from './db';
import type { Env } from './env';
import { fail, isSchemaOutdated, json } from './http';
import { getGameMedia, searchGames } from './igdb';
import { searchSteamStore } from './steam';
import {
  dismissFailure,
  enqueue,
  listPending,
  listRecentFailures,
  parseEntry,
  pendingAddKeys,
} from './queries/mailbox';
import { getCuriosities, getGameAchievements } from './queries/achievements';
import { getGameDetail } from './queries/game';
import { findOwned, listLibrary, listPlanned } from './queries/library';
import { getSaga } from './queries/saga';
import { beatTimer, getActiveTimer, startTimer, stopTimer, TimerError } from './queries/timer';
import { listSessions } from './queries/sessions';
import { getStatsSummary } from './queries/stats';
import { resolveTenant } from './tenants';

// Solo el HOST de la base, nunca el token. Misma regla que el escritorio se
// impuso tras conectar un sandbox a la base real por error: el log tiene que
// decir CUÁL es la base, porque estos logs acaban pegados en informes.
const dbLabel = (url: string): string => {
  try {
    return new URL(url).hostname.split('.')[0];
  } catch {
    return 'desconocida';
  }
};

// EN QUÉ RELOJ VIVE EL QUE ESTÁ MIRANDO. Un Worker no tiene zona horaria, así
// que cualquier `getFullYear()` de aquí es UTC, mientras que el escritorio lee
// el mismo instante en local. Con una fecha de precisión de AÑO —que se guarda
// como el 1 de enero a las 00:00 LOCALES, o sea las 23:00Z del 31 de diciembre
// anterior desde España— las mismas horas caían en 2018 en la portada del
// móvil y en 2019 en Stats del PC.
//
// Cloudflare ya trae la zona del que hace la petición, deducida de su IP, y es
// justo lo que hace falta: el año que espera ver quien mira la pantalla, igual
// que en el escritorio. No es un dato perfecto —de viaje se lee la del sitio
// donde estés, no la de casa—, pero es el mismo criterio que aplica el PC y
// deja de haber dos respuestas para la misma pregunta. `cf` no está tipado
// campo a campo aquí, de ahí el acceso estrecho en vez de un cast a la
// interfaz entera.
//
// null cuando no viene (tests, `wrangler dev` a secas): entonces cada lado
// vuelve a leer en el reloj de su proceso, que es como estaba antes.
const readTimeZone = (request: Request): string | null => {
  const zone = (request.cf as { timezone?: unknown } | undefined)?.timezone;
  return typeof zone === 'string' && zone.length > 0 ? zone : null;
};

const readInt = (value: string | null): number | undefined => {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Todo lo que no sea /api/* lo sirven los assets estáticos de la PWA
    // (ver wrangler.jsonc). Si esto se ejecuta con otra ruta es que la
    // configuración de assets no está haciendo su trabajo.
    if (!url.pathname.startsWith('/api/')) {
      return fail('not_found', 'esta ruta no es de la API', 404);
    }

    // GET y POST, nada más: cualquier otro método se corta aquí arriba.
    //
    // El reparto era "GET lee, POST escribe" y ya no es cierto del todo. Lo
    // que la web puede escribir sigue siendo lo del §8.1 —el buzón del Plan y
    // el cronómetro, y nada más—, pero el cronómetro entra por las dos
    // puertas: sus POST (start/beat/stop) y también el GET de /api/timer, que
    // cierra las sesiones abandonadas mientras contesta (§7.4, ver
    // queries/timer.ts). Es la única excepción, y está tratada como escritura
    // donde importa: en la guarda CSRF de aquí abajo.
    if (request.method !== 'GET' && request.method !== 'POST') {
      return fail('not_found', 'método no permitido', 405);
    }

    // CSRF. access.ts acepta la cookie CF_Authorization, así que sin esto una
    // página cualquiera que visites estando dentro de Access podría mandar una
    // petición con tu cookie ambiente y encolar órdenes que tu escritorio
    // EJECUTA después. Un formulario HTML cross-site puede hacerlo sin
    // preflight.
    //
    // La defensa es barata porque el Worker sirve la PWA y la API desde el
    // MISMO origen (ver wrangler.jsonc): cualquier petición legítima viene de
    // 'same-origin'.
    //
    // Cubre los POST y el GET de /api/timer, que también escribe. Pero no con
    // la misma vara, y la asimetría es deliberada:
    //
    //   - POST: falla CERRADO. Sin Sec-Fetch-Site se mira el Origin, y si no
    //     hay ninguno de los dos, fuera. Una orden del buzón acaba
    //     ejecutándose en el PC: ahí no se conceden dudas.
    //   - el GET que escribe: se rechaza solo lo que se SABE cruzado. Los
    //     navegadores no mandan Origin en un GET, así que exigir una de las
    //     dos cabeceras dejaría sin cronómetro a cualquiera sin Sec-Fetch-Site
    //     (iOS Safari anterior a 16.4), y esto es una PWA de móvil. El techo
    //     del daño es cerrar una sesión que la regla de frescura iba a cerrar
    //     igual en cuanto alguien mirara.
    const writingGet = request.method === 'GET' && url.pathname === '/api/timer';
    if (request.method === 'POST' || writingGet) {
      const site = request.headers.get('sec-fetch-site');
      const origin = request.headers.get('origin');
      const sameOrigin = site === 'same-origin' || (site === null && origin === url.origin);
      const unknown = site === null && origin === null;
      if (!sameOrigin && !(unknown && writingGet)) {
        console.warn(
          `[csrf] ${request.method} ${url.pathname} rechazado (sec-fetch-site=${site}, origin=${origin})`,
        );
        return fail('forbidden', 'petición cruzada rechazada', 403);
      }
    }

    const now = Date.now();

    // ── 1. Quién eres (§5.2 regla 4) ──────────────────────────────────────
    let email: string;
    try {
      ({ email } = await authenticate(request, env, now));
    } catch (error) {
      if (error instanceof AccessError) {
        return fail('unauthenticated', error.message, 401);
      }
      console.error('[access] fallo inesperado verificando el token:', error);
      return fail('internal', 'no se pudo verificar la identidad', 500);
    }

    // ── 2. Qué base te toca (§5.2 regla 2: fallar cerrado) ────────────────
    const tenant = resolveTenant(env, email);
    if (!tenant) {
      // El email SÍ va al log: es la información que hace falta para arreglar
      // el mapa de inquilinos cuando alguien no entra. El token de esa base,
      // obviamente, no.
      console.warn(`[tenants] email sin base asignada: ${email}`);
      return fail('forbidden', 'esta cuenta no tiene una biblioteca asignada', 403);
    }

    // ── 3. Conexión POR PETICIÓN (§5.2 regla 1) ───────────────────────────
    // Nace aquí dentro y muere con la petición. Ver db.ts para el porqué.
    const db = openTenantDb(tenant);

    try {
      // ── Las escrituras de la API (§8.1: solo Plan y cronómetro) ─────────
      // Casi todas son del buzón, y el buzón no toca ninguna tabla real: deja
      // una orden que el escritorio drena al arrancar llamando al código de
      // verdad (§6.2). La excepción es el cronómetro, aquí abajo.
      if (request.method === 'POST') {
        // Descartar un fallo ya drenado. No es una orden para el escritorio:
        // solo borra el mensaje de error de una fila del propio buzón, que es
        // una tabla desechable y no una de las de verdad.
        if (url.pathname === '/api/plan/dismiss') {
          const id = readInt(url.searchParams.get('id'));
          if (id === undefined || !Number.isInteger(id) || id <= 0) {
            return fail('not_found', 'falta el id de la orden', 400);
          }
          const dismissed = await dismissFailure(db, id);
          return dismissed
            ? json({ dismissed: true, id })
            : fail('not_found', 'esa orden no existe o todavía no se ha drenado', 404);
        }

        // El CRONÓMETRO (§7) — lo único de toda la API que toca tablas
        // REALES, y son dos: `sessions` siempre, y `state_events` cuando el
        // playthrough no estaba activo y hay que dejarle su 'started' (§8.10).
        // No puede ir por buzón: una sesión en marcha tiene que existir ahora,
        // no cuando abras el PC.
        if (url.pathname.startsWith('/api/timer/')) {
          const action = url.pathname.slice('/api/timer/'.length);
          try {
            if (action === 'start') {
              const gameId = readInt(url.searchParams.get('gameId'));
              if (gameId === undefined || !Number.isInteger(gameId) || gameId <= 0) {
                return fail('not_found', 'falta el juego', 400);
              }
              return json(await startTimer(db, gameId, now), 201);
            }

            const sessionId = readInt(url.searchParams.get('sessionId'));
            if (sessionId === undefined || !Number.isInteger(sessionId) || sessionId <= 0) {
              return fail('not_found', 'falta la sesión', 400);
            }

            if (action === 'beat') {
              // Un latido sobre una sesión que ya no existe o ya se cerró no
              // es un error del que avisar a gritos: la pestaña se enterará al
              // refrescar. Se contesta con el estado y punto.
              return json({ alive: await beatTimer(db, sessionId, now) });
            }
            if (action === 'stop') {
              return json(await stopTimer(db, sessionId, now));
            }
            return fail('not_found', 'ruta desconocida', 404);
          } catch (error) {
            // Los choques del cronómetro (ya hay una sesión abierta, el
            // playthrough está cerrado, no hay ninguno) son cosas que el
            // usuario puede entender y resolver — 409, con su frase, no un 500.
            if (error instanceof TimerError) return fail('forbidden', error.message, 409);
            throw error;
          }
        }

        if (url.pathname !== '/api/plan/enqueue') {
          return fail('not_found', 'esta ruta no acepta escrituras', 405);
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return fail('not_found', 'el cuerpo no es JSON válido', 400);
        }

        const entry = parseEntry(body);
        // Lo que llega del navegador va a acabar EJECUTÁNDOSE en la máquina
        // del escritorio. Un payload torcido que pase de aquí no falla donde
        // se ve, falla dentro del drenado días después.
        if (!entry) return fail('not_found', 'la orden no tiene una forma válida', 400);

        // Un duplicado revienta contra el UNIQUE al drenarse, o sea en otra
        // máquina y sin nadie delante. Se comprueba aquí para que el "ya lo
        // tienes" salga en la misma pulsación.
        //
        // Y se mira TAMBIÉN el buzón pendiente, no solo `games`: un juego
        // encolado todavía no es un juego, así que mirando solo la tabla se
        // podía encolar el mismo dos veces antes de drenar — que es
        // exactamente el bug que esta guarda venía a cerrar.
        if (entry.type === 'add') {
          const source = entry.source;
          const [owned, queued] = await Promise.all([
            findOwned(
              db,
              'igdbId' in source
                ? { igdbIds: [source.igdbId] }
                : { steamAppIds: [source.steamAppId] },
            ),
            pendingAddKeys(db),
          ]);
          const where =
            'igdbId' in source
              ? owned.byIgdbId.get(source.igdbId)
              : owned.bySteamAppId.get(source.steamAppId);
          const alreadyQueued =
            'igdbId' in source
              ? queued.igdbIds.has(source.igdbId)
              : queued.steamAppIds.has(source.steamAppId);

          if (where || alreadyQueued) {
            return fail(
              'not_found',
              alreadyQueued
                ? 'ya está en la cola, esperando a tu PC'
                : where === 'plan'
                  ? 'ya está en tu plan'
                  : 'ya está en tu biblioteca',
              409,
            );
          }
        }

        const { id } = await enqueue(db, entry, email);
        return json({ queued: true, id, entry }, 202);
      }

      if (url.pathname === '/api/health') {
        return json({ ok: true, database: dbLabel(tenant.url), at: now });
      }

      // Lo que el escritorio todavía no ha aplicado, para que la PWA lo pinte
      // encima de lo que lee (§6.3) — y lo que falló, que si no desaparece en
      // silencio.
      if (url.pathname === '/api/plan/pending') {
        const [pending, failures] = await Promise.all([listPending(db), listRecentFailures(db)]);
        return json({ pending, failures });
      }

      if (url.pathname === '/api/search') {
        const q = url.searchParams.get('q') ?? '';
        // La búsqueda la hace el WORKER contra IGDB con las claves DE ESTE
        // inquilino, nunca el navegador (§6.4). Sin ellas se busca solo en
        // Steam: peor catálogo, pero sigue pudiéndose dar de alta.
        //
        // Y si IGDB se cae, tampoco se cae la búsqueda. igdb.ts LANZA ante un
        // no-ok mientras steam.ts se lo traga, así que un 429 de IGDB salía
        // por el catch de abajo como 502 "no se pudo leer la base de datos" —
        // un error de base de datos para una caída de catálogo, y sin llegar
        // nunca al respaldo que habría resuelto la búsqueda igual.
        let fromIgdb: Awaited<ReturnType<typeof searchGames>> = [];
        if (tenant.igdb) {
          try {
            fromIgdb = await searchGames(tenant.igdb, q, now);
          } catch (error) {
            console.warn('[igdb] búsqueda fallida, tiro del respaldo de Steam:', error);
          }
        }

        // La tienda de Steam SOLO como respaldo, igual que el escritorio: si
        // IGDB ya encontró algo, preguntarle a Steam es gastar una llamada
        // para mezclar dos catálogos que nombran los juegos distinto. Cuando
        // IGDB no sabe nada —juegos anunciados que aún no ha catalogado— es la
        // única forma de darlos de alta.
        const fromSteam = fromIgdb.length === 0 ? await searchSteamStore(q) : [];

        const owned = await findOwned(db, {
          igdbIds: fromIgdb.map((result) => result.igdbId),
          steamAppIds: fromSteam.map((result) => result.steamAppId),
        });
        // Lo encolado cuenta como "ya lo tienes": todavía no es un juego, pero
        // volver a añadirlo reventaría contra el UNIQUE al drenarse.
        const queued = await pendingAddKeys(db);

        return json([
          ...fromIgdb.map((result) => ({
            source: { igdbId: result.igdbId },
            title: result.title,
            coverUrl: result.coverUrl,
            releaseYear: result.releaseYear,
            owned:
              owned.byIgdbId.get(result.igdbId) ??
              (queued.igdbIds.has(result.igdbId) ? ('queued' as const) : null),
          })),
          ...fromSteam.map((result) => ({
            source: { steamAppId: result.steamAppId },
            title: result.title,
            coverUrl: result.coverUrl,
            releaseYear: null,
            owned:
              owned.bySteamAppId.get(result.steamAppId) ??
              (queued.steamAppIds.has(result.steamAppId) ? ('queued' as const) : null),
          })),
        ]);
      }

      if (url.pathname === '/api/library') {
        return json(await listLibrary(db, readTimeZone(request)));
      }

      if (url.pathname === '/api/plan') {
        return json(await listPlanned(db));
      }

      // El cronómetro en marcha, si lo hay. Lo consulta la portada al abrir
      // para poder retomar el contador aunque cierres y vuelvas a abrir la
      // pestaña — el tiempo se cuenta contra `startedAt`, no desde que miras.
      //
      // Y de paso ESCRIBE: cierra los cronómetros que llevan horas sin latir
      // (§7.4). Con el PC apagado no hay nadie más que pueda hacerlo, y este
      // es justo el momento en que la respuesta importa. Recibe el `now` de la
      // petición para decidir la frescura con el mismo reloj que todo lo
      // demás, en vez de con un Date.now() suyo.
      if (url.pathname === '/api/timer') {
        return json(await getActiveTimer(db, now));
      }

      if (url.pathname === '/api/stats/summary') {
        return json(await getStatsSummary(db, readTimeZone(request)));
      }

      if (url.pathname === '/api/sessions') {
        return json(
          await listSessions(db, {
            limit: readInt(url.searchParams.get('limit')),
            offset: readInt(url.searchParams.get('offset')),
            gameId: readInt(url.searchParams.get('gameId')),
          }),
        );
      }

      // /api/games/:id y sus sub-recursos. Van APARTE de la ficha y no
      // embebidos en ella a propósito: logros y saga son listas largas (un
      // juego puede tener 200 logros) y la saga además sale de IGDB, o sea que
      // depende de una red ajena. Metidos dentro de /api/games/:id harían que
      // la ficha entera tardara lo que tarde lo más lento, o fallara con ello.
      const gameMatch = url.pathname.match(/^\/api\/games\/(\d+)(?:\/(\w+))?$/);
      if (gameMatch) {
        const gameId = Number(gameMatch[1]);
        const sub = gameMatch[2];

        if (sub === undefined) {
          const detail = await getGameDetail(db, gameId);
          return detail ? json(detail) : fail('not_found', 'ese juego no existe', 404);
        }
        if (sub === 'achievements') return json(await getGameAchievements(db, gameId));
        if (sub === 'curiosities') return json(await getCuriosities(db, gameId));
        if (sub === 'saga') return json(await getSaga(db, tenant.igdb, gameId, now));
        if (sub === 'media') {
          const [row] = await db
            .select({ igdbId: gamesTable.igdbId })
            .from(gamesTable)
            .where(eq(gamesTable.id, gameId))
            .limit(1);
          // Sin id de IGDB no hay capturas ni tráiler que pedir (un juego que
          // existe en Steam y que IGDB todavía no tiene), y sin claves de IGDB
          // para este inquilino tampoco. Vacío, no error: la sección
          // simplemente no se pinta.
          if (!row?.igdbId || !tenant.igdb) return json({ screenshots: [], videoId: null });
          return json(await getGameMedia(tenant.igdb, row.igdbId, now));
        }
        return fail('not_found', 'ruta desconocida', 404);
      }

      return fail('not_found', 'ruta desconocida', 404);
    } catch (error) {
      // §5.4 — la base de este inquilino todavía no ha visto la migración
      // porque su ESCRITORIO no se ha actualizado. No se cura reintentando y
      // no es culpa de la web: se dice con todas las letras en vez de escupir
      // un error de SQL.
      if (isSchemaOutdated(error)) {
        console.warn(`[db] esquema desfasado en ${dbLabel(tenant.url)}:`, error);
        return fail(
          'schema_outdated',
          'Actualiza Afterplay en tu PC y ábrelo una vez: su base todavía no tiene las tablas que esta web necesita.',
          409,
        );
      }

      console.error(`[db] error consultando ${dbLabel(tenant.url)}:`, error);
      return fail('upstream_unavailable', 'no se pudo leer la base de datos', 502);
    }
  },
} satisfies ExportedHandler<Env>;
