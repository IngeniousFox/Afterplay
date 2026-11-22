import { useQuery } from '@tanstack/react-query';
import { Settings } from 'lucide-react';
import { Link } from 'react-router-dom';
import { fetchSessions, fetchStats } from '../api';
import type { StateType, StatsSummary } from '../api';
import { Cover } from '../components/Cover';
import { Figure, Led } from '../components/Figure';
import { LiveBadge, LiveTimer } from '../components/LiveBadge';
import { PageHeader, SectionTitle } from '../components/PageHeader';
import { useCrtReveal } from '../components/fx/crt';
import { CrtFlash } from '../components/fx/CrtReveal';
import { chartGroup, growX } from '../components/fx/chart';
import { ScanBeam } from '../components/fx/Backdrop';
import { GlowText } from '../components/fx/GlowText';
import { loopPlayClass } from '../components/fx/motion';
import { Ticker } from '../components/fx/Ticker';
import { useInView } from '../components/fx/viewport';
import { VuMeter } from '../components/fx/VuMeter';
import { ErrorState, Loading } from '../components/States';
import { cn } from '../lib/cn';
import { formatHours, pluralize, relativeDay } from '../lib/format';
import { statusOf } from '../lib/status';
import {
  iconButtonClass,
  ledClass,
  primaryButtonClass,
  revealClass,
  revealDelay,
  rowLinkClass,
} from '../lib/styles';

// "Sun, Nov 22": la fecha de hoy en la cabecera, en inglés como el resto.
const todayLabel = (): string =>
  new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

// La sesión en marcha, en grande. Es la razón de que esta portada exista: una
// sesión abierta es una fila con endedAt a null, o sea que se ve desde fuera
// sin que el PC de casa esté encendido ni haya que inventar ningún canal
// (§2.1). Zona héroe de Fósforo: la carátula de fondo, líneas de escaneo y el
// degradado que protege el texto.
const LiveCard = ({ live }: { live: NonNullable<StatsSummary['live']> }): React.JSX.Element => {
  // La tarjeta «se enciende» como un tubo (scaleY y opacidad) con su destello.
  const ref = useCrtReveal<HTMLElement>('panel');
  return (
    <section
      ref={ref}
      aria-label="Playing now"
      className="relative overflow-hidden rounded-md border border-line-strong bg-panel"
    >
      <CrtFlash />
      <div className="relative h-36 overflow-hidden bg-raised">
        {live.coverUrl && (
          <img
            src={live.coverUrl}
            alt=""
            className={cn(
              'h-full w-full scale-110 object-cover blur-md brightness-[.55]',
              'animate-ken-burns [--ken-scale:1.22] motion-reduce:animate-none',
              loopPlayClass,
            )}
          />
        )}
        <div aria-hidden="true" className="absolute inset-0 bg-(image:--scan)" />
        <ScanBeam every={7} />
        <div aria-hidden="true" className="absolute inset-0 bg-(image:--protect-bottom)" />
        <div className="absolute right-4 bottom-3 left-4 flex items-end gap-3">
          <Cover url={live.coverUrl} title={live.gameTitle} className="w-16 shadow-lift" />
          <div className="min-w-0 flex-1 pb-0.5">
            <span className="flex items-center gap-2">
              <LiveBadge label="Session running" />
              <VuMeter bars={5} />
            </span>
            <GlowText
              as="h2"
              tone="bone"
              className="mt-1 font-display text-title font-bold text-bone"
            >
              {live.gameTitle}
            </GlowText>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 p-4">
        <LiveTimer since={live.since} />
        <Link to={`/game/${live.gameId}`} className={primaryButtonClass}>
          Open game
        </Link>
      </div>
    </section>
  );
};

// Cifra de la fila de arriba: número en Big Shoulders y su etiqueta debajo.
// Entra contando como un marcador (Ticker); la de las horas, con bloom.
const Stat = ({
  value,
  format,
  label,
  accent = false,
}: {
  value: number;
  format: (value: number) => string;
  label: string;
  accent?: boolean;
}): React.JSX.Element => (
  <div className="min-w-0 flex-1 border-l border-line pl-3 first:border-l-0 first:pl-0">
    <Ticker
      value={value}
      format={format}
      className="block"
      render={(text) => (
        <Figure
          value={text}
          className={cn(
            'block text-[40px] leading-[42px]',
            accent
              ? 'text-phosphor [text-shadow:0_0_1px_rgb(255_179_71/0.45),0_0_16px_rgb(255_179_71/0.32)]'
              : 'text-bone',
          )}
        />
      )}
    />
    <div className="mt-1 text-micro text-dust">{label}</div>
  </div>
);

const wholeNumber = (value: number): string => String(Math.round(value));

