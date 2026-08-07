import { BookOpen, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { GameDetail } from '../../../../../shared/types';
import { useIsClamped } from '../../../hooks/useIsClamped';

type AboutCardProps = {
  game: GameDetail;
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
// SIEMPRE nace recogida, también en la ficha del Plan. Nació con un
// defaultOpen para abrirla allí por defecto ("el juego no lo has jugado, la
// sinopsis es la respuesta") — y en la práctica era una card gigante de texto
// plantada en medio de la ficha en cada visita, tapando los datos que sí se
// comparan (tiempos, notas, fecha). Quien quiera leerla tiene el "Read more"
// a un clic; quien ya la leyó no paga el muro de texto cada vez.
export const AboutCard = ({ game }: AboutCardProps): React.JSX.Element | null => {
  const [expanded, setExpanded] = useState(false);
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
        {/* El pliegue ANIMA la altura de verdad, no aparece de golpe:
            interpolate-size (Chromium 129+, y este Electron trae 142) es lo
            que permite transicionar hasta `auto` — sin él habría que medir
            scrollHeights a mano. Recogida mide 3lh (tres líneas exactas del
            propio line-height), así que el corte cae limpio en el borde de
            línea; el precio es no tener el "…" del line-clamp — lo asume el
            "Read more" de abajo, que ya dice que hay más. La curva es la
            estándar de entrada de la casa (ver afterplay-pin-land). */}
        <p
          className={`${TEXT_CLASS} overflow-hidden text-muted-foreground [interpolate-size:allow-keywords] transition-[height] ${
            // El alto fijo SOLO cuando hay recorte real: una sinopsis de dos
            // líneas con h-[3lh] reservaría una línea de aire vacío debajo.
            // Curvas distintas por dirección — mismo motivo que el pliegue de
            // Up next (ver PlanToPlay): la de la casa despliega a lo bruto.
            isClamped && !expanded
              ? 'h-[3lh] duration-300 ease-[cubic-bezier(.22,1,.36,1)]'
              : 'h-auto duration-350 ease-[cubic-bezier(.45,0,.2,1)]'
          }`}
        >
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
