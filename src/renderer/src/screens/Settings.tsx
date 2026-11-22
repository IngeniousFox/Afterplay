import { lazy, Suspense, useRef } from 'react';
import { Navigate, NavLink, useLocation, useParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { CrtReveal, SlidingIndicator } from '../components/fx';
import { focusRingInset } from '../components/shell/controls';
import {
  isSettingsSection,
  SETTINGS_SECTIONS,
  settingsPath,
  type SettingsLocationState,
} from '../components/layout/SettingsSections';
import { LoadingNotice } from '../components/ui/loading-notice';
import { useDevices } from '../hooks/devices';
import { useAppVersion } from '../hooks/settings';

// Los controles de cada sección se cargan aparte: abrir la app no paga por
// formularios de claves, escaneos ni barras de disco que casi nunca se miran.
const SettingsContent = lazy(() =>
  import('../components/layout/SettingsContent').then((module) => ({
    default: module.SettingsContent,
  })),
);

// AJUSTES COMO PÁGINA (Fósforo: settings.png y estados-ajustes-*.png). Antes
// era un modal de 760 px con seis pestañas; ahora ocupa la pantalla con un
// índice de 230 px a la izquierda y la sección a la derecha, cada una con su
// propia URL (/settings/<sección>).
//
// Ajustes sigue tranquilo: la píldora y el filo ámbar del índice se deslizan
// de sección en sección con un muelle corto (SlidingIndicator vertical) y la
// sección nueva se enciende con un destello de tubo sutil (CrtReveal
// "screen", sin geometría). Nada más se mueve.
export const Settings = (): React.JSX.Element => {
  const { section } = useParams();
  const navRef = useRef<HTMLElement | null>(null);
  const location = useLocation();
  const { data: appVersion } = useAppVersion();
  const { data: devices } = useDevices();

  if (!isSettingsSection(section)) return <Navigate to={settingsPath('general')} replace />;

  const current =
    SETTINGS_SECTIONS.find((candidate) => candidate.id === section) ?? SETTINGS_SECTIONS[0];
  // El aviso de bienvenida de las claves viaja en el estado de la navegación:
  // es de ESA apertura (primer arranque, aviso de Home), no de la URL.
  const spotlight =
    section === 'integrations' &&
    (location.state as SettingsLocationState)?.credentialsSpotlight === true;
  const thisDevice = devices?.find((device) => device.isThisDevice);

  return (
    <div className="flex h-full" data-testid="settings-page">
      <aside className="flex w-[230px] flex-none flex-col border-r border-line px-3.5 pt-6 pb-5">
        <h1 className="px-2.5 font-display text-page font-bold text-bone">Settings</h1>
        <nav
          ref={navRef}
          aria-label="Settings sections"
          className="relative isolate mt-6 flex flex-col gap-0.5"
        >
          {/* La píldora Raised y el filo Phosphor de la sección activa: dos
              indicadores que viajan juntos (los enlaces solo cambian de
              color). Sin sección activa, se funden. */}
          <SlidingIndicator
            containerRef={navRef}
            activeKey={section}
            axis="y"
            className="inset-x-0 -z-10 rounded-sm bg-raised"
          />
          <SlidingIndicator
            containerRef={navRef}
            activeKey={section}
            axis="y"
            inset={6}
            className="left-0 w-0.5 rounded-full bg-phosphor shadow-glow-bar"
          />
          {SETTINGS_SECTIONS.map(({ id, label, icon: Icon }) => (
            <NavLink
              key={id}
              to={settingsPath(id)}
              className={cn(
                'relative flex h-9.5 items-center gap-3 rounded-sm px-2.5 text-body text-dust transition-colors duration-150',
                'hover:bg-bone/5 hover:text-bone aria-[current=page]:font-semibold aria-[current=page]:text-bone aria-[current=page]:hover:bg-transparent',
                focusRingInset,
              )}
            >
              <Icon aria-hidden size={16} className="flex-none" />
              {label}
            </NavLink>
          ))}
        </nav>
        {/* La versión y el PC al pie del índice: no son ajustes de ninguna
            sección, son datos de esta instalación. */}
        <div className="mt-auto px-2.5 text-micro text-dust">
          {appVersion && <div>Afterplay {appVersion}</div>}
          {thisDevice && <div>{thisDevice.name} · this PC</div>}
        </div>
      </aside>

      {/* key: cambiar de sección vuelve arriba y relanza la entrada, que se
          enciende como un tubo (solo brillo y opacidad). */}
      <CrtReveal key={section} variant="screen" className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[1340px] flex-col gap-5 px-9 pt-6 pb-12 animate-screen-in">
          <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h2 className="font-display text-page font-bold text-bone">{current.label}</h2>
            <p className="text-small text-dust">{current.blurb}</p>
          </header>
          <Suspense fallback={<LoadingNotice label="Loading settings…" className="min-h-32" />}>
            <SettingsContent section={section} credentialsSpotlight={spotlight} />
          </Suspense>
        </div>
      </CrtReveal>
    </div>
  );
};
