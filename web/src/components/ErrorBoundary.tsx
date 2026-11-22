import { TriangleAlert } from 'lucide-react';
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { secondaryButtonClass } from '../lib/styles';

// La red de seguridad de la PWA.
//
// No existía, y eso convertía cualquier excepción durante el render en una
// pantalla EN BLANCO — no una sección rota, la app entera desmontada. El caso
// real que lo destapó: una orden del buzón de un tipo que este bundle no
// conocía hacía que `applyPending` lanzara dentro de un useMemo, y con ello se
// iba todo. Ese fallo concreto ya está arreglado en su origen; esto es para el
// siguiente, que siempre lo hay.
//
// Componente de clase porque no hay equivalente con hooks: React solo ofrece
// captura de errores de render por esta vía.
type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // A la consola del navegador con su traza: en un móvil no hay más sitio
    // donde mirar, y sin esto el mensaje de abajo sería lo único que queda.
    console.error('[afterplay] error de render:', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error === null) return this.props.children;

    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-8 text-center">
        <span className="mb-4 flex size-16 items-center justify-center rounded-full border border-line-strong bg-panel text-live">
          <TriangleAlert size={24} aria-hidden="true" />
        </span>
        <h1 className="font-display text-[30px] leading-8 font-bold text-bone">Something broke</h1>
        <p className="mt-2 max-w-xs text-small text-dust">{this.state.error.message}</p>
        {/* Recargar y no un "reintentar" que vuelva a montar el mismo árbol:
            si el fallo viene de datos cacheados, remontar lo repite igual. */}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className={`${secondaryButtonClass} mt-5`}
        >
          Reload
        </button>
      </div>
    );
  }
}
