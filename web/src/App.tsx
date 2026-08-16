import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ApiFailure } from './api';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Loading } from './components/States';
import { TabBar } from './components/TabBar';
import { TimerBar } from './components/TimerBar';
import { Home } from './screens/Home';
import { Library } from './screens/Library';

// ── Rutas partidas con lazy() ────────────────────────────────────────────
// Antes TODO el código viajaba en el primer pintado: 160,7 kB gzip para
// enseñar la Home. La ficha, el Plan y Sessions no hacen falta hasta que se
// toca su pestaña, así que van en chunks aparte; con ellos se va también el
// chunk de markdown (31,5 kB gzip) que solo usa la ficha. Medido con
// `npm run build`: el primer pintado baja de 160,7 a 116,5 kB gzip (-27%).
//
// Home y Library se quedan estáticas a propósito: Home ES el primer pintado,
// y Library comparte casi todos sus módulos con ella (Cover, States, api);
// partirla ahorraría ~2 kB gzip a cambio de un salto de chunk en la segunda
// pestaña más usada.
//
// Las importaciones dinámicas viven en constantes con nombre para poder
// CALENTARLAS en idle (ver el useEffect de Shell) además de dárselas a lazy().
const importPlan = (): Promise<typeof import('./screens/PlanScreen')> =>
  import('./screens/PlanScreen');
const importSessions = (): Promise<typeof import('./screens/SessionsScreen')> =>
  import('./screens/SessionsScreen');
const importGameDetail = (): Promise<typeof import('./screens/GameDetailScreen')> =>
  import('./screens/GameDetailScreen');

const PlanScreen = lazy(async () => ({ default: (await importPlan()).PlanScreen }));
const SessionsScreen = lazy(async () => ({ default: (await importSessions()).SessionsScreen }));
const GameDetailScreen = lazy(async () => ({
  default: (await importGameDetail()).GameDetailScreen,
}));

// Un redespliegue cambia los hashes de los chunks, y esta PWA se redespliega
// cada vez que se toca una pantalla: un móvil con la pestaña abierta de ayer
// pediría al navegar un fichero que ya no existe en el Worker. Vite avisa con
// este evento y la salida limpia es recargar — el HTML nuevo trae los hashes
// nuevos. Sin esto, el fallo caería al ErrorBoundary como pantalla de error.
window.addEventListener('vite:preloadError', () => {
  window.location.reload();
});

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

const Shell = (): React.JSX.Element => {
  // Los chunks partidos se calientan cuando el hilo queda libre tras pintar la
  // Home: así el primer pintado no los paga pero el primer toque en una
  // pestaña tampoco espera a la red. requestIdleCallback con red de seguridad
  // de setTimeout porque el Safari de iOS —el navegador de esta PWA— ha
  // tardado años en tenerlo y no se puede dar por hecho.
  useEffect(() => {
    const warm = (): void => {
      void importGameDetail();
      void importPlan();
      void importSessions();
    };
    // typeof y no `'requestIdleCallback' in window`: lib.dom lo declara como
    // siempre presente, así que el `in` deja la otra rama en `never` y no
    // compila — pero en el Safari real puede faltar de verdad.
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(warm);
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(warm, 2500);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <>
      <Header />
      <main className="mx-auto max-w-lg">
        {/* El fallback es el MISMO spinner que las pantallas enseñan mientras
            piden datos, para que un chunk que aún baja no se distinga de una
            query en vuelo. Con la navegación normal casi nunca se ve: React
            Router navega dentro de una transición, así que la pantalla vieja
            se queda hasta que el chunk llega. Aparece al entrar por URL
            directa a una ruta lazy (un enlace compartido a /game/…). */}
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/library" element={<Library />} />
            <Route path="/plan" element={<PlanScreen />} />
            <Route path="/sessions" element={<SessionsScreen />} />
            <Route path="/game/:id" element={<GameDetailScreen />} />
          </Routes>
        </Suspense>
      </main>
      {/* El cronómetro, si hay uno en marcha: encima de las pestañas y visible
          desde cualquier pantalla. Ahí es también donde late (§7.4). */}
      <TimerBar />
      <TabBar />
    </>
  );
};

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
