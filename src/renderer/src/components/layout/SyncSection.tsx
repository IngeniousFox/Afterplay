import { Monitor, RefreshCw, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { checkHubUrl } from '../../../../shared/sync/hubUrl';
import type { SyncStatus } from '../../../../shared/sync/status';
import { useDevices } from '../../hooks/devices';
import { usePairSync, useSyncNow, useSyncStatus, useUnpairSync } from '../../hooks/sync';
import { describeAgo } from '../../lib/syncText';
import { fieldLabelClass, textInputClass } from '../library/add-game/styles';
import { buttonSize, primaryButtonClass, secondaryButtonClass } from '../shell/controls';
import { SettingsCard, SettingsNotice } from './SettingsCard';

const secondaryClass = cn(secondaryButtonClass, buttonSize.md);

// Sync entre tus PCs a través de TU hub (AFTERPLAY-2.0.md §9). Aquí se
// empareja este PC, se ve cómo va, qué dispositivos conoce la base y se
// olvida el hub; el alta de dispositivos nuevos y su revocación viven en la
// web. Página propia en Fósforo (settings.png): estado grande arriba.
export const SyncSection = (): React.JSX.Element | null => {
  const { data: status } = useSyncStatus();
  if (!status) return null;

  return (
    <div className="flex max-w-[1100px] flex-col gap-5">
      {status.paired ? <PairedView status={status} /> : <PairForm available={status.available} />}
      {status.paired && <DevicesCard />}
    </div>
  );
};

const PairForm = ({ available }: { available: boolean }): React.JSX.Element => {
  const pair = usePairSync();
  const [hubUrl, setHubUrl] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  // El formulario nace plegado: la mayoría de la gente no usa sync, y así la
  // sección no estrena dos campos de texto a la vista.
  const [open, setOpen] = useState(false);

  // La dirección se valida mientras se escribe, pero solo si hay algo: un
  // campo vacío no debe estrenarse en rojo.
  const urlCheck = hubUrl.trim() === '' ? null : checkHubUrl(hubUrl);
  const urlMessage = urlCheck && !urlCheck.ok ? urlCheck.message : null;
  const canPair = available && urlCheck?.ok === true && code.trim() !== '' && !pair.isPending;

  const handlePair = async (): Promise<void> => {
    setError(null);
    try {
      const result = await pair.mutateAsync({ hubUrl, code });
      if (result.ok) {
        setHubUrl('');
        setCode('');
      } else {
        setError(result.message);
      }
    } catch (failure) {
      setError((failure as Error).message);
    }
  };

  return (
    <SettingsCard
      title={
        <span className="flex items-center gap-3">
          <span aria-hidden className="size-2.5 flex-none rounded-full border-2 border-dust" />
          <span className="font-display text-title font-bold">Not paired.</span>
        </span>
      }
      description="Keep your library, sessions and plan in step across your PCs and your phone through your own Afterplay hub. The app works the same without it."
      action={
        !open && (
          <button type="button" onClick={() => setOpen(true)} className={secondaryClass}>
            Pair this PC…
          </button>
        )
      }
    >
      {open && (
        <form
          className="flex max-w-[640px] flex-col gap-3.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (canPair) void handlePair();
          }}
        >
          <div className="text-small text-dust">
            In the web app, open <span className="text-bone">Add device</span> to get a one-time
            code, then enter it here with your hub address.
          </div>
          <label className="block">
            <div className={fieldLabelClass}>Hub address</div>
            <input
              type="text"
              value={hubUrl}
              onChange={(event) => setHubUrl(event.target.value)}
              placeholder="https://your-hub.example"
              spellCheck={false}
              autoComplete="off"
              aria-invalid={urlMessage !== null}
              className={textInputClass}
            />
            {urlMessage && (
              <div role="alert" className="mt-1.5 text-small text-live">
                {urlMessage}
              </div>
            )}
          </label>
          <label className="block">
            <div className={fieldLabelClass}>Pairing code</div>
            <input
              type="text"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="Code from the web app"
              spellCheck={false}
              autoComplete="off"
              className={cn(textInputClass, 'font-mono')}
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={!canPair}
              className={cn(primaryButtonClass, buttonSize.md)}
            >
              {pair.isPending ? 'Pairing…' : 'Pair'}
            </button>
            <button type="button" onClick={() => setOpen(false)} className={secondaryClass}>
              Cancel
            </button>
            {!available && (
              <span className="text-small text-dust">Sync is turned off in this session.</span>
            )}
          </div>
          {error && (
            <div role="alert" className="text-small text-live">
              {error}
            </div>
          )}
        </form>
      )}
    </SettingsCard>
  );
};

