import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

export const LoadingNotice = ({
  label,
  className,
}: {
  label: string;
  className?: string;
}): React.JSX.Element => (
  <div
    role="status"
    className={cn(
      'flex items-center justify-center gap-2 text-sm text-muted-foreground',
      className,
    )}
  >
    <Loader2 size={16} aria-hidden className="animate-spin motion-reduce:animate-none" />
    <span>{label}</span>
  </div>
);
