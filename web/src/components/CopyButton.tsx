import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '../lib/cn';
import { secondaryButtonClass } from '../lib/styles';

// Copia `value` al portapapeles. `navigator.clipboard` solo existe en contextos
// seguros (https o localhost) y puede rechazar el permiso; sin él, el texto
// que se enseña al lado es seleccionable y se puede copiar a mano.
// Con `text` enseña la palabra ("Copy code"); sin él es un botón de icono de
// 44 px, para ir pegado a un campo.
export const CopyButton = ({
  value,
  label,
  text,
}: {
  value: string;
  label: string;
  text?: string;
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
      className={cn(secondaryButtonClass, text ? 'px-3' : 'w-11 px-0')}
    >
      {state === 'copied' ? (
        <Check size={16} className="text-phosphor" />
      ) : (
        <Copy size={16} className="text-dust" />
      )}
      <span aria-live="polite" className={text ? undefined : 'sr-only'}>
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Select it' : (text ?? 'Copy')}
      </span>
    </button>
  );
};
