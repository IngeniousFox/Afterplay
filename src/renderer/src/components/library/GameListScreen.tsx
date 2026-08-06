import { Button } from '@/components/ui/button';
import { Gamepad2, Plus, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import type { GameListItem } from '../../../../shared/types';
import { useScrollMemory } from '../../hooks/useScrollMemory';
import {
  accentGradientStyle,
  outlineButtonClass,
  revealClass,
  revealStyle,
} from '../../lib/styles';
import { AddGameModal } from './AddGameModal';
import { GameGrid } from './GameGrid';

type GameListScreenProps = {
  title: string;
  subtitle: string;
  emptyTitle: string;
  emptyText: string;
  loadingText: string;
  errorText: string;
  games: GameListItem[];
  isLoading: boolean;
  isError: boolean;
  // Sin esto, un fallo (red, DB de arranque a medias) dejaba al usuario
  // atascado leyendo el mismo error para siempre — la única salida real era
  // cerrar y reabrir la app. useGames()/usePlannedGames() ya traen refetch
  // de fábrica (son useQuery); esto solo lo expone en un botón.
  onRetry: () => void;
  // Modo del AddGameModal — 'plan' para Plan to Play, sin especificar
  // (default 'library') para la biblioteca normal.
  modalMode?: 'library' | 'plan';
  // Texto del botón de alta. Por defecto "Add game" (biblioteca); Plan to
  // Play dice lo suyo, porque desde ahí NO se añade a la biblioteca — dos
  // botones idénticos que hacen cosas distintas es justo lo que confunde.
  addLabel?: string;
  // Clave de memoria de scroll — entrar al detalle de un juego y volver
  // restaura el punto exacto de la lista (ver useScrollMemory). Distinta por
  // pantalla para que Library y Plan no se pisen la posición.
  scrollKey: string;
  onSelectGame: (id: number) => void;
};

// Desde el rediseño del Plan (PLAN-TO-PLAY.md §1) esta pantalla ya solo la
// usa Library: el Plan estrenó pantalla propia (PlanToPlay.tsx) con filas de
// decisión en vez de parrilla. Se conserva la forma genérica por si algún
// día vuelve a haber una segunda lista con esta pinta.
//
// La entrada escalonada tarjeta a tarjeta SÍ existe ahora, pero vive en
// GameGrid y se reparte POR PANTALLA: solo las tarjetas visibles en el
// viewport corren la onda (el resto ni anima), así que el peligro que este
// comentario documentaba antes —una ola de delays recorriendo cientos de
// juegos durante segundos— no puede darse. Ver el porqué completo en
// GameGrid.tsx.
export const GameListScreen = ({
  title,
  subtitle,
  emptyTitle,
  emptyText,
  loadingText,
  errorText,
  games,
  isLoading,
  isError,
  onRetry,
  modalMode,
  addLabel = 'Add game',
  scrollKey,
  onSelectGame,
}: GameListScreenProps): React.JSX.Element => {
  const [addModalOpen, setAddModalOpen] = useState(false);
  const { attachRef, onScroll } = useScrollMemory<HTMLDivElement>(scrollKey);

  return (
    <div ref={attachRef} onScroll={onScroll} className="h-full overflow-y-auto px-8.5 pt-7.5 pb-15">
      <div
        className={`mb-6.5 flex items-start justify-between gap-4 ${revealClass}`}
        style={revealStyle(0)}
      >
        <div>
          {/* items-baseline y no items-center: con el H1 tan grande junto a
              una píldora pequeña, centrar por CAJA (el line-height completo
              del H1, mucho más alto que su texto real) deja la píldora
              "flotando" en vez de asentada — alinear por línea base la pone
              donde el ojo espera. */}
          <div className="flex items-baseline gap-2.75">
            <h1 className="text-[26px] font-extrabold tracking-[-.01em] text-foreground">
              {title}
            </h1>
            {!isLoading && !isError && games.length > 0 && (
              <span className="flex-none rounded-full border border-input bg-white/[0.03] px-2.5 py-0.75 text-[12px] font-bold text-foreground tabular-nums">
                {games.length}
                <span className="ml-1 font-semibold text-muted-foreground">
                  {games.length === 1 ? 'game' : 'games'}
                </span>
              </span>
            )}
          </div>
          <p className="mt-1.25 text-[13.5px] text-muted-foreground">{subtitle}</p>
        </div>
        <Button
          type="button"
          onClick={() => setAddModalOpen(true)}
          className="flex flex-none items-center gap-2 rounded-[10px] px-4.5 py-4.5 text-sm font-bold text-[#08120c] shadow-[0_4px_14px_rgba(47,220,126,0.22)]"
          style={{ background: accentGradientStyle.background }}
        >
          <Plus size={16} />
          {addLabel}
        </Button>
      </div>

      {/* onCreated = onSelectGame: el juego recién añadido queda
          seleccionado (su ficha abierta) en vez de volver a la lista. Y lo
          mismo para uno que ya tenías y buscaste sin acordarte: en vez de
          dejarte darlo de alta dos veces, te lleva a su ficha. El modal solo
          usa onOpenExisting en el alta de biblioteca, así que a Plan to Play
          (donde onSelectGame va a /plan/:id) no le afecta. */}
      <AddGameModal
        open={addModalOpen}
        onOpenChange={setAddModalOpen}
        mode={modalMode}
        onCreated={onSelectGame}
        onOpenExisting={onSelectGame}
      />

      {isLoading ? (
        <p className={`text-sm text-muted-foreground ${revealClass}`} style={revealStyle(1)}>
          {loadingText}
        </p>
      ) : isError ? (
        <div className={`flex flex-col items-start gap-2.5 ${revealClass}`} style={revealStyle(1)}>
          <p className="text-sm text-destructive">{errorText}</p>
          <button
            type="button"
            onClick={onRetry}
            className={`${outlineButtonClass} border-input bg-white/[0.03] text-foreground hover:bg-white/[0.06]`}
          >
            <RefreshCw size={14} />
            <span>Try again</span>
          </button>
        </div>
      ) : games.length === 0 ? (
        <div
          className={`flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-24 text-center ${revealClass}`}
          style={revealStyle(1)}
        >
          <div className="flex h-13 w-13 items-center justify-center rounded-full bg-white/[0.04]">
            <Gamepad2 size={24} strokeWidth={1.5} className="text-muted-foreground/50" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">{emptyTitle}</p>
            <p className="mt-0.75 text-xs text-muted-foreground">{emptyText}</p>
          </div>
        </div>
      ) : (
        <GameGrid games={games} onSelectGame={onSelectGame} />
      )}
    </div>
  );
};
