import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ApiFailure } from './api';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TabBar } from './components/TabBar';
import { TimerBar } from './components/TimerBar';
import { GameDetailScreen } from './screens/GameDetailScreen';
import { Home } from './screens/Home';
import { Library } from './screens/Library';
import { PlanScreen } from './screens/PlanScreen';
import { SessionsScreen } from './screens/SessionsScreen';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Un móvil entra y sale de cobertura constantemente; reintentar tiene
      // sentido. Lo que NO tiene sentido es reintentar un 403 (esta cuenta no
      // tiene biblioteca) o un esquema desfasado (§5.4): esos no se curan
      // insistiendo, solo gastan batería y retrasan el mensaje de verdad.
      retry: (failureCount, error) => {
        if (error instanceof ApiFailure) {
          if (['forbidden', 'unauthenticated', 'schema_outdated', 'not_found'].includes(error.code))
            return false;
        }
        return failureCount < 2;
      },
      staleTime: 30_000,
      // Volver a la pestaña tras un rato es exactamente cuando quieres datos
      // frescos: puede haber empezado una sesión mientras no mirabas.
      refetchOnWindowFocus: true,
    },
  },
});

// La cabecera solo en las pantallas de nivel superior: la ficha de juego tiene
// su propio arte a sangre arriba y una barra encima lo estropearía.
const Header = (): React.JSX.Element | null => {
  const { pathname } = useLocation();
  if (pathname.startsWith('/game/')) return null;

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-[#0a0b0a]/90 px-4 py-3 backdrop-blur-lg">
      <span className="text-[15px] font-extrabold tracking-tight">
        After<span className="text-primary">play</span>
      </span>
    </header>
  );
};

const Shell = (): React.JSX.Element => (
  <>
    <Header />
    <main className="mx-auto max-w-lg">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/library" element={<Library />} />
        <Route path="/plan" element={<PlanScreen />} />
        <Route path="/sessions" element={<SessionsScreen />} />
        <Route path="/game/:id" element={<GameDetailScreen />} />
      </Routes>
    </main>
    {/* El cronómetro, si hay uno en marcha: encima de las pestañas y visible
        desde cualquier pantalla. Ahí es también donde late (§7.4). */}
    <TimerBar />
    <TabBar />
  </>
);

export const App = (): React.JSX.Element => (
  // El ErrorBoundary por FUERA de todo: una excepción de render sin él
  // desmontaba la raíz entera y dejaba la pantalla en blanco, que en un móvil
  // es indistinguible de una app colgada.
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </QueryClientProvider>
  </ErrorBoundary>
);
