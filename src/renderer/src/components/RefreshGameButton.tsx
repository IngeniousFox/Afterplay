import { Loader2, RefreshCw } from 'lucide-react';
import { useRefreshGame } from '../hooks/useRefreshGame';

// El botón fantasma de la fila del Plan — el MISMO tratamiento que el de
// fijar (PinButton): invisible hasta que pasas el ratón por la fila, porque
// es un gesto ocasional que no puede competir con los datos de decisión, pero
// tampoco puede esconderse en un menú.
//
// La lógica (la mutación, el parte y los avisos) vive en hooks/useRefreshGame
// y es la MISMA que usa la barra de acciones de la ficha: los dos sitios
// hacen literalmente lo mismo, solo cambia el envoltorio.
export const RefreshGameButton = ({
  gameId,
  title,
}: {
  gameId: number;
  title: string;
}): React.JSX.Element => {
  const { refresh, refreshing } = useRefreshGame(gameId, title);

  return (
    <button
      type="button"
      onClick={(event) => {
        // La fila entera navega a la ficha: sin esto, refrescar navegaría.
        event.stopPropagation();
        if (!refreshing) refresh();
      }}
      disabled={refreshing}
      title="Refresh everything for this game"
      aria-label="Refresh everything for this game"
      className={`flex h-6.5 w-6.5 flex-none items-center justify-center rounded-lg border border-transparent bg-transparent text-muted-foreground/70 transition-[opacity,background-color,border-color] duration-150 hover:border-input hover:bg-white/[0.06] hover:text-foreground focus-visible:opacity-100 ${
        refreshing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
      }`}
    >
      {refreshing ? <Loader2 size={12.5} className="animate-spin" /> : <RefreshCw size={12.5} />}
    </button>
  );
};
