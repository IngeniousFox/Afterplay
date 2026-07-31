import { CalendarRange, Clock3, Gamepad2, Play } from 'lucide-react';
import { useState } from 'react';
import type { GameListItem } from '../../../../shared/types';
import { useImageSrc } from '../../hooks/useImageSrc';
import { useLiveTimer } from '../../hooks/useLiveTimer';
import { DAY_MS, humanizeSpan, startOfDayMs } from '../../lib/dateMath';
import { formatElapsed, formatHours } from '../../lib/format';
import { getGameStatusMeta } from '../../lib/gameStatus';
import { StatusIcon } from '../StatusIcon';
import { BLUE, GREEN, TEAL } from '../../lib/colors';

type GameCardProps = {
  game: GameListItem;
  onSelect: () => void;
};

// Máximo de chips de género en la trasera + un "+N" con el resto: pintarlos
// todos desbordaría la card con juegos de 4-5 géneros (el espacio es el que
// es, formato 3/4).
const MAX_GENRES = 2;

// "Last played 3 weeks ago" — el lazo con el juego dicho en humano, no una
// fecha que obliga a restar de cabeza.
//
// Días de CALENDARIO (medianoche local), no tramos de 24 h: una sesión de
// ayer a las 20:00 es "yesterday" aunque no hayan pasado 24 horas — que es
// como lo cuenta cualquiera, y la misma regla que ya usan los cubos de la
// pantalla de Sessions. Medir horas transcurridas hacía decir "today" a lo
// jugado ayer por la noche.
const lastPlayedLabel = (lastPlayedAt: Date): string => {
  const days = Math.round((startOfDayMs(new Date()) - startOfDayMs(lastPlayedAt)) / DAY_MS);
  if (days <= 0) return 'Last played today';
  if (days === 1) return 'Last played yesterday';
  return `Last played ${humanizeSpan(days)} ago`;
};

