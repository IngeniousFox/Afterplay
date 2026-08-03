import { useEffect, useMemo, useState } from 'react';
import type { GameListItem, SessionWithGame, StateEventSummary } from '../../../../shared/types';
import { useCuriosities } from '../../hooks/curiosities';
import { useGames } from '../../hooks/games';
import { useSessions } from '../../hooks/sessions';
import { useAmbientIdleMinutes } from '../../hooks/settings';
import { useSpendEvents } from '../../hooks/spend';
import { useStateEvents } from '../../hooks/stateEvents';
import { useIdle } from '../../hooks/useIdle';
import { usePageVisible } from '../../hooks/usePageVisible';
import { useImageSrc } from '../../hooks/useImageSrc';
import { useWindowVisible } from '../../hooks/useWindowVisible';
import { useAchievementsOverview } from '../../hooks/achievements';
import { ambientLines, type AmbientContext } from '../../lib/ambientLines';
import { GREEN } from '../../lib/colors';

// El modo ambiente: cuando dejas de tocar la app, la biblioteca se pone a
// desfilar sola.
//
// Por qué existe: todo lo demás en Afterplay son herramientas que USAS. Esto
// es lo contrario — es lo único que hace algo cuando tú no haces nada, y es
// lo que separa una app con presencia de una hoja de cálculo con carátulas.
//
// Las reglas que lo mantienen del lado de "bonito" y no de "molesto":
//   · Se va al primer movimiento del ratón o tecla, con un fundido corto.
//     Rápido porque has vuelto y quieres tu app, pero no instantáneo: cortar
//     en seco se sentía como apagar la tele de un botonazo.
//   · No aparece si hay un juego en marcha. Estás jugando, la app está de
//     fondo midiendo — taparla con un salvapantallas sería absurdo.
//   · No aparece si hay algo abierto encima (un modal, un diálogo): tener a
//     medias un formulario y que se te ponga esto delante sería agresivo.
//   · No aparece si nadie puede verlo: minimizada o en la bandeja. La app
//     sigue viva ahí (vigilando procesos, sin ventana), pero el contador de
//     inactividad solo mira ratón/teclado — sin ventana visible esos eventos
//     no llegan nunca, así que sin este freno contaba como inactivo igual y
//     te encontrabas el modo ambiente encendido en cuanto reabrías desde el
//     tray, aunque llevaras minutos trabajando en otra cosa.
//   · Solo usa imágenes YA cacheadas en disco (userData/covers y /heroes).
//     Cero red.
//
// Sobre la composición: un panel de cristal con la carátula nítida a un lado
// y el texto al otro, flotando sobre la propia app desenfocada.
//
// La regla que la sostiene es de resolución, no de gusto: las carátulas de
// IGDB vienen a 264x374, así que TODA imagen que se vea con detalle se pinta
// por DEBAJO de su tamaño nativo. La primera versión estiraba un hero de
// SteamGridDB a pantalla completa con zoom encima (hasta 2.1x) y se veía
// blanda y sucia. Lo que sí se amplía — el tinte de color del panel — va
// desenfocado hasta dejar de ser una imagen, y ahí la resolución da igual
// porque nadie ve el detalle de algo borroso.

const SLIDE_MS = 26_000;
// Menos que los 264px nativos de una carátula de IGDB: pintarla por debajo
// de su tamaño real es lo que la mantiene afilada. Subir de ahí es
// exactamente el error que tenía la versión anterior.
const COVER_WIDTH = 236;

