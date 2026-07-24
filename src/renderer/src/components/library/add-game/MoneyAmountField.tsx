import { NumberInput } from '../../ui/number-input';

const AMBER = '#e3b24a';

type MoneyAmountFieldProps = {
  // 'MONEY SPENT (€)' en Add Game, 'AMOUNT (€)' en el popover de gasto del
  // detalle — mismo componente, dos formularios distintos.
  label: string;
  // '· saved as a purchase' — solo Add Game lo lleva, el popover de gasto
  // ya deja elegir el tipo (Purchase/In-game spend) al lado.
  hint?: string;
} & React.ComponentProps<'input'>;

// Compartido por AddGameModal (Money Spent) y AddSpendPopover (Amount) —
// mismo lenguaje que HoursPlayedField: tile ámbar de dinero (en vez de
// verde de tiempo) con el input en su propio hueco oscuro, no flotando
// transparente sobre el tinte.
export const MoneyAmountField = ({
  label,
  hint,
  ...props
}: MoneyAmountFieldProps): React.JSX.Element => (
  <div
    className="flex-1 rounded-[9px] border px-3 py-2"
    style={{ borderColor: `${AMBER}2e`, background: `${AMBER}0f` }}
  >
    <div className="text-[9.5px] font-bold tracking-[.11em]" style={{ color: `${AMBER}c4` }}>
      {label}
      {hint && <span className="font-medium tracking-normal normal-case opacity-80"> {hint}</span>}
    </div>
    <div
      className="mt-1 flex items-center gap-1.5 rounded-[7px] border px-2.25 py-1.5"
      style={{ borderColor: `${AMBER}26`, background: 'rgba(0,0,0,.22)' }}
    >
      <span className="flex-none text-[13px] font-bold" style={{ color: `${AMBER}99` }}>
        €
      </span>
      <NumberInput
        {...props}
        min={0}
        step="0.01"
        placeholder="0.00"
        className="w-full bg-transparent text-[15px] font-extrabold tabular-nums outline-none placeholder:font-medium placeholder:text-muted-foreground/40"
        style={{ color: AMBER }}
      />
    </div>
  </div>
);
