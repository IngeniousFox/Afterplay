import { Check, Loader2, MonitorSmartphone, Search, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import type { CloudMachine, IdentityCheck } from '../../../../shared/types';
import {
  useAdoptMachine,
  useCheckIdentity,
  useKeepIdentity,
  useNeedsIdentityCheck,
} from '../../hooks/saves';
import { expandClass } from '../../lib/styles';
import { AMBER, BLUE } from '../../lib/colors';

// Reconocer la carpeta que este PC ya tenía en el bucket, antes de empezar a
// subir a una nueva (PARTIDAS-GUARDADAS.md §7.2, ver saves/identity.ts).
//
// Por qué esto tiene que existir: el machineId vive en un fichero local que
// nunca sincroniza, así que una reinstalación mina uno nuevo y abandona la
// carpeta anterior — que deja de podarse y se paga para siempre. Y sin Turso,
// además, el índice desaparece y esos backups quedan invisibles.
//
// La sección solo aparece cuando hay algo que decidir: la comprobación previa
// es local (comparar el bucket configurado con el ya reconciliado) y no gasta
// ni una operación de R2. Mirar la nube es siempre un clic explícito.
export const CloudIdentitySection = (): React.JSX.Element | null => {
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
    <div
      className="flex flex-col gap-2.5 rounded-[10px] border px-3.25 py-2.75"
      style={{ borderColor: `${AMBER}3d`, background: `${AMBER}0d` }}
    >
      <div className="flex items-start gap-2">
        <div
          className="flex h-6 w-6 flex-none items-center justify-center rounded-md"
          style={{ background: `${AMBER}1f` }}
        >
          <MonitorSmartphone size={13} style={{ color: AMBER }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold text-foreground">
            Check this PC&apos;s cloud folder
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Afterplay hasn&apos;t looked at this bucket yet. If you&apos;ve backed up from this PC
            before — on another install — it can reclaim that folder instead of starting a second
            one that never gets cleaned up.
          </div>
        </div>
      </div>

      {!result && (
        <button
          type="button"
          onClick={handleCheck}
          disabled={busy}
          className="flex w-fit flex-none items-center gap-1.75 rounded-[9px] border border-input bg-white/[0.03] px-3.25 py-2 text-[12.5px] font-semibold text-foreground transition-colors duration-150 hover:border-primary/45 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {check.isPending ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          {check.isPending ? 'Looking…' : 'Check the cloud'}
        </button>
      )}

      {check.isError && (
        <div className="text-[11px] text-destructive">
          Couldn&apos;t read the bucket — {check.error.message}
        </div>
      )}
      {/* adopt/keep escriben en el bucket (PUT machines/<id>.json) — a
          diferencia de check, que solo lee. Un token de R2 con permisos
          acotados a un prefijo concreto (p.ej. solo "saves/") dejaría esto
          fallar en silencio si no se pintara: la mutation captura el error
          igual, pero sin esto en el JSX nadie lo veía. */}
      {(adopt.isError || keep.isError) && (
        <div className="text-[11px] text-destructive">
          Couldn&apos;t write to the bucket — {(adopt.error ?? keep.error)?.message}
        </div>
      )}

      {result && (
        <IdentityResult result={result} busy={busy} onAdopt={handleAdopt} onKeep={handleKeep} />
      )}
    </div>
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
      <div className={`flex flex-col gap-2 ${expandClass}`}>
        <div className="text-[11.5px] text-muted-foreground">
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
    <div className={`flex flex-col gap-2 ${expandClass}`}>
      {/* Ya hemos escrito bajo el id actual: cambiarlo ahora dejaría esos
          objetos huérfanos, así que se avisa antes de ofrecer nada. */}
      {result.claimed && (
        <div className="flex items-start gap-1.75 text-[11px]" style={{ color: AMBER }}>
          <TriangleAlert size={12} className="mt-0.5 flex-none" />
          <span>
            This install has already uploaded backups under its own folder. Claiming another one
            would leave those behind — only do it if you know they&apos;re not worth keeping.
          </span>
        </div>
      )}

      <div className="text-[11px] font-bold tracking-[.05em] text-muted-foreground">
        FOUND IN THE CLOUD
      </div>

      {sorted.map((machine) => (
        <MachineRow
          key={machine.machineId}
          machine={machine}
          busy={busy}
          onAdopt={() => onAdopt(machine.machineId)}
        />
      ))}

      <ConfirmButton label="None of these — this is a different PC" busy={busy} onClick={onKeep} />
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
      className="flex items-center gap-2.5 rounded-[8px] border px-2.75 py-2"
      style={
        likely
          ? { borderColor: `${BLUE}2e`, background: `${BLUE}0d` }
          : { borderColor: 'var(--border)', background: 'rgba(255,255,255,.02)' }
      }
    >
      <MonitorSmartphone
        size={13}
        className="flex-none"
        style={{ color: likely ? BLUE : 'rgba(255,255,255,.25)' }}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-semibold text-foreground">
          {machine.machineName}
          {likely && (
            <span className="ml-1.5 text-[10.5px] font-bold" style={{ color: BLUE }}>
              probably this PC
            </span>
          )}
        </div>
        <div className="truncate font-mono text-[10.5px] text-muted-foreground">{machine.home}</div>
      </div>
      <button
        type="button"
        onClick={onAdopt}
        disabled={busy}
        className="flex-none rounded-[7px] border border-input px-2.25 py-1 text-[11px] font-bold text-muted-foreground transition-colors duration-150 enabled:hover:border-primary/45 enabled:hover:bg-white/[0.06] enabled:hover:text-foreground disabled:opacity-50"
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
  <button
    type="button"
    onClick={onClick}
    disabled={busy}
    className="flex w-fit items-center gap-1.5 rounded-[9px] border border-input bg-white/[0.03] px-3 py-1.75 text-[12px] font-semibold text-foreground transition-colors duration-150 hover:border-primary/45 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
  >
    {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
    {label}
  </button>
);
