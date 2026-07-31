import { ArrowRight, BookOpen } from 'lucide-react';
import type { GeneratedMemorySummary } from '../../../../shared/types';
import { VIOLET } from '../../lib/colors';

// La tarjeta-resumen del recap de un mes cerrado, al frente de su grupo en el
// diario (AFTERPLAY-LOOP.md §5): el titular del mes y la puerta al Journey,
// donde vive el texto completo. El grupo del mes en curso nunca la tiene —
// esa regla la aplica quien agrupa (Sessions.tsx), no esta tarjeta.
//
// Mismo lenguaje visual que el panel del Journey y el toast de aterrizaje:
// violeta de la memoria + lomo de libro. Verla en tres sitios con la misma
// cara es lo que la convierte en "la historia" y no en tres features sueltas.
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
    className="group/story relative mb-2.5 flex w-full items-center gap-3 overflow-hidden rounded-[13px] border border-white/[0.08] px-4 py-3 text-left transition-colors duration-150 hover:border-white/[0.16]"
    style={{
      background:
        'linear-gradient(125deg, rgba(124,134,200,.12), rgba(124,134,200,.04) 55%, transparent)',
    }}
  >
    <span
      aria-hidden
      className="absolute inset-y-0 left-0 w-0.75"
      style={{ background: `linear-gradient(180deg, ${VIOLET}, ${VIOLET}26)` }}
    />
    <span
      className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px]"
      style={{ background: `${VIOLET}21` }}
    >
      <BookOpen size={15} style={{ color: VIOLET }} />
    </span>
    <span className="min-w-0 flex-1">
      <span
        className="block text-[9px] font-extrabold tracking-[.16em]"
        style={{ color: `${VIOLET}c9` }}
      >
        THE STORY OF THIS MONTH
      </span>
      <span className="mt-0.75 block truncate text-[14px] font-extrabold text-foreground">
        {recap.payload.headline}
      </span>
    </span>
    <span className="flex flex-none items-center gap-1 text-[10.5px] font-bold text-muted-foreground">
      Read it in your Journey
      <ArrowRight
        size={12}
        className="transition-transform duration-200 ease-[cubic-bezier(.16,1,.3,1)] group-hover/story:translate-x-0.5"
        style={{ color: `${VIOLET}cc` }}
      />
    </span>
  </button>
);
