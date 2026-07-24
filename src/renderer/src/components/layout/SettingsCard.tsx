import type { LucideIcon } from 'lucide-react';

type SettingsCardBaseProps = {
  title: React.ReactNode;
  description: React.ReactNode;
  // Icono + color de identidad de la sección — mismo lenguaje que FormSection
  // en Add/Edit Game, adaptado a la tipografía de Settings (título en frase,
  // no eyebrow en mayúsculas). Opcional: sin ellos, título suelto de siempre.
  icon?: LucideIcon;
  color?: string;
  // Para la entrada escalonada (revealClass/revealStyle) del modal.
  className?: string;
  style?: React.CSSProperties;
};

type SettingsCardProps =
  | (SettingsCardBaseProps & {
      // Fila: título+descripción a la izquierda, un control fijo a la
      // derecha (Time format de Settings, botón de Backups).
      layout: 'row';
      // Clase del contenedor de título+descripción — por defecto 'flex-1'.
      // Backups pasa 'min-w-0 flex-1': necesita poder encoger para truncar
      // la ruta guardada.
      textClassName?: string;
      // Contenido extra tras la descripción, dentro de la misma columna de
      // texto (Backups: ruta guardada / error de la copia).
      extra?: React.ReactNode;
      children: React.ReactNode;
    })
  | (SettingsCardBaseProps & {
      // Columna: título+descripción arriba, cuerpo debajo (Emulators).
      layout: 'column';
      children: React.ReactNode;
    });

const CARD_CLASS = 'rounded-[10px] border border-border bg-white/[0.02] px-3.25 py-2.75';

// Card de sección de Ajustes — el wrapper con borde/fondo + título/descripción
// que hoy repiten Time format, Emulators y Backups. El borde va en clase
// (border border-border) en vez del style inline con var(--border) de hoy:
// mismo resultado visual, sin el objeto inline.
export const SettingsCard = (props: SettingsCardProps): React.JSX.Element => {
  const { title, description, icon: Icon, color, className, style } = props;

  const heading = (
    <div className="flex items-center gap-2">
      {Icon && color && (
        <div
          className="flex h-6 w-6 flex-none items-center justify-center rounded-md"
          style={{ background: `${color}1f` }}
        >
          <Icon size={13} style={{ color }} />
        </div>
      )}
      <div className="text-[13.5px] font-semibold text-foreground">{title}</div>
    </div>
  );

  if (props.layout === 'row') {
    return (
      <div
        className={`flex items-center justify-between gap-3 ${CARD_CLASS} ${className ?? ''}`}
        style={style}
      >
        <div className={props.textClassName ?? 'flex-1'}>
          {heading}
          <div className="mt-1 text-xs text-muted-foreground">{description}</div>
          {props.extra}
        </div>
        {props.children}
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-3 ${CARD_CLASS} ${className ?? ''}`} style={style}>
      <div>
        {heading}
        <div className="mt-1 text-xs text-muted-foreground">{description}</div>
      </div>
      {props.children}
    </div>
  );
};
