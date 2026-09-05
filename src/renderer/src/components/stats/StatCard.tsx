import { cn } from '../../lib/utils';
import type { CSSProperties } from 'react';

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
  style?: CSSProperties;
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
  style,
  children,
}: StatCardProps): React.JSX.Element => (
  <div
    className={cn(
      'afterplay-stat-card rounded-[14px] border border-border bg-card px-5.5 py-5',
      '[.afterplay-stats-screen_&]:relative [.afterplay-stats-screen_&]:isolate',
      '[.afterplay-stats-screen_&]:[background:linear-gradient(145deg,rgba(255,255,255,0.038),rgba(255,255,255,0.012)),rgba(12,14,13,0.76)]',
      '[.afterplay-stats-screen_&]:border-white/[0.085]',
      '[.afterplay-stats-screen_&]:[box-shadow:inset_0_1px_0_rgba(255,255,255,0.025),0_15px_42px_rgba(0,0,0,0.13)]',
      '[.afterplay-stats-screen_&]:[transition:border-color_240ms_ease,background-color_240ms_ease,box-shadow_260ms_ease]',
      "[.afterplay-stats-screen_&::before]:content-[''] [.afterplay-stats-screen_&::before]:absolute",
      '[.afterplay-stats-screen_&::before]:-z-1 [.afterplay-stats-screen_&::before]:inset-0',
      '[.afterplay-stats-screen_&::before]:rounded-[inherit] [.afterplay-stats-screen_&::before]:pointer-events-none',
      '[.afterplay-stats-screen_&::before]:opacity-0',
      '[.afterplay-stats-screen_&::before]:[background:radial-gradient(circle_at_88%_0%,rgba(47,220,126,0.075),transparent_34%)]',
      '[.afterplay-stats-screen_&::before]:[transition:opacity_240ms_ease]',
      '[.afterplay-stats-screen_&:hover]:border-white/[0.135]',
      '[.afterplay-stats-screen_&:hover]:[box-shadow:inset_0_1px_0_rgba(255,255,255,0.035),0_22px_52px_rgba(0,0,0,0.2)]',
      '[.afterplay-stats-screen_&:hover::before]:opacity-100',
      className,
    )}
    style={style}
  >
    {title !== undefined && (
      <div className={`text-[14px] font-bold text-foreground ${titleClassName}`.trim()}>
        {title}
      </div>
    )}
    {children}
  </div>
);
