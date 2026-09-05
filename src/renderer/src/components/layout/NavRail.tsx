import { BarChart3, Bookmark, Clock, Gamepad2 } from 'lucide-react';
import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { usePendingSessions } from '../../hooks/sessions';
import { useCredentials } from '../../hooks/settings';
import { AMBER } from '../../lib/colors';
import { SettingsModal } from './SettingsModal';
import { GREEN } from '../../lib/colors';
import firefly from '../../../../../resources/icon.png';
import { preloadStatsRoute } from '../../lib/statsRoute';

type NavItem = {
  to: string;
  Icon: typeof Gamepad2;
  size: number;
  label: string;
};

const NAV_ITEMS: NavItem[] = [
  { to: '/games', Icon: Gamepad2, size: 22, label: 'Games' },
  { to: '/plan', Icon: Bookmark, size: 21, label: 'Plan to play' },
  { to: '/sessions', Icon: Clock, size: 21, label: 'Sessions' },
  { to: '/stats', Icon: BarChart3, size: 21, label: 'Stats' },
];

export const NavRail = (): React.JSX.Element => {
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Badge de sesiones de emulador sin asignar sobre el icono de Sessions
  // (EMULADORES.md §6): ámbar ESTÁTICO, sin pulso — atención pasiva, no
  // actividad en vivo (ese lenguaje queda para el verde de PLAYING).
  const { data: pendingSessions = [] } = usePendingSessions();
  const pendingCount = pendingSessions.length;

  // Primer arranque sin credenciales de IGDB (instalación virgen, sin .env
  // que importar): se abre Ajustes UNA vez en la pestaña Connections, con el
  // grupo de IGDB desplegado y el aviso de bienvenida — sin ellas no hay
  // búsqueda de juegos y el porqué no es obvio. Ajustar-estado-durante-render
  // (sin useEffect), como el resto de la app; una sola vez por sesión para no
  // dar la lata.
  const { data: credentials } = useCredentials();
  const [credentialsChecked, setCredentialsChecked] = useState(false);
  const [credentialsSpotlight, setCredentialsSpotlight] = useState(false);
  if (credentials && !credentialsChecked) {
    setCredentialsChecked(true);
    if (!credentials.twitchClientId || !credentials.twitchClientSecret) {
      setCredentialsSpotlight(true);
      setSettingsOpen(true);
    }
  }

  return (
    <div
      className="relative z-2 flex w-15.5 flex-none flex-col items-center gap-1.5 border-r border-border py-3.5 backdrop-blur-md"
      style={{ background: 'rgba(13,15,14,.925)' }}
    >
      <button
        type="button"
        title="Settings"
        aria-label="Settings"
        aria-haspopup="dialog"
        aria-expanded={settingsOpen}
        onClick={() => setSettingsOpen(true)}
        className="afterplay-brand-button group/brand border-0 [transition:transform_150ms_cubic-bezier(0.22,1,0.36,1)] after:pointer-events-none after:absolute after:inset-0 after:z-0 after:rounded-[11px] after:[background:linear-gradient(145deg,rgba(255,255,255,0.052),rgba(255,255,255,0.016))] after:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.062)] after:[transition:background_150ms_ease,box-shadow_150ms_ease] after:content-[''] hover:after:[background:linear-gradient(145deg,rgba(47,220,126,0.11),rgba(47,220,126,0.035))] hover:after:shadow-[inset_0_0_0_1px_rgba(47,220,126,0.19)] active:[transform:scale(0.96)] focus-visible:[outline:1px_solid_rgba(47,220,126,0.72)] focus-visible:outline-offset-2 motion-reduce:transition-none motion-reduce:after:transition-none motion-reduce:hover:transform-none motion-reduce:active:transform-none relative mb-2.5 flex size-10.5 flex-none items-center justify-center rounded-[11px] bg-transparent"
      >
        <img
          src={firefly}
          alt=""
          draggable={false}
          className="afterplay-brand-button__mark opacity-[0.98] [filter:drop-shadow(0_2px_5px_rgba(47,220,126,0.12))] [transition:opacity_150ms_ease,transform_150ms_cubic-bezier(0.22,1,0.36,1),filter_150ms_ease] group-hover/brand:opacity-100 group-hover/brand:[filter:drop-shadow(0_2px_6px_rgba(47,220,126,0.2))] group-hover/brand:[transform:scale(1.035)] motion-reduce:transition-none motion-reduce:group-hover/brand:transform-none relative z-1 size-8 object-contain select-none"
        />
      </button>

      <SettingsModal
        open={settingsOpen}
        onOpenChange={(next) => {
          setSettingsOpen(next);
          // El spotlight es solo para ESA apertura — al cerrar, el modal
          // vuelve a ser el de siempre (sección colapsada, sin aviso).
          if (!next) setCredentialsSpotlight(false);
        }}
        credentialsSpotlight={credentialsSpotlight}
      />

      {NAV_ITEMS.map(({ to, Icon, size, label }) => (
        <NavLink
          key={to}
          to={to}
          title={label}
          onPointerEnter={to === '/stats' ? preloadStatsRoute : undefined}
          onFocus={to === '/stats' ? preloadStatsRoute : undefined}
          className="relative flex h-10.5 w-10.5 items-center justify-center rounded-[11px]"
        >
          {({ isActive }) => (
            <>
              {/* Mismo verde de acento que ya lleva la fila seleccionada del
                  MiddleColumn de al lado (antes gris genérico aquí, la
                  misma inconsistencia que se arregló ahí) — barra a la
                  misma opacidad suave (no a tope) que se afinó allí. */}
              {isActive && (
                <>
                  <div
                    className="absolute inset-0 rounded-[11px]"
                    style={{ background: `${GREEN}1f` }}
                  />
                  <div
                    className="absolute top-2.75 bottom-2.75 w-0.75 rounded-[3px]"
                    style={{ left: '-14px', background: `${GREEN}b3` }}
                  />
                </>
              )}
              <div className="relative z-1">
                <Icon size={size} color={isActive ? '#e9ebe9' : 'var(--muted-foreground)'} />
                {to === '/sessions' && pendingCount > 0 && (
                  <span
                    className="absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-extrabold"
                    style={{ background: AMBER, color: '#0a0b0a' }}
                  >
                    {pendingCount}
                  </span>
                )}
              </div>
            </>
          )}
        </NavLink>
      ))}
    </div>
  );
};