// El reparto por estado, en una barra apilada: cuánto has terminado frente a
// cuánto te queda, de un vistazo.
//
// El denominador es la biblioteca ENTERA (totalGames): los cinco estados más
// "sin estado" suman exactamente eso (worker/src/queries/stats.ts). On Hold y
// Resting van con SU etiqueta (comparten el LED violeta de Fósforo) y solo si
// los hay; el hueco sin pintar es Unplayed.
const StatusBar = ({ stats }: { stats: StatsSummary }): React.JSX.Element | null => {
  const counted: { state: StateType; count: number; always: boolean }[] = [
    { state: 'started', count: stats.playing, always: true },
    { state: 'completed', count: stats.beaten, always: true },
    { state: 'on_hold', count: stats.onHold, always: false },
    { state: 'resting', count: stats.resting, always: false },
    { state: 'dropped', count: stats.dropped, always: true },
  ];
  const segments = counted.filter(({ count, always }) => always || count > 0);

  const { observe, inView } = useInView();
  const known = stats.totalGames;
  if (known === 0) return null;

  return (
    <section className={revealClass} style={revealDelay(2, 60)}>
      <SectionTitle aside={pluralize(known, 'game')}>Your library</SectionTitle>
      {/* La barra crece al entrar en la vista, tramo a tramo de izquierda a
          derecha (scaleX desde su borde izquierdo). */}
      <div
        ref={observe}
        data-inview={inView || undefined}
        className={cn(chartGroup, 'flex h-2 gap-px overflow-hidden rounded-xs bg-bone/8')}
      >
        {segments.map(({ state, count }, index) => (
          <div
            key={state}
            className={cn(ledClass(state), growX)}
            style={{ width: `${(count / known) * 100}%`, animationDelay: `${120 + index * 110}ms` }}
          />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
        {segments.map(({ state, count }) => (
          <li key={state} className="flex items-center gap-2 text-small">
            <Led state={state} />
            <span className="text-dust">{statusOf(state).label}</span>
            <span className="ml-auto font-display text-figure font-bold text-bone">{count}</span>
          </li>
        ))}
        <li className="flex items-center gap-2 text-small">
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-bone/25" />
          <span className="text-dust">Unplayed</span>
          <span className="ml-auto font-display text-figure font-bold text-bone">
            {stats.unplayed}
          </span>
        </li>
      </ul>
    </section>
  );
};

export const Home = (): React.JSX.Element => {
  const stats = useQuery({ queryKey: ['stats'], queryFn: fetchStats });
  const recent = useQuery({ queryKey: ['sessions', 'recent'], queryFn: () => fetchSessions(6) });

  const header = (
    <PageHeader
      title="Tonight"
      aside={
        <>
          <span>{todayLabel()}</span>
          {/* Ajustes no es una pestaña: se usa una vez cada mucho (emparejar
              un PC), así que vive aquí y no se come un hueco de la barra. */}
          <Link to="/settings" aria-label="Settings" className={cn(iconButtonClass, '-mr-3')}>
            <Settings size={20} strokeWidth={1.8} />
          </Link>
        </>
      }
    />
  );

  if (stats.isPending)
    return (
      <div className="px-4">
        {header}
        <Loading label="Reading your library" />
      </div>
    );
  if (stats.isError)
    return (
      <div className="px-4">
        {header}
        <ErrorState error={stats.error} onRetry={() => stats.refetch()} />
      </div>
    );

  const summary = stats.data;

  return (
    <div className="flex flex-col gap-6 px-4 pb-6">
      <div>
        {header}
        {/* Las horas del año siguen la misma regla que Stats filtrado por año:
            sesiones de ese año MÁS las horas manuales atribuidas a él. */}
        <div className={cn(revealClass, 'flex border-t border-line pt-4')}>
          <Stat
            value={summary.hoursThisYear}
            format={formatHours}
            label={`in ${summary.year}`}
            accent
          />
          <Stat
            value={summary.gamesThisYear}
            format={wholeNumber}
            label={`games in ${summary.year}`}
          />
          <Stat value={summary.totalSessions} format={wholeNumber} label="sessions" />
        </div>
      </div>

      {summary.live && <LiveCard live={summary.live} />}

      <StatusBar stats={summary} />

      {/* Las sesiones recientes: el "qué he estado haciendo" que justifica
          abrir esto en un tren. Solo si hay alguna — una sección vacía no
          aporta nada. */}
      {recent.data && recent.data.sessions.length > 0 && (
        <section className={revealClass} style={revealDelay(3, 60)}>
          <SectionTitle
            aside={
              <Link
                to="/sessions"
                className="-my-3 inline-flex min-h-11 items-center px-1 font-semibold text-phosphor"
              >
                See all
              </Link>
            }
          >
            Recently played
          </SectionTitle>
          <ul className="border-t border-line">
            {recent.data.sessions.map((session) => (
              <li key={session.id} className="border-b border-line">
                <Link to={`/game/${session.gameId}`} className={rowLinkClass}>
                  <Cover url={session.coverUrl} title={session.gameTitle} className="w-10" />
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-body font-semibold text-bone">
                      {session.gameTitle}
                    </div>
                    <div className="mt-0.5 text-small text-dust">
                      {relativeDay(session.startedAt)}
                    </div>
                  </div>
                  {session.durationSec !== null ? (
                    <Figure
                      value={formatHours(session.durationSec / 3600)}
                      className="shrink-0 text-[24px] leading-none text-bone"
                    />
                  ) : (
                    <LiveBadge label="now" />
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-center text-small text-dust">
        {pluralize(summary.playedGames, 'game')} played of {summary.totalGames}
      </p>
    </div>
  );
};
