import { BookOpen, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { GameDetail } from '../../../../../shared/types';
import { useIsClamped } from '../../../hooks/useIsClamped';

type AboutCardProps = {
  game: GameDetail;
  // En la ficha del Plan la sinopsis se abre por defecto: ahí el juego no lo
  // has jugado y esto es lo que contesta "¿qué era esto que apunté hace ocho
  // meses?". En la biblioteca va recogida — de un juego que has terminado no
  // necesitas que te cuenten de qué iba.
  defaultOpen?: boolean;
};

const TEXT_CLASS = 'text-[12.5px] leading-relaxed';

// La sinopsis de IGDB (PLAN-TO-PLAY.md §7). Es `summary` y NUNCA `storyline`:
// el segundo es la trama entera, más largo y con spoilers de un juego que
// precisamente aún no has jugado — decisión cerrada.
//
// Veredicto honesto de la calidad: son los mismos textos que ya se leen bajo
// cada resultado del buscador de Add Game. En juegos conocidos, decentes; en
// nicho y retro, una línea o directamente ausentes; y siempre en inglés. Con
// eso basta para lo que se les pide aquí. Por eso van SIEMPRE recortadas con
// "ver más": una mala no rompe nada, y una que no existe no deja hueco
// porque la card entera no se pinta.
export const AboutCard = ({
  game,
  defaultOpen = false,
}: AboutCardProps): React.JSX.Element | null => {
  const [expanded, setExpanded] = useState(defaultOpen);
  // Sin esto, un resumen de dos líneas cortas seguía enseñando "Read more" —
  // un botón que al pulsarlo no cambiaba nada, porque no había nada que
  // desplegar. isClamped mide si a 3 líneas de verdad falta texto.
  const [measureRef, isClamped] = useIsClamped<HTMLParagraphElement>();
  if (!game.summary) return null;

  return (
    <div className="rounded-[14px] border border-border bg-card px-5 py-4.5">
      <div className="flex items-center gap-1.75">
        <BookOpen size={13} className="flex-none text-muted-foreground" />
        <span className="text-[13.5px] font-bold text-foreground">About</span>
        <span className="ml-auto flex-none text-[10.5px] font-semibold text-muted-foreground/70">
          via IGDB
        </span>
      </div>

      <div className="relative mt-2.5">
        {/* El clon de medida: invisible, SIEMPRE a 3 líneas, sea cual sea el
            estado de `expanded` del párrafo real de abajo. Ocupa el mismo
            ancho que él (absolute inset-x-0 dentro de este `relative`) para
            que la medida sea la de verdad y no una aproximación. */}
        <p
          ref={measureRef}
          aria-hidden="true"
          className={`invisible absolute inset-x-0 top-0 line-clamp-3 ${TEXT_CLASS}`}
        >
          {game.summary}
        </p>
        <p className={`${TEXT_CLASS} text-muted-foreground ${expanded ? '' : 'line-clamp-3'}`}>
          {game.summary}
        </p>
      </div>

      {isClamped && (
        <button
          type="button"
          onClick={() => setExpanded((previous) => !previous)}
          className="mt-2 flex items-center gap-1 text-[11.5px] font-semibold text-muted-foreground/70 transition-colors duration-150 hover:text-foreground"
        >
          {expanded ? 'Show less' : 'Read more'}
          <ChevronDown
            size={12}
            className="transition-transform duration-200"
            style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
          />
        </button>
      )}
    </div>
  );
};
