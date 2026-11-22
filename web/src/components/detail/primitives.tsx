import { ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Figure } from '../Figure';
import { Ticker } from '../fx/Ticker';

// Las piezas pequeñas que se repiten por toda la ficha. Están juntas en un
// fichero porque son componentes de diez líneas: un archivo por cada uno sería
// más navegación que código.

// Título de sección: Barlow semibold, sin mayúsculas espaciadas (Fósforo no
// usa eyebrows). Sin margen propio — cada sitio decide el suyo.
export const SectionLabel = ({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element => (
  <h2 className={cn('text-lead font-semibold text-bone', className)}>{children}</h2>
);

// Píldora de dato secundario (plataforma, formato, origen, géneros). Neutra
// salvo que se pida un tono: si todo va coloreado, el color deja de significar
// nada. Envuelve en vez de recortar.
export const InfoChip = ({
  Icon,
  children,
  tone = 'neutral',
  title,
}: {
  Icon?: LucideIcon;
  children: React.ReactNode;
  tone?: 'neutral' | 'tube';
  title?: string;
}): React.JSX.Element => (
  <span
    title={title}
    className={cn(
      'inline-flex max-w-full items-center gap-1.5 rounded-sm border px-2 py-1 text-small',
      tone === 'tube' ? 'border-tube/35 bg-tube/8 text-tube' : 'border-line bg-bone/3 text-dust',
    )}
  >
    {Icon && <Icon size={13} className="shrink-0" aria-hidden="true" />}
    <span className="min-w-0">{children}</span>
  </span>
);

// Una cifra con su etiqueta debajo, para las filas de cifras separadas por
// líneas finas (Played · Sessions · Spent…). Con un número y su `format`, la
// cifra entra contando como un marcador (Ticker); con un texto, se pinta tal
// cual ("—").
export const FigureCell = ({
  value,
  format = (amount) => String(Math.round(amount)),
  label,
  accent = false,
  hint,
}: {
  value: string | number;
  format?: (value: number) => string;
  label: string;
  accent?: boolean;
  hint?: string;
}): React.JSX.Element => {
  const figureClass = cn(
    'block text-[30px] leading-8',
    accent
      ? 'text-phosphor [text-shadow:0_0_1px_rgb(255_179_71/0.45),0_0_16px_rgb(255_179_71/0.32)]'
      : 'text-bone',
  );
  return (
    <div className="min-w-0 flex-1 border-l border-line pl-3 first:border-l-0 first:pl-0">
      {typeof value === 'number' ? (
        <Ticker
          value={value}
          format={format}
          className="block"
          render={(text) => <Figure value={text} className={figureClass} />}
        />
      ) : (
        <Figure value={value} className={figureClass} />
      )}
      <div className="mt-0.5 text-micro text-dust">{label}</div>
      {hint && <div className="text-micro font-semibold text-phosphor">{hint}</div>}
    </div>
  );
};

// Celda de la rejilla de Details: etiqueta pequeña arriba, dato debajo. El
// dato envuelve: un "Bandai Namco Entertainment" no se recorta.
export const Cell = ({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}): React.JSX.Element => (
  <div className="min-w-0">
    <div className="text-micro text-dust">{label}</div>
    <div className="mt-0.5 text-small font-semibold break-words text-bone">{value}</div>
  </div>
);

// Panel contenedor estándar de la ficha: Panel con su línea, 8 px de radio.
export const DetailCard = ({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element => (
  <div className={cn('rounded-md border border-line bg-panel p-4', className)}>{children}</div>
);

export const CardTitle = ({
  children,
  aside,
}: {
  children: React.ReactNode;
  aside?: React.ReactNode;
}): React.JSX.Element => (
  <div className="flex items-center justify-between gap-3">
    <h2 className="text-lead font-semibold text-bone">{children}</h2>
    {aside}
  </div>
);

// "Show all 14" / "Show less": el botón que despliega una lista recortada.
export const ShowMoreButton = ({
  expanded,
  total,
  onToggle,
}: {
  expanded: boolean;
  total: number;
  onToggle: () => void;
}): React.JSX.Element => (
  <button
    type="button"
    onClick={onToggle}
    aria-expanded={expanded}
    className="mt-1 flex min-h-11 w-full items-center justify-center gap-1 rounded-sm text-small font-semibold text-tube focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-phosphor active:bg-bone/6"
  >
    {expanded ? 'Show less' : `Show all ${total}`}
    <ChevronDown
      size={15}
      aria-hidden="true"
      className={cn(
        'transition-transform duration-200 motion-reduce:transition-none',
        expanded && 'rotate-180',
      )}
    />
  </button>
);
