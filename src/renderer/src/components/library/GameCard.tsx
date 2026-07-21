import { Gamepad2, Play } from 'lucide-react';
import { useState } from 'react';
import type { GameListItem } from '../../../../shared/types';
import { useImageSrc } from '../../hooks/useImageSrc';
import { useLiveTimer } from '../../hooks/useLiveTimer';
import { formatElapsed, formatHours } from '../../lib/format';
import { getGameStatusMeta } from '../../lib/gameStatus';
import { StatusIcon } from '../StatusIcon';

type GameCardProps = {
  game: GameListItem;
  onSelect: () => void;
};

const GREEN = '#2fdc7e';
const BLUE = '#85a3d6';
const HLTB_MAIN = '#2bb6a6';

// Las dos medidas de la cara trasera — mismo lenguaje que los MeasureTile
// del Playthrough del detalle (borde y fondo teñidos del color del dato),
// en miniatura.
const StatTile = ({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: string;
}): React.JSX.Element => (
  <div
    className="flex-1 rounded-[9px] border px-2.5 py-2"
    style={{ borderColor: `${color}2e`, background: `${color}0f` }}
  >
    <div className="text-[9.5px] font-bold tracking-[.11em]" style={{ color: `${color}c4` }}>
      {label}
    </div>
    <div className="mt-0.5 text-[14px] font-extrabold tabular-nums" style={{ color }}>
      {value}
    </div>
  </div>
);

// Máximo de chips de género en la trasera + un "+N" con el resto: pintarlos
// todos desbordaría la card con juegos de 4-5 géneros (el espacio es el que
// es, formato 3/4).
const MAX_GENRES = 2;

// Cara trasera de la card (se ve al voltearla): cabecera sólida con título +
// año y estado (con el contador en vivo si está en marcha) — texto sobre
// fondo constante, no sobre arte impredecible —, hero debajo, y el cuerpo
// con tiles de horas/sesiones, progreso contra el Main Story y géneros.
const CardBack = ({
  game,
  elapsedSeconds,
}: {
  game: GameListItem;
  elapsedSeconds: number;
}): React.JSX.Element => {
  const status = getGameStatusMeta(game.currentState);
  const heroSrc = useImageSrc(game.heroUrl, 'heroes');

  const hltbPct =
    game.hltbMain !== null && game.hltbMain > 0 && game.totalHours > 0
      ? Math.min(100, (game.totalHours / game.hltbMain) * 100)
      : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex-none px-3 pt-2.25 pb-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[13.5px] font-extrabold text-foreground">
            {game.title}
          </span>
          {game.releaseYear !== null && (
            <span className="flex-none text-[11px] font-semibold text-muted-foreground tabular-nums">
              {game.releaseYear}
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <StatusIcon meta={status} size={13} />
          <span className="truncate text-[11.5px] font-bold" style={{ color: status.color }}>
            {status.label}
          </span>
          {game.isLive && (
            <span className="ml-auto flex-none text-[11px] font-bold text-primary tabular-nums">
              {formatElapsed(elapsedSeconds)}
            </span>
          )}
        </div>
      </div>

      {/* h-[26%]: sin crecido de por medio (se quitó), este es el margen que
          necesita el cuerpo de abajo para caber cuando los géneros pasan a
          dos filas. */}
      <div className="relative h-[26%] w-full flex-none">
        {heroSrc ? (
          <img src={heroSrc} alt="" className="block h-full w-full object-cover" />
        ) : (
          // Sin hero elegido, un lienzo tenue en vez de un hueco vacío.
          <div className="flex h-full w-full items-center justify-center bg-white/[0.03]">
            <Gamepad2 size={24} strokeWidth={1.5} className="text-muted-foreground/30" />
          </div>
        )}
        {/* Velo arriba y abajo para fundir el hero con la cabecera y el
            cuerpo — sin texto encima, la imagen se luce sola. */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(23,25,24,.35) 0%, transparent 30%, transparent 65%, rgba(23,25,24,.6) 100%)',
          }}
        />
      </div>

      {/* justify-evenly: el hueco sobrante se reparte ENTRE los bloques en
          vez de acumularse todo al fondo — los géneros ya no quedan pegados
          al borde inferior. */}
      <div className="flex min-h-0 flex-1 flex-col justify-evenly gap-1.5 px-3 pt-1.5 pb-2.25">
        {game.totalHours > 0 ? (
          <div className="flex gap-1.5">
            <StatTile color={GREEN} label="PLAYED" value={formatHours(game.totalHours)} />
            {game.sessionCount > 0 && (
              <StatTile color={BLUE} label="SESSIONS" value={String(game.sessionCount)} />
            )}
          </div>
        ) : (
          // Un juego sin tocar no enseña tiles a cero — lo dice con palabras.
          <div className="text-[11.5px] text-muted-foreground">Not played yet.</div>
        )}

        {hltbPct !== null && (
          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <span
                className="text-[9px] font-bold tracking-[.11em]"
                style={{ color: `${HLTB_MAIN}c4` }}
              >
                MAIN STORY
              </span>
              <span className="text-[10.5px] font-semibold text-muted-foreground tabular-nums">
                {formatHours(game.hltbMain ?? 0)}
              </span>
            </div>
            <div className="h-1.25 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${hltbPct}%`,
                  background: `linear-gradient(90deg, ${HLTB_MAIN}, ${HLTB_MAIN}99)`,
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
                className="rounded-md border border-input bg-white/[0.04] px-1.75 py-0.5 text-[10px] font-semibold text-muted-foreground"
              >
                {genre}
              </span>
            ))}
            {game.genres.length > MAX_GENRES && (
              <span className="self-center text-[10px] font-semibold text-muted-foreground/60 tabular-nums">
                +{game.genres.length - MAX_GENRES}
              </span>
            )}
          </div>
        )}
      </div>
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
      <div
        className="relative aspect-3/4 transition-transform duration-700 ease-[cubic-bezier(.35,.9,.3,1)] [transform-style:preserve-3d]"
        style={{ transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}
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
