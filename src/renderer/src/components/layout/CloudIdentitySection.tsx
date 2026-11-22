import { Check, Loader2, Monitor, Search, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import type { CloudMachine, DuplicateResolution, IdentityCheck } from '../../../../shared/types';
import {
  useAdoptMachine,
  useCheckIdentity,
  useInstallIdentity,
  useKeepIdentity,
  useNeedsIdentityCheck,
  useResolveDuplicate,
} from '../../hooks/saves';
import { expandClass } from '../../lib/styles';
import { buttonSize, secondaryButtonClass } from '../shell/controls';
import { CloudConfirmDialog } from './CloudConfirmDialog';
import { SettingsCard, StatusLine } from './SettingsCard';

const buttonClass = cn(secondaryButtonClass, buttonSize.md);

// Reconocer la carpeta que este PC ya tenía en el bucket, antes de empezar a
// subir a una nueva (PARTIDAS-GUARDADAS.md §7.2, ver saves/identity.ts).
//
// Por qué esto tiene que existir: el machineId vive en un fichero local que
// nunca sincroniza, así que una reinstalación mina uno nuevo y abandona la
// carpeta anterior — que deja de podarse y se paga para siempre. Y sin sync,
// además, el índice desaparece y esos backups quedan invisibles.
//
// La sección solo aparece cuando hay algo que decidir: la comprobación previa
// es local (comparar el bucket configurado con el ya reconciliado) y no gasta
// ni una operación de R2. Mirar la nube es siempre un clic explícito.
export const CloudIdentitySection = (): React.JSX.Element => (
  <>
    <DuplicateIdentityCard />
    <BucketIdentityCheck />
  </>
);

const DUPLICATE_CONFIRM: Record<
  DuplicateResolution,
  { title: string; confirmLabel: string; message: string }
> = {
  'keep-this-pc': {
    title: 'This PC is the original',
    confirmLabel: 'Yes, this is the original',
    message:
      "This PC keeps its cloud-save identity and the other installation is paused instead: it will stop backing up and cleaning up until it's given a new identity.",
  },
  'new-identity': {
    title: 'This PC is a different one',
    confirmLabel: 'Restart with a new identity',
    message:
      "Afterplay will restart and this PC will start a fresh cloud-save identity. Its previous backups stay with the other installation, and this PC won't see them as its own.",
  },
};

// Otra instalación usa el id de este PC (§12.6, F-24): normalmente porque la
// carpeta de datos se copió de aquí o hacia aquí. Mientras dure, backups y
// poda están pausados en este PC. Es local y barato, así que se mira siempre.
const DuplicateIdentityCard = (): React.JSX.Element | null => {
  const { data: identity } = useInstallIdentity();
  const resolve = useResolveDuplicate();
  const [pending, setPending] = useState<DuplicateResolution | null>(null);

  if (!identity?.duplicate) return null;

  const handleConfirm = async (): Promise<void> => {
    if (!pending) return;
    // 'new-identity' relanza la app: esta promesa puede no resolver nunca.
    try {
      await resolve.mutateAsync(pending);
      setPending(null);
    } catch {
      // El motivo se enseña en el diálogo (resolve.error); sigue abierto.
    }
  };

  const confirm = pending ? DUPLICATE_CONFIRM[pending] : null;

  return (
    <SettingsCard
      data-testid="duplicate-identity"
      tone="danger"
      title={
        <span className="flex items-center gap-2.5">
          <TriangleAlert aria-hidden size={17} className="flex-none text-live" />
          Another installation shares this PC&apos;s identity
        </span>
      }
      description="Another Afterplay installation is using this PC's identity. Its data folder was probably copied from here or to here. Cloud backups and cleanup are paused on this PC."
    >
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setPending('keep-this-pc')} className={buttonClass}>
          This PC is the original
        </button>
        <button type="button" onClick={() => setPending('new-identity')} className={buttonClass}>
          This PC is a different one
        </button>
      </div>
      <CloudConfirmDialog
        open={pending !== null}
        title={confirm?.title ?? ''}
        message={confirm?.message}
        confirmLabel={confirm?.confirmLabel ?? 'Confirm'}
        busy={resolve.isPending}
        error={resolve.isError ? resolve.error.message : null}
        destructive={pending === 'new-identity'}
        onConfirm={handleConfirm}
        onCancel={() => {
          resolve.reset();
          setPending(null);
        }}
      />
    </SettingsCard>
  );
};