// Cara trasera de la card (se ve al voltearla): la ficha del juego SOBRE su
// arte a sangre completa — el mismo lenguaje de "arte tras un velo" del toast
// de cierre y del panel del Journey. La versión anterior era un sándwich de
// franjas (cabecera sólida, tira de hero al 26%, cuerpo sólido) que troceaba
// la card en tres; ahora el hero llena la trasera entera, el título y el
// estado viven arriba, los datos flotan abajo, y el centro queda para que el
// arte respire.
//
// La legibilidad sobre arte impredecible la resuelve el velo (denso arriba y
// abajo, tenue en el centro), no la suerte. Y la cadena de respaldo es la del
// modo ambiente: sin hero, la CARÁTULA desenfocada de fondo — borrosa da
// igual su resolución y siempre trae la paleta del juego —; sin nada, lienzo.
const CardBack = ({
  game,
  elapsedSeconds,
}: {
  game: GameListItem;
  elapsedSeconds: number;
}): React.JSX.Element => {
  const status = getGameStatusMeta(game.currentState);
  const heroSrc = useImageSrc(game.heroUrl, 'heroes');
  const coverSrc = useImageSrc(game.coverUrl, 'covers');

  const hltbPct =
    game.hltbMain !== null && game.hltbMain > 0 && game.totalHours > 0
      ? Math.min(100, (game.totalHours / game.hltbMain) * 100)
      : null;

  return (
    <div className="relative flex h-full flex-col">
      {/* ── El arte, a sangre completa ─────────────────────────────────── */}
      <div className="absolute inset-0">
        {heroSrc ? (
          <img src={heroSrc} alt="" className="h-full w-full object-cover brightness-[.66]" />
        ) : coverSrc ? (
          // scale-110: el blur difumina los bordes hacia fuera y sin margen
          // asomarían las esquinas transparentes de la propia imagen (mismo
          // truco que el fondo del modo ambiente).
          <img
            src={coverSrc}
            alt=""
            className="h-full w-full scale-110 object-cover blur-lg brightness-[.5]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[#151716]">
            <Gamepad2 size={26} strokeWidth={1.5} className="text-muted-foreground/25" />
          </div>
        )}
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(13,15,14,.82) 0%, rgba(13,15,14,.42) 26%, rgba(13,15,14,.30) 48%, rgba(13,15,14,.88) 78%, rgba(13,15,14,.96) 100%)',
          }}
        />
      </div>

      {/* ── Cabecera: quién es y cómo estás con él ─────────────────────── */}
      <div className="relative flex-none px-3 pt-2.5">
        <div className="flex items-start justify-between gap-2">
          <span className="line-clamp-2 text-[13.5px] leading-tight font-extrabold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,.75)]">
            {game.title}
          </span>
          {game.releaseYear !== null && (
            <span className="flex-none pt-0.25 text-[10.5px] font-semibold text-white/55 tabular-nums">
              {game.releaseYear}
            </span>
          )}
        </div>
        <div className="mt-1.25 flex items-center gap-1.5">
          <StatusIcon meta={status} size={13} />
          <span
            className="truncate text-[11.5px] font-bold drop-shadow-[0_1px_2px_rgba(0,0,0,.8)]"
            style={{ color: status.color }}
          >
            {status.label}
          </span>
          {game.isLive && (
            <span className="ml-auto flex-none text-[11px] font-bold text-primary tabular-nums drop-shadow-[0_1px_2px_rgba(0,0,0,.8)]">
              {formatElapsed(elapsedSeconds)}
            </span>
          )}
        </div>
        {/* El recuerdo, no el dato: cuándo fue la última vez. En vivo sobra
            — el contador de arriba ya dice que es AHORA. */}
        {!game.isLive && game.lastPlayedAt !== null && (
          <div className="mt-1 text-[10.5px] leading-4 font-bold text-white/75">
            {lastPlayedLabel(game.lastPlayedAt)}
          </div>
        )}
      </div>

      {/* El centro queda libre a propósito: es donde el arte se luce. */}
      <div className="min-h-0 flex-1" />

      {/* ── Los datos, flotando al pie ─────────────────────────────────── */}
      <div className="relative flex flex-none flex-col gap-2 px-3 pb-3">
        {game.totalHours > 0 ? (
          // leading-4 (16px) + iconos de 12: el centrado vertical da 2px
          // EXACTOS. Con el line-height heredado (19,5px) e iconos de 12,5
          // caía en medio píxel — invisible mientras el giro 3D mantiene la
          // cara rasterizada como textura, pero al terminar la animación el
          // navegador vuelve a pintar normal, redondea al píxel entero y el
          // icono daba un saltito hacia abajo.
          <div className="flex items-center gap-3">
            {/* Sin drop-shadow aquí a propósito: cada filtro es un nodo de
                efecto que Chromium puede re-ajustar por su cuenta al acabar
                el giro, y el velo del pie ya es casi opaco — la sombra no
                aportaba contraste, solo otro sitio donde saltar. */}
            <span className="flex items-center gap-1.5 text-[13px] leading-4 font-extrabold text-white tabular-nums">
              <Clock3 size={12} style={{ color: GREEN }} />
              {formatHours(game.totalHours)}
            </span>
            {game.sessionCount > 0 && (
              <span className="flex items-center gap-1.5 text-[12px] leading-4 font-bold text-white/80 tabular-nums">
                <CalendarRange size={12} style={{ color: BLUE }} />
                {game.sessionCount} {game.sessionCount === 1 ? 'session' : 'sessions'}
              </span>
            )}
          </div>
        ) : (
          // Un juego sin tocar no enseña cifras a cero — lo dice con palabras.
          <div className="text-[11.5px] font-semibold text-white/60 drop-shadow-[0_1px_2px_rgba(0,0,0,.8)]">
            Not played yet.
          </div>
        )}

        {hltbPct !== null && (
          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <span
                className="text-[9px] font-bold tracking-[.11em] drop-shadow-[0_1px_2px_rgba(0,0,0,.8)]"
                style={{ color: `${TEAL}d8` }}
              >
                MAIN STORY
              </span>
              <span className="text-[10.5px] font-semibold text-white/60 tabular-nums drop-shadow-[0_1px_2px_rgba(0,0,0,.8)]">
                {formatHours(game.hltbMain ?? 0)}
              </span>
            </div>
            <div className="h-1.25 overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${hltbPct}%`,
                  background: `linear-gradient(90deg, ${TEAL}, ${TEAL}99)`,
                  boxShadow: `0 0 6px ${TEAL}66`,
                }}
              />
            </div>
          </div>
        )}

        {game.genres && game.genres.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {game.genres.slice(0, MAX_GENRES).map((genre) => (
              <span
                key={genre}
                className="rounded-md border border-white/12 bg-black/35 px-1.75 py-0.5 text-[10px] font-semibold text-white/75"
              >
                {genre}
              </span>
            ))}
            {game.genres.length > MAX_GENRES && (
              <span className="self-center text-[10px] font-semibold text-white/45 tabular-nums drop-shadow-[0_1px_2px_rgba(0,0,0,.8)]">
                +{game.genres.length - MAX_GENRES}
              </span>
            )}
          </div>
        )}
      </div>

      {/* La firma de color del estado al pie — el mismo remate que las
          carátulas del Journey. */}
      <div className="absolute inset-x-0 bottom-0 h-0.75" style={{ background: status.color }} />
    </div>
  );
};

