import type { LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { GameDetail } from '../../../../../shared/types';
import type { GameId } from '../../../../../shared/entityIds';
import { useImageSrc } from '../../../hooks/useImageSrc';
import { useOffscreenAnimation } from '../../../hooks/useOffscreenAnimation';
import { Grain, ScanBeam, Vignette } from '../../fx/Backdrop';
import { useCrtReveal } from '../../fx/crt';
import { GlowText } from '../../fx/GlowText';
import { focusRing } from '../../shell/controls';
import { Tabs, tabId, tabPanelId, type TabItem } from '../../ui/tabs';
import { CoverThumb } from '../add-game/CoverThumb';
import { StatusLed } from '../statusLed';
import { STATE_TO_STATUS_KEY, STATUS_META, type StatusKey } from '../../../lib/gameStatus';

// LA CABECERA DE LA FICHA (Fósforo, detail.png y README-ficha.md).
//
// En Overview manda el banner grande: arte del juego con protección abajo y a
// la izquierda, carátula, título en Big Shoulders, LED y estado, metadatos y
// las acciones. Al bajar, en cuanto el banner deja de verse, aparece arriba
// una banda compacta pegajosa con el título, el estado, las mismas acciones y
// las utilidades, y las pestañas se quedan pegadas debajo. En el resto de
// pestañas no hay banner: la banda compacta es la cabecera desde el principio
// (como si la página ya se hubiera desplazado).
//
// Las acciones se pintan con una función que recibe `compact`: cada sitio
// decide su tamaño. Mientras la banda compacta está a la vista, las del banner
// (que queda fuera de pantalla) se esconden para la accesibilidad y el foco,
// así nunca hay dos "Play" a la vez.

type HeaderSlots = {
  // Botones principales (Play/Stop, Edit, Add spend...).
  actions: (compact: boolean) => React.ReactNode;
  // Utilidades de icono (carátula, carpeta, refrescar, borrar).
  utilities: React.ReactNode;
  // LED + estado y lo que va en la línea de metadatos (avisos incluidos).
  status: React.ReactNode;
  meta: React.ReactNode;
  // Pastilla en vivo ("Playing on Living room PC 0:42:10") junto a los botones.
  live?: React.ReactNode;
};

type DetailLayoutProps<K extends string> = HeaderSlots & {
  game: GameDetail;
  tabs: TabItem<K>[];
  tab: K;
  onTabChange: (key: K) => void;
  // La pestaña que lleva el banner grande (Overview).
  bannerTab: K;
  // Avisos a todo el ancho entre la cabecera y las pestañas (fusionar...).
  notices?: React.ReactNode;
  children: React.ReactNode;
  // Diálogos y modales: fuera del scroller para no heredar su contexto.
  overlays?: React.ReactNode;
};

// Cuánto tiene que quedar del banner a la vista para seguir sin banda
// compacta: lo que mide la propia banda.
const COMPACT_BAND_PX = 96;

export const DetailLayout = <K extends string>({
  game,
  tabs,
  tab,
  onTabChange,
  bannerTab,
  notices,
  children,
  overlays,
  ...slots
}: DetailLayoutProps<K>): React.JSX.Element => {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const [bannerOut, setBannerOut] = useState(false);
  const withBanner = tab === bannerTab;
  const compact = !withBanner || bannerOut;
  const heroSrc = useImageSrc(game.heroUrl, 'heroes');
  // ¿Primera vez que se abre esta ficha desde que arrancó la app? Se lee al
  // montar y se apunta en un efecto (no en el inicializador, que el modo
  // estricto llama dos veces).
  const [firstOpen] = useState(() => !openedThisSession.has(game.id));
  useEffect(() => {
    openedThisSession.add(game.id);
  }, [game.id]);
  // Lo que mide la banda compacta flotante (envuelve en ventanas estrechas).
  const [bandHeight, setBandHeight] = useState(0);
  const bandObserver = useRef<ResizeObserver | null>(null);
  const bandRef = (node: HTMLDivElement | null): void => {
    bandObserver.current?.disconnect();
    bandObserver.current = null;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setBandHeight(Math.round(entry.borderBoxSize[0]?.blockSize ?? node.offsetHeight)),
    );
    observer.observe(node);
    bandObserver.current = observer;
  };

  useEffect(() => {
    const root = scrollerRef.current;
    const banner = bannerRef.current;
    if (!withBanner || !root || !banner) return;
    const observer = new IntersectionObserver(([entry]) => setBannerOut(!entry.isIntersecting), {
      root,
      rootMargin: `-${COMPACT_BAND_PX}px 0px 0px 0px`,
      threshold: 0,
    });
    observer.observe(banner);
    return () => {
      observer.disconnect();
      setBannerOut(false);
    };
  }, [withBanner]);

  // Cambiar de pestaña vuelve arriba: cada una es su propia página.
  const handleTabChange = (key: K): void => {
    onTabChange(key);
    scrollerRef.current?.scrollTo({ top: 0 });
  };

  const tabBar = (
    <div className="border-b border-line bg-cabinet/95 backdrop-blur-sm">
      <div className="mx-auto max-w-[1600px] px-6">
        <Tabs
          items={tabs}
          value={tab}
          onChange={handleTabChange}
          label="Game sections"
          idPrefix="game-detail"
          className="-mx-4.5"
          sliding
        />
      </div>
    </div>
  );

  // El panel de la pestaña "se enciende" al cambiar: solo brillo y opacidad
  // (variante screen, sin geometría), para que nada mida cajas a medio
  // escalar. Remonta por key, así que el hook arranca solo.
  const panelRef = useCrtReveal<HTMLDivElement>('screen', tab);

  // Una sola estructura para las dos cabeceras: la barra de pestañas ocupa
  // SIEMPRE el mismo sitio del árbol, así no se remonta al pasar de Overview
  // a otra pestaña y su raya puede deslizarse en vez de aparecer de nuevo.
  return (
    <div ref={scrollerRef} className="h-full overflow-y-auto">
      {withBanner && (
        <div ref={bannerRef}>
          <DetailBanner
            game={game}
            heroSrc={heroSrc}
            hidden={compact}
            firstOpen={firstOpen}
            {...slots}
          />
        </div>
      )}
      {withBanner && notices}
      {/* Con banner, la banda compacta cuelga POR ENCIMA de las pestañas
          (bottom-full) y las pestañas se pegan a su altura: aparecer no empuja
          nada del flujo, así que el scroll no salta. Sin banner, la banda ES la
          cabecera y va en el flujo. */}
      <div className="sticky z-30" style={{ top: withBanner && compact ? bandHeight : 0 }}>
        {withBanner ? (
          compact && (
            <div
              ref={bandRef}
              className={cn(
                'absolute inset-x-0 bottom-full',
                // Entra deslizándose desde arriba, como una persiana corta.
                'animate-in fade-in-0 slide-in-from-top-3 duration-260 ease-out',
                'motion-reduce:slide-in-from-top-0',
              )}
            >
              <CompactBand game={game} heroSrc={heroSrc} asHeading={false} {...slots} />
            </div>
          )
        ) : (
          <CompactBand game={game} heroSrc={heroSrc} asHeading {...slots} />
        )}
        {tabBar}
      </div>
      {!withBanner && notices}

      <div
        key={`${game.id}-${tab}`}
        ref={panelRef}
        role="tabpanel"
        id={tabPanelId('game-detail', tab)}
        aria-labelledby={tabId('game-detail', tab)}
        className="mx-auto max-w-[1600px] px-6 pt-7 pb-28"
      >
        {children}
      </div>

      {overlays}
    </div>
  );
};