// Barajado determinista a partir de una semilla: los juegos salen en orden
// distinto cada vez que entra el modo, pero SIN Math.random durante el
// render (impuro para el compilador de React, y además haría que cada
// repintado reordenara la cola).
const shuffled = <T,>(items: T[], seed: number): T[] => {
  const copy = [...items];
  let state = seed || 1;
  for (let index = copy.length - 1; index > 0; index--) {
    // xorshift de 32 bits: barato, determinista y suficiente para barajar.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const target = Math.abs(state) % (index + 1);
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
};

// A nivel de módulo (y no dentro del componente) porque useIdle la mete en
// las dependencias de su efecto: una función nueva en cada render volvería a
// montar el temporizador sesenta veces por minuto.
//
// Se mira el DOM en vez de llevar la cuenta de modales abiertos por la app:
// los diálogos de Base UI solo montan su portal mientras están abiertos, así
// que preguntarle al DOM es la fuente de verdad y no hay ningún estado que
// mantener sincronizado.
const isDialogOpen = (): boolean =>
  document.querySelector('[role="dialog"], [data-slot="dialog-portal"]') !== null;

export const AmbientMode = (): React.JSX.Element | null => {
  const { data: games = [] } = useGames();
  // Sin respuesta todavía se asume el valor por defecto en vez de 0: con 0
  // el hook arrancaría apagado y se encendería un instante después, y ese
  // parpadeo de configuración no aporta nada.
  const { data: idleMinutes = 3 } = useAmbientIdleMinutes();

  // Sin carátula no hay diapositiva: es la pieza nítida que manda en la
  // composición Y de donde sale el color del panel. Sin ella quedaría texto
  // flotando en una tarjeta gris.
  const candidates = games.filter((game) => game.coverUrl !== null);
  const anyLive = games.some((game) => game.isLive);
  const windowVisible = useWindowVisible();
  // La señal de pintado de Chromium, además del canal del main: cubre la
  // ventana TOTALMENTE TAPADA por otras (oclusión nativa de Windows), que
  // para el main sigue siendo "visible" — y era la rendija por la que el
  // modo ambiente se encendía "estando la app de fondo". Parcialmente
  // visible detrás de otra ventana sí sigue entrando: esa es la presencia
  // buscada; a pantalla completamente invisible, no hay nadie que la vea.
  const pageVisible = usePageVisible();

  // 0 minutos = apagado en Ajustes: ni se monta el temporizador. Tampoco con
  // la ventana oculta — al volver a mostrarla el efecto de useIdle arranca
  // de cero (ver su comentario), así que no hace falta nada más para que no
  // aparezca "de sopetón" recién reabierta.
  const idle = useIdle(
    idleMinutes * 60,
    idleMinutes > 0 && !anyLive && candidates.length > 0 && windowVisible && pageVisible,
    isDialogOpen,
  );

  // Desmontar en cuanto `idle` baja cortaba el modo ambiente de golpe, como
  // si se apagara la tele. Aquí el desmontaje se RETRASA hasta que termina el
  // fundido de salida: `mounted` sigue a `idle` al entrar, pero al salir
  // espera al onTransitionEnd de la capa.
  //
  // Ajuste de estado DURANTE EL RENDER (el patrón de react.dev que ya usa el
  // resto de la app, p.ej. useSaveBackupActivity) y no dentro de un efecto:
  // hacerlo en un efecto pinta primero un fotograma con el estado viejo.
  const [wasIdle, setWasIdle] = useState(idle);
  const [mounted, setMounted] = useState(idle);
  if (wasIdle !== idle) {
    setWasIdle(idle);
    // Al entrar se monta ya; al salir NO se desmonta aquí — lo hará el
    // final de la transición.
    if (idle) setMounted(true);
  }

  // LA RED DE SEGURIDAD del desmontaje. transitionend solo llega si la
  // transición CORRE, y una ventana oculta no pinta: minimizar con el modo
  // ambiente puesto dejaba el overlay montado PARA SIEMPRE — invisible
  // (opacidad 0) pero con el pase de diapositivas girando de fondo,
  // quemando ciclos con la app en la bandeja. Reproducido con cronología:
  // idle→false estando oculta ⇒ mounted se quedaba en true tras restaurar.
  // El temporizador desmonta pase lo que pase, algo después del fundido de
  // salida (420ms); si transitionend llegó antes, el estado ya está en
  // false y este set es un no-op.
  useEffect(() => {
    if (idle || !mounted) return;
    const timer = setTimeout(() => setMounted(false), 600);
    return () => clearTimeout(timer);
  }, [idle, mounted]);

  if (!mounted || candidates.length === 0) return null;

  return (
    <div
      // La capa entera se atenúa: al entrar con calma (te has ido, no hay
      // prisa) y al salir rápido, porque has vuelto y quieres tu app. Pero
      // rápido no es instantáneo — 420ms bastan para que se sienta como que
      // se aparta, no como un corte.
      //
      // El fondo es TU PROPIA APP desenfocada, no una imagen: backdrop-filter
      // difumina lo que hay detrás de esta capa (la pantalla en la que estabas)
      // en vez de tapar con negro. Por eso el fondo va translúcido — con un
      // color opaco no habría nada que desenfocar. Un desenfoque suave, además:
      // se trata de que la app se aleje, no de esconderla.
      // El atributo lo lee tv/gamepad.ts: la pulsación de mando que despierta
      // este salvapantallas se consume y no llega al motor de foco.
      data-afterplay-ambient=""
      className="fixed inset-0 z-[60]"
      style={{
        background: 'rgba(8,9,8,.42)',
        backdropFilter: 'blur(15px) saturate(0.95) brightness(0.78)',
        opacity: idle ? 1 : 0,
        transition: `opacity ${idle ? 1100 : 420}ms ${idle ? 'ease-out' : 'cubic-bezier(.4,0,1,1)'}`,
        // Mientras el salvapantallas está puesto, el velo ABSORBE los clics:
        // el mousedown que lo despierta no puede pulsar a la vez el botón que
        // hubiera debajo (misma regla que el mando y el teclado — despertar
        // se consume). En cuanto empieza a disolverse vuelve a dejar pasar.
        pointerEvents: idle ? 'auto' : 'none',
      }}
      onTransitionEnd={() => {
        if (!idle) setMounted(false);
      }}
    >
      <AmbientShow games={candidates} />
    </div>
  );
};

const AmbientShow = ({ games }: { games: GameListItem[] }): React.JSX.Element => {
  const { data: sessions = [] } = useSessions();
  const { data: stateEvents = [] } = useStateEvents();
  const { data: spendEvents = [] } = useSpendEvents();
  const { data: curiosityRows = [] } = useCuriosities();
  // Para las frases de trofeos (LOGROS-IDEAS.md §2.7): el salón de la fama y
  // los 100% ya vienen calculados del main — aquí solo se consultan por juego.
  const { data: achievementsOverview } = useAchievementsOverview();

  // Se lee UNA vez, al montar: el orden de la cola no puede rebarajarse en
  // cada repintado.
  const [seed] = useState(() => Date.now() & 0x7fffffff);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setIndex((current) => current + 1), SLIDE_MS);
    return () => clearInterval(timer);
  }, []);

  // Los índices se construyen UNA vez para toda la sesión de modo ambiente,
  // no por diapositiva: con 300 juegos y miles de sesiones, recorrerlo todo
  // cada 26 segundos sería tirar trabajo a la basura.
  const indexes = useMemo(() => {
    const sessionsByGame = new Map<number, SessionWithGame[]>();
    for (const session of sessions) {
      const list = sessionsByGame.get(session.gameId) ?? [];
      list.push(session);
      sessionsByGame.set(session.gameId, list);
    }

    const eventsByGame = new Map<number, StateEventSummary[]>();
    for (const event of stateEvents) {
      const list = eventsByGame.get(event.gameId) ?? [];
      list.push(event);
      eventsByGame.set(event.gameId, list);
    }

    const spendByGame = new Map<number, number>();
    for (const event of spendEvents) {
      spendByGame.set(event.gameId, (spendByGame.get(event.gameId) ?? 0) + event.amount);
    }

    const curiositiesByGame = new Map<number, string[]>();
    for (const row of curiosityRows) {
      const list = curiositiesByGame.get(row.gameId) ?? [];
      list.push(row.text);
      curiositiesByGame.set(row.gameId, list);
    }

    // Ranking por horas: da el "tu juego más jugado" y el "#3 de tu
    // biblioteca". Solo cuentan los que tienen horas — un juego a cero no
    // ocupa puesto.
    const rankByGame = new Map<number, number>();
    games
      .filter((game) => game.totalHours > 0)
      .sort((a, b) => b.totalHours - a.totalHours)
      .forEach((game, position) => rankByGame.set(game.id, position + 1));

    const libraryHours = games.reduce((sum, game) => sum + game.totalHours, 0);

    // Los extremos de la biblioteca: el primero que añadiste y el último.
    // Cada frase la puede decir un solo juego, que es justo lo que las hace
    // especiales cuando salen.
    const byAdded = games.slice().sort((a, b) => a.addedAt.getTime() - b.addedAt.getTime());
    const oldestId = byAdded[0]?.id ?? null;
    const newestId = byAdded[byAdded.length - 1]?.id ?? null;
    const libraryStartYear = byAdded[0]?.addedAt.getFullYear() ?? null;

    // Su sitio entre los de su género: cuántos comparten género principal y
    // el ranking de horas dentro de esa familia ("your most played shooter").
    const genreCounts = new Map<string, number>();
    const gamesByGenre = new Map<string, GameListItem[]>();
    for (const game of games) {
      const genre = game.genres?.[0];
      if (!genre) continue;
      genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
      const list = gamesByGenre.get(genre) ?? [];
      list.push(game);
      gamesByGenre.set(genre, list);
    }
    const genreRankByGame = new Map<number, number>();
    for (const list of gamesByGenre.values()) {
      list
        .filter((game) => game.totalHours > 0)
        .sort((a, b) => b.totalHours - a.totalHours)
        .forEach((game, position) => genreRankByGame.set(game.id, position + 1));
    }

    // Juegos que llegaron el mismo día de calendario — pero solo en tandas
    // PEQUEÑAS (2-3): "llegó con X" es un recuerdo cuando fueron un par, y
    // puro ruido el día que importaste media biblioteca de golpe.
    const byAddedDay = new Map<string, GameListItem[]>();
    for (const game of games) {
      const key = game.addedAt.toDateString();
      const list = byAddedDay.get(key) ?? [];
      list.push(game);
      byAddedDay.set(key, list);
    }
    const addedSameDayByGame = new Map<number, string>();
    for (const list of byAddedDay.values()) {
      if (list.length < 2 || list.length > 3) continue;
      for (const game of list) {
        const companion = list.find((other) => other.id !== game.id);
        if (companion) addedSameDayByGame.set(game.id, companion.title);
      }
    }

    // Compañeros de quinta (mismo año de lanzamiento) y el decano absoluto.
    const releaseYearCounts = new Map<number, number>();
    let oldestReleaseId: number | null = null;
    let oldestReleaseYear = Infinity;
    for (const game of games) {
      if (game.releaseYear === null) continue;
      releaseYearCounts.set(game.releaseYear, (releaseYearCounts.get(game.releaseYear) ?? 0) + 1);
      if (game.releaseYear < oldestReleaseYear) {
        oldestReleaseYear = game.releaseYear;
        oldestReleaseId = game.id;
      }
    }

    // El primer y el último 'completed' de toda la biblioteca — dos frases
    // exclusivas, como oldest/newest.
    let firstCompletionGameId: number | null = null;
    let latestCompletionGameId: number | null = null;
    let firstCompletionAt = Infinity;
    let latestCompletionAt = -Infinity;
    for (const event of stateEvents) {
      if (event.type !== 'completed') continue;
      const at = event.occurredAt.getTime();
      if (at < firstCompletionAt) {
        firstCompletionAt = at;
        firstCompletionGameId = event.gameId;
      }
      if (at > latestCompletionAt) {
        latestCompletionAt = at;
        latestCompletionGameId = event.gameId;
      }
    }

    // Cuántos juegos terminaste cada año, para el "uno de los 8 que acabaste
    // en 2024".
    const completedPerYear = new Map<number, number>();
    for (const event of stateEvents) {
      if (event.type !== 'completed') continue;
      const year = event.occurredAt.getFullYear();
      completedPerYear.set(year, (completedPerYear.get(year) ?? 0) + 1);
    }

    // Qué jugabas justo antes de estrenar cada juego. Se recorre la línea
    // temporal completa UNA vez y se anota, en lugar de buscarlo por juego.
    const chronological = sessions
      .filter((session) => !session.isManual)
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
    const previousTitleByGame = new Map<number, string>();
    const seen = new Set<number>();
    for (let position = 0; position < chronological.length; position++) {
      const session = chronological[position];
      if (seen.has(session.gameId)) continue;
      seen.add(session.gameId);
      // Hacia atrás hasta encontrar una sesión de OTRO juego: la anterior
      // suya propia no cuenta como "lo que estabas jugando antes".
      for (let back = position - 1; back >= 0; back--) {
        if (chronological[back].gameId !== session.gameId) {
          previousTitleByGame.set(session.gameId, chronological[back].gameTitle);
          break;
        }
      }
    }

    return {
      sessionsByGame,
      eventsByGame,
      spendByGame,
      curiositiesByGame,
      rankByGame,
      libraryHours,
      oldestId,
      newestId,
      completedPerYear,
      previousTitleByGame,
      libraryStartYear,
      genreCounts,
      genreRankByGame,
      addedSameDayByGame,
      releaseYearCounts,
      oldestReleaseId,
      firstCompletionGameId,
      latestCompletionGameId,
    };
  }, [games, sessions, stateEvents, spendEvents, curiosityRows]);

  const queue = shuffled(games, seed);
  const game = queue[index % queue.length];

  const gameEvents = indexes.eventsByGame.get(game.id) ?? [];
  // Los "otros" que acabaste ese mismo año: el total del año menos este.
  const completedYear = gameEvents
    .filter((event) => event.type === 'completed')
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0]
    ?.occurredAt.getFullYear();
  const completedSameYear =
    completedYear === undefined
      ? 0
      : Math.max(0, (indexes.completedPerYear.get(completedYear) ?? 1) - 1);

  const primaryGenre = game.genres?.[0];
  const context: AmbientContext = {
    sessions: indexes.sessionsByGame.get(game.id) ?? [],
    events: gameEvents,
    rank: indexes.rankByGame.get(game.id) ?? null,
    libraryHours: indexes.libraryHours,
    spend: indexes.spendByGame.get(game.id) ?? 0,
    libraryGames: games.length,
    isOldestInLibrary: indexes.oldestId === game.id,
    isNewestInLibrary: indexes.newestId === game.id,
    completedSameYear,
    playedJustBefore: indexes.previousTitleByGame.get(game.id) ?? null,
    genrePeers: primaryGenre ? (indexes.genreCounts.get(primaryGenre) ?? 0) : 0,
    genreRank: indexes.genreRankByGame.get(game.id) ?? null,
    addedSameDayTitle: indexes.addedSameDayByGame.get(game.id) ?? null,
    sameReleaseYearCount:
      game.releaseYear !== null ? (indexes.releaseYearCounts.get(game.releaseYear) ?? 0) : 0,
    isOldestRelease: indexes.oldestReleaseId === game.id,
    isFirstCompletion: indexes.firstCompletionGameId === game.id,
    isLatestCompletion: indexes.latestCompletionGameId === game.id,
    libraryStartYear: indexes.libraryStartYear,
    curiosities: indexes.curiositiesByGame.get(game.id) ?? [],
    achievements: (() => {
      if (!achievementsOverview) return null;
      const fameIndex = achievementsOverview.hallOfFame.findIndex(
        (entry) => entry.gameId === game.id,
      );
      const fame = fameIndex >= 0 ? achievementsOverview.hallOfFame[fameIndex] : null;
      const perfect =
        achievementsOverview.perfectGames.find((entry) => entry.gameId === game.id) ?? null;
      if (!fame && !perfect) return null;
      return {
        rarest: fame
          ? {
              name: fame.displayName,
              percent: fame.globalPercent,
              unlockedAt: fame.unlockedAt,
              fameRank: fameIndex + 1,
            }
          : null,
        isPerfect: perfect !== null,
        perfectTotal: perfect?.total ?? 0,
      };
    })(),
  };

  return (
    <AmbientSlide
      key={`${game.id}-${index}`}
      game={game}
      context={context}
      // Semilla propia de ESTA diapositiva para sortear la frase. Sin ella se
      // vería siempre la primera de la lista y un juego con quince cosas que
      // contar acabaría diciendo siempre la misma.
      lineSeed={seed + index * 7919}
    />
  );
};

