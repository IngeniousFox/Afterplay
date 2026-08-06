import { ArrowRight, Bookmark, Library, X } from 'lucide-react';
import { useState } from 'react';
import { GREEN } from '../../lib/colors';
import { STATUS_META } from '../../lib/gameStatus';
import { floatingPanelClass } from '../../lib/styles';

const PLAN_COLOR = STATUS_META.plan.color;

// En ms — el mismo número gobierna la clase Tailwind (duration-200) de abajo
// y el setTimeout que espera a que la animación de salida termine antes de
// desmontar de verdad. Mismo patrón que ScreenshotLightbox.
const CLOSE_DURATION_MS = 200;

// `fill-mode-forwards`: sin esto, tw-animate-css deja `animation-fill-mode:
// none` por defecto y el elemento vuelve de golpe a opacidad/escala plenas en
// cuanto la animación de salida termina — como el desmontaje real lo gobierna
// un setTimeout aparte, ese repintado a veces se veía un fotograma antes de
// desaparecer. Con forwards, el estado final se sostiene hasta el desmontaje.
const CLOSING_ANIM = 'animate-out fill-mode-forwards';

// Una de las dos puertas del diálogo. El hover la enciende ENTERA (borde,
// halo, flecha que aparece): son solo dos opciones y elegir debe sentirse
// como abrir una puerta, no como marcar un radio button.
const DoorButton = ({
  Icon,
  color,
  label,
  hint,
  onClick,
}: {
  Icon: typeof Library;
  color: string;
  label: string;
  hint: string;
  onClick: () => void;
}): React.JSX.Element => (
  <button
    type="button"
    onClick={onClick}
    className="group flex flex-1 flex-col items-center gap-2 rounded-[13px] border px-3 pt-4.5 pb-3.5 transition-[transform,box-shadow,border-color,background-color] duration-150 hover:-translate-y-0.5"
    style={{ borderColor: `${color}30`, background: `${color}0d` }}
    onMouseEnter={(event) => {
      event.currentTarget.style.borderColor = `${color}6b`;
      event.currentTarget.style.background = `${color}1a`;
      event.currentTarget.style.boxShadow = `0 8px 24px rgba(0,0,0,.35), 0 0 16px ${color}24`;
    }}
    onMouseLeave={(event) => {
      event.currentTarget.style.borderColor = `${color}30`;
      event.currentTarget.style.background = `${color}0d`;
      event.currentTarget.style.boxShadow = 'none';
    }}
  >
    <span
      className="flex h-11 w-11 items-center justify-center rounded-[12px]"
      style={{ background: `${color}1f`, border: `1px solid ${color}38` }}
    >
      <Icon size={19} style={{ color }} />
    </span>
    <span className="flex items-center gap-1 text-[13px] font-bold" style={{ color }}>
      {label}
      <ArrowRight
        size={12}
        className="-ml-1 opacity-0 transition-[opacity,margin] duration-150 group-hover:ml-0 group-hover:opacity-100"
      />
    </span>
    <span className="text-[10.5px] leading-tight text-muted-foreground">{hint}</span>
  </button>
);

// El intermedio de §3.4: pulsaste un juego (de la saga, o del radar) que NO
// tienes, y hay exactamente dos sitios donde puede ir. Minúsculo a propósito
// — dos puertas con el icono y el color de cada sección, no un formulario.
// Sin botón de Cancel: la X de la esquina y el clic fuera son las dos formas
// de siempre de cerrar un panel de la app, y un tercer botón de texto suelto
// debajo de las puertas solo les robaba el final de la escena.
//
// Cierre ANIMADO (petición explícita) — mismo patrón que ScreenshotLightbox:
// el diálogo sigue montado durante CLOSE_DURATION_MS con las clases
// animate-out puestas, y solo entonces se llama al onCancel real que lo
// desmonta desde el padre. Sin este paso intermedio, un componente montado
// condicionalmente (`{pending && <WhereToAddDialog/>}`, tal cual vive en
// PlanToPlay/SagaSection) desaparece de golpe en cuanto React lo quita del
// árbol — no hay forma de animar una salida que ya no está.
export const WhereToAddDialog = ({
  title,
  onPick,
  onCancel,
}: {
  title: string;
  onPick: (where: 'plan' | 'library') => void;
  onCancel: () => void;
}): React.JSX.Element => {
  const [closing, setClosing] = useState(false);

  const startClose = (): void => {
    if (closing) return; // ya en marcha — un segundo clic no la reinicia
    setClosing(true);
    setTimeout(onCancel, CLOSE_DURATION_MS);
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-[2px] duration-200 ${
        closing ? `${CLOSING_ANIM} fade-out-0` : 'animate-in fade-in-0'
      }`}
      onClick={startClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className={`w-96 rounded-[18px] border p-5.5 ${floatingPanelClass} duration-200 ${
          closing ? `${CLOSING_ANIM} fade-out-0 zoom-out-95` : 'animate-in fade-in-0 zoom-in-95'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[15.5px] font-extrabold tracking-[-.01em] text-foreground">
              {title}
            </div>
            <div className="mt-1 text-[12.5px] text-muted-foreground">
              You don&apos;t have this one yet — where should it go?
            </div>
          </div>
          <button
            type="button"
            onClick={startClose}
            aria-label="Cancel"
            className="flex h-7 w-7 flex-none items-center justify-center rounded-lg text-muted-foreground/70 transition-colors duration-150 hover:bg-white/[0.07] hover:text-foreground"
          >
            <X size={15} />
          </button>
        </div>

        <div className="mt-4.5 flex gap-3">
          <DoorButton
            Icon={Bookmark}
            color={PLAN_COLOR}
            label="Plan to play"
            hint="someday, when the time comes"
            onClick={() => onPick('plan')}
          />
          <DoorButton
            Icon={Library}
            color={GREEN}
            label="My library"
            hint="you already own or play it"
            onClick={() => onPick('library')}
          />
        </div>
      </div>
    </div>
  );
};
