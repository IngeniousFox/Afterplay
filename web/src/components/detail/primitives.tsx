import type { LucideIcon } from 'lucide-react';

// Las piezas pequeñas que se repiten por toda la ficha, portadas una a una del
// escritorio (SectionLabel, InfoChip, StatTile, Cell y MetricCard). Están
// juntas en un fichero porque son cinco componentes de diez líneas: un archivo
// por cada uno sería más navegación que código.

// Eyebrow de sección: texto pequeño, mayúsculas, tracking ancho. Sin margen
// propio — cada sitio decide el suyo.
export const SectionLabel = ({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element => (
  <div className={`text-lead font-semibold text-bone ${className}`}>{children}</div>
);

// Píldora de dato secundario (plataforma, formato, origen, géneros). Sin
// color es neutra, que es lo que debe ser la mayoría: si todo va coloreado, el
// color deja de significar nada.
export const InfoChip = ({
  Icon,
  children,
  color,
  title,
}: {
  Icon?: LucideIcon;
  children: React.ReactNode;
  color?: string;
  title?: string;
}): React.JSX.Element => (
  <span
    title={title}
    className="inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2.25 py-1 text-[11.5px] font-semibold"
    style={
      color
        ? { color, borderColor: `${color}3d`, background: `${color}14` }
        : {
            color: 'var(--muted-foreground)',
            borderColor: 'var(--border)',
            background: 'rgba(233,228,216,.028)',
          }
    }
  >
    {Icon && <Icon size={12} className="flex-none" />}
    <span className="truncate">{children}</span>
  </span>
);

// Tile de una medida coloreada: borde y fondo teñidos, etiqueta diminuta,
// valor grande.
export const StatTile = ({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: string;
}): React.JSX.Element => (
  <div
    className="rounded-[11px] border px-3 py-2.5"
    style={{ borderColor: `${color}2e`, background: `${color}0f` }}
  >
    <div className="text-micro font-semibold text-dust">{label}</div>
    <div
      className="mt-1 font-display text-[24px] leading-none font-bold tabular-nums"
      style={{ color }}
    >
      {value}
    </div>
  </div>
);

// Celda de la rejilla de ficha: etiqueta diminuta arriba, dato debajo. Dos por
// fila ocupan lo que antes ocupaba UNA fila `label —— valor`, y al ir
// alineadas en columna se comparan de un vistazo.
export const Cell = ({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}): React.JSX.Element => (
  <div className="min-w-0">
    <div className="text-micro font-semibold text-dust">{label}</div>
    <div
      className="mt-0.75 truncate text-[12.5px] font-semibold text-foreground"
      title={typeof value === 'string' ? value : undefined}
    >
      {value}
    </div>
  </div>
);

// Card de métrica con su color de identidad (verde tiempo, ámbar dinero, azul
// conteos, violeta ratios) y el brillo tenue en la esquina.
//
// El único ajuste respecto al escritorio es el tamaño del número: allí son
// 25px en una fila de cuatro cards anchas; aquí van dos por fila en 375px, y
// a 25px un "5448h 43m" se salía de su caja.
export const MetricCard = ({
  Icon,
  label,
  value,
  liveHint,
  accent = '#ffb347',
}: {
  Icon: LucideIcon;
  label: string;
  value: string;
  liveHint?: string;
  accent?: string;
}): React.JSX.Element => (
  <div className="relative min-w-0 overflow-hidden rounded-[13px] border border-border bg-card px-3.5 py-3">
    <div
      className="pointer-events-none absolute -top-8 -right-8 h-24 w-24 rounded-full blur-2xl"
      style={{ background: accent, opacity: 0.09 }}
    />
    <div className="relative flex items-center gap-1.5">
      <span
        className="flex h-5.5 w-5.5 flex-none items-center justify-center rounded-[6px] border"
        style={{ background: `${accent}1f`, borderColor: `${accent}40` }}
      >
        <Icon size={11} color={accent} />
      </span>
      <span className="truncate text-micro font-semibold text-dust">{label}</span>
    </div>
    <div className="relative mt-2 font-display text-[24px] leading-none font-bold text-bone tabular-nums">
      {value}
    </div>
    {liveHint && (
      <div className="relative mt-1 text-[11px] font-semibold text-primary tabular-nums">
        {liveHint}
      </div>
    )}
  </div>
);

// Card contenedora estándar de la ficha: el mismo borde, fondo y radio en
// todas. Repetido a mano en cada sección del escritorio; aquí es una pieza.
export const DetailCard = ({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element => (
  <div className={`rounded-[14px] border border-border bg-card px-4 py-4 ${className}`}>
    {children}
  </div>
);

export const CardTitle = ({
  children,
  aside,
}: {
  children: React.ReactNode;
  aside?: React.ReactNode;
}): React.JSX.Element => (
  <div className="flex items-center justify-between gap-3">
    <span className="text-lead font-semibold text-bone">{children}</span>
    {aside}
  </div>
);
