import { Plus } from 'lucide-react';
import { PlaythroughEntryCard } from './PlaythroughEntryCard';
import { EMPTY_MANUAL_PLAYTHROUGH } from './types';
import type { ManualPlaythroughEntry } from './types';

type ManualPlaythroughsListProps = {
  entries: ManualPlaythroughEntry[];
  onChange: (entries: ManualPlaythroughEntry[]) => void;
  // Número de la PRIMERA entrada de la lista. En Add Game es 2 (el 1 es el de
  // PlayedBeforePanel); en Edit Game continúa la cuenta de los playthroughs
  // que el juego ya tiene guardados.
  firstNumber: number;
  addLabel: string;
};

// Lista de playthroughs manuales pendientes de crear, que se van APILANDO
// visualmente conforme se añaden y no se guardan hasta que se guarda el
// formulario entero. Compartida por Add Game y por Edit Game: antes Edit
// tenía su propio modo "uno cada vez" con otra pinta, y no se podía preparar
// más de uno por pasada.
export const ManualPlaythroughsList = ({
  entries,
  onChange,
  firstNumber,
  addLabel,
}: ManualPlaythroughsListProps): React.JSX.Element => (
  <div className="flex flex-col gap-3">
    {entries.map((entry, index) => (
      // key por índice a propósito: estas entradas no tienen id (no existen
      // todavía en la base de datos) y solo se añaden al final o se quitan,
      // que es justo el caso en el que el índice se comporta bien.
      <PlaythroughEntryCard
        key={index}
        number={firstNumber + index}
        entry={entry}
        onChange={(next) => onChange(entries.map((item, i) => (i === index ? next : item)))}
        onRemove={() => onChange(entries.filter((_, i) => i !== index))}
      />
    ))}
    <button
      type="button"
      onClick={() => onChange([...entries, EMPTY_MANUAL_PLAYTHROUGH])}
      className="flex w-fit items-center gap-1.5 rounded-[9px] border border-input bg-white/[0.03] px-3.5 py-1.75 text-[12.5px] font-semibold text-foreground hover:bg-white/[0.06]"
    >
      <Plus size={13} />
      {addLabel}
    </button>
  </div>
);
