type StatCardProps = {
  // Título estándar de card ('text-[14px] font-bold text-foreground') — cada
  // sitio aporta su propio margen inferior (o ninguno) vía titleClassName,
  // así que no se fuerza un mb único para todos.
  title?: string;
  titleClassName?: string;
  // Extras del wrapper por sitio: 'flex h-full flex-col' (GenreRadar,
  // StreakCard, HoursByMonthChart — estirarse a la altura de la grid) o el
  // overflow de HistoryList.
  className?: string;
  children: React.ReactNode;
};

// Wrapper repetido 12 veces: 'rounded-[14px] border border-border bg-card
// px-5.5 py-5'. Algunas cards (ActivityHeatmap, GameAgeDonut,
// HoursByMonthChart) llevan cabecera compuesta y la mantienen como children,
// sin usar el prop `title`.
export const StatCard = ({
  title,
  titleClassName = '',
  className = '',
  children,
}: StatCardProps): React.JSX.Element => (
  <div className={`rounded-[14px] border border-border bg-card px-5.5 py-5 ${className}`.trim()}>
    {title !== undefined && (
      <div className={`text-[14px] font-bold text-foreground ${titleClassName}`.trim()}>
        {title}
      </div>
    )}
    {children}
  </div>
);
