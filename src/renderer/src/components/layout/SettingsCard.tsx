import { TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

// LOS BLOQUES DE LA PÁGINA DE AJUSTES (Fósforo: estados-ajustes-*.png).
//
// Cada bloque es un panel: título, descripción y acción arriba a la derecha;
// debajo, separado por una línea, su cuerpo (filas de ajuste, una lista, unas
// barras). Antes cada sección pintaba su propia tarjeta con icono y color de
// identidad; en Fósforo el color se reserva para el estado (Phosphor para lo
// pendiente y la acción principal, Tube para sync e información, Live para el
// error) y la jerarquía la dan el panel y la tipografía.

type Tone = 'default' | 'notice' | 'danger';

const toneClass: Record<Tone, string> = {
  default: 'border-line bg-panel',
  // Algo que decidir (identidad duplicada, bucket sin mirar): filo Phosphor.
  notice: 'border-phosphor/45 bg-panel',
  danger: 'border-live/45 bg-live/6',
};

type SettingsCardProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  // Acción (o acciones) a la derecha del título.
  action?: React.ReactNode;
  // Líneas de estado bajo la descripción (progreso, avisos, errores).
  extra?: React.ReactNode;
  // Cuerpo bajo la línea. `flush` lo deja sin relleno para filas y listas
  // que llevan el suyo (SettingsRow, tablas).
  children?: React.ReactNode;
  flush?: boolean;
  bodyClassName?: string;
  tone?: Tone;
  className?: string;
  'data-testid'?: string;
};

export const SettingsCard = ({
  title,
  description,
  action,
  extra,
  children,
  flush = false,
  bodyClassName,
  tone = 'default',
  className,
  'data-testid': testId,
}: SettingsCardProps): React.JSX.Element => (
  <section
    data-testid={testId}
    className={cn('min-w-0 rounded-md border', toneClass[tone], className)}
  >
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 pt-4.5 pb-4">
      <div className="min-w-0 flex-[1_1_320px]">
        <h3 className="text-lead font-semibold text-bone">{title}</h3>
        {description && (
          <p className="mt-1 max-w-[68ch] text-small text-pretty text-dust">{description}</p>
        )}
        {extra}
      </div>
      {action && <div className="flex flex-none flex-wrap items-center gap-2">{action}</div>}
    </header>
    {children && (
      <div className={cn('border-t border-line', !flush && 'px-5 py-4', bodyClassName)}>
        {children}
      </div>
    )}
  </section>
);

// Una fila de ajuste dentro de un panel: nombre y explicación a la izquierda,
// el control a la derecha. Varias seguidas se separan con una línea.
export const SettingsRow = ({
  label,
  description,
  control,
  children,
  labelId,
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  control?: React.ReactNode;
  // Debajo de la explicación (un aviso de conflicto, por ejemplo).
  children?: React.ReactNode;
  // Para que el control se nombre con la etiqueta (aria-labelledby).
  labelId?: string;
}): React.JSX.Element => (
  <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2.5 border-t border-line px-5 py-3.5 first:border-t-0">
    <div className="min-w-0 flex-[1_1_280px]">
      <div id={labelId} className="text-body font-semibold text-bone">
        {label}
      </div>
      {description && <div className="mt-0.5 text-small text-pretty text-dust">{description}</div>}
      {children}
    </div>
    {control && <div className="flex flex-none items-center gap-2">{control}</div>}
  </div>
);

// Aviso en línea: triángulo y texto en Phosphor (no hay color "caution"; el
// icono lleva el significado). `danger` lo pasa a Live para los errores.
export const SettingsNotice = ({
  children,
  action,
  danger = false,
  className,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
  danger?: boolean;
  className?: string;
}): React.JSX.Element => (
  <div
    className={cn(
      'flex flex-wrap items-center gap-x-4 gap-y-2 rounded-sm border px-3.5 py-2.5',
      danger ? 'border-live/40 bg-live/8' : 'border-phosphor/40 bg-phosphor-tint',
      className,
    )}
  >
    <div
      className={cn(
        'flex min-w-0 flex-[1_1_260px] items-start gap-2 text-small font-medium',
        danger ? 'text-live' : 'text-phosphor',
      )}
    >
      <TriangleAlert aria-hidden size={14} className="mt-0.5 flex-none" />
      <div className="min-w-0">{children}</div>
    </div>
    {action && <div className="flex flex-none items-center gap-2">{action}</div>}
  </div>
);

// Línea de estado bajo la descripción de un panel: progreso (Phosphor), dato
// en reposo (Dust) o error (Live).
export const StatusLine = ({
  children,
  tone = 'muted',
}: {
  children: React.ReactNode;
  tone?: 'muted' | 'active' | 'error' | 'info';
}): React.JSX.Element => (
  <div
    className={cn(
      'mt-1.5 text-small font-semibold',
      tone === 'muted' && 'text-dust',
      tone === 'active' && 'text-phosphor',
      tone === 'info' && 'text-tube',
      tone === 'error' && 'text-live',
    )}
  >
    {children}
  </div>
);
