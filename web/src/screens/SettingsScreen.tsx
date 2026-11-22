import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Monitor, Plus, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { createEnrollCode, fetchDevices, fetchMe, inviteByEmail, revokeDevice } from '../api';
import type { DeviceDto } from '../api';
import { CopyButton } from '../components/CopyButton';
import { ErrorState, Loading } from '../components/States';
import { useCountdown } from '../hooks/useCountdown';
import {
  activeDevices,
  deviceSeenLabel,
  formatCountdown,
  inviteErrorMessage,
} from '../lib/account';

const SectionTitle = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <h2 className="mb-2.5 text-micro font-bold tracking-[.11em] text-muted-foreground uppercase">
    {children}
  </h2>
);

const primaryButton =
  'flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-[13px] font-extrabold text-primary-foreground disabled:opacity-50';

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
    <section>
      <SectionTitle>Add device</SectionTitle>
      <div className="rounded-2xl border border-border bg-card p-4">
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          On your PC, open Settings, then Sync (or the 2.0 migration screen), and enter the address
          and this code.
        </p>

        {live && (
          <div className="mt-4 flex flex-col gap-3">
            <div>
              <div className="mb-1 text-micro font-bold tracking-[.11em] text-muted-foreground uppercase">
                One-time code
              </div>
              <div className="flex items-center gap-2">
                <code
                  data-testid="enroll-code"
                  className="min-w-0 flex-1 rounded-xl bg-bone/6 px-3 py-3 text-center font-mono text-[19px] font-extrabold tracking-wider break-all select-all"
                >
                  {issued.code}
                </code>
                <CopyButton value={issued.code} label="code" />
              </div>
              <div
                className="mt-2 text-[12px] font-semibold text-muted-foreground tabular-nums"
                role="timer"
              >
                Expires in <span className="text-foreground">{formatCountdown(msLeft)}</span>
              </div>
            </div>
          </div>
        )}

        {expired && (
          <p className="mt-4 rounded-xl border border-destructive/40 px-3 py-2.5 text-[12.5px] font-semibold text-destructive">
            This code has expired. Generate a new one.
          </p>
        )}

        {(live || expired) && (
          <div className="mt-4">
            <div className="mb-1 text-micro font-bold tracking-[.11em] text-muted-foreground uppercase">
              Address
            </div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 rounded-xl bg-bone/6 px-3 py-2.5 font-mono text-[13px] font-semibold break-all select-all">
                {hubAddress}
              </code>
              <CopyButton value={hubAddress} label="address" />
            </div>
          </div>
        )}

        {create.isError && (
          <p role="alert" className="mt-3 text-[12.5px] font-semibold text-destructive">
            Couldn&apos;t create a code. Try again.
          </p>
        )}

        <button
          type="button"
          onClick={() => create.mutate()}
          disabled={create.isPending}
          className={`${primaryButton} mt-4 w-full`}
        >
          {create.isPending ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
          {issued === null ? 'Generate a code' : 'Generate a new code'}
        </button>
      </div>
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
  <li className="rounded-xl border border-border bg-card px-3.5 py-3">
    <div className="flex items-center gap-3">
      <Monitor size={18} className="shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-bold break-words">{device.deviceName}</div>
        <div className="text-[11.5px] font-semibold text-muted-foreground">
          {deviceSeenLabel(device)}
        </div>
      </div>
      {!confirming && (
        <button
          type="button"
          onClick={onAsk}
          className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-[12px] font-bold text-muted-foreground"
        >
          Revoke
        </button>
      )}
    </div>
    {confirming && (
      <div className="mt-3 border-t border-border pt-3">
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          Revoke <span className="font-bold text-foreground">{device.deviceName}</span>? It will
          stop syncing and will need a new code to come back.
        </p>
        {failed && (
          <p role="alert" className="mt-2 text-[12.5px] font-semibold text-destructive">
            Couldn&apos;t revoke it. Try again.
          </p>
        )}
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="flex-1 rounded-xl border border-border py-2 text-[12.5px] font-bold disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-destructive py-2 text-[12.5px] font-extrabold text-background disabled:opacity-50"
          >
            {pending && <Loader2 size={14} className="animate-spin" />}
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
      <SectionTitle>Devices</SectionTitle>
      {devices.isPending && <Loading />}
      {devices.isError && (
        <ErrorState error={devices.error} onRetry={() => void devices.refetch()} />
      )}
      {devices.data && list.length === 0 && (
        <p className="rounded-xl border border-border bg-card px-3.5 py-3 text-[12.5px] font-semibold text-muted-foreground">
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
    <section>
      <SectionTitle>Invite a person</SectionTitle>
      <form onSubmit={submit} className="rounded-2xl border border-border bg-card p-4">
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
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
          className="mt-3 w-full rounded-xl border border-border bg-bone/6 px-3 py-2.5 text-[16px] outline-none placeholder:text-muted-foreground/60 focus:border-primary"
        />
        {invited !== null && (
          <p role="status" className="mt-3 text-[12.5px] font-semibold text-primary">
            <span className="break-all">{invited}</span> can now sign in and get their own space.
          </p>
        )}
        {invite.isError && (
          <p role="alert" className="mt-3 text-[12.5px] font-semibold text-destructive">
            {inviteErrorMessage(invite.error)}
          </p>
        )}
        <button
          type="submit"
          disabled={invite.isPending || email.trim() === ''}
          className={`${primaryButton} mt-3 w-full`}
        >
          {invite.isPending ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <UserPlus size={15} />
          )}
          Invite
        </button>
      </form>
    </section>
  );
};

// ── Screen ─────────────────────────────────────────────────────────────────

export const SettingsScreen = (): React.JSX.Element => {
  const me = useQuery({ queryKey: ['me'], queryFn: fetchMe });

  return (
    <div className="flex flex-col gap-6 px-4 pt-5 pb-6">
      <h1 className="text-[22px] font-extrabold tracking-tight">Settings</h1>
      <AddDevice />
      <Devices />
      {/* Lo decide el hub: quien no es el anfitrión no ve la sección. Si /me
          falla, tampoco: la sección es opcional y el resto ya funciona. */}
      {me.data?.isHost && <Invite />}
    </div>
  );
};
