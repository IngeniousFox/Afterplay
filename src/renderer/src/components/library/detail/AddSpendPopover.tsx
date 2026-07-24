import { Plus } from 'lucide-react';
import { useState } from 'react';
import type { SpendEvent } from '../../../../../shared/types';
import { useAddSpend } from '../../../hooks/spend';
import { accentGradientStyle, floatingPanelClass } from '../../../lib/styles';
import { DateWithPrecisionPicker } from '../add-game/DateWithPrecisionPicker';
import { MoneyAmountField } from '../add-game/MoneyAmountField';
import type { PrecisionDateValue } from '../add-game/precisionDate';
import { parseIsoDate, todayValue } from '../add-game/precisionDate';
import { SegmentedButtonGroup } from '../add-game/SegmentedButtonGroup';
import { fieldLabelClass, textInputClass, textInputFocusClass } from '../add-game/styles';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover';

type AddSpendPopoverProps = {
  gameId: number;
};

const TYPE_OPTIONS: { value: SpendEvent['type']; label: string }[] = [
  { value: 'purchase', label: 'Purchase' },
  { value: 'ingame_spend', label: 'In-game spend' },
];

// Botón "Añadir gasto" de la barra de acciones (SPEC 4.5) — popover con un
// formulario pequeño e independiente del playthrough: tipo, cantidad, fecha
// con precisión, nota libre. Crea un spendEvent suelto colgando del juego.
export const AddSpendPopover = ({ gameId }: AddSpendPopoverProps): React.JSX.Element => {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<SpendEvent['type']>('purchase');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState<PrecisionDateValue | null>(todayValue());
  const [note, setNote] = useState('');
  const addSpend = useAddSpend();

  const reset = (): void => {
    setType('purchase');
    setAmount('');
    setDate(todayValue());
    setNote('');
    addSpend.reset();
  };

  const handleSubmit = async (): Promise<void> => {
    const parsedAmount = Number(amount);
    if (!date || !amount.trim() || Number.isNaN(parsedAmount) || parsedAmount <= 0) return;

    await addSpend.mutateAsync({
      gameId,
      type,
      amount: parsedAmount,
      occurredAt: parseIsoDate(date.isoDate),
      datePrecision: date.precision,
      note: note.trim() || null,
    });

    reset();
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <PopoverTrigger className="flex items-center gap-2 rounded-[11px] border border-input bg-white/[0.03] px-4.5 py-3 text-[14px] font-semibold text-foreground hover:bg-white/[0.06]">
        <Plus size={16} />
        Add spend
      </PopoverTrigger>
      <PopoverContent className={`w-80 ${floatingPanelClass} p-4`}>
        <div className="flex flex-col gap-3.5">
          <div>
            <div className={fieldLabelClass}>TYPE</div>
            <SegmentedButtonGroup value={type} options={TYPE_OPTIONS} onChange={setType} />
          </div>

          <MoneyAmountField
            label="AMOUNT (€)"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />

          <DateWithPrecisionPicker label="Date" value={date} onChange={setDate} />

          <div>
            <div className={fieldLabelClass}>NOTE · optional</div>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="e.g. Winter sale, season pass…"
              className={`${textInputClass} ${textInputFocusClass}`}
            />
          </div>

          {addSpend.isError && (
            <div className="text-[12px] text-destructive">
              Couldn&apos;t add the spend — {addSpend.error.message}
            </div>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={addSpend.isPending}
            className="[will-change:transform] rounded-[9px] px-4 py-2.25 text-[13px] font-bold transition-transform duration-200 ease-[cubic-bezier(.16,1,.3,1)] disabled:cursor-not-allowed disabled:opacity-60 enabled:hover:-translate-y-1 enabled:hover:shadow-[0_10px_24px_rgba(47,220,126,.32)]"
            style={accentGradientStyle}
          >
            {addSpend.isPending ? 'Adding…' : 'Add spend'}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
};
