import {
  ChevronDown,
  Eye,
  EyeOff,
  Lock,
  RefreshCw,
  Search,
  Sparkles,
  Trophy,
  X,
} from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import type { AchievementEntry, TimeFormat } from '../../../../../shared/types';
import { useGameAchievements, useRefreshGameAchievements } from '../../../hooks/achievements';
import { useFlashLanding } from '../../../hooks/useFlashLanding';
import { useImageSrc } from '../../../hooks/useImageSrc';
import { useTimeFormat } from '../../../hooks/settings';
import {
  consumeAchievementFlash,
  getPendingAchievementFlash,
  requestAchievementFlash,
  subscribeAchievementFlash,
} from '../../../lib/achievementFlash';
import {
  isRare,
  percentLabel,
  rarityAccent,
  sortForDisplay,
  ULTRA_RARE,
  ULTRA_VIOLET,
} from '../../../lib/achievements';
import { AMBER, GREEN } from '../../../lib/colors';
import { formatByPrecision } from '../../../lib/format';
import { revealClass, revealStyle } from '../../../lib/styles';

// LOS LOGROS DE LA FICHA, tras el rediseño (LOGROS-REDISENO.md §2).
//
// La tesis del documento entero: los logros son el único dato de Afterplay
// que viene CON ARTE PROPIO, y se trataban como cifras. Aquí el icono es el
// contenido y la cifra es el pie de foto — la vitrina la preside TU pieza
// más rara a 100px, la lista es de filas finas donde el color se gana, y por
// fin se puede llegar a UN logro concreto: buscándolo, filtrando, o
// aterrizando desde una sesión con el parpadeo dorado.

type AchievementsSectionProps = {
  gameId: number;
};

// Cuántos se pintan plegada. Un juego puede tener 200 logros y la ficha no es
// una lista de logros: enseña lo tuyo y deja ver el resto a quien lo pida.
const COLLAPSED_COUNT = 12;

// El buscador solo aparece pasando de este número: en un juego de 8 logros
// sería un mueble vacío — mostrar nada antes que una caja vacía.
const SEARCH_THRESHOLD = 12;

type Filter = 'all' | 'unlocked' | 'locked' | 'rare';

// ── El anillo de progreso ───────────────────────────────────────────────────
// Vive en el zócalo de la vitrina, pequeño: el protagonismo ya no es suyo.
// SVG y no conic-gradient porque el trazo redondeado solo sale bien con
// stroke; se dibuja al entrar (afterplay-ring-in en main.css).

const RING_SIZE = 44;
const RING_STROKE = 5;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_C = 2 * Math.PI * RING_RADIUS;