const AmbientSlide = ({
  game,
  context,
  lineSeed,
}: {
  game: GameListItem;
  context: AmbientContext;
  lineSeed: number;
}): React.JSX.Element => {
  const coverSrc = useImageSrc(game.coverUrl, 'covers');
  // El reloj se lee al montar CADA diapositiva (cada una se remonta por su
  // key), no una vez al entrar en el modo: esto puede quedarse horas abierto
  // y las frases de aniversario dependen de la fecha de hoy.
  const [now] = useState(() => Date.now());
  const lines = ambientLines(game, context, now);
  // Si el juego no tiene nada que contar, no se inventa nada: se queda la
  // carátula y su título. Mejor silencio que "0 horas jugadas".
  const line = lines.length > 0 ? lines[Math.abs(lineSeed) % lines.length] : null;

  const slideVar = { ['--afterplay-slide-ms' as string]: `${SLIDE_MS + 4000}ms` };

  return (
    <div className="afterplay-ambient-slide absolute inset-0">
      {/* Sin hero de fondo: el fondo ahora es la propia app desenfocada por la
          capa de arriba (ver AmbientMode). Solo queda la viñeta, que apaga los
          bordes para que la carátula y el texto del centro no compitan con lo
          que se intuya detrás. */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 35%, rgba(8,9,8,.55))',
        }}
      />

      {/* Composición centrada: carátula a la izquierda, texto a la derecha,
          el conjunto enmarcado en un panel de cristal.
          Ahora que se ve la app de fondo (ver AmbientMode), el panel es lo
          que separa "esto es el contenido" de "eso es lo que había detrás" —
          sin él, texto y carátula competían con lo que se intuyera detrás. */}
      <div className="absolute inset-0 flex items-center justify-center px-24">
        <div
          className="relative overflow-hidden rounded-[34px]"
          style={{
            background: 'rgba(9,10,9,.5)',
            backdropFilter: 'blur(30px) saturate(1.15)',
            // Tres sombras, cada una con su trabajo: la línea clara de arriba
            // simula la luz que pega en el canto de un cristal, el contorno
            // interior dibuja el borde sin la dureza de un `border`, y la
            // grande de fuera despega el panel de la app.
            boxShadow: [
              'inset 0 1px 0 rgba(255,255,255,.18)',
              'inset 0 0 0 1px rgba(255,255,255,.07)',
              '0 44px 110px -24px rgba(0,0,0,.8)',
            ].join(', '),
          }}
        >
          {/* El color del panel SALE DE LA CARÁTULA: la misma imagen, ampliada
              y desenfocada hasta ser solo color, deriva despacio por detrás
              del contenido. Cada juego tiñe su propia tarjeta — es lo que
              hace que no sean 300 diapositivas iguales con distinta foto.
              Reaprovecha la animación del hero, que quedó libre al quitarlo. */}
          {coverSrc && (
            <img
              src={coverSrc}
              alt=""
              aria-hidden
              className="afterplay-ambient-backdrop absolute inset-0 h-full w-full object-cover"
              style={{ ...slideVar, filter: 'blur(70px) saturate(1.9)', opacity: 0.55 }}
            />
          )}

          {/* Encima del tinte: un velo en diagonal que devuelve el contraste
              al texto, y un brillo suave en la esquina superior para que el
              cristal tenga dirección de luz en vez de estar plano. */}
          <div
            className="absolute inset-0"
            style={{
              background: [
                'linear-gradient(160deg, rgba(255,255,255,.10), transparent 38%)',
                'linear-gradient(115deg, rgba(6,7,6,.58), rgba(6,7,6,.22) 45%, rgba(6,7,6,.62))',
              ].join(', '),
            }}
          />

          <div className="relative flex items-center gap-14 px-16 py-12">
            {coverSrc && (
              <div
                className="afterplay-ambient-cover relative flex-none"
                style={{ ...slideVar, width: COVER_WIDTH }}
              >
                {/* Copia desenfocada justo detrás: la carátula parece emitir
                    su propia luz sobre el panel en vez de estar pegada. */}
                <img
                  src={coverSrc}
                  alt=""
                  aria-hidden
                  className="absolute inset-0 w-full rounded-[16px]"
                  style={{
                    filter: 'blur(26px) saturate(1.7)',
                    opacity: 0.65,
                    transform: 'translateY(14px) scale(1.03)',
                  }}
                />
                <img
                  src={coverSrc}
                  alt=""
                  className="relative w-full rounded-[16px]"
                  style={{
                    boxShadow: [
                      'inset 0 0 0 1px rgba(255,255,255,.14)',
                      '0 28px 60px -12px rgba(0,0,0,.8)',
                    ].join(', '),
                  }}
                />
              </div>
            )}

            {/* Ancho FIJO, no `max-w`: con ancho máximo el panel se encogía
                al contenido y un juego de título corto salía casi cuadrado
                mientras el de al lado salía apaisado — el desfile parecía
                descuadrado. Reservando siempre el mismo hueco, todas las
                diapositivas tienen el mismo tamaño aunque sobre sitio a la
                derecha. La ALTURA ya era constante de por sí: la marca la
                carátula, que siempre mide igual.
                `min-w-0` + encogible para que en una ventana estrecha ceda en
                vez de desbordar. */}
            <div className="w-[42rem] min-w-0">
              <div className="afterplay-ambient-text" style={{ animationDelay: '600ms' }}>
                {game.isLive && (
                  <div className="mb-3.5 flex items-center gap-2">
                    <span
                      className="afterplay-ambient-halo h-2 w-2 rounded-full"
                      style={{ background: GREEN, boxShadow: `0 0 14px ${GREEN}` }}
                    />
                    <span
                      className="text-[11px] font-extrabold tracking-[.16em]"
                      style={{ color: GREEN }}
                    >
                      PLAYING RIGHT NOW
                    </span>
                  </div>
                )}

                {/* El título se apaga de arriba a abajo: el ojo entra por la
                    primera línea y no por un bloque de blanco macizo. */}
                <h2
                  // leading-[1.06] cortaba la cola de las minúsculas con
                  // descendente (g, y, p): el degradado de texto pinta el
                  // glifo entero pero la CAJA de línea era más baja que la
                  // letra. 1.2 le da aire de sobra sin que se note más
                  // separado.
                  className="text-[46px] leading-[1.2] font-extrabold tracking-[-.02em] drop-shadow-[0_2px_20px_rgba(0,0,0,.6)]"
                  style={{
                    backgroundImage: 'linear-gradient(180deg, #ffffff 25%, rgba(255,255,255,.72))',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  {game.title}
                </h2>
              </div>

              {line && (
                <div className="afterplay-ambient-text mt-6" style={{ animationDelay: '1400ms' }}>
                  {/* Filete corto en el verde de la app: separa el dato del
                      título y ata la diapositiva al resto de Afterplay. */}
                  <div
                    className="mb-4 h-px w-16"
                    style={{ background: `linear-gradient(90deg, ${GREEN}, transparent)` }}
                  />
                  <p className="text-[17.5px] leading-relaxed font-medium text-white/72">{line}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
