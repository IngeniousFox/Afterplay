type StatTileProps = {
  color: string;
  label: string;
  value: string;
  // 'sm' (17px, PlannedPanel — un juego sin playthrough) o 'lg' (19px,
  // PlaythroughPanel — las dos medidas que sí importan). Mismo tile, la
  // única diferencia real entre los dos que había antes.
  size?: 'sm' | 'lg';
};

// Tile de una medida coloreada (borde/fondo teñidos, etiqueta diminuta +
// valor grande) — repetido byte a byte entre PlannedPanel y PlaythroughPanel
// con solo el tamaño del valor distinto.
export const StatTile = ({
  color,
  label,
  value,
  size = 'lg',
}: StatTileProps): React.JSX.Element => (
  <div
    className="rounded-sm border px-3 py-2.5"
    style={{ borderColor: `${color}2e`, background: `${color}0f` }}
  >
    <div className="text-micro font-semibold text-dust">{label}</div>
    <div
      className={`mt-1 font-display leading-none font-bold tabular-nums ${size === 'sm' ? 'text-[22px]' : 'text-[24px]'}`}
      style={{ color }}
    >
      {value}
    </div>
  </div>
);
