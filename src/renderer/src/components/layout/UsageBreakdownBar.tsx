import { useState } from 'react';
import { formatBytes } from '../../lib/format';

export type UsageSegment = { key: string; label: string; color: string; bytes: number };

// Una carpeta que existe pero pesa cuatro pelos sigue mereciendo un trocito
// visible: sin mínimo, "18 MB de logros" desaparece del todo al lado de 650
// MB de capturas y parece que no está.
const MIN_SEGMENT_PERCENT = 2;

// Barra de reparto de disco + leyenda, compartida por Images y Local copies
// (Ajustes). MISMO lenguaje que la barra apilada de Status Breakdown: tramos
// PLANOS que recorta el contenedor redondeado (cada tramo con su propio
// rounded-full parecía una fila de cápsulas sueltas, con bordes redondos
// por todas partes en vez de una barra continua con filetes), y el mismo
// hover en los dos sentidos — pasar por un tramo o por su fila de leyenda
// atenúa el resto, para inspeccionar una parte sin perder el conjunto.
export const UsageBreakdownBar = ({
  segments,
}: {
  segments: UsageSegment[];
}): React.JSX.Element => {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const total = segments.reduce((sum, segment) => sum + segment.bytes, 0);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
        {segments.map((segment) => (
          <div
            key={segment.key}
            onMouseEnter={() => setHoveredKey(segment.key)}
            onMouseLeave={() => setHoveredKey(null)}
            title={`${segment.label} · ${formatBytes(segment.bytes)} · ${Math.round((segment.bytes / Math.max(1, total)) * 100)}%`}
            className="transition-opacity duration-200"
            style={{
              width: `${Math.max(MIN_SEGMENT_PERCENT, (segment.bytes / Math.max(1, total)) * 100)}%`,
              background: segment.color,
              opacity: hoveredKey !== null && hoveredKey !== segment.key ? 0.35 : 1,
            }}
          />
        ))}
      </div>
      {/* Leyenda en rejilla de dos columnas con el tamaño alineado a la
          derecha, no en flex-wrap: con etiquetas de ancho distinto, envolver
          dejaba una fila de tres y otra de una, con las cifras cayendo cada
          una en un sitio. */}
      <div className="grid grid-cols-2 gap-x-5 gap-y-1.5">
        {segments.map((segment) => {
          const isDimmed = hoveredKey !== null && hoveredKey !== segment.key;
          return (
            <div
              key={segment.key}
              onMouseEnter={() => setHoveredKey(segment.key)}
              onMouseLeave={() => setHoveredKey(null)}
              className="flex items-center gap-1.75 text-[11px] transition-opacity duration-200"
              style={{ opacity: isDimmed ? 0.45 : 1 }}
            >
              <div
                className="h-1.5 w-1.5 flex-none rounded-full"
                style={{ background: segment.color }}
              />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{segment.label}</span>
              <span className="flex-none font-semibold tabular-nums text-foreground">
                {formatBytes(segment.bytes)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