// Las fichas que ya se han abierto en esta sesión de la app: el título solo
// se enciende con parpadeo la primera vez (luego sería un tic, no un momento).
const openedThisSession = new Set<GameId>();

// Fondo compartido por banner y banda: el arte del juego (o, sin él, los
// anillos de fósforo de detail.png) con la protección de Fósforo encima.
const HeaderArt = ({
  heroSrc,
  compact,
}: {
  heroSrc: string | null;
  compact: boolean;
}): React.JSX.Element => {
  // Ken Burns solo en el banner grande, y en pausa cuando sale de la vista
  // (al bajar por la ficha el banner sigue montado, fuera de pantalla).
  const { observe, playState } = useOffscreenAnimation();
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {heroSrc ? (
        <img
          ref={compact ? undefined : observe}
          src={heroSrc}
          alt=""
          className={cn(
            'absolute inset-0 h-full w-full object-cover',
            compact
              ? 'object-[50%_30%] opacity-45'
              : 'animate-ken-burns object-[50%_25%] motion-reduce:animate-none',
          )}
          style={compact ? undefined : { animationPlayState: playState }}
        />
      ) : (
        <div className="absolute inset-0 bg-panel">
          <div className="absolute inset-0 bg-[repeating-radial-gradient(circle_at_50%_48%,rgb(255_179_71/0.16)_0_1px,transparent_1px_9px)] [mask-image:radial-gradient(closest-side_at_50%_48%,black,transparent)]" />
        </div>
      )}
      <div className="absolute inset-0 bg-(image:--scan) opacity-60" />
      {/* El banner es un héroe: grano, viñeta y un haz que lo barre de vez en
          cuando. Por debajo de la protección y del texto. */}
      {!compact && (
        <>
          <Grain />
          <Vignette />
          <ScanBeam every={9} />
        </>
      )}
      <div className="absolute inset-0 bg-(image:--protect-side)" />
      <div
        className={cn(
          'absolute inset-0',
          compact
            ? 'bg-[linear-gradient(0deg,var(--color-cabinet)_0%,rgb(16_20_22/0.82)_60%,rgb(16_20_22/0.7)_100%)]'
            : 'bg-(image:--protect-bottom)',
        )}
      />
    </div>
  );
};

