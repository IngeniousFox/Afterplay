import { Check } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { BLUE, GREEN } from '../../../lib/colors';

// Las dos ternas de color (borde marcado / relleno marcado / icono de check)
// que usa cada checkbox de este tipo en toda la app — verde para lo
// "estructural" (endless, emulado, arranque con Windows), azul para lo que
// es más una anotación/opción secundaria (jugado antes, extra content, notas).
// fillColorChecked reusa los tokens compartidos (antes una tercera copia
// suelta de los mismos hex); borderColorChecked/checkIconColor son variantes
// de alpha propias de este componente, no una simple reutilización directa.
const ACCENT_COLORS: Record<
  'green' | 'blue',
  { borderColorChecked: string; fillColorChecked: string; checkIconColor: string }
> = {
  green: {
    borderColorChecked: 'rgba(255,179,71,.7)',
    fillColorChecked: GREEN,
    checkIconColor: '#1a1100',
  },
  blue: {
    borderColorChecked: 'rgba(95,211,224,.6)',
    fillColorChecked: BLUE,
    checkIconColor: '#101416',
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
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onToggle}
      className="flex w-full cursor-pointer items-start gap-2.75 rounded-sm bg-bone/[0.02] px-3.25 py-2.75 text-left transition-[border-color,background-color] duration-150 hover:bg-bone/[0.035] outline-hidden focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-phosphor"
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
    </button>
  );
};
