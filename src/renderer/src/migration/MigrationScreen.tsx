import { Check, CircleAlert, Loader2, MonitorSmartphone } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CutoverAction, CutoverState } from '../../../shared/cutover';
import {
  BRAND_VEIL_BACKGROUND,
  BRAND_WORDMARK,
  BRAND_WORDMARK_SHADOW,
  BRAND_WORDMARK_TRACKING,
  BRAND_WORDMARK_WEIGHT,
} from '../../../shared/branding';
import { Button } from '@/components/ui/button';
import {
  fieldLabelClass,
  textInputClass,
  textInputFocusClass,
} from '../components/library/add-game/styles';
import {
  CUTOVER_STEPS,
  checkPairingInput,
  cutoverStepIndex,
  describeCutover,
  errorKeepsOldData,
  laggingReason,
  pullingProgress,
  seedingFraction,
  seedingProgress,
} from '../lib/cutoverView';
import { cn } from '@/lib/utils';

// LA PANTALLA DE MIGRACIÓN 1.x → 2.0 (AFTERPLAY-2.0.md §15.7, §19.6).
//
// Tapa la ventana entera mientras el proceso principal mueve la biblioteca
// (MigrationGate decide cuándo). Pura presentación: recibe el estado y manda
// acciones por `window.api.cutover.act`. En el caso normal no pregunta nada
// (D-07: la confirmación ya la pidió la 1.8); las únicas pantallas con
// controles son la pregunta de los PCs rezagados, el emparejado y el error.

const act = (action: CutoverAction): void => window.api.cutover.act(action);

// Barra de progreso: determinada si hay total, y si no un pulso suave.
const ProgressBar = ({
  fraction,
  label,
}: {
  fraction: number | null;
  label: string;
}): React.JSX.Element => (
  <div
    role="progressbar"
    aria-label={label}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)}
    className="h-1.5 w-full overflow-hidden rounded-full bg-white/8"
  >
    <div
      className={cn(
        'h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none',
        fraction === null && 'w-2/5 animate-pulse motion-reduce:animate-none',
      )}
      style={fraction === null ? undefined : { width: `${Math.max(2, fraction * 100)}%` }}
    />
  </div>
);

// La lista de pasos del camino normal. `aria-current="step"` en el activo.
const Steps = ({ current }: { current: number }): React.JSX.Element => (
  <ol aria-label="Progress" className="flex flex-wrap justify-center gap-x-4 gap-y-1.5">
    {CUTOVER_STEPS.map((step, index) => {
      const done = index < current;
      const active = index === current;
      return (
        <li
          key={step.id}
          aria-current={active ? 'step' : undefined}
          className={cn(
            'flex items-center gap-1.5 text-[12px] font-semibold',
            active ? 'text-foreground' : done ? 'text-primary' : 'text-muted-foreground/70',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'flex size-4.5 items-center justify-center rounded-full border text-[10px]',
              active && 'border-primary bg-primary/15 text-primary',
              done && 'border-primary/50 bg-primary/10',
              !active && !done && 'border-white/12',
            )}
          >
            {done ? <Check className="size-3" strokeWidth={3} /> : index + 1}
          </span>
          {step.label}
          {done && <span className="sr-only"> (done)</span>}
        </li>
      );
    })}
  </ol>
);

