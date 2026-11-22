import { Check, Loader2, MonitorPlay, MonitorSmartphone, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CutoverAction, CutoverState } from '../../../shared/cutover';
import { BRAND_NAME } from '../../../shared/branding';
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
    className="h-1.5 w-full overflow-hidden rounded-full bg-inset"
  >
    <div
      className={cn(
        'h-full rounded-full bg-phosphor shadow-glow-bar transition-[width] duration-500 motion-reduce:transition-none',
        fraction === null && 'w-2/5 animate-pulse motion-reduce:animate-none',
      )}
      style={fraction === null ? undefined : { width: `${Math.max(2, fraction * 100)}%` }}
    />
  </div>
);

// La lista de pasos del camino normal, como stepper de Fósforo: hecho = círculo
// Phosphor con check, activo = anillo con halo, pendiente = gris. Los pasos se
// unen con un filete que se enciende al dejarlos atrás. `aria-current="step"`
// en el activo.
const Steps = ({ current }: { current: number }): React.JSX.Element => (
  <ol aria-label="Progress" className="flex w-full items-start">
    {CUTOVER_STEPS.map((step, index) => {
      const done = index < current;
      const active = index === current;
      const last = index === CUTOVER_STEPS.length - 1;
      return (
        <li
          key={step.id}
          aria-current={active ? 'step' : undefined}
          className="relative flex min-w-0 flex-1 flex-col items-center gap-2 px-1"
        >
          {!last && (
            <span
              aria-hidden
              className={cn(
                'absolute top-3.25 right-[calc(-50%+18px)] left-[calc(50%+18px)] h-0.5 rounded-full',
                done ? 'bg-phosphor' : 'bg-line-strong',
              )}
            />
          )}
          <span
            aria-hidden
            className={cn(
              'flex size-7 flex-none items-center justify-center rounded-full font-display text-[15px] font-bold tabular-nums',
              done && 'bg-phosphor text-ink',
              active &&
                'border-2 border-phosphor bg-cabinet text-phosphor shadow-[0_0_0_3px_rgb(255_179_71/.18),0_0_18px_rgb(255_179_71/.35)]',
              !active && !done && 'border border-line-strong bg-cabinet text-dust',
            )}
          >
            {done ? <Check className="size-3.5" strokeWidth={3} /> : index + 1}
          </span>
          <span
            className={cn(
              'text-center text-micro leading-tight',
              active ? 'font-semibold text-bone' : done ? 'text-bone/80' : 'text-dust',
            )}
          >
            {step.label}
            {done && <span className="sr-only"> (done)</span>}
          </span>
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
              'flex items-start gap-3 rounded-sm border px-3.5 py-3',
              device.self ? 'border-live/45 bg-live/6' : 'border-line bg-inset',
            )}
          >
            <MonitorSmartphone
              aria-hidden
              className={cn('mt-0.5 size-4.5 flex-none', device.self ? 'text-live' : 'text-dust')}
            />
            <div className="min-w-0">
              <div className="text-body font-semibold break-words text-bone">
                {device.self ? `${device.deviceName} (this PC)` : device.deviceName}
              </div>
              <div className="text-small text-dust">{laggingReason(device, now)}</div>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-small text-dust">
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
      <div role="status" className="min-h-5 text-micro text-dust">
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
          className="rounded-sm border border-live/40 border-l-2 border-l-live bg-live/8 px-3 py-2 text-small text-bone"
        >
          {state.error}
        </div>
      )}
      <label className="block">
        <div className={fieldLabelClass}>Sync service address</div>
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
          <div role="alert" className="mt-1.5 text-micro text-live">
            {urlMessage}
          </div>
        )}
      </label>
      <label className="block">
        <div className={fieldLabelClass}>One-time code</div>
        <input
          type="text"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="Code from Add device"
          spellCheck={false}
          autoComplete="off"
          className={cn(
            textInputClass,
            textInputFocusClass,
            'py-1.5 font-display text-[22px] font-bold tracking-[.08em] placeholder:font-sans placeholder:text-[13px] placeholder:font-normal placeholder:tracking-normal',
          )}
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
      const fraction = seedingFraction(state.rowsLeft, state.rowsTotal);
      return (
        <div className="flex w-full flex-col gap-2.5">
          <ProgressBar fraction={fraction} label="Upload progress" />
          <div className="flex items-baseline justify-between gap-4 text-left">
            {text && (
              <div role="status" className="text-small text-dust">
                {text}
              </div>
            )}
            {fraction !== null && (
              <span
                aria-hidden
                className="ml-auto font-display text-figure font-bold text-phosphor tabular-nums"
              >
                {Math.round(fraction * 100)}%
              </span>
            )}
          </div>
          {state.problem && (
            <div className="rounded-sm border border-line bg-inset px-3 py-2 text-small text-bone/85">
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
            <div role="status" className="text-left text-small text-dust">
              {text}
            </div>
          )}
          {state.problem && (
            <div className="rounded-sm border border-line bg-inset px-3 py-2 text-small text-bone/85">
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
          <div className="text-small text-dust">
            {state.deviceName} started at {sinceText(state.since)}.
          </div>
        </div>
      );
    case 'error':
      return (
        <div className="flex w-full flex-col items-center gap-3.5">
          {errorKeepsOldData(state.code) && (
            <p className="text-small text-dust">Your Afterplay 1 library has not been changed.</p>
          )}
          <Button size="lg" onClick={() => act({ type: 'retry' })}>
            Try again
          </Button>
        </div>
      );
    case 'checking':
    case 'waiting-devices':
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
      className="relative flex h-full w-full overflow-y-auto bg-cabinet"
    >
      {/* El velo de la ventana: tinte petróleo en el centro y líneas de
          escaneo, como el resto de pantallas de estado de Fósforo. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_60%_45%_at_50%_40%,rgb(95_211_224/.07),transparent_72%)]"
      />
      <div aria-hidden className="pointer-events-none fixed inset-0 bg-(image:--scan) opacity-70" />
      <div className="relative m-auto flex w-full max-w-140 flex-col items-center gap-7 px-6 py-10 text-center">
        <div aria-hidden className="flex items-center gap-2.5 text-bone">
          <MonitorPlay className="size-6 text-phosphor" />
          <span className="font-display text-title font-bold">{BRAND_NAME}</span>
        </div>
        {step !== null && <Steps current={step} />}
        <div className="flex w-full flex-col items-center gap-3.5">
          {state.kind === 'error' ? (
            <span
              aria-hidden
              className="flex size-14 items-center justify-center rounded-full border-2 border-live/70 bg-live/8"
            >
              <TriangleAlert className="size-6 text-live" />
            </span>
          ) : (
            copy.busy && (
              <Loader2
                aria-hidden
                className="size-8 animate-spin text-phosphor motion-reduce:animate-none"
                strokeWidth={1.75}
              />
            )
          )}
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="font-display text-page font-bold text-bone outline-hidden"
          >
            {copy.title}
          </h1>
          {/* El texto cambia con el estado: se anuncia sin robar el foco. */}
          <div aria-live="polite" className="max-w-120 text-lead text-dust">
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
