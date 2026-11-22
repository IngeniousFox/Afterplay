import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import type { GameId } from '../../../../shared/entityIds';
import { useCredentials } from '../../hooks/settings';
import { useMemoryArrivalToast } from '../../hooks/useMemoryArrivalToast';
import { useSessionClosedToast } from '../../hooks/useSessionClosedToast';
import { CrtReveal } from '../fx/CrtReveal';
import { useTiltRegion } from '../fx/tilt';
import { CommandPalette } from '../shell/CommandPalette';
import {
  INITIAL_LIBRARY_VIEW,
  ShellContext,
  type LibraryView,
  type ShellActions,
} from '../shell/shellContext';
import { TopBar } from '../shell/TopBar';
import { NowPlayingCard } from './NowPlayingCard';
import { settingsPath, type SettingsLocationState } from './SettingsSections';

// El alta de juegos pesa (buscador, escaneo, formulario) y solo se usa al
// pulsar Add game: se carga entonces, fuera del presupuesto de arranque.
const AddGameModal = lazy(() =>
  import('../library/AddGameModal').then((module) => ({ default: module.AddGameModal })),
);

// EL ARMAZÓN DE ESCRITORIO (Fósforo). De arriba abajo: la barra superior de
// 56 px, la pantalla de la ruta (cada una dueña de su propio scroll) y la
// barra "Now playing" acoplada, que solo existe mientras hay algo en marcha.
//
// Antes eran tres columnas: rail, lista fija de juegos y pantalla. Lo que
// hacía la lista vive ahora en Library (búsqueda, filtros, recuento) y en la
// paleta de Ctrl K (saltar a un juego y, en Stats y Sessions, filtrar por
// uno). La TitleBar nativa sigue encima, fuera de este árbol (Afterplay.tsx).
export const RootLayout = (): React.JSX.Element => {
  // Aviso de cierre de juego. Aquí y no en Afterplay.tsx porque necesita
  // navigate (llevarte a la ficha), y eso solo existe dentro del router.
  useSessionClosedToast();
  // Aviso de "tu mes ya está contado" (AFTERPLAY-LOOP.md §3.3): mismo motivo,
  // navega al Journey.
  useMemoryArrivalToast();
  const navigate = useNavigate();
  // Cambiar de pantalla «re-enciende» el tubo: un destello de brillo de 240 ms
  // (CrtReveal "screen": sin geometría, nada mide cajas a medio escalar). Las
  // secciones de Ajustes y el ?game= de Stats son la misma pantalla.
  const { pathname } = useLocation();
  const screenKey = pathname.startsWith('/settings') ? '/settings' : pathname;
  // Un solo listener de ratón para inclinar TODAS las portadas (fx/TiltCover).
  const tiltRegion = useTiltRegion();

  const [addGameOpen, setAddGameOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [library, setLibrary] = useState<LibraryView>(INITIAL_LIBRARY_VIEW);

  const openSettings: ShellActions['openSettings'] = (options) => {
    const state: SettingsLocationState = options?.credentials
      ? { credentialsSpotlight: true }
      : null;
    navigate(settingsPath(options?.credentials ? 'integrations' : options?.section), { state });
  };

  // Primer arranque sin credenciales de IGDB (instalación virgen, sin .env que
  // importar): se va UNA vez a Ajustes → Integrations, con el grupo de IGDB
  // desplegado y el aviso de bienvenida. Sin ellas no hay búsqueda de juegos
  // y el porqué no es obvio. Navegar es un efecto, así que va en useEffect;
  // la marca de "ya mirado" (un ref, no estado: no pinta nada) evita
  // repetirlo en la misma sesión.
  const { data: credentials } = useCredentials();
  const credentialsChecked = useRef(false);
  useEffect(() => {
    if (credentials === undefined || credentialsChecked.current) return;
    credentialsChecked.current = true;
    if (!credentials.twitchClientId || !credentials.twitchClientSecret) {
      navigate(settingsPath('integrations'), {
        state: { credentialsSpotlight: true } satisfies SettingsLocationState,
      });
    }
  }, [credentials, navigate]);

  // Ctrl K (Cmd K en macOS) desde cualquier pantalla, también escribiendo en
  // un campo. Con otro diálogo abierto no se apila encima.
  const modalOpen = addGameOpen;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
      if (event.altKey || event.shiftKey || modalOpen) return;
      event.preventDefault();
      setPaletteOpen(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modalOpen]);

  const shell: ShellActions = {
    openSettings,
    openAddGame: () => setAddGameOpen(true),
    openPalette: () => setPaletteOpen(true),
    library,
    updateLibrary: (patch) => setLibrary((current) => ({ ...current, ...patch })),
  };

  const openGame = (id: GameId): void => {
    navigate(`/games/${id}`);
  };

  return (
    <ShellContext.Provider value={shell}>
      <div className="flex h-full flex-col bg-cabinet text-bone" data-testid="desktop-layout">
        <TopBar
          onOpenSyncSettings={() => openSettings({ section: 'sync' })}
          onOpenPalette={() => setPaletteOpen(true)}
          onAddGame={() => setAddGameOpen(true)}
        />
        <main ref={tiltRegion} className="relative min-h-0 flex-1">
          <CrtReveal variant="screen" replayKey={screenKey} className="h-full">
            <Outlet />
          </CrtReveal>
        </main>
        <NowPlayingCard />
      </div>

      {/* onCreated: el juego recién añadido queda abierto en su ficha. Y uno
          que ya tenías y buscaste sin acordarte te lleva a la suya en vez de
          dejarte darlo de alta dos veces. */}
      {addGameOpen && (
        <Suspense fallback={null}>
          <AddGameModal
            open
            onOpenChange={setAddGameOpen}
            onCreated={openGame}
            onOpenExisting={openGame}
          />
        </Suspense>
      )}

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onAddGame={() => setAddGameOpen(true)}
      />
    </ShellContext.Provider>
  );
};