// La ÚNICA pregunta del corte (§19.6 paso 2).
const LaggingQuestion = ({
  state,
}: {
  state: Extract<CutoverState, { kind: 'question-lagging' }>;
}): React.JSX.Element => {
  // `now` se fija al montar y se refresca con cada nuevo estado: basta para
  // un "hace 3 días".
  const [now] = useState(() => Date.now());
  const hasSelf = state.devices.some((device) => device.self);
  return (
    <div className="flex w-full flex-col gap-4">
      <ul className="flex flex-col gap-2 text-left">
        {state.devices.map((device) => (
          <li
            key={device.deviceId}
            className={cn(
              'flex items-start gap-3 rounded-[12px] border px-3.5 py-3',
              device.self ? 'border-destructive/40 bg-destructive/6' : 'border-border bg-white/3',
            )}
          >
            <MonitorSmartphone
              aria-hidden
              className="mt-0.5 size-4.5 flex-none text-muted-foreground"
            />
            <div className="min-w-0">
              <div className="text-[13.5px] font-bold break-words text-foreground">
                {device.self ? `${device.deviceName} (this PC)` : device.deviceName}
              </div>
              <div className="text-[12.5px] leading-snug text-muted-foreground">
                {laggingReason(device, now)}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-[12.5px] leading-snug text-muted-foreground">
        {hasSelf
          ? 'If you continue, the changes on this PC that were never uploaded are left behind. A copy stays in this PC’s backups folder.'
          : 'If you continue, their missing changes can be recovered later from their own copy. Nothing is lost.'}
      </p>
      <div className="flex flex-wrap justify-center gap-2.5">
        <Button size="lg" onClick={() => act({ type: 'wait' })} disabled={state.rechecking}>
          Wait for them
        </Button>
        <Button
          size="lg"
          variant="outline"
          onClick={() => act({ type: 'continue' })}
          disabled={state.rechecking}
        >
          Continue anyway
        </Button>
      </div>
      <div role="status" className="min-h-5 text-[12px] text-muted-foreground">
        {state.rechecking ? 'Checking again…' : 'We check again by ourselves every 30 seconds.'}
      </div>
    </div>
  );
};

// Dirección y código de un solo uso (el primer PC de una persona, o un alta caducada).
const PairingForm = ({
  state,
}: {
  state: Extract<CutoverState, { kind: 'needs-pairing' }>;
}): React.JSX.Element => {
  const [hubUrl, setHubUrl] = useState(state.hubUrl ?? '');
  const [code, setCode] = useState('');
  const check = checkPairingInput(hubUrl, code);
  const urlMessage = check.ok ? null : check.urlMessage;
  return (
    <form
      className="flex w-full flex-col gap-3.5 text-left"
      onSubmit={(event) => {
        event.preventDefault();
        if (check.ok) act({ type: 'submit-pairing', hubUrl: check.hubUrl, code: check.code });
      }}
    >
      {state.error && (
        <div
          role="alert"
          className="rounded-[10px] border border-destructive/40 bg-destructive/8 px-3 py-2 text-[12.5px] text-destructive"
        >
          {state.error}
        </div>
      )}
      <label className="block">
        <div className={fieldLabelClass}>SYNC SERVICE ADDRESS</div>
        <input
          type="text"
          value={hubUrl}
          onChange={(event) => setHubUrl(event.target.value)}
          placeholder="https://your-sync-service.example"
          spellCheck={false}
          autoComplete="off"
          aria-invalid={urlMessage !== null}
          className={cn(textInputClass, textInputFocusClass)}
        />
        {urlMessage && (
          <div role="alert" className="mt-1 text-[11.5px] text-destructive">
            {urlMessage}
          </div>
        )}
      </label>
      <label className="block">
        <div className={fieldLabelClass}>ONE-TIME CODE</div>
        <input
          type="text"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="Code from Add device"
          spellCheck={false}
          autoComplete="off"
          className={cn(textInputClass, textInputFocusClass)}
        />
      </label>
      <div className="flex flex-wrap justify-center gap-2.5 pt-1">
        <Button type="submit" size="lg" disabled={!check.ok}>
          Connect
        </Button>
        {state.canRetrySecret && (
          <Button type="button" size="lg" variant="outline" onClick={() => act({ type: 'retry' })}>
            Try the saved sign-in again
          </Button>
        )}
      </div>
    </form>
  );
};

const sinceText = (since: number): string =>
  new Date(since).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// Lo que cuelga del texto según el estado: controles, progreso o nada.
const Details = ({ state }: { state: CutoverState }): React.JSX.Element | null => {
  switch (state.kind) {
    case 'question-lagging':
      return <LaggingQuestion state={state} />;
    case 'needs-pairing':
      return <PairingForm state={state} />;
    case 'seeding': {
      const text = seedingProgress(state.rowsLeft, state.rowsTotal);
      return (
        <div className="flex w-full flex-col gap-2.5">
          <ProgressBar
            fraction={seedingFraction(state.rowsLeft, state.rowsTotal)}
            label="Upload progress"
          />
          {text && (
            <div role="status" className="text-[12.5px] text-muted-foreground">
              {text}
            </div>
          )}
          {state.problem && (
            <div className="rounded-[10px] border border-white/10 bg-white/4 px-3 py-2 text-[12.5px] leading-snug text-foreground">
              {state.problem} The upload picks up again by itself.
            </div>
          )}
        </div>
      );
    }
    case 'pulling': {
      const text = pullingProgress(state.rowsLocal);
      return (
        <div className="flex w-full flex-col gap-2.5">
          <ProgressBar fraction={null} label="Download progress" />
          {text && (
            <div role="status" className="text-[12.5px] text-muted-foreground">
              {text}
            </div>
          )}
          {state.problem && (
            <div className="rounded-[10px] border border-white/10 bg-white/4 px-3 py-2 text-[12.5px] leading-snug text-foreground">
              {state.problem} The download picks up again by itself.
            </div>
          )}
        </div>
      );
    }
    case 'waiting-other':
      return (
        <div className="flex w-full flex-col gap-2.5">
          <ProgressBar fraction={null} label="Waiting for the other PC" />
          <div className="text-[12.5px] text-muted-foreground">
            {state.deviceName} started at {sinceText(state.since)}.
          </div>
        </div>
      );
    case 'error':
      return (
        <div className="flex w-full flex-col items-center gap-3.5">
          {errorKeepsOldData(state.code) && (
            <p className="text-[12.5px] leading-snug text-muted-foreground">
              Your Afterplay 1 library has not been changed.
            </p>
          )}
          <Button size="lg" onClick={() => act({ type: 'retry' })}>
            Try again
          </Button>
        </div>
      );
    case 'checking':
    case 'importing':
    case 'pairing':
    case 'finishing':
    case 'local-migration':
      return <ProgressBar fraction={null} label="Working" />;
    default:
      return null;
  }
};

export const MigrationScreen = ({ state }: { state: CutoverState }): React.JSX.Element => {
  const copy = describeCutover(state);
  const step = cutoverStepIndex(state);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // El contenido nuevo reclama el foco al cambiar de estado (no en cada tic de
  // progreso): un lector de pantalla lee el título y el teclado queda dentro.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [state.kind]);

  // La ventana nace oculta hasta que el renderer avisa de que hay algo que
  // enseñar (useStartupContentSignal vive en la app, que aún no está montada).
  useEffect(() => {
    window.api.window.startupContentReady();
  }, []);

  return (
    <main
      data-testid="migration-screen"
      data-state={state.kind}
      className="flex h-full w-full overflow-y-auto"
      style={{ background: BRAND_VEIL_BACKGROUND }}
    >
      <div className="m-auto flex w-full max-w-130 flex-col items-center gap-6 px-6 py-10 text-center">
        <div
          aria-hidden
          className="text-[15px] text-foreground"
          style={{
            fontWeight: BRAND_WORDMARK_WEIGHT,
            letterSpacing: BRAND_WORDMARK_TRACKING,
            paddingLeft: BRAND_WORDMARK_TRACKING,
            textShadow: BRAND_WORDMARK_SHADOW,
          }}
        >
          {BRAND_WORDMARK}
        </div>
        {step !== null && <Steps current={step} />}
        <div className="flex w-full flex-col items-center gap-3">
          {state.kind === 'error' ? (
            <CircleAlert aria-hidden className="size-7 text-destructive" />
          ) : (
            copy.busy && (
              <Loader2
                aria-hidden
                className="size-6 animate-spin text-primary motion-reduce:animate-none"
              />
            )
          )}
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-[21px] leading-tight font-bold text-foreground outline-none"
          >
            {copy.title}
          </h1>
          {/* El texto cambia con el estado: se anuncia sin robar el foco. */}
          <div aria-live="polite" className="text-[13.5px] leading-relaxed text-muted-foreground">
            {copy.body}
          </div>
        </div>
        <div className="flex w-full flex-col items-center">
          <Details state={state} />
        </div>
      </div>
    </main>
  );
};
