import { Check } from 'lucide-react';

type CheckboxRowProps = {
  checked: boolean;
  onToggle: () => void;
  title: string;
  description: string;
  borderColorChecked: string;
  fillColorChecked: string;
  checkIconColor: string;
  // Endless siempre tiene el borde de la fila neutro; "jugado antes" lo
  // tiñe del acento en cuanto se marca — mismo componente, dos comportamientos.
  rowBorderFollowsChecked?: boolean;
};

export const CheckboxRow = ({
  checked,
  onToggle,
  title,
  description,
  borderColorChecked,
  fillColorChecked,
  checkIconColor,
  rowBorderFollowsChecked = false,
}: CheckboxRowProps): React.JSX.Element => (
  <div
    onClick={onToggle}
    className="flex cursor-pointer items-start gap-2.75 rounded-[10px] bg-white/[0.02] px-3.25 py-2.75"
    style={{
      border: `1px solid ${rowBorderFollowsChecked && checked ? borderColorChecked : 'var(--border)'}`,
    }}
  >
    <div
      className="mt-0.25 flex h-5 w-5 flex-none items-center justify-center rounded-md"
      style={
        checked
          ? { border: `1px solid ${borderColorChecked}`, background: fillColorChecked }
          : { border: '1px solid var(--input)', background: 'transparent' }
      }
    >
      {checked && <Check size={14} color={checkIconColor} />}
    </div>
    <div className="flex-1">
      <div className="text-[13.5px] font-semibold text-foreground">{title}</div>
      <div className="mt-0.25 text-xs text-muted-foreground">{description}</div>
    </div>
  </div>
);
