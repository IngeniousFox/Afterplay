import { CloudOff, Loader2, Lock, LockKeyhole, SearchX, WifiOff } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ApiFailure } from '../api';
import { useOnline } from '../hooks/useOnline';
import { cn } from '../lib/cn';
import { secondaryButtonClass } from '../lib/styles';
import { loopPlayClass } from './fx/motion';

// El esqueleto: un bloque Raised que recorre un barrido de fósforo. El brillo
// es una capa con degradado que se desplaza de lado a lado (transform, en el
// compositor), no un background-position que repinta cada frame. Se para con
// la pestaña oculta y con movimiento reducido no se mueve.
const Skeleton = ({ className }: { className: string }): React.JSX.Element => (
  <div className={cn('relative overflow-hidden bg-raised', className)}>
    <span
      className={cn(
        'absolute inset-0 block bg-[linear-gradient(90deg,transparent_25%,rgb(255_179_71/0.07)_45%,rgb(255_214_150/0.11)_50%,rgb(255_179_71/0.07)_55%,transparent_75%)]',
        'animate-[fx-sweep_1.6s_var(--ease-in-out)_infinite] motion-reduce:hidden',
        loopPlayClass,
      )}
    />
  </div>
);

// Carga: spinner ámbar con su frase y, debajo, filas esqueleto con un brillo
// que barre de izquierda a derecha (quieto con movimiento reducido). Las filas
// imitan la lista que va a llegar, así que el salto al pintar es mínimo.
export const Loading = ({
  label = 'Loading',
  rows = 6,
}: {
  label?: string;
  rows?: number;
}): React.JSX.Element => (
  <div aria-busy="true" className="animate-fade-in">
    <div className="flex flex-col items-center gap-2 pt-6 pb-4 text-dust" role="status">
      <Loader2
        size={22}
        className="animate-spin motion-reduce:animate-none text-phosphor"
        aria-hidden="true"
      />
      <span className="text-micro font-semibold">{label}</span>
    </div>
    <div aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 border-b border-line py-2.5">
          <Skeleton className="h-14 w-11 rounded-sm" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-3/5 rounded-xs" />
            <Skeleton className="h-2.5 w-2/5 rounded-xs" />
          </div>
          <Skeleton className="h-4 w-12 rounded-xs" />
        </div>
      ))}
    </div>
  </div>
);

// Cada error dice qué hacer, y hay tres que merecen su propio texto porque el
// genérico ("revisa tu conexión") manda a mirar donde no es:
//
//   · 'session_expired' / 'unauthorized': la sesión de Access ha caducado.
//     Reintentar repite la redirección; lo que cura es recargar la página, y
//     el propio error lo dice.
//   · 'forbidden': la cuenta con la que has entrado no
//     tiene biblioteca. Ni reintentar ni navegar a otra pantalla lo cura.
//   · 'not_found': el enlace apunta a un juego que no está. Antes caía al
//     texto genérico de red, así que abrir un /game/99999 (o un enlace
//     compartido a medias) decía "revisa tu conexión" — mandando a mirar la
//     cobertura cuando el problema es el enlace.
//
// Del error se lee el `code` y, solo en 'session_expired', el `message`: ese
// texto lo fija api.ts en inglés. Los mensajes que manda el hub son notas de
// desarrollo en español ('ese juego no existe', 'ruta desconocida'…), y
// pintarlos dejaba un título en inglés con un subtítulo en español debajo —
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
    if (error.code === 'session_expired' || error.code === 'unauthorized') {
      return {
        title: 'Session expired',
        hint: error.message,
        Icon: Lock,
        recover: 'none',
      };
    }
    if (error.code === 'forbidden') {
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
  // Sin red, el fallo genérico se dice como lo que es. Los demás (sesión
  // caducada, 404…) no dependen de la conexión y mantienen su texto.
  const online = useOnline();
  const described = describe(error);
  const { title, hint, Icon, recover } =
    !online && described.recover === 'retry'
      ? {
          ...described,
          title: 'No connection',
          hint: 'Afterplay on the web needs a connection to read and write your library. It reloads by itself when you are back.',
          Icon: WifiOff,
        }
      : described;
  return (
    <StateMessage
      Icon={Icon}
      title={title}
      hint={hint}
      action={
        recover === 'retry' && onRetry ? (
          <button type="button" onClick={onRetry} className={secondaryButtonClass}>
            Try again
          </button>
        ) : recover === 'library' ? (
          <Link to="/library" className={secondaryButtonClass}>
            Go to your library
          </Link>
        ) : undefined
      }
    />
  );
};

// El molde común de error, vacío y sin conexión: icono en un círculo, título
// en Big Shoulders, una frase y, si la hay, una salida.
export const StateMessage = ({
  Icon,
  title,
  hint,
  action,
}: {
  Icon: typeof CloudOff;
  title: string;
  hint?: React.ReactNode;
  action?: React.ReactNode;
}): React.JSX.Element => (
  <div className="flex animate-fade-in flex-col items-center px-6 py-14 text-center">
    <span className="mb-4 flex size-16 items-center justify-center rounded-full border border-line-strong bg-panel text-phosphor">
      <Icon size={24} aria-hidden="true" />
    </span>
    <h2 className="font-display text-[30px] leading-8 font-bold tracking-[0.005em] text-bone">
      {title}
    </h2>
    {hint && <p className="mt-2 max-w-xs text-small text-dust">{hint}</p>}
    {action && <div className="mt-5">{action}</div>}
  </div>
);

// "Show nothing rather than show an empty box" es la regla de la casa, así que
// esto solo aparece cuando el vacío ES la respuesta a algo que preguntaste
// (una búsqueda sin resultados), no como relleno de una sección sin datos.
export const EmptyState = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <div className="animate-fade-in px-6 py-14 text-center text-body text-dust">{children}</div>
);