// El titular del estado, con las mismas palabras que la pastilla de la barra
// superior (SyncLed): Tube cuando todo va bien, gris sin conexión o en pausa,
// Live solo cuando hace falta que hagas algo.
const headlineOf = (
  status: SyncStatus,
): { heading: string; tone: 'ok' | 'busy' | 'off' | 'error' } => {
  if (status.disabledReason !== null) return { heading: 'Sync paused', tone: 'off' };
  if (status.problem) {
    if (status.problem.code === 'network') return { heading: 'Offline', tone: 'off' };
    const needsYou = !status.problem.retrying || status.problem.code === 'clock_ahead';
    return needsYou
      ? { heading: 'Sync stopped', tone: 'error' }
      : { heading: 'Sync will retry', tone: 'off' };
  }
  if (status.running) return { heading: 'Syncing', tone: 'busy' };
  return { heading: 'Up to date', tone: 'ok' };
};

const DOT_CLASS = {
  ok: 'bg-tube shadow-[0_0_8px_var(--color-tube)]',
  busy: 'bg-tube animate-pulse-soft motion-reduce:animate-none',
  off: 'border-2 border-dust',
  error: 'bg-live',
} as const;

const PairedView = ({ status }: { status: SyncStatus }): React.JSX.Element => {
  const syncNow = useSyncNow();
  const unpair = useUnpairSync();
  const [confirming, setConfirming] = useState(false);
  // La hora entra por estado (y se refresca sola) para que el render siga siendo puro.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const lastSync = Math.max(status.lastPushAt ?? 0, status.lastPullAt ?? 0) || null;
  const { heading, tone } = headlineOf(status);

  return (
    <SettingsCard
      title={
        <span className="flex items-center gap-3">
          <span aria-hidden className={cn('size-3 flex-none rounded-full', DOT_CLASS[tone])} />
          <span className="font-display text-title font-bold">{heading}</span>
        </span>
      }
      description={
        <>
          Paired with <span className="font-semibold text-bone">{hostOf(status.hubUrl)}</span>
          {' · '}
          {status.running ? 'syncing…' : `last sync ${describeAgo(lastSync, now)}`}
        </>
      }
      action={
        <>
          {!confirming && (
            <button type="button" onClick={() => setConfirming(true)} className={secondaryClass}>
              Unpair
            </button>
          )}
          <button
            type="button"
            onClick={() => syncNow.mutate()}
            disabled={status.running || status.disabledReason !== null}
            className={cn(primaryButtonClass, buttonSize.md)}
          >
            <RefreshCw
              aria-hidden
              size={15}
              className={cn(status.running && 'animate-spin motion-reduce:animate-none')}
            />
            Sync now
          </button>
        </>
      }
    >
      {(status.problem || status.disabledReason || confirming) && (
        <div className="flex flex-col gap-3">
          {(status.problem || status.disabledReason) && (
            <SettingsNotice danger={tone === 'error'}>
              {status.disabledReason ?? status.problem?.message}
            </SettingsNotice>
          )}
          {confirming && (
            <div className="flex flex-col gap-3 rounded-sm border border-line-strong bg-inset px-4 py-3.5">
              <div className="text-small text-bone">
                This PC will stop syncing and forget the hub. Your data stays here. To cut off its
                access for good, also remove this device from the web app.
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    unpair.mutate(undefined, { onSettled: () => setConfirming(false) })
                  }
                  disabled={unpair.isPending}
                  className={secondaryClass}
                >
                  {unpair.isPending ? 'Unpairing…' : 'Unpair this PC'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className={secondaryClass}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </SettingsCard>
  );
};

// Los dispositivos que conoce la base (los mismos que firman las sesiones).
// Solo se leen: renombrar y dar de baja viven en la web.
const DevicesCard = (): React.JSX.Element | null => {
  const { data: devices = [] } = useDevices();
  if (devices.length === 0) return null;
  return (
    <SettingsCard
      title="Devices"
      description="Every device that writes to this library. Add or remove devices from the web app."
      flush
    >
      <ul>
        {devices.map((device) => {
          const Icon = device.os === 'web' ? Smartphone : Monitor;
          return (
            <li
              key={device.id}
              className={cn(
                'flex items-center gap-3.5 border-t border-line px-5 py-3 first:border-t-0',
                device.isThisDevice && 'bg-phosphor-tint',
              )}
            >
              <span className="flex size-8 flex-none items-center justify-center rounded-sm bg-raised text-dust">
                <Icon aria-hidden size={16} />
              </span>
              <span className="min-w-0 flex-1 text-body font-semibold text-bone">
                {device.name}
              </span>
              {device.isThisDevice && (
                <span className="rounded-xs bg-phosphor px-1.5 py-0.5 text-micro font-semibold text-ink">
                  This PC
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </SettingsCard>
  );
};

const hostOf = (hubUrl: string | null): string => {
  if (!hubUrl) return 'your hub';
  try {
    return new URL(hubUrl).host;
  } catch {
    return hubUrl;
  }
};
