import { Check, Flame, Timer } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { SessionClosedEvent } from '../../../shared/types';
import { useSetSessionNote } from '../hooks/sessions';
import { useImageSrc } from '../hooks/useImageSrc';
import { AMBER } from '../lib/colors';
import { formatHours } from '../lib/format';
import { GameCover } from './GameCover';

// El aviso de "acabas de cerrar X": duración, total acumulado y —lo que de
// verdad importa— el sitio donde escribir el diario de sesión EN CALIENTE.
//
// Nunca es un modal, y esa decisión es el diseño entero: los cierres suelen
// pasar con la app en la bandeja, así que un diálogo por cierre significaría
// volver a la app y encontrarte una cola de interrogatorios pendientes. Aquí
// no se pregunta, se OFRECE: el toast se retira solo, no bloquea nada, y la
// nota se puede escribir igual (o corregir) después desde la fila de la
// sesión, que es su sitio de verdad.
//
// Se ve como una FICHA del juego, no como un mensaje de sistema: hero de
// fondo tras un velo y carátula al lado, el mismo lenguaje visual que
// GameBanner y HeroBanner. Tiene que llamar la atención — es el remate de
// haber estado jugando, no una notificación de que algo se ha guardado.

type SessionClosedToastProps = {
  event: SessionClosedEvent;
  toastId: string | number;
  durationMs: number;
  onOpenGame: () => void;
};

// "1h 47m" partido en número y unidad, para poder pintar la cifra grande y la
// unidad pequeña sin que el conjunto parezca un texto plano.
const splitDuration = (seconds: number): { value: string; unit: string } => {
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return { value: `${hours}h ${minutes}`, unit: 'm' };
  return { value: String(minutes), unit: 'm' };
};

export const SessionClosedToast = ({
  event,
  toastId,
  durationMs,
  onOpenGame,
}: SessionClosedToastProps): React.JSX.Element => {
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(false);
  const setSessionNote = useSetSessionNote();
  const heroSrc = useImageSrc(event.heroUrl, 'heroes');
  const duration = splitDuration(event.durationSec);

  const save = async (): Promise<void> => {
    if (!note.trim() || setSessionNote.isPending) return;
    await setSessionNote.mutateAsync({ id: event.sessionId, note });
    setSaved(true);
    // Un respiro para que se vea el acuse de recibo antes de irse — cerrar
    // en seco deja la duda de si se guardó.
    setTimeout(() => toast.dismiss(toastId), 900);
  };

  return (
    <div className="afterplay-toast relative w-full overflow-hidden rounded-[14px] border border-input bg-[#141614] shadow-[0_20px_55px_rgba(0,0,0,.6)]">
      {/* Hero del juego de fondo, con el mismo velo de izquierda a derecha de
          la ficha: da identidad al aviso sin comerse la legibilidad. */}
      {heroSrc && (
        <>
          <img src={heroSrc} alt="" className="absolute inset-0 h-full w-full object-cover" />
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(90deg, rgba(18,20,19,.97) 0%, rgba(18,20,19,.93) 45%, rgba(18,20,19,.68) 100%)',
            }}
          />
        </>
      )}

      <div className="relative flex flex-col gap-2.5 px-3.5 pt-3.25 pb-3.5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onOpenGame}
            title="Open game"
            className="flex-none transition-transform duration-200 ease-[cubic-bezier(.16,1,.3,1)] hover:-translate-y-0.5"
          >
            <GameCover
              url={event.coverUrl}
              className="h-16 w-11.5 overflow-hidden rounded-[8px] border border-white/15 shadow-[0_8px_20px_rgba(0,0,0,.45)]"
              iconSize={15}
            />
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.25 text-[10px] font-bold tracking-[.09em] text-muted-foreground/80">
              <Timer size={11} />
              SESSION ENDED
            </div>
            <button
              type="button"
              onClick={onOpenGame}
              className="mt-0.75 block max-w-full truncate text-left text-[14.5px] font-extrabold text-foreground hover:underline"
            >
              {event.gameTitle}
            </button>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-[24px] leading-none font-extrabold text-primary tabular-nums">
                {duration.value}
              </span>
              <span className="text-[13px] font-bold text-primary/80">{duration.unit}</span>
              <span className="ml-0.5 text-[11.5px] text-muted-foreground">
                · {formatHours(event.totalHours)} total
              </span>
            </div>
          </div>
        </div>

        {/* El récord es LA noticia cuando pasa: se lleva su propia banda, no
            una palabra suelta perdida entre el resto. */}
        {event.isLongest && (
          <div
            className="flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[11.5px] font-bold"
            style={{ background: `${AMBER}1a`, color: AMBER }}
          >
            <Flame size={12} className="flex-none" />
            Your longest session with this game
          </div>
        )}

        {saved ? (
          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-primary">
            <Check size={13} />
            Saved — you&apos;ll see it when you come back.
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            {/* SIN autoFocus, y es importante: robar el foco interrumpe lo que
                estuvieras haciendo, y además el CSS pausa la cuenta atrás
                mientras el toast tiene el foco dentro — enfocarlo solo hacía
                que el aviso no se fuera NUNCA por su cuenta. Si no lo tocas,
                se va; si escribes, se para mientras escribes. */}
            <input
              value={note}
              onChange={(changeEvent) => setNote(changeEvent.target.value)}
              onKeyDown={(keyEvent) => {
                if (keyEvent.key === 'Enter') void save();
                if (keyEvent.key === 'Escape') toast.dismiss(toastId);
              }}
              placeholder="Where did you leave off?"
              className="min-w-0 flex-1 rounded-[7px] border border-input bg-black/35 px-2.5 py-1.5 text-[12px] text-foreground outline-none backdrop-blur-sm placeholder:text-muted-foreground/70 focus:border-primary/50"
            />
            <button
              type="button"
              onClick={() => void save()}
              disabled={!note.trim() || setSessionNote.isPending}
              className="flex-none rounded-[7px] p-1.5 text-primary transition-colors duration-150 hover:bg-primary/12 disabled:opacity-30"
              aria-label="Save note"
            >
              <Check size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Cuenta atrás. Se pinta solo mientras el toast se pueda ir solo: tras
          guardar, el cierre lo controla el propio guardado y una barra
          corriendo ahí sería mentira. */}
      {!saved && (
        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white/8">
          <div
            className="afterplay-toast-countdown h-full bg-primary/75"
            style={{ '--afterplay-toast-duration': `${durationMs}ms` } as React.CSSProperties}
          />
        </div>
      )}
    </div>
  );
};
