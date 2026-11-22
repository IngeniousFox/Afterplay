import { cn } from '@/lib/utils';

// Cifra de Fósforo con la unidad pequeña en Dust (README-sistema, principio
// 7): "23h 15m" se pinta como 23 h 15 m con las letras a 0.45 em. La comparten
// Sessions (duraciones, cabecera), el Plan (HLTB, deuda) y el aviso de cierre.
export const Figure = ({
  value,
  className,
  unitClassName,
}: {
  value: string;
  className?: string;
  // El color de la unidad: Dust por defecto; el aviso de cierre la quiere en
  // Phosphor apagado, como su cifra.
  unitClassName?: string;
}): React.JSX.Element => (
  <span className={cn('font-display leading-none font-bold tabular-nums', className)}>
    {value.split(/(\d[\d,.:]*)/).map((part, index) =>
      /\d/.test(part) ? (
        <span key={index}>{part}</span>
      ) : part.trim() === '' ? null : (
        <span
          key={index}
          className={cn(
            'ml-[0.1em] mr-[0.6em] text-[0.45em] font-semibold text-dust last:mr-0',
            unitClassName,
          )}
        >
          {part.trim()}
        </span>
      ),
    )}
  </span>
);
