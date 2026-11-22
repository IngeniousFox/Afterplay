import { useRef } from 'react';
import { cn } from '@/lib/utils';

// Pestañas de Fósforo (ficha de juego): texto Barlow en Dust, la activa en
// Bone semibold con una raya Phosphor de 2 px debajo, y a la derecha de cada
// una su cifra en una placa Inset. Un punto opcional avisa de que la pestaña
// pide atención (los saves divergidos, por ejemplo). Las flechas mueven el
// foco y la selección, como pide el patrón de tablist.

export type TabItem<K extends string> = {
  key: K;
  label: string;
  // Cifra pequeña junto a la etiqueta ("14", "38/52"). Sin ella no hay placa.
  count?: string | null;
  // Punto de atención: el color lo pone quien llama (clases literales).
  attentionClass?: string | null;
  attentionLabel?: string;
};

type TabsProps<K extends string> = {
  items: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  label: string;
  // Prefijo de los id de pestaña y panel, para aria-controls.
  idPrefix: string;
  className?: string;
};

export const tabPanelId = (idPrefix: string, key: string): string => `${idPrefix}-panel-${key}`;
export const tabId = (idPrefix: string, key: string): string => `${idPrefix}-tab-${key}`;

export const Tabs = <K extends string>({
  items,
  value,
  onChange,
  label,
  idPrefix,
  className,
}: TabsProps<K>): React.JSX.Element => {
  const listRef = useRef<HTMLDivElement>(null);

  const focusAt = (index: number): void => {
    const next = items[(index + items.length) % items.length];
    onChange(next.key);
    listRef.current
      ?.querySelector<HTMLButtonElement>(`[data-tab-key="${next.key}"]`)
      ?.focus({ preventScroll: true });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const index = items.findIndex((item) => item.key === value);
    if (event.key === 'ArrowRight') focusAt(index + 1);
    else if (event.key === 'ArrowLeft') focusAt(index - 1);
    else if (event.key === 'Home') focusAt(0);
    else if (event.key === 'End') focusAt(items.length - 1);
    else return;
    event.preventDefault();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={handleKeyDown}
      className={cn('flex min-w-0 flex-wrap items-stretch gap-x-2', className)}
    >
      {items.map((item) => {
        const active = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            id={tabId(idPrefix, item.key)}
            data-tab-key={item.key}
            aria-selected={active}
            aria-controls={tabPanelId(idPrefix, item.key)}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.key)}
            className={cn(
              'relative flex h-12 items-center gap-2 px-4.5 text-lead whitespace-nowrap transition-colors duration-150',
              'outline-hidden focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-phosphor',
              'after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:transition-colors after:duration-150',
              active
                ? 'font-semibold text-bone after:bg-phosphor'
                : 'text-dust after:bg-transparent hover:text-bone',
            )}
          >
            {item.label}
            {item.count && (
              <span className="rounded-xs bg-inset px-1.5 py-px text-micro font-medium text-dust tabular-nums">
                {item.count}
              </span>
            )}
            {item.attentionClass && (
              <span
                role="img"
                aria-label={item.attentionLabel ?? 'Needs attention'}
                className={cn('size-2 flex-none rounded-full', item.attentionClass)}
              />
            )}
          </button>
        );
      })}
    </div>
  );
};
