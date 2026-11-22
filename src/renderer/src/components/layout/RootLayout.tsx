import { lazy, Suspense, useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import type { GameId } from '../../../../shared/entityIds';
import { useCredentials } from '../../hooks/settings';
import { useMemoryArrivalToast } from '../../hooks/useMemoryArrivalToast';
import { useSessionClosedToast } from '../../hooks/useSessionClosedToast';
import { CommandPalette } from '../shell/CommandPalette';
import {
  INITIAL_LIBRARY_VIEW,
  ShellContext,
  type LibraryView,
  type ShellActions,
} from '../shell/shellContext';
import { TopBar } from '../shell/TopBar';
import { NowPlayingCard } from './NowPlayingCard';
import { SettingsModal } from './SettingsModal';

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

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [credentialsSpotlight, setCredentialsSpotlight] = useState(false);
  const [addGameOpen, setAddGameOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [library, setLibrary] = useState<LibraryView>(INITIAL_LIBRARY_VIEW);

  // Primer arranque sin credenciales de IGDB (instalación virgen, sin .env que
  // importar): se abre Ajustes UNA vez en la sección de claves, con el grupo
  // de IGDB desplegado y el aviso de bienvenida. Sin ellas no hay búsqueda de
  // juegos y el porqué no es obvio. Ajustar-estado-durante-render (sin
  // useEffect), como el resto de la app; una sola vez por sesión.
  const { data: credentials } = useCredentials();
  const [credentialsChecked, setCredentialsChecked] = useState(false);
  if (credentials && !credentialsChecked) {
    setCredentialsChecked(true);
    if (!credentials.twitchClientId || !credentials.twitchClientSecret) {
      setCredentialsSpotlight(true);
      setSettingsOpen(true);
    }
  }

  // Ctrl K (Cmd K en macOS) desde cualquier pantalla, también escribiendo en
  // un campo. Con otro diálogo abierto no se apila encima.
  const modalOpen = settingsOpen || addGameOpen;
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
    openSettings: (options) => {
      setCredentialsSpotlight(options?.credentials === true);
      setSettingsOpen(true);
    },
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
          settingsOpen={settingsOpen}
          onOpenSettings={() => shell.openSettings()}
          onOpenPalette={() => setPaletteOpen(true)}
          onAddGame={() => setAddGameOpen(true)}
        />
        <main className="relative min-h-0 flex-1">
          <Outlet />
        </main>
        <NowPlayingCard />
      </div>

      <SettingsModal
        open={settingsOpen}
        onOpenChange={(next) => {
          setSettingsOpen(next);
          // El spotlight es solo para ESA apertura: al cerrar, el modal vuelve
          // a ser el de siempre (sección colapsada, sin aviso).
          if (!next) setCredentialsSpotlight(false);
        }}
        credentialsSpotlight={credentialsSpotlight}
      />

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