const DetailBanner = ({
  game,
  heroSrc,
  hidden,
  actions,
  utilities,
  status,
  meta,
  live,
  firstOpen,
}: HeaderSlots & {
  game: GameDetail;
  heroSrc: string | null;
  // La banda compacta está a la vista: este juego de acciones (fuera de
  // pantalla) se aparta del foco y de la accesibilidad.
  hidden: boolean;
  // Primera vez que se abre la ficha en esta sesión: el título se enciende.
  firstOpen: boolean;
}): React.JSX.Element => (
  <header className="relative flex min-h-90 flex-col justify-end overflow-hidden">
    <HeaderArt heroSrc={heroSrc} compact={false} />

    <div
      className={cn('absolute top-5 right-6 z-10 flex items-center gap-2', hidden && 'invisible')}
      inert={hidden}
    >
      {utilities}
    </div>

    <div className="relative mx-auto flex w-full max-w-[1600px] flex-wrap items-end gap-x-8 gap-y-5 px-6 pt-20 pb-7">
      <div className="flex min-w-0 flex-[1_1_520px] items-end gap-6">
        <div className="hidden h-39 w-29 flex-none overflow-hidden rounded-sm bg-raised shadow-lift ring-1 ring-line-strong sm:block">
          <CoverThumb url={game.coverUrl} alt="" className="h-full w-full object-cover" />
        </div>
        <div className="min-w-0 flex-1">
          {/* Bloom de fósforo sobre el arte (tono bone: halo ámbar suave) y,
              la primera vez que se abre en la sesión, parpadeo de tubo. */}
          <GlowText
            as="h1"
            tone="bone"
            flicker={firstOpen}
            className="m-0 font-display text-[clamp(44px,5.4vw,84px)] leading-[0.94] font-bold tracking-[0.005em] text-balance text-bone [overflow-wrap:anywhere]"
          >
            {game.title}
          </GlowText>
          <div className="mt-3.5 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-body text-bone">
            {status}
            {meta}
          </div>
        </div>
      </div>

      <div
        className={cn('flex flex-wrap items-center justify-end gap-2.5', hidden && 'invisible')}
        inert={hidden}
      >
        {live}
        {actions(false)}
      </div>
    </div>
  </header>
);

