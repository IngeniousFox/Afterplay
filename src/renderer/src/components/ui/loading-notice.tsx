import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

// Fósforo: spinner de 15 px a 700 ms lineal; con reduced motion pasa a un
// pulso de opacidad suave en vez de quedarse quieto.
export const LoadingNotice = ({
  label,
  className,
}: {
  label: string;
  className?: string;
}): React.JSX.Element => (
  <div
    role="status"
    className={cn('flex items-center justify-center gap-2 text-body text-dust', className)}
  >
    <Loader2
      size={15}
      aria-hidden
      className="animate-[spin_700ms_linear_infinite] text-phosphor motion-reduce:animate-pulse-soft"
    />
    <span>{label}</span>
  </div>
);
