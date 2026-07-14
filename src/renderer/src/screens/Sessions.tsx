// Bloque 3A solo necesita la ruta y su hueco en el rail — el contenido de
// verdad (lista de sesiones detectadas por el watcher) llega en el Bloque 3C.
export const Sessions = (): React.JSX.Element => (
  <div className="flex h-full items-center justify-center px-8.5">
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-12 py-24 text-center">
      <p className="text-sm font-semibold text-foreground">Sessions</p>
      <p className="text-xs text-muted-foreground">Coming soon.</p>
    </div>
  </div>
);