const CompactBand = ({
  game,
  heroSrc,
  asHeading,
  actions,
  utilities,
  status,
  meta,
  live,
}: HeaderSlots & {
  game: GameDetail;
  heroSrc: string | null;
  // En las pestañas sin banner la banda ES la cabecera, y su título el h1.
  asHeading: boolean;
}): React.JSX.Element => {
  const Title = asHeading ? 'h1' : 'div';
  return (
    <div className="relative min-h-24 overflow-hidden border-b border-line bg-cabinet">
      <HeaderArt heroSrc={heroSrc} compact />
      <div className="relative mx-auto flex min-h-24 max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-3 px-6 py-3.5">
        <div className="min-w-0 flex-[1_1_360px]">
          <Title className="m-0 font-display text-[clamp(30px,3vw,46px)] leading-[1.02] font-bold text-bone [overflow-wrap:anywhere]">
            {game.title}
          </Title>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-bone">
            {status}
            {meta}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2.5">
          {live}
          {actions(true)}
          <span aria-hidden className="mx-1.5 h-8 w-px bg-line-strong" />
          <div className="flex items-center gap-2">{utilities}</div>
        </div>
      </div>
    </div>
  );
};

// Separador vertical de la línea de metadatos ("Playing | RPG | PC | 2025").
export const MetaSeparator = (): React.JSX.Element => (
  <span aria-hidden className="h-3.5 w-px flex-none bg-line-strong" />
);

// Botón de utilidad de la cabecera: icono de 34 px sobre cristal oscuro, con
// title para el tooltip y aria-label. `danger` tiñe de Live al pasar el ratón.
export const HeaderUtilityButton = ({
  icon: Icon,
  label,
  onClick,
  disabled,
  danger,
  spinning,
  title,
  className,
  style,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  spinning?: boolean;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
}): React.JSX.Element => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title ?? label}
    aria-label={label}
    style={style}
    className={cn(
      'flex size-8.5 flex-none items-center justify-center rounded-sm border border-line-strong bg-cabinet/70 text-bone backdrop-blur-sm',
      'transition-[background-color,border-color,color,transform,scale] duration-150 ease-out active:scale-[.97] motion-reduce:active:scale-100',
      'disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100',
      danger
        ? 'enabled:hover:border-live/60 enabled:hover:bg-live/14 enabled:hover:text-live'
        : 'enabled:hover:border-line-hover enabled:hover:bg-raised-hover',
      focusRing,
      className,
    )}
  >
    <Icon size={16} className={spinning ? 'animate-spin motion-reduce:animate-none' : undefined} />
  </button>
);

// El estado y los metadatos de la línea bajo el título, compartidos por la
// ficha de biblioteca y la del Plan.
const statusKeyOfDetail = (game: GameDetail): StatusKey =>
  game.planned
    ? 'plan'
    : game.currentState === null
      ? 'unplayed'
      : STATE_TO_STATUS_KEY[game.currentState];

// "Playing | RPG, Turn-based | PC | 2025" — la línea bajo el título.
export const DetailMeta = ({
  game,
  extra,
}: {
  game: GameDetail;
  extra?: React.ReactNode;
}): React.JSX.Element => {
  const parts = [
    game.genres?.length ? game.genres.join(', ') : null,
    game.officialPlatforms?.length ? game.officialPlatforms.join(', ') : null,
    game.releaseYear ? String(game.releaseYear) : null,
  ].filter((part): part is string => part !== null);
  return (
    <>
      {parts.map((part) => (
        <span key={part} className="contents">
          <MetaSeparator />
          <span className="[overflow-wrap:anywhere]">{part}</span>
        </span>
      ))}
      {extra}
    </>
  );
};

// `live`: hay una sesión en marcha. El LED cobra vida: respira y suelta un
// anillo que se expande, como el de las tarjetas «en marcha» de Home.
export const DetailStatus = ({
  game,
  live = false,
}: {
  game: GameDetail;
  live?: boolean;
}): React.JSX.Element => {
  const key = statusKeyOfDetail(game);
  return (
    <span className="flex items-center gap-2 font-semibold">
      <span className="relative inline-flex flex-none">
        {live && (
          <span
            aria-hidden
            className="absolute inset-0 animate-led-ring rounded-full bg-phosphor motion-reduce:hidden"
          />
        )}
        <StatusLed
          status={key}
          className={cn(
            live &&
              'animate-led-live shadow-[0_0_8px_rgb(255_179_71/0.7)] motion-reduce:animate-none',
          )}
        />
      </span>
      {STATUS_META[key].label}
    </span>
  );
};
