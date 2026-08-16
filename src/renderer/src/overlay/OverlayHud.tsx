import {
  CalendarDays,
  Check,
  Flame,
  Gamepad2,
  History,
  Hourglass,
  Loader2,
  Play,
  Quote,
  Timer,
  Trophy,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { GameCover } from '../components/GameCover';
import { useGameAchievements, useSessionUnlocks } from '../hooks/achievements';
import { SessionAchievements } from '../components/sessions/SessionAchievements';
import type { SessionAchievementEntry } from '../components/sessions/SessionAchievements';
import { SessionNote } from '../components/sessions/SessionNote';
import { useGames } from '../hooks/games';
import { useSessions, useSetSessionNote } from '../hooks/sessions';
import { useOverlayShortcut, useTimeFormat } from '../hooks/settings';
import { queryKeys } from '../hooks/queryKeys';
import { useImageSrc } from '../hooks/useImageSrc';
import { useLiveTimer } from '../hooks/useLiveTimer';
import { isRare, percentLabel, rarityAccent } from '../lib/achievements';
import { AMBER, BLUE, GREEN, VIOLET } from '../lib/colors';
import { daysBetween, humanizeSpan } from '../lib/dateMath';
import {
  formatByPrecision,
  formatElapsed,
  formatHours,
  formatSessionEndTime,
  formatTime,
} from '../lib/format';
import { getGameStatusMeta } from '../lib/gameStatus';
import type {
  AchievementEntry,
  GameListItem,
  SessionWithGame,
  TimeFormat,
} from '../../../shared/types';

// La capa del overlay in-game (OVERLAY.md + decisión 2026-08-07): pantalla
// completa estilo Steam, con el lenguaje de la casa — el arte del juego dos
// veces (a sangre completa tras el velo y nítido en la banda de cabecera,
// como el HeroBanner de la ficha), la barra de HowLongToBeat de tres tramos
// con su marcador y sus tiles (clonada de HowLongToBeatCard), el catálogo de
// logros entero con scroll y hover, tu historial en baldosas, la hora — que
// jugando se pierde — y la nota rápida (§7.2.1) con la MISMA mutación que el
// toast de cierre.
//
// ── SINCRONIZACIÓN CON EL MAIN, y por qué así ───────────────────────────
// El estado de visibilidad vive en el main (§8.3) y aquí se espeja con el
// patrón get()+onChange que usa toda la casa (ver useBigPicture): se
// PREGUNTA al montar y además se ESCUCHA, descartando la foto inicial si el
// evento se adelantó. Copiarlo no era opcional: con solo el listener, el
// aviso de apertura llegaba antes de que React montara y se perdía — la
// ventana se enseñaba con el componente en fase 'hidden', o sea vacía, y
// hacían falta tres o cuatro pulsaciones hasta que un `true` coincidía con
// el listener ya puesto. Y al montar se envía 'ready', que es lo que el main
// espera para enseñar la ventana.
//
// ENTRADA SIN VIAJE VERTICAL: solo un fade corto. La cascada escalonada
// original (paneles deslizándose 12px con hasta 270ms de retardo) se leía
// sobre un juego en marcha como "abre desplazada y se recoloca" — sobre
// contenido ajeno, cualquier movimiento vertical parece un error de
// posición, no una entrada. Steam abre el suyo prácticamente instantáneo.
//
// MANDO (§6.3): Guía abre/cierra y B cierra, ambos leídos por SDL en el main
// (ver gamepad.ts) — este componente no sondea nada.

const humanizeShortcut = (accelerator: string): string =>
  accelerator.replaceAll('CommandOrControl', 'Ctrl').replaceAll('+', ' + ');

// Los segundos de una sesión viva, con la MISMA cuenta que useLiveTimer
// (useLiveTimer.ts:18) pero leyendo el reloj EN EL RENDER, en vez de un `now`
// que solo mueve un intervalo. De aquí sale el elapsed de toda la pantalla, no
// solo el de un caso raro: ver el telón, más abajo.
const secondsSince = (since: Date | null): number =>
  since === null ? 0 : Math.max(0, (Date.now() - since.getTime()) / 1000);

// Los tres tiempos del telón: abierto, fundiéndose, y fuera del DOM (con la
// ventana ya oculta no queda nada montado — Regla 1: oculto, coste cero).
type Phase = 'hidden' | 'open' | 'closing';

// El margen que la pantalla SIEMPRE conserva por arriba y por abajo,
// pase lo que pase con el contenido — el overlay nunca toca borde a borde.
// En px y no en vh: un margen relativo a la ventana (que ya es del tamaño
// del monitor) da lo mismo en la práctica, y en px es un número que se lee
// y se ajusta sin hacer cuentas.
const OVERLAY_VERTICAL_MARGIN = 44;

const enterClass = (closing: boolean): string =>
  closing ? '' : 'animate-in fade-in-0 duration-150';

// Panel de la casa con su veladura de color por sección (el mismo recurso
// que las filas fijadas del Plan y la cabecera de deuda).
const panelStyle = (accent: string): React.CSSProperties => ({
  background: `linear-gradient(135deg, ${accent}10, transparent 52%) #141614`,
});
const PANEL_CLASS = 'rounded-[16px] border border-input shadow-[0_24px_70px_rgba(0,0,0,.65)]';

// Los colores de los tres tramos — LOS MISMOS de HowLongToBeatCard, que es
// lo que las hace la misma pieza.
const HLTB_MAIN = '#2bb6a6';
const HLTB_EXTRA = '#3f7fe0';
const HLTB_COMPLETIONIST = '#2fdc7e';
type TierKey = 'main' | 'extra' | 'completionist';
const TIER_LABEL: Record<TierKey, string> = {
  main: 'Main Story',
  extra: '+ Extra',
  completionist: '100%',
};
const TIER_COLOR: Record<TierKey, string> = {
  main: HLTB_MAIN,
  extra: HLTB_EXTRA,
  completionist: HLTB_COMPLETIONIST,
};
// Los tramos se ACUMULAN: quien ha superado el de "+ Extra" se pasó la
// historia principal por el camino. El encendido de los tiles era excluyente
// aquí (reached={reachedTier === key}) y acumulativo en la ficha
// (HowLongToBeatCard.tsx:399 y 409): con 45h sobre main=26h/extra=40h, la
// ficha encendía MAIN y + EXTRA y este HUD enseñaba "Main Story" apagado —
// o sea, decía que NO te habías pasado la historia justo cuando la ficha
// decía que sí, con los mismos números delante. La regla vive aquí en una
// función para que no vuelva a copiarse a mano distinta.
// De la ficha se hereda TAMBIÉN su rareza, y queda dicha: si el tramo de
// arriba está alcanzado, uno sin dato (threshold 0, que se pinta '—') sale
// encendido con su check. La card hace exactamente eso (reached={reachedTier
// !== null}), y aquí manda la paridad — que las dos pantallas digan lo mismo
// vale más que limarlo en una sola y volver a tener dos reglas.
const TIER_ORDER: TierKey[] = ['main', 'extra', 'completionist'];
const tierReached = (reachedTier: TierKey | null, key: TierKey): boolean =>
  reachedTier !== null && TIER_ORDER.indexOf(reachedTier) >= TIER_ORDER.indexOf(key);

// El chip de icono de las cabeceras — idéntico al de PlanSectionHeading.
const SectionIcon = ({
  icon: Icon,
  color,
}: {
  icon: LucideIcon;
  color: string;
}): React.JSX.Element => (
  <span
    className="flex h-6 w-6 flex-none items-center justify-center rounded-lg"
    style={{ background: `${color}1c`, border: `1px solid ${color}33` }}
  >
    <Icon size={12} style={{ color }} />
  </span>
);

const Key = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <kbd className="rounded-[6px] border border-white/15 bg-white/[0.08] px-1.5 py-0.5 text-[10px] font-bold text-white/85">
    {children}
  </kbd>
);

// Un momento que está pasando AHORA (§7.2.3): celebratorio y sin interrumpir.
const MomentChip = ({
  icon: Icon,
  color,
  label,
}: {
  icon: LucideIcon;
  color: string;
  label: string;
}): React.JSX.Element => (
  <span
    className="flex items-center gap-1.75 rounded-full border px-3 py-1.25 text-[11.5px] font-bold"
    style={{ borderColor: `${color}45`, background: `${color}14`, color }}
  >
    <Icon size={12} className="flex-none" />
    {label}
  </span>
);

