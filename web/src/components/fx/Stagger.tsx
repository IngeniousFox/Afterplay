import { createElement } from 'react';
import { useStagger, type StaggerOptions } from './useStagger';

// STAGGER: los hijos directos entran escalonados (fundido y 8 px hacia
// arriba, o un pop de escala). Solo los que se ven; el resto ya asentado.
//
//   <Stagger as="ul" replayKey={search}>{results.map(…<li/>)}</Stagger>
//
//   · step      ms entre hijos (45). · max  a partir de aquí sin más retraso (8).
//   · replayKey cambia → se reparte otra vez (otra búsqueda).
//
// WAAPI con fill 'backwards'. Reduced motion: solo fundido, más corto.

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
