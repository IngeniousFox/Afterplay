type SettingsCardBaseProps = {
  title: React.ReactNode;
  description: React.ReactNode;
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
  const { title, description } = props;

  if (props.layout === 'row') {
    return (
      <div className={`flex items-center justify-between gap-3 ${CARD_CLASS}`}>
        <div className={props.textClassName ?? 'flex-1'}>
          <div className="text-[13.5px] font-semibold text-foreground">{title}</div>
          <div className="mt-0.25 text-xs text-muted-foreground">{description}</div>
          {props.extra}
        </div>
        {props.children}
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-3 ${CARD_CLASS}`}>
      <div>
        <div className="text-[13.5px] font-semibold text-foreground">{title}</div>
        <div className="mt-0.25 text-xs text-muted-foreground">{description}</div>
      </div>
      {props.children}
    </div>
  );
};
