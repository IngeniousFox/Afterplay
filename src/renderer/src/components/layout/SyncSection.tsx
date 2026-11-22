import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { checkHubUrl } from '../../../../shared/sync/hubUrl';
import type { SyncStatus } from '../../../../shared/sync/status';
import { usePairSync, useSyncNow, useSyncStatus, useUnpairSync } from '../../hooks/sync';
import { AMBER, GREEN } from '../../lib/colors';
import { accentGradientStyle } from '../../lib/styles';
import { describeAgo } from '../../lib/syncText';
import { fieldLabelClass, textInputClass, textInputFocusClass } from '../library/add-game/styles';
import { SettingsCard } from './SettingsCard';

// Mismo botón de contorno que el resto de Ajustes (Back up now, Export keys).
const outlineButtonClass =
  'flex flex-none items-center gap-1.75 rounded-[9px] border border-line-strong bg-raised px-3 py-1.75 text-[12px] font-semibold text-foreground transition-colors duration-150 hover:border-line-hover hover:bg-raised-hover disabled:cursor-not-allowed disabled:opacity-50';

// Sync entre tus PCs a través de TU hub (AFTERPLAY-2.0.md §9). Aquí solo se
// empareja este PC, se ve cómo va y se olvida el hub; el alta de dispositivos
// nuevos y su revocación viven en la web.
export const SyncSection = (): React.JSX.Element => {
  const { data: status } = useSyncStatus();

  return (
    <SettingsCard
      layout="column"
      title="Sync"
      description="Keep your library, sessions and plan in step across your PCs and your phone through your own Afterplay hub. The app works the same without it."
      icon={RefreshCw}
      color={GREEN}
    >
      {status &&
        (status.paired ? (
          <PairedView status={status} />
        ) : (
          <PairForm available={status.available} />
        ))}
    </SettingsCard>
  );
};

const PairForm = ({ available }: { available: boolean }): React.JSX.Element => {
  const pair = usePairSync();
  const [hubUrl, setHubUrl] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  // El formulario nace plegado: la mayoría de la gente no usa sync, y así la
  // pestaña Connections no estrena dos campos de texto más a la vista.
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

  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-2.75">
        <div className="text-[12px] text-muted-foreground">Not paired.</div>
        <button type="button" onClick={() => setOpen(true)} className={outlineButtonClass}>
          Pair this PC…
        </button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-2.5 border-t border-line pt-2.75"
      onSubmit={(event) => {
        event.preventDefault();
        if (canPair) void handlePair();
      }}
    >
      <div className="text-[12px] text-muted-foreground">
        In the web app, open <span className="text-foreground">Add device</span> to get a one-time
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
          className={`${textInputClass} ${textInputFocusClass}`}
        />
        {urlMessage && (
          <div role="alert" className="mt-1 text-[11px] text-destructive">
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
          className={`${textInputClass} ${textInputFocusClass}`}
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!canPair}
          style={accentGradientStyle}
          className="flex flex-none items-center gap-1.75 rounded-[9px] px-3.5 py-2 text-[12.5px] font-bold disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pair.isPending ? 'Pairing…' : 'Pair'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={outlineButtonClass}>
          Cancel
        </button>
        {!available && (
          <span className="text-[11px] text-muted-foreground">
            Sync is turned off in this session.
          </span>
        )}
      </div>
      {error && (
        <div role="alert" className="text-[11px] text-destructive">
          {error}
        </div>
      )}
    </form>
  );
};

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

  return (
    <div className="flex flex-col gap-2.5 border-t border-line pt-2.75">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <div className="min-w-0 text-[12px] text-muted-foreground">
          Paired with <span className="font-semibold text-foreground">{hostOf(status.hubUrl)}</span>
          {' · '}
          {status.running ? 'syncing…' : `last sync ${describeAgo(lastSync, now)}`}
        </div>
        <div className="flex flex-none items-center gap-2">
          <button
            type="button"
            onClick={() => syncNow.mutate()}
            disabled={status.running || status.disabledReason !== null}
            className={outlineButtonClass}
          >
            <RefreshCw size={13} className={status.running ? 'animate-spin' : ''} />
            Sync now
          </button>
          {!confirming && (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className={outlineButtonClass}
            >
              Unpair
            </button>
          )}
        </div>
      </div>

      {(status.problem || status.disabledReason) && (
        <div
          className="flex items-start gap-2 rounded-[9px] border px-2.75 py-2"
          style={{ borderColor: `${AMBER}44`, background: `${AMBER}0f` }}
        >
          <AlertTriangle size={13} className="mt-0.5 flex-none" style={{ color: AMBER }} />
          <div className="min-w-0 text-[11.5px] leading-relaxed" style={{ color: AMBER }}>
            {status.disabledReason ?? status.problem?.message}
          </div>
        </div>
      )}

      {confirming && (
        <div className="flex flex-col gap-2 rounded-[9px] border border-border px-2.75 py-2">
          <div className="text-[11.5px] leading-relaxed text-muted-foreground">
            This PC will stop syncing and forget the hub. Your data stays here. To cut off its
            access for good, also remove this device from the web app.
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => unpair.mutate(undefined, { onSettled: () => setConfirming(false) })}
              disabled={unpair.isPending}
              className={outlineButtonClass}
            >
              {unpair.isPending ? 'Unpairing…' : 'Unpair this PC'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className={outlineButtonClass}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
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
