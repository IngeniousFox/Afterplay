import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Monitor, Plus, TriangleAlert, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { createEnrollCode, fetchDevices, fetchMe, inviteByEmail, revokeDevice } from '../api';
import type { DeviceDto } from '../api';
import { CopyButton } from '../components/CopyButton';
import { Figure } from '../components/Figure';
import { PageHeader, SectionTitle } from '../components/PageHeader';
import { QrCode } from '../components/QrCode';
import { ErrorState, Loading } from '../components/States';
import { useCountdown } from '../hooks/useCountdown';
import {
  activeDevices,
  deviceSeenLabel,
  formatCountdown,
  inviteErrorMessage,
} from '../lib/account';
import { cn } from '../lib/cn';
import {
  dangerButtonClass,
  fieldClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../lib/styles';

const panelClass = 'rounded-md border border-line bg-panel p-4';
const panelTitleClass = 'text-lead font-semibold text-bone';

// Un aviso de error dentro de un panel: borde y texto Live, con triángulo.
const ErrorNote = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <p
    role="alert"
    className="mt-3 flex items-start gap-2 rounded-sm border border-live/45 bg-live/8 px-3 py-2.5 text-small font-semibold text-live"
  >
    <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
    <span>{children}</span>
  </p>
);

// ── Add device ─────────────────────────────────────────────────────────────

const AddDevice = (): React.JSX.Element => {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: createEnrollCode,
    // El PC nuevo aparecerá en la lista en cuanto se empareje.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['devices'] }),
  });
  const issued = create.data ?? null;
  const msLeft = useCountdown(issued?.expiresAt ?? null);
  const expired = issued !== null && msLeft <= 0;
  const live = issued !== null && !expired;
  // Mismo origen que sirve esta PWA: es la dirección que pide el PC.
  const hubAddress = window.location.origin;

  return (
    <section className={panelClass} aria-labelledby="add-device-title">
      <h2 id="add-device-title" className={panelTitleClass}>
        Add device
      </h2>
      <p className="mt-1 text-small text-dust">
        On your PC, open Settings, then Sync (or the 2.0 migration screen), and enter the address
        and this code.
      </p>

      {live && (
        <div className="mt-4 flex flex-col gap-3">
          <code
            data-testid="enroll-code"
            aria-label="One-time code"
            className="block rounded-sm border border-line-strong bg-inset px-3 py-3 text-center font-display text-[46px] leading-[48px] font-bold tracking-[0.06em] break-all text-phosphor select-all [text-shadow:var(--shadow-glow-text)]"
          >
            {issued.code}
          </code>

          <div className="flex items-center gap-4">
            {/* El QR lleva la dirección y el código, una línea cada uno, para
                pasarlos a otro dispositivo con la cámara. Es el mismo código
                de un solo uso: caduca con él. */}
            <div className="shrink-0 rounded-sm bg-[#f4f0e6] p-1">
              <QrCode
                value={`${hubAddress}\n${issued.code}`}
                label="QR code with the address and the one-time code"
                className="block size-28"
              />
            </div>
            <div className="flex min-w-0 flex-col items-start gap-1">
              <div className="flex items-baseline gap-2 text-small text-dust" role="timer">
                Expires in
                <Figure
                  value={formatCountdown(msLeft)}
                  className="text-[32px] leading-none text-bone"
                />
              </div>
              <span className="text-small text-dust">Single use</span>
              <div className="mt-1">
                <CopyButton value={issued.code} label="code" text="Copy code" />
              </div>
            </div>
          </div>
        </div>
      )}

      {expired && <ErrorNote>This code has expired. Generate a new one.</ErrorNote>}

      {(live || expired) && (
        <div className="mt-4">
          <div className="mb-1 text-small text-dust">Address</div>
          <div className="flex items-center gap-2">
            <code className="flex min-h-11 min-w-0 flex-1 items-center rounded-sm border border-line-strong bg-inset px-3 py-2 text-small font-semibold break-all text-bone select-all">
              {hubAddress}
            </code>
            <CopyButton value={hubAddress} label="address" />
          </div>
        </div>
      )}

      {create.isError && <ErrorNote>Couldn&apos;t create a code. Try again.</ErrorNote>}

      <button
        type="button"
        onClick={() => create.mutate()}
        disabled={create.isPending}
        aria-busy={create.isPending}
        className={cn(primaryButtonClass, 'mt-4 w-full')}
      >
        {create.isPending ? (
          <Loader2 size={16} className="animate-spin motion-reduce:animate-none" />
        ) : (
          <Plus size={17} />
        )}
        {issued === null ? 'Generate a code' : 'Generate a new code'}
      </button>
    </section>
  );
};

// ── Devices ────────────────────────────────────────────────────────────────

