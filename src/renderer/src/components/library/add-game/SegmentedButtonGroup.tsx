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
          className="rounded-[9px] px-4 py-2 text-[13px] font-semibold"
          style={
            isSelected
              ? {
                  border: '1px solid rgba(47,220,126,.5)',
                  background: 'rgba(47,220,126,.12)',
                  color: '#2fdc7e',
                }
              : {
                  border: '1px solid var(--input)',
                  background: 'rgba(255,255,255,.03)',
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
