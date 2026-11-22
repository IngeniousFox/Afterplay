import { useRef } from 'react';
import { cn } from '@/lib/utils';

export type SegmentedOption<T extends string> = { value: T; label: React.ReactNode };

type SegmentedControlProps<T extends string> = {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  'aria-label': string;
  className?: string;
};

// Control segmentado de Fósforo (hoja 5): opciones excluyentes pegadas en un
// marco Inset con Line strong; la elegida en Raised con el texto en Phosphor.
// Semántica de grupo de radio: las flechas mueven la selección y solo la
// opción elegida entra en el orden de tabulación.
export const SegmentedControl = <T extends string>({
  value,
  options,
  onChange,
  className,
  'aria-label': ariaLabel,
}: SegmentedControlProps<T>): React.JSX.Element => {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (from: number, step: number): void => {
    const next = (from + step + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex flex-none overflow-hidden rounded-sm border border-line-strong bg-inset',
        className,
      )}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault();
                move(index, 1);
              } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                event.preventDefault();
                move(index, -1);
              }
            }}
            className={cn(
              'h-8 px-3.5 text-small font-semibold whitespace-nowrap transition-[background-color,color] duration-150',
              'outline-hidden focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-phosphor',
              index > 0 && 'border-l border-line',
              selected ? 'bg-raised text-phosphor' : 'text-dust hover:bg-bone/6 hover:text-bone',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
};
