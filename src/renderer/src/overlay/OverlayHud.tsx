import { Check, Flame, Gamepad2, Loader2, MonitorPlay, Timer, Trophy, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { GameCover } from '../components/GameCover';
import { Tabs, tabId, tabPanelId } from '../components/ui/tabs';
import { kbdClass, primaryButtonClass, secondaryButtonClass } from '../components/shell/controls';
import {
  createAchievementsActivityInvalidator,
  useGameAchievements,
  useSessionUnlocks,
} from '../hooks/achievements';
import { SessionAchievements } from '../components/sessions/SessionAchievements';
import type { SessionAchievementEntry } from '../components/sessions/SessionAchievements';
import { SessionNote } from '../components/sessions/SessionNote';
import { useGames } from '../hooks/games';
import { useGameSessions, useSetSessionNote } from '../hooks/sessions';
import { useOverlayShortcut, useTimeFormat } from '../hooks/settings';
import { queryKeys } from '../hooks/queryKeys';
import { useDataChangedSync } from '../hooks/useDataChangedSync';
import { useImageSrc } from '../hooks/useImageSrc';
import { useLiveTimer } from '../hooks/useLiveTimer';
import {
  isRare,
  percentLabel,
  rarityAccent,
  sortForDisplay,
  ULTRA_RARE,
  ULTRA_VIOLET,
} from '../lib/achievements';
import { daysBetween, humanizeSpan } from '../lib/dateMath';
import {
  formatByPrecision,
  formatElapsed,
  formatHours,
  formatSessionEndTime,
  formatTime,
} from '../lib/format';
import { getGameStatusMeta } from '../lib/gameStatus';
import { cn } from '@/lib/utils';
import { OverlayToaster } from './OverlayToaster';
import type {
  AchievementEntry,
  GameListItem,
  SessionWithGame,
  TimeFormat,
} from '../../../shared/types';
import type { SessionId } from '../../../shared/entityIds';

// La capa del overlay in-game (OVERLAY.md + rediseño Fósforo, estados §8):
// un HUD COMPACTO arriba a la derecha sobre el juego, que sigue viéndose. El
// panel lleva el tiempo de la sesión en grande y dos pestañas:
//   · Session: la nota rápida (§7.2.1, con la MISMA mutación que el toast de
//     cierre) y el catálogo de logros entero, desbloqueados primero.
//   · History: la barra de HowLongToBeat (clonada de HowLongToBeatCard) y tu
//     historial con este juego, cada sesión con sus trofeos y su nota.
// No se pierde nada de la pantalla completa anterior: la hora y el día van en
// la cabecera del panel, y año, géneros, estado y momentos junto al título.
// Las dos pestañas se quedan MONTADAS (la oculta con `hidden`): el borrador de
// la nota, el scroll y las tandas de logros sobreviven al cambio de pestaña, y
// el coste es el mismo que cuando todo se veía a la vez.
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
// LA VENTANA ES TRANSPARENTE y mide el monitor entero (main/windows/overlay.ts;
// main.tsx le quita el fondo y el hueco de la TitleBar). Por eso el panel no
// usa backdrop-filter: dentro de una ventana transparente no hay nada que
// desenfocar, el juego lo compone Windows por detrás. El panel es casi opaco.
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

// El margen que el panel SIEMPRE conserva respecto a los bordes de la
// pantalla, pase lo que pase con el contenido — el overlay nunca toca borde a
// borde. En px y no en vh: la ventana ya es del tamaño del monitor, y en px es
// un número que se lee y se ajusta sin hacer cuentas.
const OVERLAY_VERTICAL_MARGIN = 44;

// Un título de sección dentro del panel: Barlow semibold en Bone, con su dato
// a la derecha en Dust.
const sectionTitleClass = 'text-small font-semibold text-bone';
const sectionMetaClass = 'ml-auto text-micro text-dust tabular-nums';

// Los colores de los tres tramos — LOS MISMOS de HowLongToBeatCard, que es
// lo que las hace la misma pieza (Tube, Tube hi y Phosphor).
const HLTB_MAIN = '#5fd3e0';
const HLTB_EXTRA = '#8ce4ee';
const HLTB_COMPLETIONIST = '#ffb347';
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

const Key = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <kbd className={kbdClass}>{children}</kbd>
);