const BucketIdentityCheck = (): React.JSX.Element | null => {
  const { data: needed } = useNeedsIdentityCheck();
  const check = useCheckIdentity();
  const adopt = useAdoptMachine();
  const keep = useKeepIdentity();
  const [result, setResult] = useState<IdentityCheck | null>(null);
  const [done, setDone] = useState(false);

  if (!needed || done) return null;

  const handleCheck = async (): Promise<void> => {
    setResult(await check.mutateAsync());
  };

  const handleAdopt = async (machineId: string): Promise<void> => {
    await adopt.mutateAsync(machineId);
    setDone(true);
  };

  const handleKeep = async (): Promise<void> => {
    await keep.mutateAsync();
    setDone(true);
  };

  const busy = check.isPending || adopt.isPending || keep.isPending;

  return (
    <SettingsCard
      tone="notice"
      title="Check this PC's cloud folder"
      description="Afterplay hasn't looked at this bucket yet. If you've backed up from this PC before, on another install, it can reclaim that folder instead of starting a second one that never gets cleaned up."
      action={
        !result && (
          <button type="button" onClick={handleCheck} disabled={busy} className={buttonClass}>
            {check.isPending ? (
              <Loader2 aria-hidden size={15} className="animate-spin motion-reduce:animate-none" />
            ) : (
              <Search aria-hidden size={15} />
            )}
            {check.isPending ? 'Looking…' : 'Check the cloud'}
          </button>
        )
      }
      extra={
        <>
          {check.isError && (
            <StatusLine tone="error">
              Couldn&apos;t read the bucket: {check.error.message}
            </StatusLine>
          )}
          {/* adopt/keep escriben en el bucket (PUT machines/<id>.json) — a
              diferencia de check, que solo lee. Un token de R2 acotado a un
              prefijo dejaría esto fallar en silencio si no se pintara. */}
          {(adopt.isError || keep.isError) && (
            <StatusLine tone="error">
              Couldn&apos;t write to the bucket: {(adopt.error ?? keep.error)?.message}
            </StatusLine>
          )}
        </>
      }
    >
      {result && (
        <IdentityResult result={result} busy={busy} onAdopt={handleAdopt} onKeep={handleKeep} />
      )}
    </SettingsCard>
  );
};

const IdentityResult = ({
  result,
  busy,
  onAdopt,
  onKeep,
}: {
  result: IdentityCheck;
  busy: boolean;
  onAdopt: (machineId: string) => void;
  onKeep: () => void;
}): React.JSX.Element => {
  // Las que coinciden en nombre y en cuenta van primero: son las que casi
  // seguro son este mismo PC de una instalación anterior.
  const sorted = [...result.machines].sort(
    (a, b) => Number(b.sameName && b.sameHome) - Number(a.sameName && a.sameHome),
  );

  if (sorted.length === 0) {
    return (
      <div className={cn('flex flex-col items-start gap-3', expandClass)}>
        <div className="text-small text-dust">
          {/* claimed distingue dos situaciones que acababan en el mismo
              texto: un bucket estrenándose de verdad, y el caso normal de
              una instalación que YA subía backups desde antes de que
              existiera el registro de máquinas — decirle "fresh start" a
              esta última hacía pensar que la comprobación no veía sus
              backups (pasó de verdad). */}
          {result.claimed
            ? "Your backups are here and this folder is already this PC's — it just isn't registered by name yet. Registering only adds that tag, so a future reinstall can recognise it."
            : 'Nothing else in this bucket — this is a fresh start. Afterplay will register this PC so a future reinstall can recognise it.'}
        </div>
        <ConfirmButton label="Register this PC" busy={busy} onClick={onKeep} />
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-2.5', expandClass)}>
      {/* Ya hemos escrito bajo el id actual: cambiarlo ahora dejaría esos
          objetos huérfanos, así que se avisa antes de ofrecer nada. */}
      {result.claimed && (
        <div className="flex items-start gap-2 text-small text-phosphor">
          <TriangleAlert aria-hidden size={14} className="mt-0.5 flex-none" />
          <span>
            This install has already uploaded backups under its own folder. Claiming another one
            would leave those behind — only do it if you know they&apos;re not worth keeping.
          </span>
        </div>
      )}

      <div className="text-small font-semibold text-dust">Found in the cloud</div>

      {sorted.map((machine) => (
        <MachineRow
          key={machine.machineId}
          machine={machine}
          busy={busy}
          onAdopt={() => onAdopt(machine.machineId)}
        />
      ))}

      <div>
        <ConfirmButton label="None of these, this is a different PC" busy={busy} onClick={onKeep} />
      </div>
    </div>
  );
};

const MachineRow = ({
  machine,
  busy,
  onAdopt,
}: {
  machine: CloudMachine;
  busy: boolean;
  onAdopt: () => void;
}): React.JSX.Element => {
  const likely = machine.sameName && machine.sameHome;

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-sm border px-3.5 py-2.5',
        likely ? 'border-tube/40 bg-tube/6' : 'border-line bg-inset',
      )}
    >
      <Monitor
        aria-hidden
        size={15}
        className={cn('flex-none', likely ? 'text-tube' : 'text-dust')}
      />
      <div className="min-w-0 flex-1">
        <div className="text-body font-semibold text-bone">
          {machine.machineName}
          {likely && (
            <span className="ml-2 text-micro font-semibold text-tube">probably this PC</span>
          )}
        </div>
        <div className="font-mono text-micro break-all text-dust">{machine.home}</div>
      </div>
      <button
        type="button"
        onClick={onAdopt}
        disabled={busy}
        className={cn(secondaryButtonClass, buttonSize.sm)}
      >
        That&apos;s me
      </button>
    </div>
  );
};

const ConfirmButton = ({
  label,
  busy,
  onClick,
}: {
  label: string;
  busy: boolean;
  onClick: () => void;
}): React.JSX.Element => (
  <button type="button" onClick={onClick} disabled={busy} className={buttonClass}>
    {busy ? (
      <Loader2 aria-hidden size={14} className="animate-spin motion-reduce:animate-none" />
    ) : (
      <Check aria-hidden size={14} />
    )}
    {label}
  </button>
);