// El tile de un tramo — adaptación directa del TierTile de la card: el
// alcanzado se enciende con su check (y con él todos los de debajo, ver
// tierReached), el del ratón se realza y atenúa al resto.
const TierTile = ({
  tierKey,
  value,
  reached,
  hovered,
  dimmed,
  onHover,
}: {
  tierKey: TierKey;
  value: string;
  reached: boolean;
  hovered: boolean;
  dimmed: boolean;
  onHover: (key: TierKey | null) => void;
}): React.JSX.Element => {
  const color = TIER_COLOR[tierKey];
  return (
    <div
      onMouseEnter={() => onHover(tierKey)}
      onMouseLeave={() => onHover(null)}
      className="flex-1 rounded-[10px] border px-2 py-2 text-center transition-[opacity,box-shadow,border-color,background-color] duration-150"
      style={{
        opacity: dimmed ? 0.4 : 1,
        ...(reached || hovered
          ? { borderColor: `${color}5c`, background: `${color}17` }
          : { borderColor: 'var(--border)', background: 'rgba(255,255,255,.02)' }),
        ...(hovered ? { boxShadow: `0 0 0 1px ${color}59, 0 0 14px ${color}33` } : {}),
      }}
    >
      <div className="mb-1 flex items-center justify-center gap-1">
        {reached ? (
          <Check size={10} color={color} strokeWidth={3.5} />
        ) : (
          <span className="h-2 w-2 flex-none rounded-[2px]" style={{ background: color }} />
        )}
        <span
          className="text-[9.5px] font-bold tracking-[.06em] whitespace-nowrap"
          style={{ color: reached || hovered ? color : 'var(--muted-foreground)' }}
        >
          {TIER_LABEL[tierKey]}
        </span>
      </div>
      <div
        className="text-[13.5px] font-extrabold tabular-nums"
        style={{ color: reached || hovered ? color : 'var(--foreground)' }}
      >
        {value}
      </div>
    </div>
  );
};

// La pieza de HowLongToBeat entera, clonada de la card de la ficha. Sin
// datos, el estado vacío honesto — nunca un hueco mudo.
const HltbPanel = ({
  game,
  markerHours,
  closing,
}: {
  game: GameListItem;
  markerHours: number;
  closing: boolean;
}): React.JSX.Element => {
  const [hoveredTier, setHoveredTier] = useState<TierKey | null>(null);
  const main = game.hltbMain ?? 0;
  const extra = game.hltbMainExtras ?? 0;
  const completionist = game.hltbCompletionist ?? 0;
  const hasData = main > 0 || extra > 0 || completionist > 0;

  if (!hasData) {
    return (
      <div
        className={`${PANEL_CLASS} flex items-center gap-2.5 px-5.5 py-3.5 ${enterClass(closing)}`}
        style={panelStyle(HLTB_MAIN)}
      >
        <SectionIcon icon={Hourglass} color={HLTB_MAIN} />
        <span className="text-[13.5px] font-bold text-foreground">How long to beat</span>
        <span className="text-[11.5px] text-muted-foreground">
          no confident match for this one · {formatHours(markerHours)} played and counting
        </span>
      </div>
    );
  }

  // Escala al MAYOR de los tres datos conocidos, nunca a completionist a
  // ciegas — el mismo arreglo real de la card: si falta justo el 100%, un
  // denominador falso sacaba los tramos del contenedor.
  const scale = Math.max(main, extra, completionist, 1);
  const segMain = (main / scale) * 100;
  const segExtra = (Math.max(0, extra - main) / scale) * 100;
  const segComp = Math.max(0, 100 - segMain - segExtra);
  const markerPct = Math.max(0, Math.min(100, (markerHours / scale) * 100));

  const reachedTier: TierKey | null =
    completionist > 0 && markerHours >= completionist
      ? 'completionist'
      : extra > 0 && markerHours >= extra
        ? 'extra'
        : main > 0 && markerHours >= main
          ? 'main'
          : null;
  const tiers = (
    [
      { key: 'main', threshold: main },
      { key: 'extra', threshold: extra },
      { key: 'completionist', threshold: completionist },
    ] satisfies { key: TierKey; threshold: number }[]
  ).filter((tier) => tier.threshold > 0);
  const nextTier = tiers.find((tier) => tier.threshold > markerHours) ?? null;

  return (
    <div
      className={`${PANEL_CLASS} px-5.5 py-4.5 ${enterClass(closing)}`}
      style={panelStyle(HLTB_MAIN)}
    >
      <div className="flex items-center gap-2">
        <SectionIcon icon={Hourglass} color={HLTB_MAIN} />
        <span className="text-[13.5px] font-bold text-foreground">How long to beat</span>
        <span className="ml-auto text-[11px] font-semibold text-muted-foreground tabular-nums">
          {nextTier ? (
            <>
              <span style={{ color: TIER_COLOR[nextTier.key] }}>
                {formatHours(Math.max(0, nextTier.threshold - markerHours))}
              </span>{' '}
              to {TIER_LABEL[nextTier.key]}
            </>
          ) : (
            <span style={{ color: HLTB_COMPLETIONIST }}>everything reached</span>
          )}
        </span>
      </div>

      {/* Barra y marcador CLONADOS de la card: pill de horas + aguja blanca
          con anillo oscuro y halo (entra la última, afterplay-drop-in), y
          tramos creciendo en cadena de izquierda a derecha. */}
      <div className="relative mt-7 mb-1">
        <div
          className="absolute -top-5 rounded-md border border-input px-1.5 py-0.5 text-[10.5px] font-extrabold whitespace-nowrap text-foreground tabular-nums shadow-[0_4px_10px_rgba(0,0,0,.4)]"
          style={{
            left: `${markerPct}%`,
            background: '#1d211f',
            animation: 'afterplay-drop-in 420ms ease-out 380ms both',
            // Los tramos llevan transform (su crecido) y eso crea contexto de
            // apilado: sin z-index explícito, el marcador se pintaba debajo.
            zIndex: 2,
          }}
        >
          {formatHours(markerHours)}
        </div>
        <div
          className="absolute -top-1 rounded-sm bg-white"
          style={{
            left: `${markerPct}%`,
            width: 3,
            height: 22,
            boxShadow: '0 0 0 2px rgba(13,15,14,.85), 0 0 12px rgba(255,255,255,.5)',
            animation: 'afterplay-drop-in 420ms ease-out 380ms both',
            zIndex: 2,
          }}
        />
        <div
          className="flex h-3.5 overflow-hidden rounded-[5px] bg-white/5"
          style={{ boxShadow: 'inset 0 1px 3px rgba(0,0,0,.4)' }}
        >
          {(
            [
              { key: 'main' as const, width: segMain, background: HLTB_MAIN },
              { key: 'extra' as const, width: segExtra, background: HLTB_EXTRA },
              { key: 'completionist' as const, width: segComp, background: HLTB_COMPLETIONIST },
            ] satisfies { key: TierKey; width: number; background: string }[]
          ).map((segment, index) => {
            const isHovered = hoveredTier === segment.key;
            const isDimmed = hoveredTier !== null && !isHovered;
            return (
              <div
                key={segment.key}
                onMouseEnter={() => setHoveredTier(segment.key)}
                onMouseLeave={() => setHoveredTier(null)}
                className="transition-[opacity,filter] duration-150"
                style={{
                  width: `${segment.width}%`,
                  background: segment.background,
                  transformOrigin: 'left',
                  opacity: isDimmed ? 0.4 : 1,
                  filter: isHovered ? 'brightness(1.25)' : 'none',
                  boxShadow: isHovered ? `inset 0 0 10px ${segment.background}99` : 'none',
                  animation: `afterplay-grow-x 420ms ease-out ${index * 90}ms both`,
                }}
              />
            );
          })}
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        {(['main', 'extra', 'completionist'] as TierKey[]).map((key) => {
          const threshold = key === 'main' ? main : key === 'extra' ? extra : completionist;
          return (
            <TierTile
              key={key}
              tierKey={key}
              value={threshold > 0 ? formatHours(threshold) : '—'}
              reached={tierReached(reachedTier, key)}
              hovered={hoveredTier === key}
              dimmed={hoveredTier !== null && hoveredTier !== key}
              onHover={setHoveredTier}
            />
          );
        })}
      </div>
    </div>
  );
};