const DeviceRow = ({
  device,
  confirming,
  pending,
  failed,
  onAsk,
  onCancel,
  onConfirm,
}: {
  device: DeviceDto;
  confirming: boolean;
  pending: boolean;
  failed: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}): React.JSX.Element => (
  <li
    className={cn(
      'rounded-md border bg-panel px-3 py-2.5',
      confirming ? 'border-live/45' : 'border-line',
    )}
  >
    <div className="flex items-center gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-raised text-dust">
        <Monitor size={17} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-body font-semibold break-words text-bone">{device.deviceName}</div>
        <div className="text-small text-dust">{deviceSeenLabel(device)}</div>
      </div>
      {!confirming && (
        <button
          type="button"
          onClick={onAsk}
          className={cn(secondaryButtonClass, 'shrink-0 px-3 text-small')}
        >
          Revoke
        </button>
      )}
    </div>
    {confirming && (
      <div className="mt-2.5 border-t border-line pt-2.5">
        <p className="text-small text-dust">
          Revoke <span className="font-semibold text-bone">{device.deviceName}</span>? It will stop
          syncing and will need a new code to come back.
        </p>
        {failed && <ErrorNote>Couldn&apos;t revoke it. Try again.</ErrorNote>}
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className={cn(secondaryButtonClass, 'flex-1')}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            aria-busy={pending}
            className={cn(dangerButtonClass, 'flex-1')}
          >
            {pending && <Loader2 size={15} className="animate-spin motion-reduce:animate-none" />}
            Revoke device
          </button>
        </div>
      </div>
    )}
  </li>
);

const Devices = (): React.JSX.Element => {
  const queryClient = useQueryClient();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const devices = useQuery({ queryKey: ['devices'], queryFn: fetchDevices });
  const revoke = useMutation({
    mutationFn: revokeDevice,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['devices'] });
      setConfirmingId(null);
    },
  });

  const list = devices.data ? activeDevices(devices.data) : [];

  return (
    <section>
      <SectionTitle aside={devices.data ? list.length : undefined}>Devices</SectionTitle>
      {devices.isPending && <Loading label="Reading your devices" rows={2} />}
      {devices.isError && (
        <ErrorState error={devices.error} onRetry={() => void devices.refetch()} />
      )}
      {devices.data && list.length === 0 && (
        <p className={cn(panelClass, 'text-small text-dust')}>
          No PC is paired yet. Use Add device above.
        </p>
      )}
      {list.length > 0 && (
        <ul className="flex flex-col gap-2">
          {list.map((device) => (
            <DeviceRow
              key={device.tokenId}
              device={device}
              confirming={confirmingId === device.tokenId}
              pending={revoke.isPending}
              failed={revoke.isError}
              onAsk={() => {
                revoke.reset();
                setConfirmingId(device.tokenId);
              }}
              onCancel={() => setConfirmingId(null)}
              onConfirm={() => revoke.mutate(device.tokenId)}
            />
          ))}
        </ul>
      )}
    </section>
  );
};

// ── Invite a person ────────────────────────────────────────────────────────

const Invite = (): React.JSX.Element => {
  const [email, setEmail] = useState('');
  const [invited, setInvited] = useState<string | null>(null);
  const invite = useMutation({
    mutationFn: inviteByEmail,
    onSuccess: (invitation) => {
      setInvited(invitation.email);
      setEmail('');
    },
  });

  const submit = (event: React.SyntheticEvent): void => {
    event.preventDefault();
    const trimmed = email.trim();
    if (trimmed === '') return;
    setInvited(null);
    invite.mutate(trimmed);
  };

  return (
    <form onSubmit={submit} className={panelClass} aria-labelledby="invite-title">
      <h2 id="invite-title" className={panelTitleClass}>
        Invite a person
      </h2>
      <p className="mt-1 text-small text-dust">
        They get their own library, separate from yours. They also need to be allowed by the
        Cloudflare Access policy to sign in.
      </p>
      <label htmlFor="invite-email" className="sr-only">
        Email address
      </label>
      <input
        id="invite-email"
        type="email"
        inputMode="email"
        autoComplete="off"
        autoCapitalize="none"
        placeholder="friend@example.com"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        className={cn(fieldClass, 'mt-3')}
      />
      {invited !== null && (
        <p role="status" className="mt-3 flex items-start gap-2 text-small font-semibold text-tube">
          <Check size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            <span className="break-all">{invited}</span> can now sign in and get their own space.
          </span>
        </p>
      )}
      {invite.isError && <ErrorNote>{inviteErrorMessage(invite.error)}</ErrorNote>}
      <button
        type="submit"
        disabled={invite.isPending || email.trim() === ''}
        aria-busy={invite.isPending}
        className={cn(primaryButtonClass, 'mt-3 w-full')}
      >
        {invite.isPending ? (
          <Loader2 size={16} className="animate-spin motion-reduce:animate-none" />
        ) : (
          <UserPlus size={17} />
        )}
        Invite
      </button>
    </form>
  );
};

// ── Screen ─────────────────────────────────────────────────────────────────

export const SettingsScreen = (): React.JSX.Element => {
  const me = useQuery({ queryKey: ['me'], queryFn: fetchMe });

  return (
    <div className="px-4 pb-6">
      <PageHeader title="Settings" back="/" />
      <div className="flex flex-col gap-6">
        <AddDevice />
        <Devices />
        {/* Lo decide el hub: quien no es el anfitrión no ve la sección. Si /me
            falla, tampoco: la sección es opcional y el resto ya funciona. */}
        {me.data?.isHost && <Invite />}
      </div>
    </div>
  );
};
