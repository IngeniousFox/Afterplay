import { ChevronLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '../lib/cn';
import { iconButtonClass } from '../lib/styles';

// La cabecera de las pantallas de primer nivel: título grande en Big
// Shoulders y, a la derecha, el dato de contexto ("331 games", la fecha…).
// Sustituye a la barra global con la marca: en Fósforo cada pantalla se
// presenta por su nombre.
export const PageHeader = ({
  title,
  aside,
  back,
  className,
}: {
  title: string;
  aside?: React.ReactNode;
  // Pantallas que no están en la barra de pestañas (Ajustes): flecha atrás.
  back?: string;
  className?: string;
}): React.JSX.Element => (
  <header className={cn('flex items-end justify-between gap-3 pt-5 pb-3', className)}>
    <div className="flex min-w-0 items-center gap-1">
      {back && (
        <Link to={back} aria-label="Back" className={cn(iconButtonClass, '-ml-3 text-bone')}>
          <ChevronLeft size={22} />
        </Link>
      )}
      <h1 className="font-display text-[40px] leading-[42px] font-bold tracking-[0.005em] text-bone">
        {title}
      </h1>
    </div>
    {aside && (
      <div className="flex shrink-0 items-center gap-1 pb-1 text-small text-dust">{aside}</div>
    )}
  </header>
);

// Título de sección dentro de una pantalla: Barlow semibold, sin mayúsculas
// espaciadas (Fósforo no usa eyebrows).
export const SectionTitle = ({
  children,
  aside,
  className,
}: {
  children: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
}): React.JSX.Element => (
  <div className={cn('mb-2 flex items-baseline justify-between gap-3', className)}>
    <h2 className="text-lead font-semibold text-bone">{children}</h2>
    {aside && <div className="shrink-0 text-small text-dust tabular-nums">{aside}</div>}
  </div>
);
