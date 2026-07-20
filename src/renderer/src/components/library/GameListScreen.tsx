import { Button } from '@/components/ui/button';
import { Gamepad2, Plus } from 'lucide-react';
import { useState } from 'react';
import type { GameListItem } from '../../../../shared/types';
import { useScrollMemory } from '../../hooks/useScrollMemory';
import { accentGradientStyle, revealClass, revealStyle } from '../../lib/styles';
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
  // Modo del AddGameModal — 'plan' para Plan to Play, sin especificar
  // (default 'library') para la biblioteca normal.
  modalMode?: 'library' | 'plan';
  // Clave de memoria de scroll — entrar al detalle de un juego y volver
  // restaura el punto exacto de la lista (ver useScrollMemory). Distinta por
  // pantalla para que Library y Plan no se pisen la posición.
  scrollKey: string;
  onSelectGame: (id: number) => void;
};

// Library y PlanToPlay son la misma pantalla (~90% idéntica: cabecera, botón
// Add game, isLoading/isError/empty, GameGrid) — solo cambian los textos, el
// modo del modal y a dónde navega la grid al seleccionar un juego. Rediseño:
// las GameCard del grid ya estaban bien (zoom, degradado, glow en marcha) y
// se quedan intactas — lo que se pule es todo lo de alrededor, que hasta
// ahora era el único rincón sin nada del lenguaje "juicy" del resto de la
// app: la cabecera no decía cuántos juegos había, el vacío era una caja
// punteada sin gracia, y nada entraba con ninguna animación. A propósito NO
// hay entrada escalonada tarjeta a tarjeta — con cientos de juegos en la
// grid, un delay por tarjeta tardaría segundos en terminar de aparecer (el
// mismo problema que se evitó en MiddleColumn); solo la cabecera y el estado
// vacío/carga entran suaves, la grid aparece de golpe como siempre.
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
  modalMode,
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
          Add game
        </Button>
      </div>

      {/* onCreated = onSelectGame: el juego recién añadido queda
          seleccionado (su ficha abierta) en vez de volver a la lista. */}
      <AddGameModal
        open={addModalOpen}
        onOpenChange={setAddModalOpen}
        mode={modalMode}
        onCreated={onSelectGame}
      />

      {isLoading ? (
        <p className={`text-sm text-muted-foreground ${revealClass}`} style={revealStyle(1)}>
          {loadingText}
        </p>
      ) : isError ? (
        <p className={`text-sm text-destructive ${revealClass}`} style={revealStyle(1)}>
          {errorText}
        </p>
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
