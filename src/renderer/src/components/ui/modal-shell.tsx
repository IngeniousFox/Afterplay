import type { LucideIcon } from 'lucide-react';
import { X } from 'lucide-react';
import { primaryButtonClass, secondaryButtonClass } from '../../lib/styles';
import { Dialog, DialogContent } from './dialog';

type ModalShellProps = {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  // Icono + color de identidad del modal — mismo lenguaje que FormSection
  // (Add/Edit Game) y SettingsCard: un chip de color junto al título, más un
  // lavado sutil del mismo color de fondo de la cabecera. Opcionales: sin
  // ellos, cabecera neutra de siempre.
  icon?: LucideIcon;
  color?: string;
  // Ancho/alto máximo del modal — cada uno de los 6 modales trae el suyo
  // (w-160/w-135/w-130, max-h-[80vh]/[70vh]); maxHClass es opcional porque
  // Edit Notes no limita altura (su contenido no necesita scroll propio).
  widthClass: string;
  maxHClass?: string;
  // Contenido extra bajo el título, dentro de la misma cabecera — hoy es el
  // subtítulo de Add Game / Assign Session. Si llega, el título y este
  // contenido comparten el mismo div envolvente (igual que hoy); si no,
  // el título va suelto.
  headerExtra?: React.ReactNode;
  // Clase del cuerpo — por defecto la de los modales con contenido
  // scrollable (Add Game/Edit Game/Change Cover). Los que se salen de ese
  // patrón (Edit Notes sin scroll, Settings con su propio flex-col,
  // Assign Session con su propio padding) pasan la suya exacta.
  bodyClassName?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
};

const DEFAULT_BODY_CLASS = 'min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-5.5 py-5';

// Shell compartido por los 6 modales de la app (auditoría del refactor de
// UI): mismo Dialog + DialogContent con la clase canónica que todos
// repetían, misma cabecera (título + botón X) y mismo footer opcional —
// cada modal solo aporta lo que le es propio (ancho/alto, contenido,
// footer).
export const ModalShell = ({
  open,
  onClose,
  title,
  icon: Icon,
  color,
  widthClass,
  maxHClass,
  headerExtra,
  bodyClassName,
  footer,
  children,
}: ModalShellProps): React.JSX.Element => {
  const containerClass = [
    'flex',
    maxHClass,
    widthClass,
    // Fósforo: Overlay + Line strong + radio 8; shadow-modal ya trae el filo
    // superior de luz.
    'max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-md border border-line-strong bg-overlay p-0 shadow-modal sm:max-w-[calc(100%-2rem)]',
  ]
    .filter(Boolean)
    .join(' ');

  const titleRow = (
    <div className="flex items-center gap-2.5">
      {Icon && color && (
        <div
          className="flex h-8 w-8 flex-none items-center justify-center rounded-sm"
          style={{ background: `${color}20` }}
        >
          <Icon size={16} style={{ color }} />
        </div>
      )}
      <div className="font-display text-title font-bold text-bone">{title}</div>
    </div>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent showCloseButton={false} className={containerClass}>
        {/* flex-none obligatorio: el overflow-hidden (para recortar el
            degradado) anula el min-height:auto de la cabecera, así que sin
            esto flexbox la encoge en modales altos (max-h-[80vh] con mucho
            contenido) y el overflow-hidden recorta el título. */}
        {/* Sin lavado de color: en Fósforo el brillo es solo de las zonas
            héroe; la identidad del modal la lleva el chip del icono. */}
        <div className="relative flex-none border-b border-line">
          <div className="relative flex items-center justify-between px-5.5 py-4.5">
            {headerExtra ? (
              <div>
                {titleRow}
                {headerExtra}
              </div>
            ) : (
              titleRow
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-8.5 w-8.5 flex-none items-center justify-center rounded-sm text-dust outline-hidden transition-[background-color,color,transform] duration-150 hover:bg-bone/6 hover:text-bone focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phosphor active:scale-[.97] active:bg-bone/11"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className={bodyClassName ?? DEFAULT_BODY_CLASS}>{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-2.5 border-t border-line px-5.5 py-4">
            {footer}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

type ModalFooterProps = {
  onCancel: () => void;
  onSubmit: () => void;
  submitting: boolean;
  submitLabel: string;
  submittingLabel: string;
  icon?: React.ReactNode;
};

// Par Cancel + botón primario que hoy repiten los footers de los modales de
// edición (Edit Game, Change Cover, Edit Notes). Add Game no lo usa: su botón
// de guardar tiene un estilo adicional (gris) cuando aún no hay juego
// elegido, distinto del resto — se queda con su footer propio.
export const ModalFooter = ({
  onCancel,
  onSubmit,
  submitting,
  submitLabel,
  submittingLabel,
  icon,
}: ModalFooterProps): React.JSX.Element => (
  <>
    <button type="button" onClick={onCancel} disabled={submitting} className={secondaryButtonClass}>
      Cancel
    </button>
    <button
      type="button"
      onClick={onSubmit}
      disabled={submitting}
      className={primaryButtonClass}
      aria-busy={submitting || undefined}
    >
      {icon}
      <span>{submitting ? submittingLabel : submitLabel}</span>
    </button>
  </>
);
