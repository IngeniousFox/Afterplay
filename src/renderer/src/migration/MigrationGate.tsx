import { lazy, Suspense, useEffect, useState } from 'react';
import { cutoverBlocksLibrary, type CutoverState } from '../../../shared/cutover';
// La pantalla va en su propio chunk: el presupuesto del chunk de entrada (que
// paga TODA ventana) no admite el formulario, el botón y los iconos para un
// caso que casi nunca ocurre.
const MigrationScreen = lazy(() =>
  import('./MigrationScreen').then((module) => ({ default: module.MigrationScreen })),
);

// LA PUERTA DE LA MIGRACIÓN (AFTERPLAY-2.0.md §19.6).
//
// Mientras el proceso principal mueve la biblioteca 1.x → 2.0, los manejadores
// IPC que dependen de la base LANZAN (la base 2.0 puede no existir aún). Por eso
// nada que pida datos —ni la biblioteca ni el router— se monta hasta que el
// corte no bloquea: antes se pinta la pantalla de migración a ventana completa.
//
// Sin corte en este arranque `cutover:getState` contesta `idle` y los hijos se
// montan tal cual; mientras se espera esa respuesta (un IPC local, milisegundos)
// no se pinta nada, así que no hay parpadeo. La ventana ni siquiera se enseña
// hasta que alguien avisa de que hay contenido.

/** El estado del corte: `null` hasta la primera respuesta, luego sigue los eventos. */
const useCutoverState = (): CutoverState | null => {
  const [state, setState] = useState<CutoverState | null>(null);

  useEffect(() => {
    let live = true;
    // Un evento que llegue antes que la respuesta es más reciente que ella.
    let sawEvent = false;
    const unsubscribe = window.api.cutover.onState((next) => {
      sawEvent = true;
      if (live) setState(next);
    });
    window.api.cutover
      .getState()
      .then((initial) => {
        if (live && !sawEvent) setState(initial);
      })
      // Si el canal falla, lo seguro es dejar pasar a la app: sin corte no hay nada que tapar.
      .catch(() => {
        if (live && !sawEvent) setState({ kind: 'idle' });
      });
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);

  return state;
};

export const MigrationGate = ({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element | null => {
  const state = useCutoverState();
  if (state === null) return null;
  if (cutoverBlocksLibrary(state)) {
    return (
      <Suspense fallback={null}>
        <MigrationScreen state={state} />
      </Suspense>
    );
  }
  return <>{children}</>;
};
