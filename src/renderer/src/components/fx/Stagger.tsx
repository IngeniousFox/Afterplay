import { createElement } from 'react';
import { useStagger, type StaggerOptions } from './useStagger';

// STAGGER: los hijos directos entran escalonados.
//
//   <Stagger as="ul" className="grid …">{items.map(…<li/>)}</Stagger>
//   <Stagger variant="pop" step={50} max={8} replayKey={filterKey}>
//   const ref = useStagger<HTMLUListElement>({ replayKey, max: 18, step: 26 })
//
// Solo anima los hijos QUE SE VEN (dentro del viewport en ese momento),
// ordenados por posición visual; el resto aparece ya asentado. Así su coste no
// depende de cuántos hijos haya (una rejilla de 331 portadas anima ~30) y
// quien hace scroll durante la entrada encuentra todo en su sitio.
//
//   · variant  'rise' (fundido y 8 px hacia arriba, listas y bloques) o
//              'pop' (fundido y escala .94 → 1, rejillas de portadas).
//   · step     ms entre un hijo y el siguiente (45 por defecto).
//   · max      a partir de este índice ya no se añade retraso (8).
//   · replayKey cambia → se reparte otra vez (cambiar de filtro). Lo que el
//              teclado repite (escribir en un buscador) NO debería cambiarlo.
//
// WAAPI con fill 'backwards': en reposo no queda nada puesto. Reduced motion:
// solo fundido, más corto.

type StaggerTag = 'div' | 'ul' | 'ol' | 'section';

export const Stagger = ({
  as = 'div',
  variant,
  step,
  max,
  duration,
  replayKey,
  ...rest
}: StaggerOptions & { as?: StaggerTag } & React.HTMLAttributes<HTMLElement>): React.JSX.Element => {
  const ref = useStagger<HTMLElement>({ variant, step, max, duration, replayKey });
  return createElement(as, { ref, ...rest });
};