// Un momento que está pasando AHORA (§7.2.3): celebratorio y sin interrumpir.
// Phosphor tenue, como las cifras clave de Fósforo.
const MomentChip = ({
  label,
  icon: Icon,
}: {
  label: string;
  icon: typeof Flame;
}): React.JSX.Element => (
  <span className="flex items-center gap-1.5 rounded-sm border border-phosphor/35 bg-phosphor-tint px-2 py-0.5 text-micro font-semibold text-phosphor">
    <Icon aria-hidden size={12} className="flex-none" />
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
      className="flex-1 rounded-sm border px-1.5 py-2 text-center transition-[opacity,box-shadow,border-color,background-color] duration-150"
      style={{
        opacity: dimmed ? 0.4 : 1,
        ...(reached || hovered
          ? { borderColor: `${color}5c`, background: `${color}17` }
          : { borderColor: 'var(--color-line)', background: 'var(--color-inset)' }),
        ...(hovered ? { boxShadow: `0 0 0 1px ${color}59, 0 0 14px ${color}33` } : {}),
      }}
    >
      <div className="mb-1 flex items-center justify-center gap-1">
        {reached ? (
          <Check size={10} color={color} strokeWidth={3.5} />
        ) : (
          <span className="h-2 w-2 flex-none rounded-xs" style={{ background: color }} />
        )}
        <span
          className="text-micro font-semibold whitespace-nowrap"
          style={{ color: reached || hovered ? color : 'var(--color-dust)' }}
        >
          {TIER_LABEL[tierKey]}
        </span>
      </div>
      <div
        className="font-display text-figure font-bold tabular-nums"
        style={{ color: reached || hovered ? color : 'var(--color-bone)' }}
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
}: {
  game: GameListItem;
  markerHours: number;
}): React.JSX.Element => {
  const [hoveredTier, setHoveredTier] = useState<TierKey | null>(null);
  const main = game.hltbMain ?? 0;
  const extra = game.hltbMainExtras ?? 0;
  const completionist = game.hltbCompletionist ?? 0;
  const hasData = main > 0 || extra > 0 || completionist > 0;

  if (!hasData) {
    return (
      <section className="flex-none border-b border-line px-4 py-3.5">
        <div className={sectionTitleClass}>How long to beat</div>
        <p className="mt-1 text-micro text-dust">
          No confident match for this one · {formatHours(markerHours)} played and counting
        </p>
      </section>
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
    <section className="flex-none border-b border-line px-4 pt-3.5 pb-4">
      <div className="flex items-baseline gap-2">
        <span className={sectionTitleClass}>How long to beat</span>
        <span className={sectionMetaClass}>
          {nextTier ? (
            <>
              <span className="font-semibold" style={{ color: TIER_COLOR[nextTier.key] }}>
                {formatHours(Math.max(0, nextTier.threshold - markerHours))}
              </span>{' '}
              to {TIER_LABEL[nextTier.key]}
            </>
          ) : (
            <span className="font-semibold text-phosphor">everything reached</span>
          )}
        </span>
      </div>

      {/* Barra y marcador CLONADOS de la card: pill de horas + aguja blanca
          con anillo oscuro y halo (entra la última, afterplay-drop-in), y
          tramos creciendo en cadena de izquierda a derecha. */}
      <div className="relative mt-7 mb-1">
        <div
          className="absolute -top-5.5 z-2 rounded-sm border border-line-strong bg-raised px-1.5 py-px text-micro font-semibold whitespace-nowrap text-bone tabular-nums shadow-lift motion-reduce:animate-none"
          style={{
            left: `${markerPct}%`,
            // Los tramos llevan transform (su crecido) y eso crea contexto de
            // apilado: sin z-index explícito, el marcador se pintaba debajo.
            animation: 'afterplay-drop-in 420ms ease-out 380ms both',
          }}
        >
          {formatHours(markerHours)}
        </div>
        <div
          className="absolute -top-1 z-2 h-5.5 w-0.75 rounded-xs bg-bone shadow-[0_0_0_2px_rgb(12_16_18/.85),0_0_12px_rgb(233_228_216/.5)] motion-reduce:animate-none"
          style={{
            left: `${markerPct}%`,
            animation: 'afterplay-drop-in 420ms ease-out 380ms both',
          }}
        />
        <div className="flex h-3 overflow-hidden rounded-xs bg-inset shadow-[inset_0_1px_3px_rgb(3_6_7/.4)]">
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
                className="origin-left transition-[opacity,filter] duration-150 motion-reduce:animate-none"
                style={{
                  width: `${segment.width}%`,
                  background: segment.background,
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

      <div className="mt-3 flex gap-1.5">
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
    </section>
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
    const percent = entry.globalPercent;
    const rare = unlocked && isRare(percent);
    const ultra = rare && (percent as number) < ULTRA_RARE;
    const accent = rarityAccent(percent);
    // El mismo material que la lista de la ficha (LOGROS-REDISENO §2), en
    // pequeño: el aro se gana con la rareza y el especular sube de grado.
    // Cero blur, cero pulso — chapa esmaltada, no rótulo luminoso.
    const iconShadow = unlocked
      ? ultra
        ? `inset 0 0 0 1.5px ${accent}, inset 0 1px 0 rgba(233,228,216,.3), 0 3px 8px rgba(3,6,7,.55)`
        : rare
          ? `inset 0 0 0 1px ${accent}b3, inset 0 1px 0 rgba(233,228,216,.24), 0 2px 6px rgba(3,6,7,.45)`
          : 'inset 0 0 0 1px rgba(233,228,216,.12), inset 0 1px 0 rgba(233,228,216,.14)'
      : 'inset 0 0 0 1px rgba(233,228,216,.07)';
    return (
      // flex-none por lo mismo que en SessionRow: dentro de un contenedor flex
      // con altura acotada, un hijo se encoge antes que desbordar — y una fila
      // de logro estrujada pierde su icono y su texto en vez de provocar el
      // scroll que toca.
      <div className="group -mx-2 flex flex-none items-center gap-2.5 rounded-sm px-2 py-1.5 transition-colors duration-150 hover:bg-bone/5">
        <span
          className={cn(
            'relative size-8.5 flex-none overflow-hidden rounded-sm bg-inset transition-[opacity,filter] duration-150',
            !unlocked && 'opacity-55 grayscale group-hover:opacity-80',
          )}
          style={{ boxShadow: iconShadow }}
        >
          {src ? (
            <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <span className="flex h-full w-full items-center justify-center">
              <Trophy size={14} className="text-dust/50" />
            </span>
          )}
          {unlocked && (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-sm"
              style={{
                background: `radial-gradient(120% 85% at 30% 12%, rgba(233,228,216,${ultra ? 0.28 : rare ? 0.22 : 0.14}), transparent 46%)`,
              }}
            />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              'block truncate text-small font-semibold',
              unlocked ? 'text-bone' : 'text-dust group-hover:text-bone/80',
            )}
          >
            {entry.displayName}
          </span>
          <span className="block truncate text-micro text-dust">
            {entry.description ?? (entry.hidden ? 'Hidden achievement' : '')}
          </span>
        </span>
        {entry.globalPercent !== null && (
          <span
            className="flex-none font-display text-[17px] leading-none font-bold tabular-nums"
            style={{ color: unlocked ? accent : 'var(--color-dust)' }}
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
// 28 de salida: en el panel se ven ~8 filas, así que son tres pantallazos y
// medio de colchón — ni un scroll rápido alcanza a la cola de tandas. Las
// tandas son las mismas 24 que el Plan: es lo que cabe holgado en un respiro
// de frame, medido allí.
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
// dependencias (`entries`) no cambian con el reloj, devuelve el mismo árbol y
// React se para ahí: 23 ms → 0,8 ms por tic.
//
// El día que alguien lo vuelva a meter en línea "para leerlo todo junto", el
// coste vuelve entero y sin avisar.
const AchievementsPanel = ({
  entries,
}: {
  entries: AchievementEntry[];
}): React.JSX.Element | null => {
  const [rowLimit, setRowLimit] = useState(INITIAL_ACHIEVEMENT_ROWS);

  // Los conseguidos con EL orden de la casa (lib/achievements.ts), no con una
  // ordenación propia por timestamp. La diferencia es `dateReliable`: cuando un
  // catálogo llega en bloque, syncAchievements marca sus logros con la fecha
  // del RESCATE, no la de la hazaña. Ordenando solo por fecha, esos falsos
  // recientes se colaban arriba y empujaban hacia abajo justo lo que este panel
  // existe para enseñar —lo que acabas de sacar esta noche—, mientras la ficha
  // y el modo TV los mandaban al final. El mismo catálogo contando dos cosas
  // distintas según la pantalla.
  const sorted = sortForDisplay(entries);
  const unlocked = sorted.filter((entry) => entry.unlockedAt !== null);
  // Los pendientes SÍ llevan orden propio (los más comunes primero: aquí se
  // mira "qué me falta que sea fácil", no el orden de Steam de la ficha).
  const locked = sorted
    .filter((entry) => entry.unlockedAt === null)
    .sort((a, b) => (b.globalPercent ?? -1) - (a.globalPercent ?? -1));
  const achievementsPercent =
    entries.length > 0 ? Math.round((unlocked.length / entries.length) * 100) : 0;
  // Los raros que YA tienes — el dato del que uno presume. En DOS cifras y con
  // los dos colores de la ficha (AchievementsSection) y del modo TV, y no una
  // sola: aquí se contaba con `isRare` a secas, que es "por debajo del 10%,
  // ULTRAS INCLUIDOS", y se pintaba en violeta. Así, un juego con uno al 7% y
  // dos al 3% decía "3 rare" en violeta mientras su propia ficha decía "1 rare"
  // en ámbar y "2 ultra" en violeta — la misma palabra contando dos cosas según
  // la ventana. La banda estrecha es la que comparten ficha, TV y el bloque de
  // Stats (getAchievementsOverview), así que es la que manda.
  const rareUnlocked = unlocked.filter((entry) => isRare(entry.globalPercent));
  const ultraCount = rareUnlocked.filter(
    (entry) => (entry.globalPercent as number) < ULTRA_RARE,
  ).length;
  const rareCount = rareUnlocked.length - ultraCount;

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
    <section className="flex min-h-48 flex-1 flex-col px-4 pt-3.5">
      {/* El porcentaje manda en Big Shoulders con el acento, y el conteo va a
          su lado en pequeño — el mismo reparto cifra-gorda/rótulo que Stats. */}
      <div className="flex flex-none items-baseline gap-2">
        <span className={sectionTitleClass}>Achievements</span>
        <span className="ml-auto text-micro text-dust tabular-nums">
          {unlocked.length} of {entries.length}
          {rareCount > 0 && <span className="text-phosphor"> · {rareCount} rare</span>}
          {ultraCount > 0 && <span style={{ color: ULTRA_VIOLET }}> · {ultraCount} ultra</span>}
        </span>
        <span className="font-display text-figure font-bold text-phosphor tabular-nums">
          {achievementsPercent}%
        </span>
      </div>
      <div className="mt-2 h-1 flex-none overflow-hidden rounded-full bg-inset">
        <div
          className="h-full rounded-full bg-phosphor shadow-glow-bar transition-[width] duration-700 ease-out motion-reduce:transition-none"
          style={{ width: `${achievementsPercent}%` }}
        />
      </div>

      {/* El catálogo ENTERO, con su propio scroll: el panel crece con flex-1
          hasta el hueco real de la pestaña y este scroll absorbe el resto. */}
      <div className="-mr-2 mt-2.5 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-2 pb-3">
        {unlocked.length > 0 && (
          <>
            <div className="text-micro font-semibold text-dust">Unlocked · {unlocked.length}</div>
            <div className="mt-1 mb-3 flex flex-col">
              {shownUnlocked.map((entry) => (
                <AchievementRow key={entry.id} entry={entry} unlocked />
              ))}
            </div>
          </>
        )}
        {locked.length > 0 && (
          <>
            <div className="text-micro font-semibold text-dust">
              Still locked · {locked.length} — most common first
            </div>
            <div className="mt-1 flex flex-col">
              {shownLocked.map((entry) => (
                <AchievementRow key={entry.id} entry={entry} unlocked={false} />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
};

// Una cifra del historial: rótulo en Dust y la cifra en Big Shoulders. La de
// la sesión más larga va en Phosphor (es la cifra clave del bloque).
const HistoryStat = ({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}): React.JSX.Element => (
  <div className="min-w-0 rounded-sm border border-line bg-inset px-2.5 py-2">
    <div className="text-micro text-dust">{label}</div>
    <div
      className={cn(
        'mt-1 font-display text-figure font-bold break-words tabular-nums',
        accent ? 'text-phosphor' : 'text-bone',
      )}
    >
      {value}
    </div>
  </div>
);

// La lista vacía COMPARTIDA de trofeos de una sesión — ver el memo de
// SessionRow y su sitio de uso.
const NO_UNLOCKS: SessionAchievementEntry[] = [];

// Una sesión del historial — el mismo dibujo que SessionRow en
// SessionHistoryList.tsx (la ficha del juego), en el ancho del HUD: misma
// pieza SessionAchievements y el mismo SessionNote por fila, para que saltar
// de la ficha al overlay no obligue a re-aprender cómo se lee una fila. Sin el
// borrar ni el destello dorado del aviso de cierre, que no tienen sentido
// sobre el juego en marcha.
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
        className={cn(
          'group/session relative flex flex-none items-start gap-3 overflow-hidden rounded-md border px-3 py-2.5',
          isLive ? 'border-phosphor/40 bg-phosphor-tint' : 'border-line bg-inset/60',
        )}
      >
        {fillPct > 0 && (
          <div
            className="pointer-events-none absolute inset-y-0 left-0 border-r-[1.5px] border-bone/14 bg-linear-to-r from-bone/5 to-bone/1"
            style={{ width: `${fillPct}%` }}
          />
        )}
        <div className="relative z-1 mt-0.5 flex size-7 flex-none items-center justify-center rounded-sm bg-bone/5">
          <Timer aria-hidden size={14} className={isLive ? 'text-phosphor' : 'text-dust'} />
        </div>
        <div className="relative z-1 min-w-0 flex-1">
          <div className="text-small font-semibold text-bone">
            {formatByPrecision(session.startedAt, session.datePrecision, timeFormat)}
            {endTime && <span className="font-normal text-dust"> → {endTime}</span>}
          </div>
          <div className={cn('mt-0.5 text-micro', isLive ? 'text-phosphor' : 'text-dust')}>
            {isLive ? 'Live now' : session.isManual ? 'Manual' : 'Tracked'}
          </div>

          {/* Los trofeos de la noche — la misma pieza que la ficha y la
            vista global de Sesiones. */}
          <SessionAchievements entries={achievements} />

          {/* El diario de ESTA sesión, editable aquí igual que en la ficha —
            no solo la de ahora mismo (esa la cubre la nota rápida de la
            pestaña Session): cualquier sesión pasada de este juego.

            key con la propia nota, y no es decorativo: SessionNote inicializa
            su borrador UNA vez con useState(note ?? '') y no vuelve a
            sincronizarlo con el prop nunca. Aquí —único sitio de la app donde
            DOS editores de la MISMA nota conviven: este y la nota rápida,
            porque la fila viva ES openSession— escribías la nota arriba,
            pulsabas el lapicero de la fila para releerla y el input se abría
            VACÍO (el '' del montaje); confirmar con Enter mandaba note:'' y
            BORRABA lo que acababas de escribir. Cambiar la nota cambia la key,
            así que el editor se remonta leyendo el valor de verdad.

            El precio, que no es gratis: remontar por VALOR también tira un
            borrador a medias. Si abres el lapicero de esta fila, escribes SIN
            confirmar y la nota cambia por fuera —guardando desde la nota
            rápida, o por el push del watcher cuando la escribe la ventana
            principal—, la key cambia, el editor se remonta y tu texto a medio
            escribir desaparece con él. Es estrecho y se acepta a sabiendas:
            perder cuatro palabras a medias duele menos que mandar note:'' y
            BORRAR la nota entera, que es lo que pasaba antes.

            El arreglo de fondo —que el borrador arranque del prop al ABRIR el
            editor, dentro de SessionNote, que curaría esto y además cubriría a
            la ficha del juego— NO está hecho: ese fichero es de otra zona. Esta
            key es una tirita local al overlay, no la cura. */}
          <SessionNote key={session.note ?? ''} sessionId={session.id} note={session.note} />
        </div>
        <div className="relative z-1 flex flex-none items-center gap-1.5 pt-0.5">
          {isRecord && <Flame aria-label="Your longest session" size={13} className="text-live" />}
          <span
            className={cn(
              'font-display text-figure font-bold tabular-nums',
              isLive ? 'text-phosphor' : 'text-bone',
            )}
          >
            {formatElapsed(durationSec)}
          </span>
        </div>
      </div>
    );
  },
);
SessionRow.displayName = 'SessionRow';

// Las dos pestañas del panel. El estado vive AQUÍ, en un componente que está
// dentro del árbol con key={openCount}: cada apertura del telón lo remonta y
// el HUD vuelve siempre a Session, donde está la nota que recibe el foco.
type HudTab = 'session' | 'history';
const HUD_TABS_ID = 'overlay-hud';

const HudTabs = ({
  sessionCount,
  session,
  history,
}: {
  sessionCount: number;
  session: React.ReactNode;
  history: React.ReactNode;
}): React.JSX.Element => {
  const [tab, setTab] = useState<HudTab>('session');
  const panelClass = 'min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain';
  return (
    <>
      <Tabs<HudTab>
        items={[
          { key: 'session', label: 'Session' },
          { key: 'history', label: 'History', count: String(sessionCount) },
        ]}
        value={tab}
        onChange={setTab}
        label="Overlay sections"
        idPrefix={HUD_TABS_ID}
        className="flex-none border-b border-line px-1.5"
      />
      <div
        role="tabpanel"
        id={tabPanelId(HUD_TABS_ID, 'session')}
        aria-labelledby={tabId(HUD_TABS_ID, 'session')}
        hidden={tab !== 'session'}
        className={cn(panelClass, tab === 'session' ? 'flex' : 'hidden')}
      >
        {session}
      </div>
      <div
        role="tabpanel"
        id={tabPanelId(HUD_TABS_ID, 'history')}
        aria-labelledby={tabId(HUD_TABS_ID, 'history')}
        hidden={tab !== 'history'}
        className={cn(panelClass, tab === 'history' ? 'flex' : 'hidden')}
      >
        {history}
      </div>
    </>
  );
};

export const OverlayHud = (): React.JSX.Element | null => {
  const queryClient = useQueryClient();
  const { data: games = [] } = useGames();
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
  // Solo las sesiones del juego en marcha (F-41): el HUD no necesita las demás.
  const { data: sessions = [] } = useGameSessions(live?.id ?? null);
  // null con nada en vivo: no se pide nada (catálogo vacío inofensivo), y el
  // orden de hooks queda estable (no se puede llamar condicionalmente).
  const { data: achievements } = useGameAchievements(live?.id ?? null);
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
  //
  // El oyente es el MISMO que el de la ventana principal (useDataChangedSync,
  // el único aviso 'data:changed' de §15.4); lo único propio del overlay es el
  // telón, que viaja como knob. Se lee por REF y la suscripción no depende de
  // él: volver a suscribirse en cada apertura no aportaría nada.
  const curtainDown = phase === 'hidden';
  const curtainDownRef = useRef(curtainDown);
  useEffect(() => {
    curtainDownRef.current = curtainDown;
  }, [curtainDown]);
  const shouldRefetch = useCallback(() => !curtainDownRef.current, []);
  useDataChangedSync(shouldRefetch);

  // Y el aviso de LOGROS, que es el que de verdad importa aquí: los
  // desbloqueos caen MIENTRAS juegas, y el de arriba solo se emite al abrir o
  // cerrar una sesión. Sin esta suscripción el catálogo se quedaba en la foto
  // del arranque de la partida — la tarjeta flotante cantaba el logro y este
  // panel seguía enseñándolo bloqueado hasta reiniciar la app, porque las
  // queries de logros son staleTime Infinity y nadie las invalidaba.
  //
  // Y ES LA REGLA DE LA CASA, no una copia: createAchievementsActivityInvalidator
  // (hooks/achievements.ts) es la misma que monta la ventana principal, traída
  // aquí porque aquel useAchievementsActivitySync vive en la raíz de la app
  // (Afterplay.tsx), un árbol que esta ventana no comparte.
  //
  // Lo que había era una segunda regla escrita a mano que descartaba los
  // 'progress' —diciendo que atenderlos sería "recargar el catálogo 300 veces",
  // cuando es justo al revés: son ellos los que SUPRIMEN el barrido mientras la
  // pasada corre— y ante cualquier 'synced' invalidaba el prefijo entero. Con
  // el HUD abierto durante una pasada de logros (cierre de sesión, alta de un
  // juego, vigilancia de emuladores), eso era un refetch del catálogo del juego
  // EN MARCHA por cada juego sincronizado, contra el mismo proceso main que
  // lleva la base y con el jugador delante.
  //
  // Lo único propio del overlay es el telón, y viaja como knob: bajado se marca
  // y no se pide (igual que el aviso de arriba). El efecto no depende de él a
  // propósito — volver a suscribirse en cada apertura recrearía el invalidador
  // y perdería el `passRunning` de su cierre, que es justo lo que distingue una
  // pasada de un desbloqueo suelto.
  useEffect(
    () =>
      window.api.achievements.onActivity(
        createAchievementsActivityInvalidator(queryClient, () => !curtainDownRef.current),
      ),
    [queryClient],
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
    const map = new Map<SessionId, SessionAchievementEntry[]>();
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
        // Sin este onError, un fallo (DB en pleno swap del sync, IPC caído)
        // dejaba el panel EXACTAMENTE igual que antes de pulsar: sin tick, sin
        // "Saved", sin nada. Y como el borrador se conserva —el `setDraft(null)`
        // solo corre en el éxito—, lo que se ve es tu texto ahí puesto, que es
        // justo la foto de "guardado". Con el juego detrás, nadie vuelve a
        // comprobarlo. Mismo aviso, palabra por palabra, que el editor de las
        // filas del historial (SessionNote).
        onError: (error) => {
          console.error('[overlay] fallo guardando la nota:', error);
          toast.error('Could not save the note — try again.');
        },
      },
    );
  };

  // Lo que se ve de la sesión de un vistazo, bajo el cronómetro.
  const longestSec = Math.max(longestPreviousSec, elapsed);

  return (
    <div
      key={openCount}
      ref={scrollRef}
      onClick={(event) => {
        if (event.target === event.currentTarget) window.api.overlay.dismiss();
      }}
      className={cn(
        'relative h-screen w-screen overflow-hidden',
        // Un velo que solo oscurece el lado del panel: el juego se sigue
        // viendo, pero el texto del HUD nunca compite con una escena clara.
        'bg-[linear-gradient(90deg,transparent_40%,rgb(8_11_12/.5))]',
        closing
          ? 'animate-out fade-out-0 fill-mode-forwards duration-200'
          : 'animate-in fade-in-0 duration-150',
      )}
    >
      {/* EL PANEL ACOTADO: nunca más alto que la pantalla menos un margen fijo
          arriba y abajo (OVERLAY_VERTICAL_MARGIN). Es un flex-col con altura
          máxima: cabecera, juego, cronómetro y pie llevan flex-none, y el
          único tramo elástico es la pestaña activa, que hace scroll por dentro
          — nunca un scroll de la ventana entera. */}
      <aside
        aria-label={`Afterplay overlay: ${live.title}`}
        className={cn(
          'absolute right-11 flex w-[440px] max-w-[calc(100vw-48px)] flex-col overflow-hidden rounded-md',
          'border border-line-strong bg-[rgb(16_20_22/.94)] shadow-modal',
        )}
        style={{
          top: OVERLAY_VERTICAL_MARGIN,
          maxHeight: `calc(100vh - ${OVERLAY_VERTICAL_MARGIN * 2}px)`,
        }}
      >
        {/* Líneas de escaneo muy tenues, la textura de Fósforo. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-(image:--scan) opacity-60"
        />

        {/* Cabecera: la marca y la hora del día, que jugando se pierde. */}
        <header className="relative flex h-11 flex-none items-center gap-2 border-b border-line px-4">
          <MonitorPlay aria-hidden size={16} className="flex-none text-phosphor" />
          <span className="text-small font-medium text-dust">Afterplay</span>
          <span className="ml-auto text-right text-micro text-dust tabular-nums">
            <span className="font-semibold text-bone">{formatTime(now, timeFormat)}</span>
            {' · '}
            {now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
          </span>
        </header>

        {/* El juego: carátula, título y datos, con el arte del juego muy
            apagado detrás (el mismo recurso que la cabecera de la ficha). */}
        <div className="relative flex-none overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute inset-0">
            {heroSrc ? (
              <img src={heroSrc} alt="" className="h-full w-full object-cover opacity-30" />
            ) : coverSrc ? (
              <img
                src={coverSrc}
                alt=""
                className="h-full w-full scale-110 object-cover opacity-30 blur-xl"
              />
            ) : null}
            <div className="absolute inset-0 bg-linear-to-b from-[rgb(16_20_22/.55)] to-[rgb(16_20_22/.97)]" />
          </div>

          <div className="relative flex items-start gap-3 px-4 pt-3.5">
            <GameCover
              url={live.coverUrl}
              className="h-[62px] w-11 flex-none overflow-hidden rounded-sm border border-line-strong shadow-lift"
              iconSize={16}
            />
            <div className="min-w-0 flex-1">
              <div className="text-lead font-semibold break-words text-bone">{live.title}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-micro text-dust">
                <span
                  aria-hidden
                  className="size-2 flex-none rounded-full bg-live animate-led-live motion-reduce:animate-none"
                />
                <span className="tabular-nums">
                  Session since {live.liveSince ? formatTime(live.liveSince, timeFormat) : '—'}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-micro text-dust">
                {live.releaseYear !== null && (
                  <span className="tabular-nums">{live.releaseYear}</span>
                )}
                {live.genres && live.genres.length > 0 && (
                  <>
                    {live.releaseYear !== null && <span className="text-bone/30">·</span>}
                    <span>{live.genres.slice(0, 3).join(' · ')}</span>
                  </>
                )}
                {status && (
                  <span
                    className="rounded-sm border px-1.5 py-px text-micro font-semibold"
                    style={{
                      color: status.color,
                      borderColor: `${status.color}55`,
                      background: 'rgb(8 11 12 / .55)',
                    }}
                  >
                    {status.label}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* El cronómetro manda: Big Shoulders en Phosphor, 104 px en una
              pantalla de 1080 y menos en una baja, para dejar sitio a la
              pestaña. */}
          <div className="relative px-4 pt-2 pb-3">
            <div
              className="font-display text-[clamp(64px,11vh,104px)] leading-[0.9] font-bold text-phosphor tabular-nums [text-shadow:0_0_28px_rgb(255_179_71/.35)]"
              aria-label={`This session: ${formatElapsed(elapsed)}`}
            >
              {formatElapsed(elapsed)}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-micro text-dust">
              <span>
                <span className="font-semibold text-bone tabular-nums">
                  {formatHours(hoursWithLive)}
                </span>{' '}
                total
              </span>
              <span>
                <span className="font-semibold text-bone tabular-nums">{gameSessions.length}</span>{' '}
                {gameSessions.length === 1 ? 'session' : 'sessions'}
              </span>
              <span>
                Longest{' '}
                <span className="font-semibold text-bone tabular-nums">
                  {formatHours(longestSec / 3600)}
                </span>
              </span>
            </div>
            {(isLongestSession || crossedMainStory) && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {isLongestSession && (
                  <MomentChip icon={Flame} label="Your longest session with this game" />
                )}
                {crossedMainStory && (
                  <MomentChip icon={Trophy} label="Past the main story length" />
                )}
              </div>
            )}
          </div>
        </div>

        <HudTabs
          sessionCount={gameSessions.length}
          session={
            <>
              {/* La nota rápida (§7.2.1): 3 líneas bastan para "dónde lo
                  dejo". Ctrl+Enter guarda. */}
              <section className="flex-none border-b border-line px-4 pt-3.5 pb-3.5">
                <div className="flex items-baseline gap-2">
                  <label htmlFor="overlay-quick-note" className={sectionTitleClass}>
                    Quick note
                  </label>
                  <span className={sectionMetaClass}>saved to this session</span>
                </div>
                <textarea
                  id="overlay-quick-note"
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
                  className={cn(
                    'mt-2 w-full resize-none rounded-sm border border-edge bg-inset px-3 py-2.5 text-body text-bone',
                    'transition-[border-color,box-shadow] duration-150 placeholder:text-dust',
                    'outline-hidden focus:border-phosphor focus:shadow-focus-field disabled:opacity-50',
                  )}
                />
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1 text-micro text-dust">
                    <Key>Ctrl</Key>+<Key>Enter</Key> saves
                  </span>
                  <button
                    type="button"
                    onClick={saveNote}
                    disabled={!openSession || draft === null || savingNote}
                    className={cn(primaryButtonClass, 'h-8.5 px-3.5 text-body')}
                  >
                    {savingNote ? (
                      <Loader2 size={14} className="animate-spin motion-reduce:animate-none" />
                    ) : savedFlash ? (
                      <Check size={14} className="animate-in zoom-in-50 duration-200" />
                    ) : null}
                    {savedFlash && draft === null ? 'Saved' : 'Save note'}
                  </button>
                </div>
              </section>

              <AchievementsPanel entries={entries} />
            </>
          }
          history={
            <>
              <HltbPanel game={live} markerHours={hoursWithLive} />

              {/* Tu historial con este juego: tres cifras y, debajo, TODAS las
                  sesiones — la de ahora arriba en Phosphor y las anteriores
                  con su barra de proporción contra la más larga. */}
              <section className="flex min-h-48 flex-1 flex-col px-4 pt-3.5">
                <div className="flex flex-none items-baseline gap-2">
                  <span className={sectionTitleClass}>Your history</span>
                  <span className={sectionMetaClass}>
                    {previousEndedAt !== null
                      ? `last played ${humanizeSpan(daysBetween(previousEndedAt, new Date()))} ago`
                      : 'first time here'}
                  </span>
                </div>
                <div className="mt-2.5 grid flex-none grid-cols-3 gap-1.5">
                  {/* La MISMA lista que se pinta debajo, la viva incluida — así
                      el número y las filas no pueden discrepar. El
                      sessionCount+1 de antes partía de un comentario falso
                      ("solo cuenta las cerradas"): getGames cuenta TODAS las
                      sesiones, la abierta también, así que jugando siempre
                      salía una de más. */}
                  <HistoryStat label="Sessions" value={String(gameSessions.length)} />
                  <HistoryStat label="Longest" value={formatHours(longestSec / 3600)} accent />
                  <HistoryStat
                    label="In library"
                    value={humanizeSpan(daysBetween(live.addedAt, new Date()))}
                  />
                </div>

                {gameSessions.length > 0 && (
                  <div className="mt-3 flex flex-col gap-2 pb-3.5">
                    {gameSessions.map((session) => (
                      <SessionRow
                        key={session.id}
                        session={session}
                        // La duración YA resuelta aquí, y no un `liveSeconds`
                        // para todas: el cronómetro solo es la duración de la
                        // fila VIVA (ver el memo de SessionRow). Las cerradas
                        // reciben su número de siempre, que no cambia con el
                        // segundo.
                        durationSec={
                          session.endedAt === null ? elapsed : (session.durationSec ?? 0)
                        }
                        maxDurationSec={longestSec}
                        isRecord={
                          session.durationSec !== null &&
                          session.durationSec > 0 &&
                          session.durationSec === longestPreviousSec
                        }
                        // NO_UNLOCKS y no `?? []`: un array nuevo por render le
                        // rompía el memo a todas las sesiones sin trofeos, que
                        // son la mayoría.
                        achievements={unlocksBySession.get(session.id) ?? NO_UNLOCKS}
                        timeFormat={timeFormat}
                      />
                    ))}
                  </div>
                )}
              </section>
            </>
          }
        />

        {/* El pie: cómo se vuelve al juego. */}
        <footer className="relative flex flex-none flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-4 py-2.5 text-micro text-dust">
          <span className="flex items-center gap-1.5">
            <Gamepad2 aria-hidden size={14} className="flex-none" />
            <Key>B</Key> closes
          </span>
          <span className="flex items-center gap-1.5">
            <Key>Esc</Key>
            {shortcut !== '' && (
              <>
                or <Key>{humanizeShortcut(shortcut)}</Key>
              </>
            )}
          </span>
          <button
            type="button"
            onClick={() => window.api.overlay.dismiss()}
            className={cn(secondaryButtonClass, 'ml-auto h-8 px-3 text-small')}
          >
            <X aria-hidden size={14} />
            Back to game
          </button>
        </footer>
      </aside>

      {/* DENTRO del árbol del HUD y no en main.tsx, por dos motivos: aquí solo
          existe con el telón arriba (Regla 1, "oculto = coste cero"), y viaja
          en el chunk del HUD, que ya arrastra sonner por SessionNote — montarlo
          arriba metería sonner en el chunk de ENTRADA, que pagan las dos
          ventanas. Lo que se acepta a cambio: un guardado que falle DESPUÉS de
          cerrar el telón levanta su aviso sin Toaster montado y se pierde; con
          la ventana ya oculta tampoco había dónde enseñarlo. */}
      <OverlayToaster />
    </div>
  );
};
