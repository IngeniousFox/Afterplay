type SegmentedButtonGroupProps<T extends string> = {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  wrap?: boolean;
};

// Grupo de botones tipo "elige uno" (Origin/Format) — el seleccionado se
// pinta con el acento verde, el resto queda neutro.
export const SegmentedButtonGroup = <T extends string>({
  value,
  options,
  onChange,
  wrap = false,
}: SegmentedButtonGroupProps<T>): React.JSX.Element => (
  <div className={`flex gap-2 ${wrap ? 'flex-wrap' : ''}`}>
    {options.map((option) => {
      const isSelected = value === option.value;
      return (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`rounded-sm px-4 py-2 text-[13px] font-semibold transition-[border-color,background-color,color] duration-150 ${
            isSelected ? '' : 'hover:border-line-strong hover:bg-bone/[0.06]'
          }`}
          style={
            isSelected
              ? {
                  border: '1px solid rgba(255,179,71,.5)',
                  background: 'rgba(255,179,71,.12)',
                  color: '#ffb347',
                }
              : {
                  border: '1px solid var(--input)',
                  background: 'rgba(233,228,216,.03)',
                  color: 'var(--foreground)',
                }
          }
        >
          {option.label}
        </button>
      );
    })}
  </div>
);