// Una fila de logro con hover de lista de verdad: icono, nombre, descripción
// (o el secreto de los ocultos) y la rareza con su acento.
//
// Envuelta en memo() A PROPÓSITO, y sí, con el compilador de React activo:
// esto no es sembrar memos por si acaso, es la frontera que hace lineal el
// montaje por tandas de AchievementsPanel. Cada tanda cambia `rowLimit`, o
// sea el estado del panel, así que el panel rehace su lista y React vuelve a
// llamar a TODAS las filas ya montadas para añadir 24 — con 1.328 logros son
// 55 tandas sobre una lista que crece: ~36.000 llamadas de fila. El
// compilador memoiza DENTRO de cada fila, que no es lo mismo: la fila se
// llama igual. Con memo(), una fila cuyo `entry` no ha cambiado (son los
// objetos de la query, estables) ni se llama.
// Medido en el banco con esos 1.328 logros: el montaje progresivo completo
// pasa de 281 ms a 241 ms de trabajo repartido. Es el 15%, y crece con el
// cuadrado del catálogo — que es justo lo que no se quiere sobre un juego.
const AchievementRow = memo(
  ({ entry, unlocked }: { entry: AchievementEntry; unlocked: boolean }): React.JSX.Element => {
    const src = useImageSrc(
      unlocked ? entry.iconUrl : (entry.iconGrayUrl ?? entry.iconUrl),
      'achievements',
    );
    const accent = rarityAccent(entry.globalPercent);
    return (
      // flex-none por lo mismo que en SessionRow: dentro de un contenedor flex
      // con altura acotada, un hijo se encoge antes que desbordar — y una fila
      // de logro estrujada pierde su icono y su texto en vez de provocar el
      // scroll que toca.
      <div className="group -mx-2 flex flex-none items-center gap-2.75 rounded-[10px] px-2 py-1.75 transition-colors duration-150 hover:bg-white/[0.05]">
        <span
          className={`h-9 w-9 flex-none overflow-hidden rounded-[8px] border border-white/10 bg-white/[0.04] transition-[opacity,filter] duration-150 ${
            unlocked ? '' : 'opacity-55 grayscale group-hover:opacity-80'
          }`}
        >
          {src ? (
            <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <span className="flex h-full w-full items-center justify-center">
              <Trophy size={14} className="text-muted-foreground/40" />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-[12.5px] font-semibold ${
              unlocked ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground/80'
            }`}
          >
            {entry.displayName}
          </span>
          <span className="block truncate text-[10.5px] text-muted-foreground/60">
            {entry.description ?? (entry.hidden ? 'Hidden achievement' : '')}
          </span>
        </span>
        {entry.globalPercent !== null && (
          <span
            className="flex-none text-[11px] font-bold tabular-nums"
            style={{ color: unlocked ? accent : 'var(--muted-foreground)' }}
          >
            {percentLabel(entry.globalPercent)}
          </span>
        )}
      </div>
    );
  },
);
AchievementRow.displayName = 'AchievementRow';

// Cuántas filas de logro entran en el PRIMER render y cuántas por tanda
// después. El patrón —y sus dos constantes— es el de la cola del Plan
// (PlanToPlay.tsx:76): montar solo lo que llena el primer pantallazo y colar
// el resto en el TIEMPO SOBRANTE de los frames siguientes.
//
// Aquí pesa más que en el Plan, porque este árbol se monta ENCIMA DE UN JUEGO
// EN MARCHA. Medido en el banco de Electron con el catálogo más grande de la
// biblioteca real (Payday 2, 1.328 logros): montar el catálogo entero de golpe
// eran 148 ms de render de React y 159-225 ms hasta el primer pintado —diez
// frames de 60fps robados al juego, y la capa apareciendo tarde—, más 1.334
// idas y vueltas IPC a `images.getSrc` (una por icono) contra el MISMO proceso
// main que lleva la base de datos y el vigilante de procesos. Por tandas, el
// primer pintado baja a 14-29 ms y las 1.300 filas restantes entran por los
// huecos de los frames siguientes, sin quitarle uno entero a nadie.
//
// 28 de salida: en el panel se ven ~8 filas (mide unos 380px y la fila ~48px),
// así que son tres pantallazos y medio de colchón — ni un scroll rápido
// alcanza a la cola de tandas. Las tandas son las mismas 24 que el Plan: es lo
// que cabe holgado en un respiro de frame, medido allí.
const INITIAL_ACHIEVEMENT_ROWS = 28;
const ACHIEVEMENT_ROWS_PER_BATCH = 24;
const ACHIEVEMENT_BATCH_TIMEOUT_MS = 120;

// requestIdleCallback y NO requestAnimationFrame — la diferencia entre "entra
// rápido" y "entra rápido Y suave", explicada entera en PlanToPlay.tsx:62:
// rAF dispara DENTRO del presupuesto del frame que está pintando la animación
// de entrada; el idle callback corre en lo que sobra DESPUÉS de pintar. Con un
// juego detrás la diferencia deja de ser estética. El respaldo a rAF es por si
// el runtime no trae requestIdleCallback: peor cadencia, nunca una lista a
// medias.
const scheduleIdle = (run: () => void): (() => void) => {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(run, { timeout: ACHIEVEMENT_BATCH_TIMEOUT_MS });
    return () => cancelIdleCallback(handle);
  }
  const handle = requestAnimationFrame(run);
  return () => cancelAnimationFrame(handle);
};

// El panel de logros ENTERO, como COMPONENTE PROPIO y no como un trozo de
// JSX dentro de OverlayHud. La separación es de rendimiento, no de orden:
//
// React Compiler memoiza el cuerpo de OverlayHud en UN SOLO bloque —el
// `return null` del telón bajado obliga a ello: no se puede saltar por trozos
// un código que puede salirse por el medio—, así que ese bloque tiene entre
// sus dependencias a `elapsed`, que cambia CADA SEGUNDO. Con el catálogo
// dentro, cada tic del cronómetro reconstruía las 1.328 filas de Payday 2:
// 23 ms de React por segundo, para siempre, sobre el juego. Fuera, el bloque
// del padre se rehace igual pero este componente tiene su PROPIO caché, sus
// dependencias (`entries`, `closing`) no cambian con el reloj, devuelve el
// mismo árbol y React se para ahí: 23 ms → 0,8 ms por tic.
//
// El día que alguien lo vuelva a meter en línea "para leerlo todo junto", el
// coste vuelve entero y sin avisar.
const AchievementsPanel = ({
  entries,
  closing,
}: {
  entries: AchievementEntry[];
  closing: boolean;
}): React.JSX.Element | null => {
  const [rowLimit, setRowLimit] = useState(INITIAL_ACHIEVEMENT_ROWS);

  const unlocked = entries
    .filter((entry) => entry.unlockedAt !== null)
    .sort((a, b) => (b.unlockedAt as Date).getTime() - (a.unlockedAt as Date).getTime());
  const locked = entries
    .filter((entry) => entry.unlockedAt === null)
    .sort((a, b) => (b.globalPercent ?? -1) - (a.globalPercent ?? -1));
  const achievementsPercent =
    entries.length > 0 ? Math.round((unlocked.length / entries.length) * 100) : 0;
  // Los raros que YA tienes — el dato del que uno presume, con el mismo
  // umbral y color que usa la app en la ficha y en Stats.
  const rareCount = unlocked.filter((entry) => isRare(entry.globalPercent)).length;

  // La siguiente tanda, en el primer hueco libre tras pintar la anterior. El
  // cleanup cancela la pendiente si el panel se va a mitad (cerrar el telón).
  useEffect(() => {
    if (rowLimit >= entries.length) return;
    return scheduleIdle(() => setRowLimit((limit) => limit + ACHIEVEMENT_ROWS_PER_BATCH));
  }, [rowLimit, entries.length]);

  // El límite se reparte en cascada: primero los desbloqueados, y lo que sobre
  // para los bloqueados. Las CUENTAS de los dos rótulos siguen saliendo de las
  // listas enteras (unlocked.length / locked.length), nunca de lo montado —
  // que el catálogo entre por tandas no puede cambiar lo que dice.
  const shownUnlocked = rowLimit >= unlocked.length ? unlocked : unlocked.slice(0, rowLimit);
  const lockedBudget = Math.max(0, rowLimit - unlocked.length);
  const shownLocked = lockedBudget >= locked.length ? locked : locked.slice(0, lockedBudget);

  if (entries.length === 0) return null;

  return (
    <div
      className={`${PANEL_CLASS} flex min-h-0 flex-1 flex-col px-5.5 py-4.5 ${enterClass(closing)}`}
      style={panelStyle(AMBER)}
    >
      {/* La cifra RESPIRA: el conteo iba pegado al porcentaje en
          un solo bloque ("6/24 · 25%") y se leía como un número
          raro. Ahora el porcentaje manda en grande con el acento, y
          el conteo va debajo en pequeño — el mismo reparto
          cifra-gorda/rótulo que las cards de Stats. */}
      <div className="flex flex-none items-start gap-2">
        <SectionIcon icon={Trophy} color={AMBER} />
        <span className="text-[13.5px] font-bold text-foreground">Achievements</span>
        <span className="ml-auto text-right">
          <span
            className="block text-[17px] leading-none font-extrabold tabular-nums"
            style={{ color: AMBER }}
          >
            {achievementsPercent}%
          </span>
          <span className="mt-1 block text-[10.5px] font-semibold text-muted-foreground tabular-nums">
            {unlocked.length} of {entries.length}
            {rareCount > 0 && <span style={{ color: rarityAccent(1) }}> · {rareCount} rare</span>}
          </span>
        </span>
      </div>
      <div className="mt-2.5 h-1.5 flex-none overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out"
          style={{
            width: `${achievementsPercent}%`,
            background: `linear-gradient(90deg, ${AMBER}88, ${AMBER})`,
          }}
        />
      </div>

      {/* El catálogo ENTERO. Antes tenía un max-h fijo (264px);
          ahora el panel ENTERO crece con flex-1 hasta el hueco real
          de la columna ("hazlo más alto"), y este scroll interno es
          quien absorbe lo que sobre por encima de esa altura. */}
      <div className="-mr-2 mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-2">
        {unlocked.length > 0 && (
          <>
            <div className="text-[9.5px] font-bold tracking-[.11em] text-muted-foreground/60 uppercase">
              Unlocked · {unlocked.length}
            </div>
            <div className="mt-1.5 mb-3 flex flex-col">
              {shownUnlocked.map((entry) => (
                <AchievementRow key={entry.id} entry={entry} unlocked />
              ))}
            </div>
          </>
        )}
        {locked.length > 0 && (
          <>
            <div className="text-[9.5px] font-bold tracking-[.11em] text-muted-foreground/60 uppercase">
              Still locked · {locked.length} — most common first
            </div>
            <div className="mt-1.5 flex flex-col">
              {shownLocked.map((entry) => (
                <AchievementRow key={entry.id} entry={entry} unlocked={false} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// Una cifra del resumen, en baldosa TEÑIDA de su color — el molde exacto de
// los DebtTile de la cabecera del Plan y de las cards de Stats: chip de
// icono diminuto, rótulo con tracking, y la cifra gorda en el acento.
const HistoryStat = ({
  icon: Icon,
  color,
  label,
  value,
}: {
  icon: LucideIcon;
  color: string;
  label: string;
  value: string;
}): React.JSX.Element => (
  <div
    className="min-w-0 rounded-[12px] border px-3 py-2.5"
    style={{ borderColor: `${color}2e`, background: `${color}0f` }}
  >
    <div className="flex items-center gap-1.25">
      <Icon size={10} style={{ color: `${color}c4` }} className="flex-none" />
      <span
        className="text-[9.5px] font-bold tracking-[.11em] uppercase"
        style={{ color: `${color}c4` }}
      >
        {label}
      </span>
    </div>
    <div
      className="mt-1 truncate text-[19px] leading-none font-extrabold tabular-nums"
      style={{ color }}
    >
      {value}
    </div>
  </div>
);

// La lista vacía COMPARTIDA de trofeos de una sesión — ver el memo de
// SessionRow y su sitio de uso.
const NO_UNLOCKS: SessionAchievementEntry[] = [];

// Una sesión del historial — CLON literal de SessionRow en
// SessionHistoryList.tsx (la ficha del juego): mismas clases, mismos
// tamaños, mismos colores, misma pieza SessionAchievements y el mismo
// SessionNote por fila. No es "parecido": es el mismo dibujo, para que
// saltar de la ficha al overlay no obligue a re-aprender cómo se lee una
// fila. Los únicos cambios son de DATOS (SessionWithGame trae gameId/title/
// coverUrl de más, que aquí no hacen falta) y la ausencia del borrar/
// destellar dorado del aviso de cierre, que no tienen sentido sobre el
// juego en marcha.
//
// Y en memo(), por el segundo que pasa: `elapsed` cambia cada tic y hasta
// ahora entraba en TODAS las filas (`liveSeconds`), así que el historial
// entero se re-renderizaba una vez por segundo para mover una sola fila, la
// viva. Ahora la duración ya llega calculada —la viva con el cronómetro, las
// cerradas con su número de siempre— y memo() para en seco a las que no han
// cambiado. Las cerradas solo vuelven a pintarse cuando de verdad les toca:
// cuando la sesión de hoy pasa a ser la más larga y `maxDurationSec` empieza a
// crecer, que es justo cuando sus barras tienen que reescalarse.
// Con las 20 sesiones del juego más jugado de la biblioteca real, el tic pasó
// de 1,7-2,5 ms a ~1 ms.
const SessionRow = memo(
  ({
    session,
    durationSec,
    maxDurationSec,
    isRecord,
    achievements,
    timeFormat,
  }: {
    session: SessionWithGame;
    durationSec: number;
    maxDurationSec: number;
    isRecord: boolean;
    achievements: SessionAchievementEntry[];
    timeFormat: TimeFormat;
  }): React.JSX.Element => {
    const isLive = session.endedAt === null;
    const endTime = formatSessionEndTime(session.endedAt, session.datePrecision, timeFormat);
    // Igual que en la ficha: el relleno proporcional SOLO en sesiones
    // cerradas — la viva no compite contra sí misma.
    const fillPct =
      !isLive && maxDurationSec > 0 ? Math.max(3, (durationSec / maxDurationSec) * 100) : 0;

    return (
      <div
        // flex-none es OBLIGATORIO, no decorativo: esta fila es hija de un
        // contenedor flex con altura acotada, y un hijo de flex se ENCOGE por
        // defecto (flex-shrink: 1) para caber. Sin esto, las filas se
        // aplastaban unas contra otras —la fecha cortada por arriba, la nota
        // por abajo— y el overflow-y-auto del padre no llegaba a dispararse
        // nunca, porque el contenido "cabía" a base de estrujarse. Con
        // flex-none cada sesión conserva su alto natural y lo que no cabe lo
        // resuelve el scroll del contenedor, que es lo que se quería.
        className="group/session relative flex flex-none items-center gap-4 overflow-hidden rounded-[13px] border px-4.5 py-3.5"
        style={
          isLive
            ? { borderColor: 'rgba(47,220,126,.4)', background: 'rgba(47,220,126,.06)' }
            : { borderColor: 'var(--border)', background: 'rgba(255,255,255,.024)' }
        }
      >
        {fillPct > 0 && (
          <div
            className="pointer-events-none absolute inset-y-0 left-0"
            style={{
              width: `${fillPct}%`,
              background: 'linear-gradient(90deg, rgba(255,255,255,.05), rgba(255,255,255,.01))',
              borderRight: '1.5px solid rgba(255,255,255,.14)',
            }}
          />
        )}
        <div className="relative z-1 flex h-8.5 w-8.5 flex-none items-center justify-center rounded-[9px] bg-white/5">
          <Timer size={15} className="text-muted-foreground" />
        </div>
        <div className="relative z-1 min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold text-foreground">
            {formatByPrecision(session.startedAt, session.datePrecision, timeFormat)}
          </div>
          {endTime && (
            <div className="mt-0.25 text-[11.5px] text-muted-foreground/70">→ {endTime}</div>
          )}
          <div
            className="mt-0.5 text-xs"
            style={{ color: isLive ? '#2fdc7e' : 'var(--muted-foreground)' }}
          >
            {isLive ? 'Live now' : session.isManual ? 'Manual' : 'Tracked'}
          </div>

          {/* Los trofeos de la noche — la misma pieza que la ficha y la
            vista global de Sesiones. */}
          <SessionAchievements entries={achievements} />

          {/* El diario de ESTA sesión, editable aquí igual que en la ficha —
            no solo la de ahora mismo (esa la cubre el panel "Where are you?"
            grande de al lado): cualquier sesión pasada de este juego.

            key con la propia nota, y no es decorativo: SessionNote inicializa
            su borrador UNA vez con useState(note ?? '') y no vuelve a
            sincronizarlo con el prop nunca. Aquí —único sitio de la app donde
            DOS editores de la MISMA nota conviven en pantalla: este y el
            panel grande, porque la fila viva ES openSession— escribías la
            nota arriba, pulsabas el lapicero de la fila para releerla y el
            input se abría VACÍO (el '' del montaje); confirmar con Enter
            mandaba note:'' y BORRABA lo que acababas de escribir. Cambiar la
            nota cambia la key, así que el editor se remonta leyendo el valor
            de verdad.

            El precio, que no es gratis: remontar por VALOR también tira un
            borrador a medias. Si abres el lapicero de esta fila, escribes SIN
            confirmar y la nota cambia por fuera —guardando desde el panel
            grande de al lado, o por el push del watcher cuando la escribe la
            ventana principal—, la key cambia, el editor se remonta y tu texto a
            medio escribir desaparece con él. Es estrecho (hay que abandonar el
            editor abierto para ir a guardar arriba) y se acepta a sabiendas:
            perder cuatro palabras a medias duele menos que mandar note:'' y
            BORRAR la nota entera, que es lo que pasaba antes.

            El arreglo de fondo —que el borrador arranque del prop al ABRIR el
            editor, dentro de SessionNote, que curaría esto y además cubriría a
            la ficha del juego— NO está hecho: ese fichero es de otra zona. Esta
            key es una tirita local al overlay, no la cura. */}
          <SessionNote key={session.note ?? ''} sessionId={session.id} note={session.note} />
        </div>
        <div className="relative z-1 flex flex-none items-center gap-1.5">
          {isRecord && <Flame size={13} color="#e85d72" />}
          <span
            className="text-[13px] font-semibold tabular-nums"
            style={{ color: isLive ? '#2fdc7e' : 'var(--foreground)' }}
          >
            {formatElapsed(durationSec)}
          </span>
        </div>
      </div>
    );
  },
);
SessionRow.displayName = 'SessionRow';

export const OverlayHud = (): React.JSX.Element | null => {
  const queryClient = useQueryClient();
  const { data: games = [] } = useGames();
  const { data: sessions = [] } = useSessions();
  const { data: sessionUnlocks = [] } = useSessionUnlocks();
  const { data: shortcut = '' } = useOverlayShortcut();
  const { data: timeFormat = '24h' } = useTimeFormat();
  // DESESTRUCTURADA, y no `const setNote = useSetSessionNote()`. Esto no es
  // estilo: era el mayor coste por segundo de esta pantalla.
  //
  // useMutation de react-query devuelve `{ ...result, mutate, mutateAsync }`
  // (useMutation.js:40) — un OBJETO NUEVO en cada render, siempre. React
  // Compiler memoiza por identidad de dependencias, y como `setNote` entraba
  // como dependencia del bloque memoizado que envuelve MEDIA PANTALLA (el
  // hero, HowLongToBeat, la nota y el catálogo de logros entero), ese bloque
  // no acertaba NUNCA: cada render reconstruía el árbol completo. Y hay un
  // render por segundo, el del cronómetro. Medido con el catálogo de Payday 2
  // (1.328 logros) en el banco de Electron: 23 ms de trabajo de React CADA
  // SEGUNDO, sobre un juego en marcha. Con `mutate` (estable, useCallback) e
  // `isPending` (un booleano) como dependencias, el bloque acierta y el mismo
  // tick baja a 0,6 ms.
  //
  // Si alguien vuelve a juntar esto en una sola variable "porque se lee
  // mejor", el catálogo entero vuelve a renderizarse sesenta veces por minuto.
  const { mutate: saveNoteMutation, isPending: savingNote } = useSetSessionNote();
  const [phase, setPhase] = useState<Phase>('hidden');
  const [openCount, setOpenCount] = useState(0);
  const [draft, setDraft] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const noteRef = useRef<HTMLTextAreaElement | null>(null);

  const live = games.find((game) => game.isLive) ?? null;
  // -1 con nada en vivo: catálogo vacío inofensivo, y el orden de hooks
  // queda estable (no se puede llamar condicionalmente).
  const { data: achievements } = useGameAchievements(live?.id ?? -1);
  const heroSrc = useImageSrc(live?.heroUrl ?? null, 'heroes');
  const coverSrc = useImageSrc(live?.coverUrl ?? null, 'covers');

  // CON EL TELÓN BAJADO NO SE PIDE NADA (OVERLAY.md §9.1, Regla 1: "oculto =
  // coste cero"). Esa regla la cumplía el tick del contador —que se para al
  // ocultar— pero NO el caché: cada aviso del main con el HUD escondido
  // relanzaba las cuatro consultas de esta ventana. Medido sobre la
  // biblioteca real (994 juegos, 39.808 logros), un solo aviso son getGames
  // 9 ms / 1.252 filas + getAllSessions 1 ms / 57 + getGameAchievements 9 ms
  // / 1.348 (Payday 2) + getSessionUnlocks 1 ms, más serializar esas ~2.700
  // filas por IPC y volver a derivarlas aquí — todo en el mismo proceso main
  // que lleva la base y el vigilante de procesos, y todo para repintar un
  // árbol que devuelve null. Y los avisos no son raros mientras juegas: el
  // sondeo de logros en vivo late cada 30s (steam/livePoll.ts) y el ciclo de
  // sync cada 60s.
  //
  // Así que oculto solo se MARCA el caché como viejo (refetchType 'none') y
  // el barrido lo hace la apertura del telón, más abajo — que es cuando
  // alguien va a mirar los datos.
  const curtainDown = phase === 'hidden';
  useEffect(
    () =>
      window.api.watcher.onGamesChanged(() => {
        const refetchType = curtainDown ? 'none' : 'active';
        void queryClient.invalidateQueries({ queryKey: queryKeys.games.all, refetchType });
        void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all, refetchType });
        void queryClient.invalidateQueries({ queryKey: queryKeys.achievements.all, refetchType });
      }),
    [queryClient, curtainDown],
  );

  // Y el aviso de LOGROS, que es el que de verdad importa aquí: los
  // desbloqueos caen MIENTRAS juegas, y el de arriba solo se emite al abrir o
  // cerrar una sesión. Sin esta suscripción el catálogo se quedaba en la foto
  // del arranque de la partida — la tarjeta flotante cantaba el logro y este
  // panel seguía enseñándolo bloqueado hasta reiniciar la app, porque las
  // queries de logros son staleTime Infinity y nadie las invalidaba.
  //
  // Es el mismo useAchievementsActivitySync de la ventana principal, montado
  // a mano: aquel vive en la raíz de la app (Afterplay.tsx), un árbol que
  // esta ventana no comparte.
  // Solo 'synced', que es el único que significa "hay datos nuevos". Los
  // 'progress' son la barra de la tarjeta de Ajustes, que aquí no se pinta:
  // atenderlos sería recargar el catálogo 300 veces durante una pasada
  // completa para no cambiar nada.
  // Mismo trato con el telón bajado que el aviso de arriba: marcar, no pedir.
  useEffect(
    () =>
      window.api.achievements.onActivity((event) => {
        if (event.kind !== 'synced') return;
        void queryClient.invalidateQueries({
          queryKey: queryKeys.achievements.all,
          refetchType: curtainDown ? 'none' : 'active',
        });
      }),
    [queryClient, curtainDown],
  );

  // Y los AJUSTES, que aquí llegaban una vez y se quedaban fósiles: sus dos
  // queries van a staleTime Infinity, pero quien las escribe es la OTRA
  // ventana — useSetOverlayShortcut hace setQueryData en el caché de quien
  // pulsa, y hacia el overlay no viaja ningún aviso (el main solo re-registra
  // el acelerador). Y esta ventana no se recrea: se precalienta al arrancar
  // la sesión y vive hasta que el juego muere, así que la foto vieja duraba
  // HORAS. Cambiabas el atajo a mitad de partida porque chocaba con una tecla
  // del juego y el pie del HUD seguía anunciando la única combinación que ya
  // NO lo abre; igual con el reloj, con las horas del historial y la
  // marquesina clavadas en 24h el resto de la partida.
  // Se vuelve a preguntar en CADA apertura del telón — mismo criterio que
  // useOverlayShortcutStatus, que refresca al abrir Ajustes porque su valor
  // también cambia por fuera de las mutations. Son dos lecturas diminutas
  // contra un gesto que el usuario hace a mano.
  //
  // Y AQUÍ SE BARRE lo que se quedó marcado con el telón bajado: los dos
  // ajustes se marcan igual que el resto (refetchType 'none') y un único
  // refetchQueries pide SOLO lo viejo (stale: true). Si mientras no mirabas no
  // pasó nada, no se pide nada — abrir el HUD no cuesta ni una consulta. Dos
  // marcas y un barrido, y no un invalidate por su cuenta cada uno, porque
  // invalidar con refetch por defecto Y barrer después pediría los ajustes dos
  // veces.
  useEffect(() => {
    if (phase !== 'open') return;
    void queryClient.invalidateQueries({
      queryKey: queryKeys.settings.overlayShortcut,
      refetchType: 'none',
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.settings.timeFormat,
      refetchType: 'none',
    });
    void queryClient.refetchQueries({ type: 'active', stale: true });
  }, [phase, openCount, queryClient]);

  // El espejo del estado del main, patrón get()+onChange de la casa (ver la
  // cabecera): se escucha Y se pregunta, descartando la foto inicial si el
  // evento ya se adelantó. Y se avisa de que estamos montados, que es lo que
  // el main espera para enseñar la ventana.
  useEffect(() => {
    let eventSeen = false;
    const apply = (visible: boolean): void => {
      if (visible) {
        if (closeTimer.current) clearTimeout(closeTimer.current);
        setPhase('open');
        setOpenCount((count) => count + 1);
        setDraft(null);
        setSavedFlash(false);
      } else {
        setPhase((current) => (current === 'open' ? 'closing' : current));
        // Un pelín menos que el hide real del main (230ms): el último frame
        // visible es ya el velo fundido, nunca un corte a medias.
        closeTimer.current = setTimeout(() => setPhase('hidden'), 210);
      }
    };
    const stop = window.api.overlay.onState((visible) => {
      eventSeen = true;
      apply(visible);
    });
    void window.api.overlay.getState().then((visible) => {
      if (!eventSeen && visible) apply(true);
    });
    window.api.overlay.ready();
    return stop;
  }, []);
  useEffect(() => () => clearTimeout(closeTimer.current ?? undefined), []);

  // El foco de la nota, A MANO y con preventScroll — no con autoFocus: el
  // autofoco del navegador hace scroll hasta el elemento al montar, y la
  // nota vive en la mitad baja del layout.
  useEffect(() => {
    if (phase !== 'open') return;
    scrollRef.current?.scrollTo({ top: 0 });
    const textarea = noteRef.current;
    if (textarea) {
      textarea.focus({ preventScroll: true });
      const length = textarea.value.length;
      textarea.setSelectionRange(length, length);
    }
  }, [phase, openCount]);

  // Esc cierra (§6.2) — el main devuelve el foco al juego al instante y la
  // salida animada corre por detrás. La B del mando la lee SDL en el main.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') window.api.overlay.dismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const openSession = useMemo(
    () =>
      live ? (sessions.find((s) => s.gameId === live.id && s.endedAt === null) ?? null) : null,
    [sessions, live],
  );
  // TODAS las sesiones de este juego, la viva primero y el resto de más
  // reciente a más antigua — el mismo orden que el historial de la ficha.
  const gameSessions = useMemo(() => {
    if (!live) return [];
    return sessions
      .filter((s) => s.gameId === live.id)
      .sort((a, b) => {
        if ((a.endedAt === null) !== (b.endedAt === null)) return a.endedAt === null ? -1 : 1;
        return b.startedAt.getTime() - a.startedAt.getTime();
      });
  }, [sessions, live]);
  // El listón del momento §7.2.3: la más larga que este juego había visto
  // ANTES de hoy (solo cerradas — la abierta es justo la que compite).
  const longestPreviousSec = useMemo(
    () =>
      gameSessions.reduce(
        (max, s) => (s.endedAt !== null && (s.durationSec ?? 0) > max ? (s.durationSec ?? 0) : max),
        0,
      ),
    [gameSessions],
  );
  // La última vez ANTES de esta: el fin más reciente de las CERRADAS.
  // live.lastPlayedAt no sirve aquí: getGames lo alimenta también con la
  // sesión ABIERTA, así que con el juego en marcha siempre decía "less than a
  // day ago" — la fecha era la de la partida que tienes delante. Y "first
  // time here" era literalmente inalcanzable: se estrenaba justo cuando el
  // overlay puede abrirse por primera vez, jugando.
  const previousEndedAt = useMemo(
    () =>
      gameSessions.reduce<Date | null>(
        (latest, s) =>
          s.endedAt !== null && (latest === null || s.endedAt.getTime() > latest.getTime())
            ? s.endedAt
            : latest,
        null,
      ),
    [gameSessions],
  );
  // Los logros de CADA sesión, indexados por sessionId. El cruce lo hace el
  // main (cada desbloqueo lleva su sessionId); aquí solo se agrupa, igual
  // que en la pantalla de Sesiones y el historial de la ficha.
  const unlocksBySession = useMemo(() => {
    const map = new Map<number, SessionAchievementEntry[]>();
    for (const unlock of sessionUnlocks) {
      const list = map.get(unlock.sessionId);
      if (list) list.push(unlock);
      else map.set(unlock.sessionId, [unlock]);
    }
    return map;
  }, [sessionUnlocks]);
  // Del hook se quiere el tick: con el telón cerrándose (u oculto) su
  // intervalo se para (§9.1), y abierto, ese re-render por segundo es el que
  // mueve el contador y refresca el reloj de la marquesina — cero timers de
  // más.
  const tickSeconds = useLiveTimer(phase === 'open' && live ? live.liveSince : null);
  // Porque ese valor miente en los DOS bordes del telón, y elapsed alimenta
  // media pantalla: el contador verde de 32px, el "· Xh total", el marcador de
  // HowLongToBeat, la baldosa "Longest", la fila viva del historial (y con ella
  // maxDurationSec, que si era la primera sesión del juego apagaba las barras
  // de relleno de todas las demás) y los dos MomentChip.
  //   BAJANDO: useLiveTimer con null no se limita a dejar de correr, DEVUELVE 0
  //   (useLiveTimer.ts:17), y este componente sigue montado y pintando los
  //   210ms que dura 'closing' — el primer frame del fundido de salida se
  //   repintaba entero con cero segundos de sesión.
  //   SUBIENDO (el que se ve más, y el que la primera pasada dejó a medias): el
  //   hook guarda `now` en un useState que solo mueve su propio intervalo
  //   (useLiveTimer.ts:9-15), y al rearrancar el efecto no hay un setNow
  //   inmediato. Ese `now` congelado sobrevive entre aperturas: esta función no
  //   se desmonta al ocultarse (solo devuelve null) y el key={openCount} de más
  //   abajo remonta el árbol de DENTRO, no sus hooks. Así que cada reapertura
  //   pintaba durante hasta un segundo entero la foto del cierre — con el HUD
  //   media hora cerrado, media hora de menos en toda esa lista y luego el
  //   salto de golpe.
  // La cuenta a mano en render (fórmula literal del hook, leyendo el reloj
  // ahora) es exacta en los dos bordes: lo que baja es el TELÓN, no la partida
  // — la sesión sigue viva y su cuenta sigue siendo cierta. Sin intervalo
  // propio (§9.1) y sin ref, que leerlo en render lo prohíbe react-hooks/refs.
  //
  // Y `tickSeconds` DENTRO de la fórmula, que no es adorno: es la DEPENDENCIA.
  // React Compiler memoiza por identidad de dependencias, y Date.now() no es
  // ninguna — `elapsed` y todo lo que cuelga de él (el cronómetro verde, el
  // marcador de HowLongToBeat, la baldosa "Longest", la fila viva) viven
  // dentro de un bloque memoizado cuyas dependencias NO cambian al pasar el
  // segundo. Comprobado en el banco: quitando esta referencia, el tick sigue
  // corriendo y el cronómetro se queda CLAVADO en la hora de la apertura (el
  // banco muestra un único valor distinto en cinco segundos). Hasta ahora eso
  // no se notaba por accidente: la mutación de la nota entraba sin
  // desestructurar en ese mismo bloque, invalidaba el caché en cada render y
  // reconstruía la pantalla entera cada segundo — el reloj andaba a costa de
  // repintar 1.328 filas de logros por segundo.
  //
  // El máximo devuelve SIEMPRE secondsSince: es la misma fórmula del hook con
  // el reloj más fresco, así que nunca es menor que el valor del tick, y en
  // los dos bordes del telón (donde el hook devuelve 0 o la foto vieja) sigue
  // siendo el bueno. El tick solo está para que el compilador VEA pasar el
  // segundo. Si se quita "porque no hace nada", el cronómetro se para.
  const elapsed = Math.max(tickSeconds, secondsSince(live?.liveSince ?? null));

  if (!live || phase === 'hidden') return null;
  const closing = phase === 'closing';

  const now = new Date();
  const note = draft ?? openSession?.note ?? '';
  const status = live.currentState !== null ? getGameStatusMeta(live.currentState) : null;
  const hoursWithLive = live.totalHours + elapsed / 3600;

  const isLongestSession = longestPreviousSec >= 600 && elapsed > longestPreviousSec;
  const crossedMainStory =
    live.hltbMain !== null &&
    live.hltbMain > 0 &&
    live.totalHours < live.hltbMain &&
    hoursWithLive >= live.hltbMain;

  // Los dos repartos (desbloqueados/bloqueados), el porcentaje y la cuenta de
  // raros viven DENTRO de AchievementsPanel: aquí arriba se rehacían con cada
  // tic del cronómetro, dos filtrados y dos ordenaciones sobre el catálogo
  // entero para devolver exactamente lo mismo.
  const entries = achievements?.entries ?? [];

  const saveNote = (): void => {
    if (!openSession || draft === null) return;
    saveNoteMutation(
      { id: openSession.id, note: draft },
      {
        onSuccess: () => {
          setDraft(null);
          setSavedFlash(true);
        },
      },
    );
  };

  return (
    <div
      key={openCount}
      ref={scrollRef}
      onClick={(event) => {
        if (event.target === event.currentTarget) window.api.overlay.dismiss();
      }}
      className={`relative h-screen w-screen overflow-hidden ${
        closing
          ? 'animate-out fade-out-0 fill-mode-forwards duration-200'
          : 'animate-in fade-in-0 duration-150'
      }`}
    >
      {/* El arte a sangre completa tras el velo — fixed para que no viaje con
          el scroll, pointer-events-none para que el clic del fondo siga
          llegando al cierre. */}
      <div className="pointer-events-none fixed inset-0">
        {heroSrc ? (
          <img src={heroSrc} alt="" className="h-full w-full object-cover" />
        ) : coverSrc ? (
          <img src={coverSrc} alt="" className="h-full w-full scale-110 object-cover blur-2xl" />
        ) : null}
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(7,9,8,.92) 0%, rgba(7,9,8,.80) 34%, rgba(7,9,8,.84) 66%, rgba(7,9,8,.95) 100%)',
          }}
        />
      </div>

      {/* CONTENEDOR ACOTADO: nunca más alto que la pantalla menos un margen
          fijo (OVERLAY_VERTICAL_MARGIN arriba y abajo, con my- y no padding —
          así el margen se descuenta de fuera, no de dentro). El fondo de
          arriba SÍ cubre la pantalla entera (fixed inset-0); lo que queda a
          raya es solo el contenido interactivo. Es un flex-col con altura
          DEFINIDA: los bloques fijos (marquesina, hero, HLTB, pie) llevan
          flex-none, y el único tramo elástico es la rejilla de logros +
          sesiones (flex-1 min-h-0) — crece hasta el hueco que queda y ahí
          para; lo que no cabe lo absorben los scrolls INTERNOS de esos dos
          paneles (ver grid-rows-[1fr] + min-h-0 en cascada más abajo), nunca
          un scroll de la ventana entera. */}
      <div
        className="relative mx-auto flex w-[920px] max-w-[94vw] flex-col"
        style={{
          height: `calc(100vh - ${OVERLAY_VERTICAL_MARGIN * 2}px)`,
          marginBlock: OVERLAY_VERTICAL_MARGIN,
        }}
      >
        {/* La marquesina: quién firma, la hora y el día. */}
        <div className={`mb-4 flex flex-none items-end justify-between ${enterClass(closing)}`}>
          <div className="flex items-center gap-2 pb-1">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: GREEN, animation: 'afterplay-pulse-dot 1.4s infinite' }}
            />
            <span className="text-[11px] font-extrabold tracking-[.28em] text-white/45">
              AFTERPLAY
            </span>
          </div>
          <div className="text-right">
            <div className="text-[28px] leading-none font-extrabold text-white/95 tabular-nums drop-shadow-[0_2px_10px_rgba(0,0,0,.7)]">
              {formatTime(now, timeFormat)}
            </div>
            <div className="mt-1 text-[10.5px] font-semibold text-white/45">
              {now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
            </div>
          </div>
        </div>

        {/* La banda-hero: el arte NÍTIDO dentro de la cabecera, con los dos
            degradados del HeroBanner de la ficha. */}
        <div className={`${PANEL_CLASS} relative flex-none overflow-hidden ${enterClass(closing)}`}>
          <div className="absolute inset-0">
            {heroSrc ? (
              <img src={heroSrc} alt="" className="h-full w-full object-cover" />
            ) : coverSrc ? (
              <img src={coverSrc} alt="" className="h-full w-full scale-110 object-cover blur-xl" />
            ) : (
              <div className="h-full w-full" style={panelStyle(GREEN)} />
            )}
            <div
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(180deg, rgba(13,15,14,.30) 0%, rgba(13,15,14,.62) 55%, rgba(13,15,14,.90) 100%)',
              }}
            />
            <div
              className="absolute inset-0"
              style={{ background: 'linear-gradient(90deg, rgba(13,15,14,.78), transparent 48%)' }}
            />
          </div>

          <div className="relative flex items-center gap-4.5 px-6 py-5">
            <GameCover
              url={live.coverUrl}
              className="h-[110px] w-[78px] flex-none overflow-hidden rounded-[10px] border border-white/15 shadow-[0_10px_30px_rgba(0,0,0,.6)]"
              iconSize={22}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[21px] font-extrabold tracking-[-.01em] text-white drop-shadow-[0_1px_4px_rgba(0,0,0,.8)]">
                {live.title}
              </div>
              <div className="mt-1.5 flex items-center gap-2 text-[11.5px] font-semibold text-white/70">
                {live.releaseYear !== null && (
                  <span className="tabular-nums">{live.releaseYear}</span>
                )}
                {live.genres && live.genres.length > 0 && (
                  <>
                    <span className="text-white/30">·</span>
                    <span className="truncate drop-shadow-[0_1px_2px_rgba(0,0,0,.8)]">
                      {live.genres.slice(0, 3).join(' · ')}
                    </span>
                  </>
                )}
                {status && (
                  <span
                    className="ml-1 flex items-center gap-1.25 rounded-[7px] border px-2 py-0.5 text-[10.5px] font-bold"
                    style={{
                      color: status.color,
                      borderColor: `${status.color}55`,
                      background: 'rgba(8,10,9,.55)',
                    }}
                  >
                    {status.label}
                  </span>
                )}
              </div>
              {(isLongestSession || crossedMainStory) && (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {isLongestSession && (
                    <MomentChip
                      icon={Flame}
                      color={AMBER}
                      label="Your longest session with this game"
                    />
                  )}
                  {crossedMainStory && (
                    <MomentChip icon={Trophy} color={GREEN} label="Past the main story length" />
                  )}
                </div>
              )}
            </div>
            <div className="flex-none text-right">
              <div className="flex items-center justify-end gap-2">
                <span
                  className="h-2 w-2 flex-none rounded-full"
                  style={{ background: GREEN, animation: 'afterplay-pulse-dot 1.4s infinite' }}
                />
                <span
                  className="text-[32px] leading-none font-extrabold tabular-nums"
                  style={{ color: GREEN, textShadow: `0 0 28px ${GREEN}66` }}
                >
                  {formatElapsed(elapsed)}
                </span>
              </div>
              <div className="mt-1.25 text-[11.5px] font-semibold text-white/70 drop-shadow-[0_1px_2px_rgba(0,0,0,.8)]">
                this session · {formatHours(hoursWithLive)} total
              </div>
            </div>
          </div>
        </div>

        <div className="mt-3 flex-none">
          <HltbPanel game={live} markerHours={hoursWithLive} closing={closing} />
        </div>

        {/* Dos columnas de ALTURA IGUALADA por CSS grid (self-stretch en el
            panel derecho, ver más abajo) — antes esa igualación la cobraba
            la nota, que se estiraba a la altura del stack izquierdo entero
            (logros + historial) y se quedaba como una caja de texto gigante
            casi vacía. Ahora es al revés: la nota es COMPACTA y vive en la
            columna izquierda, encima de los logros; y la columna derecha —
            liberada — es el LISTADO DE SESIONES, que sí tiene contenido de
            sobra para llenar el hueco y crece con flex-1 hasta el alto real
            que el stack izquierdo determine, con su propio scroll interno si
            se queda corto. */}
        {/* El ÚNICO tramo elástico de la columna: flex-1 min-h-0 le da la
            altura exacta que sobra tras marquesina+hero+HLTB+pie, y
            grid-rows-[1fr] es lo que hace que esa altura se REPARTA a las
            dos columnas de la rejilla — sin él, una fila "auto" de grid se
            mide por el contenido y listos, ignorando que el contenedor ya
            tiene una altura fijada desde fuera. items-stretch (default,
            explícito para que quede dicho) es lo que hace que ambas columnas
            LLEGUEN a esa altura en vez de quedarse en la suya propia. */}
        {/* minmax(0, ·fr) y no ·fr a secas: un track fr tiene el min-content
            de su contenido como MÍNIMO, y estas dos columnas van llenas de
            texto con truncate — que es nowrap, o sea que su "mínimo" es el
            ancho SIN cortar. El caso real que lo destapó (Naiad, primera
            sesión de la vida): el historial, casi vacío, colapsaba a su
            mínimo (~300px) y la columna de logros se comía el resto — 600/300
            en vez del 47/53 pactado, con los tiles truncando ("0h ...",
            "3 d..."). Con el mínimo a 0 el reparto es el pactado SIEMPRE, y
            del sobrante se encargan los truncate de dentro, que para eso
            están. Es exactamente lo que Tailwind pone de serie en sus
            grid-cols-N (repeat(N, minmax(0, 1fr))), y por este mismo motivo. */}
        <div className="mt-3 grid min-h-0 flex-1 grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] grid-rows-[1fr] items-stretch gap-3">
          <div className="flex min-h-0 flex-col gap-3">
            {/* La nota rápida (§7.2.1), COMPACTA: 3 líneas le bastan para
                "dónde lo dejo" — no necesita ni pretende llenar una columna
                entera. */}
            <div
              className={`${PANEL_CLASS} px-5.5 py-4 ${enterClass(closing)}`}
              style={panelStyle(BLUE)}
            >
              <div className="flex items-center gap-2">
                <SectionIcon icon={Quote} color={BLUE} />
                <span className="text-[13.5px] font-bold text-foreground">Where are you?</span>
                <span className="ml-auto text-[10.5px] font-semibold text-muted-foreground/60">
                  saved to this session
                </span>
              </div>
              <textarea
                ref={noteRef}
                value={note}
                rows={3}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setSavedFlash(false);
                }}
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                    event.preventDefault();
                    saveNote();
                  }
                }}
                placeholder="Jot it down while it's fresh — where you left off, what to do next…"
                disabled={!openSession}
                className="mt-2.5 w-full resize-none rounded-[10px] border border-input bg-white/[0.03] px-3 py-2.5 text-[13px] text-foreground transition-colors duration-150 placeholder:text-muted-foreground/50 focus:border-white/25 focus:outline-none disabled:opacity-50"
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground/60">
                  <Key>Ctrl</Key>+<Key>Enter</Key> saves
                </span>
                <button
                  type="button"
                  onClick={saveNote}
                  disabled={!openSession || draft === null || savingNote}
                  className="flex items-center gap-1.5 rounded-[9px] px-3.5 py-1.75 text-[12.5px] font-bold text-[#08120c] shadow-[0_4px_14px_rgba(47,220,126,0.25)] transition-[opacity,transform,box-shadow] duration-150 hover:brightness-105 active:scale-[.97] disabled:opacity-40 disabled:shadow-none"
                  style={{ background: `linear-gradient(135deg, ${GREEN}, #24c96f)` }}
                >
                  {savingNote ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : savedFlash ? (
                    <Check size={13} className="animate-in zoom-in-50 duration-200" />
                  ) : null}
                  {savedFlash && draft === null ? 'Saved' : 'Save note'}
                </button>
              </div>
            </div>

            <AchievementsPanel entries={entries} closing={closing} />
          </div>

          {/* La columna DERECHA, liberada de la nota: "Your history" con sus
              tres baldosas arriba y, debajo, el LISTADO ENTERO de sesiones
              creciendo con flex-1 — self-stretch en el panel hace que tome
              exactamente el alto del stack izquierdo (nota + logros), y
              min-h-0 en el propio div de la lista es lo que permite que ese
              flex-1 SE ACHIQUE hasta caber (sin él, un flex-child por
              defecto no encoge por debajo de su contenido y el overflow
              rompía el borde del panel en vez de activar el scroll). */}
          <div
            className={`${PANEL_CLASS} flex min-h-0 flex-col self-stretch px-5.5 py-4 ${enterClass(closing)}`}
            style={panelStyle(VIOLET)}
          >
            <div className="flex flex-none items-center gap-2">
              <SectionIcon icon={History} color={VIOLET} />
              <span className="text-[13.5px] font-bold text-foreground">Your history</span>
              <span className="ml-auto text-[10.5px] font-semibold text-muted-foreground/60">
                {previousEndedAt !== null
                  ? `last played ${humanizeSpan(daysBetween(previousEndedAt, new Date()))} ago`
                  : 'first time here'}
              </span>
            </div>
            <div className="mt-3 flex-none grid grid-cols-3 gap-2">
              {/* La MISMA lista que se pinta debajo, la viva incluida — así el
                  número y las filas no pueden discrepar. El sessionCount+1 de
                  antes partía de un comentario falso ("solo cuenta las
                  cerradas"): getGames cuenta TODAS las sesiones, la abierta
                  también, así que jugando siempre salía una de más. Con 36
                  sesiones nadie lo nota; en la PRIMERA sesión de un juego era
                  un "2" clavado sobre una lista de una fila. */}
              <HistoryStat
                icon={Play}
                color={GREEN}
                label="Sessions"
                value={String(gameSessions.length)}
              />
              <HistoryStat
                icon={Timer}
                color={AMBER}
                label="Longest"
                value={formatHours(Math.max(longestPreviousSec, elapsed) / 3600)}
              />
              <HistoryStat
                icon={CalendarDays}
                color={BLUE}
                label="In library"
                value={humanizeSpan(daysBetween(live.addedAt, new Date()))}
              />
            </div>

            {/* El LISTADO de sesiones de este juego — la de ahora arriba,
                latiendo en verde, y debajo todas las anteriores con su barra
                de proporción contra la más larga. Es el historial de la
                ficha traído aquí: mirar "¿cuánto llevo hoy comparado con
                otros días?" es media razón de abrir el overlay. gap-2.25: el
                mismo espaciado que SessionHistoryList en la ficha, no un
                valor propio inventado. */}
            {gameSessions.length > 0 && (
              <div className="-mr-2 mt-3 flex min-h-0 flex-1 flex-col gap-2.25 overflow-y-auto overscroll-contain pr-2">
                {gameSessions.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    // La duración YA resuelta aquí, y no un `liveSeconds` para
                    // todas: el cronómetro solo es la duración de la fila VIVA
                    // (ver el memo de SessionRow). Las cerradas reciben su
                    // número de siempre, que no cambia con el segundo.
                    durationSec={session.endedAt === null ? elapsed : (session.durationSec ?? 0)}
                    maxDurationSec={Math.max(longestPreviousSec, elapsed)}
                    isRecord={
                      session.durationSec !== null &&
                      session.durationSec > 0 &&
                      session.durationSec === longestPreviousSec
                    }
                    // NO_UNLOCKS y no `?? []`: un array nuevo por render le
                    // rompía el memo a todas las sesiones sin trofeos, que son
                    // la mayoría.
                    achievements={unlocksBySession.get(session.id) ?? NO_UNLOCKS}
                    timeFormat={timeFormat}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div
          className={`mt-5 flex flex-none items-center justify-center gap-4 ${enterClass(closing)}`}
        >
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-white/50">
            <Gamepad2 size={13} className="flex-none" />
            <Key>B</Key> closes
          </span>
          <span className="text-white/20">·</span>
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-white/50">
            <Key>Esc</Key>
            {shortcut !== '' && (
              <>
                {' '}
                or <Key>{humanizeShortcut(shortcut)}</Key>
              </>
            )}
          </span>
          <span className="text-white/20">·</span>
          <button
            type="button"
            onClick={() => window.api.overlay.dismiss()}
            className="flex items-center gap-1.5 rounded-full border border-white/15 bg-black/40 px-4 py-1.5 text-[12px] font-semibold text-white/70 transition-[background-color,color,transform] duration-150 hover:bg-black/60 hover:text-white active:scale-[.97]"
          >
            <X size={13} />
            Back to game
          </button>
        </div>
      </div>
    </div>
  );
};
