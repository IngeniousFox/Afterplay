import { Check, Flame, Timer } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { SessionClosedEvent } from '../../../shared/types';
import { useSetSessionNote } from '../hooks/sessions';
import { useAddStateEvent } from '../hooks/stateEvents';
import { useImageSrc } from '../hooks/useImageSrc';
import { celebrateCompletion } from '../lib/celebrate';
import { AMBER } from '../lib/colors';
import { formatHours } from '../lib/format';
import type { PastStatusKey } from '../lib/gameStatus';
import { STATUS_META, STATUS_TO_STATE_TYPE } from '../lib/gameStatus';
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

// AFTERPLAY-LOOP.md §6 — el estado rápido vive AQUÍ y no en una bandeja de
// pendientes: "sigo jugando" es el defecto y no necesita botón (no tocar nada
// ya lo dice), y si el toast se va sin pulsar, no queda nada esperándote — el
// estado se cambia desde la ficha como toda la vida. Juego normal ofrece
// Beaten/Dropped; endless, Resting (un endless no se "termina").
const quickStatusOptions = (endless: boolean): PastStatusKey[] =>
  endless ? ['resting'] : ['beaten', 'dropped'];

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
  // Estado rápido ya elegido en este toast (null = sin tocar). Se queda a la
  // vista como acuse de recibo — el toast sigue su cuenta atrás normal, que
  // marcar el desenlace no te roba el hueco de escribir la nota.
  const [marked, setMarked] = useState<PastStatusKey | null>(null);
  const setSessionNote = useSetSessionNote();
  const addStateEvent = useAddStateEvent();
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

  const markState = async (key: PastStatusKey): Promise<void> => {
    if (marked !== null || addStateEvent.isPending) return;
    try {
      // La puerta de siempre (§6): addStateEvent garantiza el invariante de
      // un-activo-por-juego, y su cierre de sesión abierta aquí no encuentra
      // ninguna — la sesión acaba de cerrarse.
      await addStateEvent.mutateAsync({
        iterationId: event.iterationId,
        type: STATUS_TO_STATE_TYPE[key],
        occurredAt: new Date(),
        datePrecision: 'datetime',
      });
    } catch {
      // Fallo al escribir (DB ocupada, lo que sea): el botón sigue ahí y se
      // puede reintentar — o marcarlo después desde la ficha, como siempre.
      return;
    }
    setMarked(key);
    // Terminarte un juego es EL momento del ciclo — el confeti está para esto.
    if (key === 'beaten') celebrateCompletion();
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

        {/* Estado rápido (AFTERPLAY-LOOP.md §6): "¿y cómo acabó?" como oferta,
            no como pregunta que persigue. Tras pulsar, el acuse ocupa el sitio
            de los botones con el color del estado — y el toast sigue su cuenta
            atrás normal: marcar el desenlace no roba el hueco de la nota. */}
        {marked !== null ? (
          <div
            className="flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[11.5px] font-bold"
            style={{
              background: `${STATUS_META[marked].color}1a`,
              color: STATUS_META[marked].color,
            }}
          >
            <Check size={12} className="flex-none" />
            Marked as {STATUS_META[marked].label}
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            {quickStatusOptions(event.endless).map((key) => {
              const meta = STATUS_META[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => void markState(key)}
                  disabled={addStateEvent.isPending}
                  className="flex items-center gap-1.5 rounded-full border border-white/12 bg-black/30 px-2.75 py-1.25 text-[11.5px] font-bold text-foreground/90 backdrop-blur-sm transition-colors duration-150 hover:border-white/28 hover:bg-white/[0.07] disabled:opacity-50"
                >
                  <meta.Icon size={12} className="flex-none" style={{ color: meta.color }} />
                  {meta.label}
                </button>
              );
            })}
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
