import { CloudOff, Loader2, LockKeyhole, RefreshCw, SearchX } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ApiFailure } from '../api';

export const Loading = ({ label = 'Loading' }: { label?: string }): React.JSX.Element => (
  <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
    <Loader2 size={22} className="animate-spin" />
    <span className="text-[12px] font-semibold">{label}</span>
  </div>
);

// Cada error dice qué hacer, y hay tres que merecen su propio texto porque el
// genérico ("revisa tu conexión") manda a mirar donde no es:
//
//   · 'schema_outdated' (§5.4): no es un fallo de la web — la base de esa
//     persona todavía no ha visto la migración, y solo se la aplica su
//     escritorio al abrirse. Enseñar "algo ha ido mal" ahí sería mandarla a
//     revisar el móvil cuando lo que hay que abrir es el PC.
//   · 'forbidden' / 'unauthenticated': la cuenta con la que has entrado no
//     tiene biblioteca. Ni reintentar ni navegar a otra pantalla lo cura.
//   · 'not_found': el enlace apunta a un juego que no está. Antes caía al
//     texto genérico de red, así que abrir un /game/99999 (o un enlace
//     compartido a medias) decía "revisa tu conexión" — mandando a mirar la
//     cobertura cuando el problema es el enlace.
//
// Del error se lee el `code` y NADA MÁS. El `message` no se pinta nunca, y
// esto es una cicatriz: la rama de 'not_found' lo enseñaba, y los mensajes del
// Worker son todos notas de desarrollo en español ('ese juego no existe',
// 'ruta desconocida', 'esa orden no existe o todavía no se ha drenado'…). Un
// /game/99999 de verdad no fabrica su error aquí, viene por la red, así que lo
// que se leía era el título en inglés con un subtítulo en español debajo —
// contra la regla de la casa de que la interfaz está en inglés sin i18n (ver
// lib/format.ts, por eso formatDate fija 'en-US').
//
// `recover` es lo que se puede HACER, que no siempre es reintentar: un 404
// devuelve el mismo 404 las veces que insistas, así que ahí la salida es
// volver a la biblioteca. Vive en el descriptor y no en quien llama porque
// quien llama solo sabe "mi query falló", no de qué murió.
type Described = {
  title: string;
  hint: string;
  Icon: typeof CloudOff;
  recover: 'retry' | 'library' | 'none';
};

const describe = (error: unknown): Described => {
  if (error instanceof ApiFailure) {
    if (error.code === 'schema_outdated') {
      return {
        title: 'Your PC needs an update',
        hint: 'Open Afterplay on your PC once so it can update its database, then come back.',
        Icon: RefreshCw,
        // Aquí el botón sí sirve: es lo que se pulsa al volver del PC.
        recover: 'retry',
      };
    }
    if (error.code === 'forbidden' || error.code === 'unauthenticated') {
      return {
        title: 'No library for this account',
        hint: 'This account is not linked to an Afterplay library.',
        Icon: LockKeyhole,
        recover: 'none',
      };
    }
    if (error.code === 'not_found') {
      return {
        title: "That game isn't here",
        hint: 'The link may be broken, or the game is no longer in your library.',
        Icon: SearchX,
        recover: 'library',
      };
    }
  }
  return {
    title: "Can't reach your library",
    hint: 'Check your connection and try again.',
    Icon: CloudOff,
    recover: 'retry',
  };
};

// `onRetry` es una OFERTA, no una orden: si el error no se cura reintentando
// no se pinta el botón aunque lo pasen. Todas las pantallas lo pasan a ciegas
// desde su `isError` —no pueden saber de qué murió la query—, y sin esta
// guarda un /game/99999 acababa ofreciendo un "Try again" que devuelve el
// mismo 404 cada vez que se pulsa.
//
// El enlace a la biblioteca solo aparece en el caso 'not_found', y por eso
// esto puede usar <Link>: ErrorState se pinta siempre dentro de una pantalla
// enrutada (las cinco de App.tsx). La red de seguridad de fuera del Router es
// ErrorBoundary, que no pasa por aquí.
export const ErrorState = ({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}): React.JSX.Element => {
  const { title, hint, Icon, recover } = describe(error);
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-8 py-20 text-center">
      <Icon size={26} className="text-muted-foreground/50" />
      <span className="text-[15px] font-bold">{title}</span>
      <span className="max-w-xs text-[12.5px] leading-relaxed text-muted-foreground">{hint}</span>
      {recover === 'retry' && onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 rounded-lg border border-border px-3.5 py-1.5 text-[12px] font-bold text-foreground"
        >
          Try again
        </button>
      )}
      {recover === 'library' && (
        <Link
          to="/library"
          className="mt-2 rounded-lg border border-border px-3.5 py-1.5 text-[12px] font-bold text-foreground"
        >
          Go to your library
        </Link>
      )}
    </div>
  );
};

// "Show nothing rather than show an empty box" es la regla de la casa, así que
// esto solo aparece cuando el vacío ES la respuesta a algo que preguntaste
// (una búsqueda sin resultados), no como relleno de una sección sin datos.
export const EmptyState = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <div className="py-16 text-center text-[12.5px] font-semibold text-muted-foreground">
    {children}
  </div>
);