// SPEC 10.6/10.7 — carátula 3/4, borde 13px. Rediseño: la card se VOLTEA al
// pasar el ratón (flip 3D CSS puro: perspectiva en el padre, preserve-3d en
// el rotador, backface-visibility en las dos caras) y la trasera enseña la
// ficha del juego — título, estado, horas, HLTB, géneros. Por eso el frente
// es carátula limpia, sin texto encima: la info vive en la vuelta, y
// repetirla delante solo taparía el arte (además ya está en la columna de
// navegación). Lo de "en marcha" (badge LIVE, glow, contador) SÍ se queda en
// el frente — saber qué se está jugando no puede depender de un hover — y el
// contador reaparece en la trasera para no perderlo al voltear.
export const GameCard = ({ game, onSelect }: GameCardProps): React.JSX.Element => {
  const coverSrc = useImageSrc(game.coverUrl, 'covers');
  const elapsedSeconds = useLiveTimer(game.isLive ? game.liveSince : null);
  const [flipped, setFlipped] = useState(false);
  // La trasera se monta en el PRIMER hover y se queda montada: montada desde
  // el principio dispararía la carga del hero (imagen 1080p) de todos los
  // juegos del grid a la vez; desmontarla al salir dejaría la animación de
  // vuelta enseñando un hueco vacío durante su primera mitad (la card aún da
  // la espalda cuando el ratón ya se fue).
  const [everFlipped, setEverFlipped] = useState(false);

  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => {
        setFlipped(true);
        setEverFlipped(true);
      }}
      onMouseLeave={() => setFlipped(false)}
      className="group relative cursor-pointer [perspective:1100px]"
    >
      {/* will-change SOLO tras el primer volteo: al terminar el giro, sin él,
          Chromium re-rasteriza las caras y las ajusta al píxel entero — y como
          la altura de la card es fraccionaria (aspect-3/4 de una columna de
          grid), los iconos de la trasera daban un saltito de medio píxel al
          aterrizar. Con la capa fijada, lo que se ve durante el giro y al
          posarse es la MISMA rasterización. Las cards nunca volteadas no
          pagan la memoria de la capa. */}
      <div
        className="relative aspect-3/4 transition-transform duration-700 ease-[cubic-bezier(.35,.9,.3,1)] [transform-style:preserve-3d]"
        style={{
          transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
          willChange: everFlipped ? 'transform' : undefined,
        }}
      >
        {/* Cara frontal — la carátula. */}
        <div className="absolute inset-0 overflow-hidden rounded-[13px] border border-border bg-card [backface-visibility:hidden]">
          {coverSrc ? (
            <img
              src={coverSrc}
              loading="lazy"
              alt={game.title}
              className="block h-full w-full object-cover brightness-90"
            />
          ) : (
            // Sin carátula, el título en texto — es lo único que identifica
            // al juego cuando no hay arte que enseñar.
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-muted px-3 text-center">
              <Gamepad2 size={40} strokeWidth={1.5} className="text-muted-foreground/40" />
              <span className="line-clamp-3 text-[12px] font-semibold text-muted-foreground">
                {game.title}
              </span>
            </div>
          )}

          {game.isLive && (
            <>
              <div
                className="absolute inset-0 rounded-[13px]"
                style={{ animation: 'afterplay-glow-card 2.6s ease-in-out infinite' }}
              />
              <div
                className="absolute top-2.75 right-2.75 flex items-center gap-1.25 rounded-[7px] border px-2 py-0.75"
                style={{
                  background: 'rgba(8,20,13,.78)',
                  borderColor: 'rgba(47,220,126,.55)',
                  animation: 'afterplay-pulse-badge 2.4s infinite',
                }}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full bg-primary"
                  style={{ animation: 'afterplay-pulse-dot 1.4s infinite' }}
                />
                <span className="text-[9.5px] font-extrabold tracking-widest text-primary">
                  LIVE
                </span>
              </div>
              <div
                className="absolute top-1/2 left-1/2 flex h-13.5 w-13.5 items-center justify-center rounded-full border-[1.5px] shadow-[0_6px_22px_rgba(0,0,0,0.4)]"
                style={{
                  transform: 'translate(-50%, -50%)',
                  background: 'rgba(8,12,10,.68)',
                  borderColor: 'rgba(47,220,126,.7)',
                }}
              >
                <Play size={20} color="#2fdc7e" fill="#2fdc7e" />
              </div>
              <div
                className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-lg border border-border px-2.5 py-0.75 text-[12.5px] font-bold tracking-[.02em] text-primary tabular-nums"
                style={{ background: 'rgba(8,12,10,.78)' }}
              >
                {formatElapsed(elapsedSeconds)}
              </div>
            </>
          )}
        </div>

        {/* Cara trasera — la ficha. Pre-rotada 180º: al girar el rotador
            queda mirando al frente. Mismo tamaño que la card, sin crecido. */}
        {everFlipped && (
          <div className="absolute inset-0 overflow-hidden rounded-[13px] border border-white/14 bg-[#151716] [backface-visibility:hidden] [transform:rotateY(180deg)]">
            <CardBack game={game} elapsedSeconds={elapsedSeconds} />
          </div>
        )}
      </div>
    </div>
  );
};