// `fraction` es la proporción SIN redondear (0..1): el arco se dibuja con
// ella y el redondeo se queda solo para el número. Los dos topes son la misma
// regla, por arriba y por abajo: el número no puede contradecir al arco que
// tiene detrás (1 de 300 no es "0%"; 199 de 200 no es "100%").
const ProgressRing = ({
  fraction,
  complete,
}: {
  fraction: number;
  complete: boolean;
}): React.JSX.Element => {
  const color = complete ? AMBER : GREEN;
  const percent = complete
    ? 100
    : Math.min(99, Math.max(fraction > 0 ? 1 : 0, Math.round(fraction * 100)));
  return (
    <div className="relative flex-none" style={{ width: RING_SIZE, height: RING_SIZE }}>
      <svg width={RING_SIZE} height={RING_SIZE} className="-rotate-90">
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          stroke="rgba(255,255,255,.07)"
          strokeWidth={RING_STROKE}
        />
        {fraction > 0 && (
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            fill="none"
            stroke={color}
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            style={{
              strokeDasharray: RING_C,
              strokeDashoffset: RING_C * (1 - fraction),
              ['--afterplay-ring-c' as string]: `${RING_C}`,
              animation: 'afterplay-ring-in 1s cubic-bezier(.22,1,.36,1) 150ms backwards',
            }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[10.5px] font-extrabold tabular-nums" style={{ color }}>
          {percent}%
        </span>
      </div>
    </div>
  );
};

// ── Las medallas ────────────────────────────────────────────────────────────
// Redondas (a diferencia de los iconos cuadrados de la lista — son medallas,
// no filas). La viveza sale de lo FÍSICO, no del neón: brillo especular
// arriba, sombra profunda debajo y un pelín de crecida al pasar el ratón —
// una chapa esmaltada, no un rótulo luminoso.

const MedalFace = ({
  entry,
  size,
  iconSize,
}: {
  entry: AchievementEntry;
  size: number;
  iconSize: number;
}): React.JSX.Element => {
  const src = useImageSrc(entry.iconUrl, 'achievements');
  return src ? (
    <img src={src} alt="" className="h-full w-full object-cover" style={{ width: size }} />
  ) : (
    <div className="flex h-full w-full items-center justify-center bg-muted">
      <Trophy size={iconSize} className="text-muted-foreground/40" />
    </div>
  );
};

const RarestMedal = ({ entry }: { entry: AchievementEntry }): React.JSX.Element => {
  const rare = isRare(entry.globalPercent);
  const accent = rarityAccent(entry.globalPercent);
  return (
    <button
      type="button"
      onClick={() => requestAchievementFlash(entry.id)}
      aria-label={`Find in the list: ${entry.displayName}`}
      className="flex cursor-pointer flex-col items-center gap-1.5 border-0 bg-transparent p-0"
      title={`${entry.displayName}${
        entry.globalPercent !== null ? ` · ${percentLabel(entry.globalPercent)}` : ''
      } — click to find it below`}
    >
      <div
        className="relative h-12 w-12 overflow-hidden rounded-full transition-transform duration-200 ease-[cubic-bezier(.2,.7,.3,1)] hover:-translate-y-0.75"
        style={{
          boxShadow: `inset 0 0 0 1.5px ${rare ? `${accent}a6` : 'rgba(255,255,255,.22)'}, inset 0 1px 0 rgba(255,255,255,.26), 0 4px 11px rgba(0,0,0,.5)`,
        }}
      >
        <MedalFace entry={entry} size={48} iconSize={14} />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{
            background:
              'radial-gradient(120% 85% at 30% 12%, rgba(255,255,255,.26), transparent 46%)',
          }}
        />
      </div>
      {entry.globalPercent !== null && (
        <span
          className="text-[10.5px] font-extrabold tabular-nums"
          style={rare ? { color: accent } : { color: 'var(--muted-foreground)' }}
        >
          {percentLabel(entry.globalPercent)}
        </span>
      )}
    </button>
  );
};

// ── La vitrina ──────────────────────────────────────────────────────────────
// Antes la cabecera decía el mismo número CUATRO veces (anillo, marcador,
// pendientes y barra). Ahora UNA pieza manda —tu logro más raro, a 100px— y
// el progreso baja al zócalo, en una línea. El tinte de la tarjeta entera lo
// decide la rareza de esa pieza: violeta si tienes un ultra, ámbar si lo
// mejor es un raro, verde si no hay ninguno — y ámbar de celebración cuando
// el juego está al 100%. Cada juego trae una cabecera de un color distinto,
// y ese color es el de tu mejor trofeo.

const TrophyCase = ({
  unlockedCount,
  total,
  fraction,
  complete,
  rareCount,
  ultraCount,
  star,
  alsoRare,
  timeFormat,
  onRefresh,
  refreshing,
}: {
  unlockedCount: number;
  total: number;
  fraction: number;
  // Del CONTEO, no del porcentaje pintado: completado <=> los tienes todos.
  complete: boolean;
  rareCount: number;
  ultraCount: number;
  // La pieza destacada (tu conseguido más raro) — null si no hay ninguno
  // conseguido: entonces la vitrina colapsa al zócalo, sin inventarse una
  // medalla vacía.
  star: AchievementEntry | null;
  // Las otras dos medallas ("ALSO RARE"). Vacío = el divisor ni se pinta.
  alsoRare: AchievementEntry[];
  timeFormat: TimeFormat;
  onRefresh: () => void;
  refreshing: boolean;
}): React.JSX.Element => {
  // El acento de la vitrina: el 100% celebra en ámbar por encima de todo; si
  // no, manda la rareza de la pieza.
  const accent = complete ? AMBER : star ? rarityAccent(star.globalPercent) : GREEN;
  const starUltra = star !== null && star.globalPercent !== null && star.globalPercent < ULTRA_RARE;

  return (
    <div
      className="relative overflow-hidden rounded-[16px] border"
      style={{
        borderColor: `${accent}33`,
        background: `linear-gradient(118deg, ${accent}1c, rgba(255,255,255,.016) 54%)`,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,.07)',
      }}
    >
      {/* El aliento de color tras la medalla — un lavado radial, no un glow:
          es luz ambiental de la tarjeta, no un halo del icono. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-17 -left-11 h-75 w-75 rounded-full"
        style={{ background: `radial-gradient(circle, ${accent}33, transparent 68%)` }}
      />

      {star && (
        <div className="relative flex items-center gap-6 px-6 pt-6 pb-5">
          <div className="relative flex-none">
            {/* La pieza destacada tambien ENLAZA con su fila: es el logro del
                que mas se habla en la ficha y hasta ahora era el unico que no
                se podia ir a ver a la lista. */}
            <button
              type="button"
              onClick={() => requestAchievementFlash(star.id)}
              aria-label={`Find in the list: ${star.displayName}`}
              title={`${star.displayName} — click to find it below`}
              className="relative block h-25 w-25 cursor-pointer overflow-hidden rounded-full border-0 p-0 transition-transform duration-250 ease-[cubic-bezier(.2,.7,.3,1)] hover:-translate-y-1"
              style={{
                boxShadow: `inset 0 0 0 2px ${accent}, inset 0 2px 0 rgba(255,255,255,.34), 0 10px 26px rgba(0,0,0,.6), 0 0 0 5px ${accent}1f`,
              }}
            >
              <MedalFace entry={star} size={100} iconSize={22} />
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-full"
                style={{
                  background:
                    'radial-gradient(120% 85% at 30% 12%, rgba(255,255,255,.3), transparent 46%)',
                }}
              />
            </button>
            {/* La sombra de apoyo elíptica que asienta la medalla en la
                tarjeta — es lo que la hace objeto y no sticker. */}
            <span
              aria-hidden
              className="absolute -bottom-2.5 left-1/2 h-2.5 w-18.5 -translate-x-1/2 rounded-full"
              style={{ background: 'radial-gradient(ellipse, rgba(0,0,0,.62), transparent 70%)' }}
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="text-[9.5px] font-extrabold tracking-[.2em]" style={{ color: accent }}>
              {complete ? 'COMPLETED' : starUltra ? 'YOUR RAREST PIECE' : 'RAREST UNLOCKED'}
            </div>
            <div className="mt-1.75 text-[25px] leading-[1.12] font-extrabold tracking-[-.015em] text-foreground">
              {star.displayName}
            </div>
            {/* La línea editorial: el logro CUENTA algo, y el filo de color
                lo enmarca como cita. */}
            {star.description && (
              <p
                className="mt-2 max-w-100 border-l-2 pl-2.75 text-[12.5px] leading-normal text-[rgba(196,202,198,.8)]"
                style={{ borderColor: `${accent}55` }}
              >
                {star.description}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2.5">
              {star.globalPercent !== null && (
                <span
                  className="flex items-center gap-1.5 rounded-full px-3.25 py-1.25 text-[12.5px] font-extrabold tabular-nums"
                  style={{
                    background: `${accent}26`,
                    color: accent,
                    boxShadow: `inset 0 0 0 1px ${accent}55`,
                  }}
                >
                  <Sparkles size={10} />
                  {percentLabel(star.globalPercent)} of players
                </span>
              )}
              {star.unlockedAt && star.dateReliable && (
                <span className="text-[11.5px] text-muted-foreground/70">
                  {formatByPrecision(star.unlockedAt, 'day', timeFormat)}
                </span>
              )}
            </div>
          </div>

          {/* Las otras dos rarezas, en segundo plano tras un divisor. Con una
              sola conseguida el bloque colapsa entero — nada de divisores
              huérfanos custodiando el vacío. */}
          {alsoRare.length > 0 && (
            <div className="hidden flex-none flex-col items-center justify-center gap-2.75 self-stretch border-l border-white/[0.07] pl-5.5 min-[900px]:flex">
              <span className="text-[8.5px] font-extrabold tracking-[.18em] text-muted-foreground/50">
                ALSO RARE
              </span>
              <div className="flex gap-3.5">
                {alsoRare.map((entry) => (
                  <RarestMedal key={entry.id} entry={entry} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* El zócalo: el progreso entero en UNA línea, sin competir con la
          pieza. Con cero conseguidos es lo único que se pinta — el anillo a
          0% y un "none yet" honesto dicen más que una medalla inventada. */}
      <div
        className={`relative flex flex-wrap items-center gap-3.5 px-6 py-3.25 ${
          star ? 'border-t border-white/[0.07]' : ''
        }`}
        style={{ background: star ? 'rgba(0,0,0,.24)' : 'transparent' }}
      >
        <ProgressRing fraction={fraction} complete={complete} />
        <span className="text-[19px] leading-none font-extrabold text-foreground tabular-nums">
          {unlockedCount}
        </span>
        <span className="-ml-2 text-[12.5px] font-semibold text-muted-foreground">
          of {total} achievements
        </span>
        {(rareCount > 0 || ultraCount > 0) && (
          <span aria-hidden className="h-3.5 w-px bg-white/[0.12]" />
        )}
        {rareCount > 0 && (
          <span
            className="flex items-center gap-1 text-[11.5px] font-extrabold tabular-nums"
            style={{ color: AMBER }}
            title={`${rareCount} rare (under 10% of players)`}
          >
            <Sparkles size={9} />
            {rareCount} rare
          </span>
        )}
        {ultraCount > 0 && (
          <span
            className="flex items-center gap-1 text-[11.5px] font-extrabold tabular-nums"
            style={{ color: ULTRA_VIOLET }}
            title={`${ultraCount} ultra rare (under ${ULTRA_RARE}% of players)`}
          >
            <Sparkles size={10} />
            {ultraCount} ultra
          </span>
        )}
        {/* El resto y el refresco, como UNA unidad de flex: en la columna
            estrecha de la ficha el zócalo envuelve, y sueltos el botón se
            descolgaba solo a una segunda línea, huérfano. */}
        <span className="ml-auto flex items-center gap-2">
          <span className="text-[11.5px] text-muted-foreground/60 tabular-nums">
            {unlockedCount === 0
              ? 'none unlocked yet'
              : complete
                ? 'all of them — well earned'
                : `${total - unlockedCount} to go`}
          </span>
          {/* Volver a preguntarle a Steam por ESTE juego. Discreto: casi nunca
            hace falta — los juegos que juegas se refrescan solos al cerrar
            sesión. Es para el endless o el early access que añadió logros. */}
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            title={
              refreshing
                ? 'Checking Steam for new achievements…'
                : 'Re-fetch this game’s achievements from Steam'
            }
            aria-label="Refresh achievements"
            className="flex h-5.5 w-5.5 flex-none items-center justify-center rounded-full text-muted-foreground/60 transition-colors duration-150 hover:bg-white/[0.07] hover:text-foreground disabled:cursor-default disabled:hover:bg-transparent"
          >
            <RefreshCw size={11} className={refreshing ? 'animate-spin' : undefined} />
          </button>
        </span>
      </div>
    </div>
  );
};

// ── La lista ────────────────────────────────────────────────────────────────
// Fuera las cajas: filas de dos líneas con divisor de un pelo dentro de un
// contenedor único — un 28% más de logros por pantalla, y el color de rareza
// por fin se ve porque es lo único que hay. El estado lo dice la cabecera de
// grupo una vez (UNLOCKED · N / LOCKED · N), no cada fila con su borde.

// Los iconos viven en el CDN de Steam y el CSP solo deja cargar imágenes por
// afterplay-image:, así que pasan por la MISMA caché que las carátulas. Se
// resuelve por fila: solo se descargan los que llegas a mirar.
const RowIcon = ({
  entry,
  unlocked,
}: {
  entry: AchievementEntry;
  unlocked: boolean;
}): React.JSX.Element => {
  const remoteUrl = (unlocked ? entry.iconUrl : (entry.iconGrayUrl ?? entry.iconUrl)) ?? null;
  const src = useImageSrc(remoteUrl, 'achievements');
  const percent = entry.globalPercent;
  const rare = unlocked && isRare(percent);
  const ultra = rare && (percent as number) < ULTRA_RARE;
  const accent = rarityAccent(percent);

  // La rareza se nota por MATERIAL, escalando en tres grados: aro más nítido,
  // especular más vivo, sombra más profunda. Cero blur, cero animación en
  // bucle — el glow difuminado del ultra era justo el "rótulo luminoso" que
  // la regla de la casa prohíbe (la viveza sale de lo físico, no del neón).
  const shadow = unlocked
    ? ultra
      ? `inset 0 0 0 2px ${accent}, inset 0 1.5px 0 rgba(255,255,255,.34), 0 5px 14px rgba(0,0,0,.6), 0 0 0 3px ${accent}26`
      : rare
        ? `inset 0 0 0 1.5px ${accent}b3, inset 0 1px 0 rgba(255,255,255,.26), 0 3px 9px rgba(0,0,0,.5)`
        : 'inset 0 0 0 1px rgba(255,255,255,.14), inset 0 1px 0 rgba(255,255,255,.16), 0 2px 6px rgba(0,0,0,.4)'
    : 'inset 0 0 0 1px rgba(255,255,255,.07)';
  const specular = ultra ? 0.3 : rare ? 0.24 : 0.16;

  return (
    <div
      className={`relative h-11 w-11 flex-none overflow-hidden rounded-[11px] transition-transform duration-200 ease-[cubic-bezier(.2,.7,.3,1)] hover:scale-[1.07] ${
        unlocked ? '' : 'opacity-30 grayscale'
      }`}
      style={{ boxShadow: shadow }}
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-muted">
          <Trophy size={15} className="text-muted-foreground/40" />
        </div>
      )}
      {unlocked && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[11px]"
          style={{
            background: `radial-gradient(120% 85% at 30% 12%, rgba(255,255,255,${specular}), transparent 46%)`,
          }}
        />
      )}
    </div>
  );
};

// La descripción en la línea de abajo, con el spoiler de los ocultos: uno ya
// conseguido no esconde nada; uno pendiente se tapa pero se destapa de un
// clic — la decisión de hacerse spoiler es tuya, no de la app.
const RowDescription = ({
  entry,
  unlocked,
}: {
  entry: AchievementEntry;
  unlocked: boolean;
}): React.JSX.Element | null => {
  const [revealed, setRevealed] = useState(false);

  if (!entry.hidden || unlocked || revealed) {
    if (!entry.description) {
      return entry.hidden && !unlocked ? (
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground/45 italic">
          Hidden achievement
        </span>
      ) : null;
    }
    return (
      <span
        className={`min-w-0 flex-1 truncate text-[11.5px] ${
          unlocked ? 'text-muted-foreground/75' : 'text-muted-foreground/45'
        }`}
        title={entry.description}
      >
        {entry.description}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setRevealed(true)}
      className="group/reveal flex min-w-0 flex-1 items-center gap-1.5 truncate text-[11.5px] text-muted-foreground/45 italic transition-colors duration-150 hover:text-muted-foreground"
    >
      <span className="grid flex-none place-items-center">
        <EyeOff
          size={11}
          className="col-start-1 row-start-1 transition-opacity duration-150 group-hover/reveal:opacity-0"
        />
        <Eye
          size={11}
          className="col-start-1 row-start-1 opacity-0 transition-opacity duration-150 group-hover/reveal:opacity-100"
        />
      </span>
      Hidden — click to reveal
    </button>
  );
};

const AchievementRow = ({
  entry,
  timeFormat,
  flash,
  showDivider,
}: {
  entry: AchievementEntry;
  timeFormat: TimeFormat;
  // Aterrizaje desde una sesión: la fila se lleva a la vista y parpadea en
  // dorado — la misma coreografía que las sesiones (SessionHistoryList).
  flash: boolean;
  showDivider: boolean;
}): React.JSX.Element => {
  const unlocked = entry.unlockedAt !== null;
  const percent = entry.globalPercent;
  const rare = unlocked && isRare(percent);
  const ultra = rare && (percent as number) < ULTRA_RARE;
  const accent = rarityAccent(percent);

  // La coreografía (a la vista, luego el destello) vive en el gancho: es la
  // misma que la del historial de sesiones.
  const { rowRef, flashClass, onAnimationEnd } = useFlashLanding(flash, consumeAchievementFlash);

  return (
    <div
      ref={rowRef}
      onAnimationEnd={onAnimationEnd}
      data-ach={entry.id}
      className={`group/ach relative flex items-center gap-3.25 px-4 py-2.25 transition-colors duration-150 ${flashClass}`}
      style={{
        borderTop: showDivider ? '1px solid rgba(255,255,255,.05)' : '1px solid transparent',
        // El lavado de color SOLO en los raros conseguidos: si cada fila se
        // tiñera, la lista sería un neón y el raro dejaría de destacar.
        background:
          unlocked && rare ? `linear-gradient(90deg, ${accent}12, transparent 42%)` : 'transparent',
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background =
          unlocked && rare
            ? `linear-gradient(90deg, ${accent}1c, rgba(255,255,255,.03) 42%)`
            : 'rgba(255,255,255,.04)';
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background =
          unlocked && rare ? `linear-gradient(90deg, ${accent}12, transparent 42%)` : 'transparent';
      }}
    >
      {/* Filo de color a la izquierda en los conseguidos — misma gramática
          que la barra de estado de la tarjeta del modo TV. El ultra lo lleva
          un punto más ancho: material, no neón. */}
      {unlocked && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0"
          style={{ width: ultra ? 3 : 2, background: accent, opacity: rare ? 0.9 : 0.45 }}
        />
      )}

      <RowIcon entry={entry} unlocked={unlocked} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.75">
          <span
            className={`min-w-0 truncate text-[13px] font-bold ${
              unlocked ? 'text-foreground' : 'text-muted-foreground/75'
            }`}
          >
            {entry.displayName}
          </span>
          {rare && <Sparkles size={9} className="flex-none" style={{ color: accent }} />}
          {/* De dónde nos consta, solo cuando NO es la vía normal: que venga
              de Steam no es noticia; del emulador ('local') o de RA, sí. */}
          {unlocked &&
            !entry.sources.includes('steam') &&
            (entry.sources.includes('emu') || entry.sources.includes('ra')) && (
              <span className="flex-none rounded px-1 py-0.25 text-[8.5px] font-bold tracking-[.06em] text-muted-foreground/60 uppercase">
                {entry.sources.includes('emu') ? 'local' : 'RA'}
              </span>
            )}
        </div>
        <div className="mt-0.5 flex items-baseline gap-2.25">
          <RowDescription entry={entry} unlocked={unlocked} />
          {/* La fecha comparte línea con la descripción: es lo que baja la
              fila de tres líneas a dos. Solo como fecha si es de fiar. */}
          {entry.unlockedAt && (
            <span className="flex-none text-[10px] font-semibold text-muted-foreground/65 tabular-nums">
              {entry.dateReliable
                ? formatByPrecision(entry.unlockedAt, 'day', timeFormat)
                : 'date unknown'}
            </span>
          )}
        </div>
      </div>

      {/* El porcentaje y su medidor: barra llena al valor del porcentaje —
          larga = lo tiene todo el mundo, hilito = casi nadie. Se escanea la
          columna entera sin leer un solo número. */}
      {percent !== null && (
        <div
          className="flex w-14.5 flex-none flex-col items-end gap-1"
          title={`${percent.toFixed(1)}% of players have this`}
        >
          <span
            className="text-[12px] font-extrabold tabular-nums"
            style={rare ? { color: accent } : { color: 'var(--muted-foreground)', opacity: 0.55 }}
          >
            {percentLabel(percent)}
          </span>
          <div className="h-[3px] w-11 overflow-hidden rounded-full bg-white/[0.08]">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(3, Math.min(100, percent))}%`,
                background: rare ? accent : 'rgba(255,255,255,.35)',
                opacity: unlocked ? 1 : 0.4,
              }}
            />
          </div>
        </div>
      )}

      {!unlocked && <Lock size={12} className="flex-none text-muted-foreground/30" />}
    </div>
  );
};

// La cabecera de grupo: el estado dicho UNA vez, con su cuenta — sustituye al
// borde discontinuo por fila, que leía como error y no como "aún no".
const GroupHeader = ({
  label,
  count,
  unlocked,
}: {
  label: string;
  count: number;
  unlocked: boolean;
}): React.JSX.Element => (
  <div
    className="flex items-center gap-2.25 px-4 pt-2.75 pb-2"
    style={{ background: unlocked ? `${GREEN}0b` : 'rgba(255,255,255,.02)' }}
  >
    <span
      aria-hidden
      className="h-1.25 w-1.25 rounded-full"
      style={{ background: unlocked ? GREEN : 'rgba(139,145,140,.5)' }}
    />
    <span
      className="text-[9.5px] font-extrabold tracking-[.18em]"
      style={{ color: unlocked ? GREEN : 'rgba(139,145,140,.8)' }}
    >
      {label}
    </span>
    <span className="text-[9.5px] font-bold text-muted-foreground/60 tabular-nums">{count}</span>
    <span aria-hidden className="h-px flex-1 bg-white/[0.06]" />
  </div>
);

// ── La sección entera ───────────────────────────────────────────────────────
// No se pinta nada si el juego no está en Steam o su catálogo no se ha
// traído: una sección vacía con "0 logros" en un juego de PS2 sería ruido.
export const AchievementsSection = ({
  gameId,
}: AchievementsSectionProps): React.JSX.Element | null => {
  const { data } = useGameAchievements(gameId);
  const { data: timeFormat = '24h' } = useTimeFormat();
  const { refresh, refreshing } = useRefreshGameAchievements(gameId);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  // El logro pendiente de aterrizar (lib/achievementFlash): llega de pulsar
  // un trofeo en una sesión — de otra pantalla o de esta misma ficha.
  const pendingFlash = useSyncExternalStore(subscribeAchievementFlash, getPendingAchievementFlash);

  // Si el logro pedido es de ESTE juego: fuera búsqueda y filtros (podrían
  // esconderlo) y lista desplegada si cae más allá del corte. Sin desplegar,
  // pulsar un logro en la posición 40 no haría nada visible y el enlace
  // parecería roto — buscar y aterrizar son los dos casos donde el usuario ha
  // pedido UN logro concreto, y esconderlo tras un "ver más" es decirle que
  // no. Un pendiente de OTRO juego se ignora (y no se consume): es de la
  // ficha a la que se está navegando, no de esta.
  const flashIsMine =
    pendingFlash !== null && (data?.entries ?? []).some((entry) => entry.id === pendingFlash);
  // Ajustar-estado-durante-render (mismo patron que el sembrado de
  // CredentialsSection), no un efecto: React re-renderiza en el acto con el
  // estado bueno, sin frame intermedio con el logro aun escondido.
  const [handledFlash, setHandledFlash] = useState<number | null>(null);
  if (flashIsMine && handledFlash !== pendingFlash) {
    setHandledFlash(pendingFlash);
    setQuery('');
    setFilter('all');
    setExpanded(true);
  } else if (pendingFlash === null && handledFlash !== null) {
    // Y se OLVIDA en cuanto la fila consume la petición. Si no, pedir el mismo
    // logro por segunda vez seguía contando como "ya atendido" y la lista no
    // volvía a desplegarse ni a limpiar el buscador.
    setHandledFlash(null);
  }

  if (!data || data.entries.length === 0) return null;

  // UN SOLO ORDEN, plegada y expandida (lib/achievements.ts): conseguidos
  // primero, recientes arriba, no fiables detrás, pendientes al final.
  // Expandir solo AÑADE al final — nada se reordena bajo el cursor.
  const sorted = sortForDisplay(data.entries);
  const unlockedAll = sorted.filter((entry) => entry.unlockedAt !== null);
  const unlockedCount = unlockedAll.length;
  const fraction = unlockedCount / sorted.length;
  const complete = unlockedCount === sorted.length;
  const rareUnlocked = unlockedAll.filter((entry) => isRare(entry.globalPercent));
  const ultraCount = rareUnlocked.filter(
    (entry) => (entry.globalPercent as number) < ULTRA_RARE,
  ).length;

  // La pieza destacada y sus dos escoltas: tus conseguidos más raros.
  const byRarity = unlockedAll
    .filter((entry) => entry.globalPercent !== null)
    .sort((a, b) => (a.globalPercent as number) - (b.globalPercent as number));
  const star = byRarity[0] ?? null;
  const alsoRare = byRarity.slice(1, 3);

  // El filtrado. Buscar ignora el corte de 12: si buscas, quieres TODOS los
  // que encajan, no los primeros doce.
  const trimmedQuery = query.trim().toLowerCase();
  const searching = trimmedQuery.length > 0;
  let filtered = sorted;
  if (filter === 'unlocked') filtered = filtered.filter((entry) => entry.unlockedAt !== null);
  if (filter === 'locked') filtered = filtered.filter((entry) => entry.unlockedAt === null);
  if (filter === 'rare') filtered = filtered.filter((entry) => isRare(entry.globalPercent));
  if (searching) {
    filtered = filtered.filter(
      (entry) =>
        entry.displayName.toLowerCase().includes(trimmedQuery) ||
        (entry.description ?? '').toLowerCase().includes(trimmedQuery),
    );
  }

  const showAll = searching || expanded;
  const visible = showAll ? filtered : filtered.slice(0, COLLAPSED_COUNT);
  const hiddenCount = filtered.length - visible.length;
  const showToolbar = sorted.length > SEARCH_THRESHOLD;

  const filters: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: sorted.length },
    { key: 'unlocked', label: 'Unlocked', count: unlockedCount },
    { key: 'locked', label: 'Locked', count: sorted.length - unlockedCount },
    { key: 'rare', label: 'Rare', count: sorted.filter((e) => isRare(e.globalPercent)).length },
  ];

  // Las cabeceras de grupo caen en la PRIMERA fila de cada estado.
  const firstUnlockedId = visible.find((entry) => entry.unlockedAt !== null)?.id ?? null;
  const firstLockedId = visible.find((entry) => entry.unlockedAt === null)?.id ?? null;
  const unlockedShown = filtered.filter((entry) => entry.unlockedAt !== null).length;
  const lockedShown = filtered.length - unlockedShown;

  return (
    <div className="mt-7.5">
      <div className={revealClass} style={revealStyle(0)}>
        <TrophyCase
          unlockedCount={unlockedCount}
          total={sorted.length}
          fraction={fraction}
          complete={complete}
          rareCount={rareUnlocked.length - ultraCount}
          ultraCount={ultraCount}
          star={star}
          alsoRare={alsoRare}
          timeFormat={timeFormat}
          onRefresh={refresh}
          refreshing={refreshing}
        />
      </div>

      {showToolbar && (
        <div
          className={`mt-3 flex flex-wrap items-center gap-2.25 ${revealClass}`}
          style={revealStyle(1)}
        >
          <div className="relative min-w-57.5 flex-1">
            <Search
              size={14}
              className="pointer-events-none absolute top-1/2 left-2.75 -translate-y-1/2 text-muted-foreground"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search achievements…"
              className="w-full rounded-[10px] border border-white/[0.12] bg-white/[0.03] py-2.25 pr-8 pl-8.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/45"
            />
            {searching && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute top-1/2 right-2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-white/[0.08] text-foreground transition-colors duration-150 hover:bg-white/[0.14]"
              >
                <X size={11} />
              </button>
            )}
          </div>
          <div className="flex gap-1.25 rounded-[10px] border border-white/[0.09] bg-white/[0.03] p-0.75">
            {filters.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setFilter(option.key)}
                className="flex items-center gap-1.25 rounded-[8px] px-3 py-1.5 text-[12px] font-bold transition-colors duration-150"
                style={
                  filter === option.key
                    ? { background: 'rgba(255,255,255,.1)', color: 'var(--foreground)' }
                    : { color: 'var(--muted-foreground)' }
                }
              >
                {option.label}
                <span className="text-[10.5px] font-bold opacity-65 tabular-nums">
                  {option.count}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {showToolbar && (
        <div className="mx-0.5 mt-3 mb-2 text-[11.5px] text-muted-foreground">
          {searching
            ? `${filtered.length} ${filtered.length === 1 ? 'match' : 'matches'}`
            : `${visible.length} of ${filtered.length} · unlocked first, recent on top`}
        </div>
      )}

      {filtered.length > 0 ? (
        <div
          className={`overflow-hidden rounded-[14px] border border-white/[0.07] bg-white/[0.012] ${showToolbar ? '' : 'mt-2.5'} ${revealClass}`}
          style={revealStyle(2)}
        >
          {visible.map((entry) => (
            <div key={entry.id}>
              {entry.id === firstUnlockedId && (
                <GroupHeader label="UNLOCKED" count={unlockedShown} unlocked />
              )}
              {entry.id === firstLockedId && (
                <GroupHeader label="LOCKED" count={lockedShown} unlocked={false} />
              )}
              <AchievementRow
                entry={entry}
                timeFormat={timeFormat}
                flash={pendingFlash === entry.id && flashIsMine}
                showDivider={entry.id !== firstUnlockedId && entry.id !== firstLockedId}
              />
            </div>
          ))}
          {!searching && (hiddenCount > 0 || expanded) && (
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              className="flex w-full items-center justify-center gap-1.75 border-t border-white/[0.07] bg-white/[0.02] py-2.75 text-[12px] font-bold text-muted-foreground transition-colors duration-150 hover:bg-white/[0.055] hover:text-foreground"
            >
              <ChevronDown
                size={13}
                className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
              />
              {expanded ? 'Show less' : `Show ${hiddenCount} more`}
            </button>
          )}
        </div>
      ) : (
        <div className="mt-2.5 rounded-[14px] border border-dashed border-white/[0.1] px-8 py-8.5 text-center">
          <Trophy size={22} className="mx-auto mb-2.25 text-muted-foreground/35" />
          <div className="text-[13px] text-muted-foreground">
            Nothing matches{' '}
            <span className="font-bold text-foreground">“{query.trim() || filter}”</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setFilter('all');
            }}
            className="mt-3 rounded-[9px] border border-white/[0.14] bg-white/[0.03] px-3.75 py-1.75 text-[12.5px] font-semibold text-foreground transition-colors duration-150 hover:bg-white/[0.07]"
          >
            Clear search
          </button>
        </div>
      )}
    </div>
  );
};
