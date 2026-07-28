import { useEffect, useMemo, useState } from 'react';
import type { GameListItem, SessionWithGame, StateEventSummary } from '../../../../shared/types';
import { useGames } from '../../hooks/games';
import { useSessions } from '../../hooks/sessions';
import { useSpendEvents } from '../../hooks/spend';
import { useStateEvents } from '../../hooks/stateEvents';
import { useIdle } from '../../hooks/useIdle';
import { useImageSrc } from '../../hooks/useImageSrc';
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
//   · Solo usa imágenes YA cacheadas en disco (userData/covers y /heroes).
//     Cero red.
//
// Sobre la composición (hero desenfocado de fondo + carátula nítida delante):
// no es solo estética, resuelve un problema de resolución real. Las carátulas
// de IGDB vienen a 264x374 y los heroes de SteamGridDB a 1920x620. La primera
// versión estiraba el hero a pantalla completa con zoom encima, lo que lo
// escalaba hasta 2.1x y se veía blando y sucio. Con el fondo desenfocado esa
// resolución deja de importar (nadie ve el detalle de algo borroso) y la
// carátula se pinta por DEBAJO de su tamaño nativo, donde sí es nítida.

const IDLE_SECONDS = 180;
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

  // El filtro es por CARÁTULA, no por hero: la carátula es la pieza nítida
  // que manda en la composición y sin ella la diapositiva es texto flotando.
  // El hero solo pone el color de fondo, y si falta se queda el fondo oscuro
  // — que sigue funcionando.
  const candidates = games.filter((game) => game.coverUrl !== null);
  const anyLive = games.some((game) => game.isLive);

  const idle = useIdle(IDLE_SECONDS, !anyLive && candidates.length > 0, isDialogOpen);

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

  if (!mounted || candidates.length === 0) return null;

  return (
    <div
      // La capa entera se atenúa: al entrar con calma (te has ido, no hay
      // prisa) y al salir rápido, porque has vuelto y quieres tu app. Pero
      // rápido no es instantáneo — 420ms bastan para que se sienta como que
      // se aparta, no como un corte.
      className="fixed inset-0 z-[60] bg-[#080908]"
      style={{
        opacity: idle ? 1 : 0,
        transition: `opacity ${idle ? 1100 : 420}ms ${idle ? 'ease-out' : 'cubic-bezier(.4,0,1,1)'}`,
        pointerEvents: 'none',
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
      rankByGame,
      libraryHours,
      oldestId,
      newestId,
      completedPerYear,
      previousTitleByGame,
    };
  }, [games, sessions, stateEvents, spendEvents]);

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
  const heroSrc = useImageSrc(game.heroUrl, 'heroes');
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
      {/* Fondo: el hero DESENFOCADO a lo bestia. A 64px de blur su resolución
          real es irrelevante — solo aporta el color y el ambiente del juego,
          que es justo lo que se le pide. */}
      {heroSrc && (
        <img
          src={heroSrc}
          alt=""
          className="afterplay-ambient-backdrop absolute inset-0 h-full w-full object-cover"
          style={{ ...slideVar, filter: 'blur(64px) saturate(1.25) brightness(0.62)' }}
        />
      )}
      {/* Velo plano por encima del desenfoque: sin esto, un hero muy claro
          deja el texto blanco ilegible. */}
      <div className="absolute inset-0 bg-[#080908]/45" />
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 30%, rgba(8,9,8,.82))',
        }}
      />

      {/* Composición centrada: carátula a la izquierda, texto a la derecha,
          el conjunto centrado en la pantalla. */}
      <div className="absolute inset-0 flex items-center justify-center gap-14 px-24">
        {coverSrc && (
          <div
            className="afterplay-ambient-cover flex-none"
            style={{ ...slideVar, width: COVER_WIDTH }}
          >
            <img
              src={coverSrc}
              alt=""
              className="w-full rounded-[14px] border border-white/10 shadow-[0_30px_70px_rgba(0,0,0,.75)]"
            />
          </div>
        )}

        <div className="min-w-0 max-w-2xl">
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

            <h2 className="text-[46px] leading-[1.06] font-extrabold tracking-[-.02em] text-white drop-shadow-[0_2px_24px_rgba(0,0,0,.85)]">
              {game.title}
            </h2>
          </div>

          {line && (
            <p
              className="afterplay-ambient-text mt-4 text-[17px] leading-relaxed font-medium text-white/55"
              style={{ animationDelay: '1400ms' }}
            >
              {line}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
