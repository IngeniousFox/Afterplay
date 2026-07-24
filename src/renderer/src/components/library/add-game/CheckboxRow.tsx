import { Check } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// Las dos ternas de color (borde marcado / relleno marcado / icono de check)
// que usa cada checkbox de este tipo en toda la app — verde para lo
// "estructural" (endless, emulado, arranque con Windows), azul para lo que
// es más una anotación/opción secundaria (jugado antes, extra content, notas).
const ACCENT_COLORS: Record<
  'green' | 'blue',
  { borderColorChecked: string; fillColorChecked: string; checkIconColor: string }
> = {
  green: {
    borderColorChecked: 'rgba(47,220,126,.7)',
    fillColorChecked: '#2fdc7e',
    checkIconColor: '#08120c',
  },
  blue: {
    borderColorChecked: 'rgba(133,163,214,.6)',
    fillColorChecked: '#85a3d6',
    checkIconColor: '#0a0b0a',
  },
};

type CheckboxRowProps = {
  checked: boolean;
  onToggle: () => void;
  title: string;
  description: string;
  accent: 'green' | 'blue';
  // Endless siempre tiene el borde de la fila neutro; "jugado antes" lo
  // tiñe del acento en cuanto se marca — mismo componente, dos comportamientos.
  rowBorderFollowsChecked?: boolean;
  // Pequeño glifo delante del título — puramente de personalidad (Infinity
  // para "Endless", History para "jugado antes"...), no sustituye al
  // check-square de la izquierda (ese sigue siendo la única afordancia de
  // "esto es un toggle"). Se tiñe del acento en cuanto se marca.
  icon?: LucideIcon;
};

export const CheckboxRow = ({
  checked,
  onToggle,
  title,
  description,
  accent,
  rowBorderFollowsChecked = false,
  icon: Icon,
}: CheckboxRowProps): React.JSX.Element => {
  const { borderColorChecked, fillColorChecked, checkIconColor } = ACCENT_COLORS[accent];
  return (
    <div
      onClick={onToggle}
      className="flex cursor-pointer items-start gap-2.75 rounded-[10px] bg-white/[0.02] px-3.25 py-2.75 transition-[border-color,background-color] duration-150 hover:bg-white/[0.035]"
      style={{
        border: `1px solid ${rowBorderFollowsChecked && checked ? borderColorChecked : 'var(--border)'}`,
      }}
    >
      <div
        className="mt-0.25 flex h-5 w-5 flex-none items-center justify-center rounded-md transition-[border-color,background-color] duration-150"
        style={
          checked
            ? { border: `1px solid ${borderColorChecked}`, background: fillColorChecked }
            : { border: '1px solid var(--input)', background: 'transparent' }
        }
      >
        {checked && <Check size={14} color={checkIconColor} />}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-1.5 text-[13.5px] font-semibold text-foreground">
          {Icon && (
            <Icon
              size={13}
              className="flex-none transition-colors duration-150"
              style={{ color: checked ? fillColorChecked : 'var(--muted-foreground)' }}
            />
          )}
          {title}
        </div>
        <div className="mt-0.25 text-xs text-muted-foreground">{description}</div>
      </div>
    </div>
  );
};
