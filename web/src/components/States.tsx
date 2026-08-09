import { CloudOff, Loader2, LockKeyhole, RefreshCw } from 'lucide-react';
import { ApiFailure } from '../api';

export const Loading = ({ label = 'Loading' }: { label?: string }): React.JSX.Element => (
  <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
    <Loader2 size={22} className="animate-spin" />
    <span className="text-[12px] font-semibold">{label}</span>
  </div>
);

// Cada error dice qué hacer, y hay uno que merece su propio texto:
// 'schema_outdated' (§5.4). Ese no es un fallo de la web ni algo que se cure
// reintentando — la base de esa persona todavía no ha visto la migración,
// y solo se la aplica su escritorio al abrirse. Enseñar "algo ha ido mal" ahí
// sería mandarla a mirar donde no es.
const describe = (error: unknown): { title: string; hint: string; Icon: typeof CloudOff } => {
  if (error instanceof ApiFailure) {
    if (error.code === 'schema_outdated') {
      return {
        title: 'Your PC needs an update',
        hint: 'Open Afterplay on your PC once so it can update its database, then come back.',
        Icon: RefreshCw,
      };
    }
    if (error.code === 'forbidden' || error.code === 'unauthenticated') {
      return {
        title: 'No library for this account',
        hint: 'This account is not linked to an Afterplay library.',
        Icon: LockKeyhole,
      };
    }
  }
  return {
    title: "Can't reach your library",
    hint: 'Check your connection and try again.',
    Icon: CloudOff,
  };
};

export const ErrorState = ({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}): React.JSX.Element => {
  const { title, hint, Icon } = describe(error);
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-8 py-20 text-center">
      <Icon size={26} className="text-muted-foreground/50" />
      <span className="text-[15px] font-bold">{title}</span>
      <span className="max-w-xs text-[12.5px] leading-relaxed text-muted-foreground">{hint}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 rounded-lg border border-border px-3.5 py-1.5 text-[12px] font-bold text-foreground"
        >
          Try again
        </button>
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
