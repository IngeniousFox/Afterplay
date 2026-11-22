import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SyncStatus } from '../../../../shared/sync/status';
import { useSyncNow, useSyncStatus } from '../../hooks/sync';
import { useNow } from '../../hooks/useNow';
import { describeAgo } from '../../lib/syncText';
import { Glitch } from '../fx/Glitch';
import { buttonSize, focusRing, primaryButtonClass, textLinkClass } from './controls';

// La pastilla de sync de la barra superior (AFTERPLAY-2.0.md §15.7, concepto
// estados-sync.png). Solo LEE el estado que ya publica el main
// (useSyncStatus) y ofrece las dos acciones que ya existían en Ajustes: Sync
// now y abrir Ajustes en la sección Sync. No hay lógica nueva de sync aquí.
//
// Con el sync sin emparejar (o en un test E2E, donde no existe) no se pinta:
// con un único PC la interfaz se ve como siempre (§15.7, principio común).

type Tone = 'ok' | 'busy' | 'offline' | 'error' | 'off';

type View = {
  tone: Tone;
  label: string;
  heading: string;
  sentence: string;
};

const viewOf = (status: SyncStatus): View => {
  if (status.disabledReason !== null) {
    return {
      tone: 'off',
      label: 'Sync off',
      heading: 'Sync paused',
      sentence: status.disabledReason,
    };
  }
  if (status.problem) {
    // "network" es estar sin conexión: nada va mal en la app, así que no se
    // pinta en rojo. El resto de fallos que se reintentan solos también se
    // quedan en gris; solo lo que pide una acción tuya va en rojo.
    if (status.problem.code === 'network') {
      return {
        tone: 'offline',
        label: 'Offline',
        heading: 'Offline',
        sentence: status.problem.message,
      };
    }
    const needsYou = !status.problem.retrying || status.problem.code === 'clock_ahead';
    return {
      tone: needsYou ? 'error' : 'offline',
      label: needsYou ? 'Sync error' : 'Retrying',
      heading: needsYou ? 'Sync stopped' : 'Sync will retry',
      sentence: status.problem.message,
    };
  }
  if (status.running) {
    return {
      tone: 'busy',
      label: 'Syncing',
      heading: 'Syncing',
      sentence: 'Sending and receiving changes now.',
    };
  }
  return {
    tone: 'ok',
    label: 'Synced',
    heading: 'Up to date',
    sentence: 'Everything on this PC has been sent.',
  };
};

const DOT_CLASS: Record<Tone, string> = {
  ok: 'bg-tube shadow-[0_0_8px_var(--color-tube)]',
  busy: 'bg-tube animate-pulse-soft motion-reduce:animate-none',
  offline: 'border-2 border-dust',
  off: 'border-2 border-dust',
  error: 'bg-live',
};

export const SyncLed = ({
  onOpenSettings,
}: {
  onOpenSettings: () => void;
}): React.JSX.Element | null => {
  const { data: status } = useSyncStatus();
  const syncNow = useSyncNow();
  const visible = status !== undefined && status.available && status.paired;
  const now = useNow(visible, 30_000);
  if (!visible) return null;

  const view = viewOf(status);
  const lastSync = Math.max(status.lastPushAt ?? 0, status.lastPullAt ?? 0) || null;

  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger
        aria-label={`Sync: ${view.label}`}
        className={cn(
          'flex h-8.5 flex-none items-center gap-2 rounded-sm border px-2.5 text-small font-semibold transition-colors duration-150',
          view.tone === 'error'
            ? 'border-live/50 text-live hover:bg-live/10'
            : 'border-transparent text-dust hover:bg-bone/6 hover:text-bone',
          'data-[popup-open]:bg-raised',
          focusRing,
        )}
      >
        {/* Un corte de RGB al ENTRAR en error o sin conexión, nunca en bucle. */}
        <Glitch
          active={view.tone === 'error' || view.tone === 'offline'}
          replayKey={view.tone}
          className="items-center gap-2"
        >
          <SyncDot tone={view.tone} />
          <span>{view.label}</span>
        </Glitch>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner
          side="bottom"
          align="end"
          sideOffset={8}
          className="isolate z-50"
        >
          <PopoverPrimitive.Popup
            className={cn(
              'w-97 origin-(--transform-origin) rounded-md border border-line bg-overlay text-bone shadow-float outline-hidden',
              'animate-pop-in',
            )}
          >
            <div className="border-b border-line px-5 pt-4.5 pb-4">
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden
                  className={cn('size-2.5 flex-none rounded-full', DOT_CLASS[view.tone])}
                />
                <PopoverPrimitive.Title className="font-display text-title font-bold">
                  {view.heading}
                </PopoverPrimitive.Title>
              </div>
              <PopoverPrimitive.Description className="mt-1.5 flex items-start gap-2 text-small text-dust">
                {view.tone === 'error' && (
                  <TriangleAlert aria-hidden size={14} className="mt-0.5 flex-none text-live" />
                )}
                <span>{view.sentence}</span>
              </PopoverPrimitive.Description>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 px-5 py-3.5 text-small">
              <dt className="text-dust">Last synced</dt>
              <dd>{describeAgo(lastSync, now)}</dd>
              {status.hubUrl && (
                <>
                  <dt className="text-dust">Hub</dt>
                  <dd className="break-all">{hostOf(status.hubUrl)}</dd>
                </>
              )}
            </dl>
            <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3.5">
              <button
                type="button"
                onClick={() => syncNow.mutate()}
                disabled={status.running || status.disabledReason !== null || syncNow.isPending}
                className={cn(primaryButtonClass, buttonSize.md)}
              >
                <RefreshCw
                  aria-hidden
                  size={15}
                  className={cn(status.running && 'animate-spin motion-reduce:animate-none')}
                />
                Sync now
              </button>
              <PopoverPrimitive.Close onClick={onOpenSettings} className={textLinkClass}>
                Open sync settings
              </PopoverPrimitive.Close>
            </div>
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
};

// El LED de la barra. Al día: un halo cian que respira despacio (vivo, pero
// sin reclamar atención); el resto de tonos, como en el popover.
const SyncDot = ({ tone }: { tone: Tone }): React.JSX.Element => (
  <span aria-hidden className="relative inline-flex size-2 flex-none">
    {tone === 'ok' && (
      <span className="absolute inset-0 animate-[led-ring_3.2s_var(--ease-out)_infinite] rounded-full bg-tube/70 motion-reduce:hidden" />
    )}
    <span className={cn('relative size-2 rounded-full', DOT_CLASS[tone])} />
  </span>
);

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};
