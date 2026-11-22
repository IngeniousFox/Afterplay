import { ArrowRight, BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { GeneratedMemorySummary } from '../../../../shared/types';
import { ScanBeam } from '../fx';
import { focusRing } from '../shell/controls';

// "Your October story is ready" — el MISMO texto que el aviso de aterrizaje
// del recap (useMemoryArrivalToast), para que tarjeta y aviso se reconozcan
// como la misma noticia. El año solo cuando no es el corriente.
const storyLabel = (scopeKey: string): string => {
  const [year, month] = scopeKey.split('-').map(Number);
  const monthName = new Date(year, (month ?? 1) - 1, 1).toLocaleDateString('en-US', {
    month: 'long',
  });
  const suffix = year === new Date().getFullYear() ? '' : ` ${year}`;
  return `Your ${monthName}${suffix} story is ready`;
};

// La tarjeta-resumen del recap de un mes cerrado, al frente de su grupo en el
// diario (AFTERPLAY-LOOP.md §5): el aviso de que la historia del mes existe, su
// titular y la puerta al Journey, donde vive el texto completo. El grupo del mes
// en curso nunca la tiene — esa regla la aplica quien agrupa (Sessions.tsx).
//
// Mismo lenguaje que el aviso "story ready" de estados-avisos.png: icono de
// libro en Tube (información) y la flecha hacia el Journey. Un haz de barrido
// la recorre cada 9 s, por detrás del texto: es la noticia del mes.
export const MonthStoryCard = ({
  recap,
  onOpen,
}: {
  recap: GeneratedMemorySummary;
  onOpen: () => void;
}): React.JSX.Element => (
  <button
    type="button"
    onClick={onOpen}
    className={cn(
      'group/story relative isolate mb-3 flex w-full overflow-hidden flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-line bg-panel px-4 py-3 text-left',
      'transition-[background-color,border-color] duration-150 ease-out hover:border-line-strong hover:bg-raised',
      focusRing,
    )}
  >
    <ScanBeam every={9} className="-z-10" />
    <span className="flex size-10 flex-none items-center justify-center rounded-sm bg-tube/12">
      <BookOpen aria-hidden size={17} className="text-tube" />
    </span>
    <span className="min-w-0 flex-1">
      <span className="block text-body font-semibold text-bone">{storyLabel(recap.scopeKey)}</span>
      <span className="mt-0.5 block text-small text-dust">{recap.payload.headline}</span>
    </span>
    <span className="flex flex-none items-center gap-1.5 text-small font-semibold text-tube">
      Read it in your Journey
      <ArrowRight
        aria-hidden
        size={14}
        className="transition-transform duration-200 ease-out group-hover/story:translate-x-0.5 motion-reduce:transition-none"
      />
    </span>
  </button>
);
