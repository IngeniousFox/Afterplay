import { NumberInput } from '../../ui/number-input';
import { fieldLabelClass } from './styles';

type MoneyAmountFieldProps = {
  // 'MONEY SPENT (€)' en Add Game, 'AMOUNT (€)' en el popover de gasto del
  // detalle — mismo componente, dos formularios distintos.
  label: string;
  // '· saved as a purchase' — solo Add Game lo lleva, el popover de gasto
  // ya deja elegir el tipo (Purchase/In-game spend) al lado.
  hint?: string;
} & React.ComponentProps<'input'>;

// Compartido por AddGameModal (Money Spent) y AddSpendPopover (Amount) —
// mismo lenguaje que HoursPlayedField: un solo marco (el del NumberInput) con
// el símbolo del euro dentro como adorno, y la cifra en Phosphor. Sin tile
// teñida alrededor ni colores en línea.
export const MoneyAmountField = ({
  label,
  hint,
  ...props
}: MoneyAmountFieldProps): React.JSX.Element => (
  <div className="min-w-0 flex-1">
    <div className={fieldLabelClass}>
      {label}
      {hint && <span className="font-medium"> {hint}</span>}
    </div>
    <div className="relative">
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[13px] font-bold text-phosphor/70"
      >
        €
      </span>
      <NumberInput
        aria-label={label}
        {...props}
        min={0}
        step="0.01"
        placeholder="0.00"
        className="w-full py-2 pr-3 pl-7.5 text-[15px] font-extrabold text-phosphor placeholder:font-medium placeholder:text-dust/60"
      />
    </div>
  </div>
);
