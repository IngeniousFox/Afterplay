import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';

// Copia `value` al portapapeles. `navigator.clipboard` solo existe en contextos
// seguros (https o localhost) y puede rechazar el permiso; sin él, el texto
// que se enseña al lado es seleccionable y se puede copiar a mano.
export const CopyButton = ({
  value,
  label,
}: {
  value: string;
  label: string;
}): React.JSX.Element => {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(timer);
  }, [state]);

  const copy = (): void => {
    navigator.clipboard.writeText(value).then(
      () => setState('copied'),
      () => setState('failed'),
    );
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy ${label}`}
      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[12px] font-bold text-foreground transition-colors active:bg-bone/8"
    >
      {state === 'copied' ? (
        <Check size={14} className="text-primary" />
      ) : (
        <Copy size={14} className="text-muted-foreground" />
      )}
      <span aria-live="polite">
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Select it' : 'Copy'}
      </span>
    </button>
  );
};
