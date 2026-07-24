import type { LucideIcon } from 'lucide-react';
import { X } from 'lucide-react';
import { accentGradientStyle } from '../../lib/styles';
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
    // El inset blanco al 6% traza una línea de luz finísima justo por dentro
    // del borde superior — el típico bisel de card premium, apenas
    // perceptible pero se nota en el conjunto.
    'max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-[18px] border border-input bg-[#121413] p-0 shadow-[inset_0_1px_0_rgba(255,255,255,.06),0_30px_80px_rgba(0,0,0,.6)] sm:max-w-[calc(100%-2rem)]',
  ]
    .filter(Boolean)
    .join(' ');

  const titleRow = (
    <div className="flex items-center gap-2.5">
      {Icon && color && (
        <div
          className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px]"
          style={{ background: `${color}20` }}
        >
          <Icon size={16} style={{ color }} />
        </div>
      )}
      <div className="text-[17px] font-extrabold tracking-[-.01em] text-foreground">{title}</div>
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
        <div className="relative flex-none overflow-hidden border-b border-border">
          {/* Lavado de color de fondo, sutil, atado a la identidad del
              modal — el mismo truco que ya usan los chips de FormSection/
              SettingsCard, aquí extendido a toda la cabecera. */}
          {color && (
            <div
              className="pointer-events-none absolute inset-0"
              style={{ background: `linear-gradient(120deg, ${color}17 0%, transparent 60%)` }}
            />
          )}
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
              className="flex h-8.5 w-8.5 flex-none items-center justify-center rounded-[9px] border border-border bg-white/3 text-foreground transition-colors duration-150 hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className={bodyClassName ?? DEFAULT_BODY_CLASS}>{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-2.5 border-t border-border px-5.5 py-4">
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

// Par Cancel + botón degradado verde que hoy repiten los footers de los
// modales de edición (Edit Game, Change Cover, Edit Notes). Add Game no lo
// usa: su botón de guardar tiene un estilo adicional (gris) cuando aún no
// hay juego elegido, distinto del resto — se queda con su footer propio.
export const ModalFooter = ({
  onCancel,
  onSubmit,
  submitting,
  submitLabel,
  submittingLabel,
  icon,
}: ModalFooterProps): React.JSX.Element => (
  <>
    <button
      type="button"
      onClick={onCancel}
      disabled={submitting}
      className="rounded-[10px] border border-input bg-white/3 px-4.5 py-2.5 text-[13.5px] font-semibold text-foreground hover:bg-white/6 disabled:opacity-50"
    >
      Cancel
    </button>
    <button
      type="button"
      onClick={onSubmit}
      disabled={submitting}
      className="[will-change:transform] flex items-center gap-2 rounded-[10px] px-5.5 py-2.5 text-[13.5px] font-bold transition-transform duration-200 ease-[cubic-bezier(.16,1,.3,1)] disabled:cursor-not-allowed disabled:opacity-60 enabled:hover:-translate-y-1 enabled:hover:shadow-[0_10px_24px_rgba(47,220,126,.32)]"
      style={accentGradientStyle}
    >
      {icon}
      <span>{submitting ? submittingLabel : submitLabel}</span>
    </button>
  </>
);
