import {
  ArrowRight,
  Check,
  ChevronDown,
  Folder,
  FolderDown,
  FolderOpen,
  FolderOutput,
  HardDrive,
  HardDriveDownload,
  Home,
  Loader2,
  TriangleAlert,
} from 'lucide-react';
import { useState } from 'react';
import type { RestoreMode, RestoreResult, SaveBackupRow } from '../../../../../shared/types';
import { useRestoreSave } from '../../../hooks/saves';
import { useTimeFormat } from '../../../hooks/settings';
import { formatByPrecision, formatBytes, pluralize } from '../../../lib/format';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../../hooks/queryKeys';
import { ModalShell } from '../../ui/modal-shell';

const BLUE = '#85a3d6';
const AMBER = '#e3b24a';

type RestoreSaveDialogProps = {
  gameId: number;
  gameTitle: string;
  backup: SaveBackupRow;
  currentTarget: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// Rojo de las cabeceras destructivas (DeleteGameDialog y compañía).
const RED = '#e85d72';

// Elegir destino y confirmar una restauración (PARTIDAS-GUARDADAS.md
// §10bis.5). La idea que ordena todo este diálogo: la ruta original es el
// valor por defecto, NO la única opción, y la fricción de cada modo es
// proporcional al daño que puede hacer — y eso se pinta: el único modo
// destructivo se tiñe de ROJO al elegirlo, los otros dos de azul. El color
// del modo elegido es el mismo del botón final, así que la paleta cuenta la
// consecuencia antes que el texto.
const MODES: {
  id: RestoreMode;
  label: string;
  detail: string;
  icon: typeof Home;
  tone: string;
}[] = [
  {
    id: 'in-place',
    label: 'Where it belongs',
    detail: 'Back to the paths the backup came from. Overwrites the save currently on disk.',
    icon: Home,
    tone: RED,
  },
  {
    id: 'custom-path',
    label: 'Another folder on this PC',
    detail: 'For when the game lives on a different drive here. Remembered for next time.',
    icon: HardDrive,
    tone: BLUE,
  },
  {
    id: 'export',
    label: 'Save a copy to…',
    detail: "Just drop the files in a folder. Doesn't touch the game or the registry.",
    icon: FolderOutput,
    tone: BLUE,
  },
];

export const RestoreSaveDialog = ({
  gameId,
  gameTitle,
  backup,
  currentTarget,
  open,
  onOpenChange,
}: RestoreSaveDialogProps): React.JSX.Element => {
  const { data: timeFormat = '24h' } = useTimeFormat();
  const queryClient = useQueryClient();
  const restore = useRestoreSave();

  const [mode, setMode] = useState<RestoreMode>('in-place');
  // El destino ya elegido para este juego en esta máquina se ofrece de
  // entrada: quien lo configuró una vez no tiene que volver a buscarlo.
  const [target, setTarget] = useState<string | null>(currentTarget);
  const [plan, setPlan] = useState<RestoreResult | null>(null);
  const [done, setDone] = useState(false);

  const needsTarget = mode !== 'in-place';
  const canRun = !needsTarget || Boolean(target);

  const reset = (): void => {
    setPlan(null);
    setDone(false);
  };

  const handleMode = (next: RestoreMode): void => {
    setMode(next);
    reset();
  };

  const handlePickTarget = async (): Promise<void> => {
    const folder = await window.api.dialog.pickFolder();
    if (!folder) return;
    setTarget(folder);
    reset();
  };

  // Dos pasos SIEMPRE: primero el plan (preview, no escribe nada) y solo
  // después la ejecución. El plan que se enseña es el que devuelve ludusavi,
  // con la ruta final real de cada archivo — no una predicción nuestra.
  // Los catch vacíos no tragan el error: restore.isError lo enseña en el
  // diálogo. Solo evitan el unhandled rejection en consola.
  const handlePreview = async (): Promise<void> => {
    const result = await restore
      .mutateAsync({
        gameId,
        backupId: backup.id,
        mode,
        target: target ?? undefined,
        preview: true,
      })
      .catch(() => null);
    if (result) setPlan(result);
  };

  const handleConfirm = async (): Promise<void> => {
    const outcome = await restore
      .mutateAsync({
        gameId,
        backupId: backup.id,
        mode,
        target: target ?? undefined,
        preview: false,
      })
      .catch(() => null);
    if (!outcome) return;
    setDone(true);
    // Restaurar cambia lo que hay en disco: el estado local de la sección
    // (y el destino recordado, si el modo lo guarda) ya no valen.
    queryClient.invalidateQueries({ queryKey: queryKeys.saves.all });
  };

  return (
    <ModalShell
      open={open}
      onClose={() => onOpenChange(false)}
      title="Restore save"
      icon={HardDriveDownload}
      color={BLUE}
      widthClass="w-145"
      maxHClass="max-h-[80vh]"
      headerExtra={
        <div className="mt-0.5 text-[12px] text-muted-foreground">
          {gameTitle} · {formatByPrecision(backup.createdAt, 'datetime', timeFormat)} · from{' '}
          {backup.machineName}
        </div>
      }
      footer={
        <div className="flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-[10px] border border-input bg-white/3 px-4.5 py-2.5 text-[13px] font-semibold text-foreground hover:bg-white/6"
          >
            {done ? 'Close' : 'Cancel'}
          </button>
          {!done &&
            (plan ? (
              <button
                type="button"
                onClick={handleConfirm}
                disabled={restore.isPending}
                className="[will-change:transform] flex items-center gap-2 rounded-[10px] px-5 py-2.5 text-[13px] font-bold text-white transition-transform duration-200 ease-[cubic-bezier(.16,1,.3,1)] disabled:cursor-not-allowed disabled:opacity-50 enabled:hover:-translate-y-1"
                style={{ background: mode === 'in-place' ? '#dc2626' : BLUE }}
              >
                {restore.isPending ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <HardDriveDownload size={15} />
                )}
                {restore.isPending
                  ? 'Working…'
                  : mode === 'export'
                    ? 'Save the copy'
                    : 'Restore for real'}
              </button>
            ) : (
              <button
                type="button"
                onClick={handlePreview}
                disabled={!canRun || restore.isPending}
                className="flex items-center gap-2 rounded-[10px] border border-input bg-white/[0.04] px-5 py-2.5 text-[13px] font-bold text-foreground hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {restore.isPending && <Loader2 size={15} className="animate-spin" />}
                Show me what will happen
              </button>
            ))}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          {MODES.map((option) => {
            const selected = mode === option.id;
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => handleMode(option.id)}
                disabled={done}
                className="flex items-center gap-3 rounded-[10px] border px-3.25 py-2.75 text-left transition-colors duration-150 disabled:opacity-60"
                style={{
                  borderColor: selected ? `${option.tone}80` : 'var(--input)',
                  background: selected
                    ? `linear-gradient(135deg, ${option.tone}1a, ${option.tone}06 65%, transparent)`
                    : 'rgba(255,255,255,.02)',
                }}
              >
                {/* Chip de icono en vez de radio: el mismo lenguaje que
                    FormSection/SettingsCard. El color ya dice cuál está
                    elegido — y en el destructivo, qué te juegas. */}
                <span
                  className="flex h-8.5 w-8.5 flex-none items-center justify-center rounded-[9px] transition-colors duration-150"
                  style={{
                    background: selected ? `${option.tone}24` : 'rgba(255,255,255,.04)',
                    border: `1px solid ${selected ? `${option.tone}3d` : 'var(--input)'}`,
                  }}
                >
                  <Icon
                    size={15}
                    style={{ color: selected ? option.tone : 'var(--muted-foreground)' }}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className="block text-[13px] font-semibold"
                    style={{ color: selected ? option.tone : 'var(--foreground)' }}
                  >
                    {option.label}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] leading-relaxed text-muted-foreground">
                    {option.detail}
                  </span>
                </span>
                {selected && (
                  <Check size={14} className="flex-none" style={{ color: option.tone }} />
                )}
              </button>
            );
          })}
        </div>

        {needsTarget && (
          <div className="flex items-center gap-2.5 rounded-[10px] border border-border bg-white/[0.02] px-3.25 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-bold tracking-[.05em] text-muted-foreground">
                DESTINATION FOLDER
              </div>
              <div
                className="truncate font-mono text-[11.5px] text-foreground"
                title={target ?? undefined}
              >
                {target ?? 'No folder chosen yet'}
              </div>
            </div>
            <button
              type="button"
              onClick={handlePickTarget}
              disabled={done}
              className="flex flex-none items-center gap-1.5 rounded-[8px] border border-input bg-white/[0.03] px-2.75 py-1.75 text-[12px] font-semibold text-foreground hover:border-primary/45 hover:bg-white/[0.06] disabled:opacity-50"
            >
              <FolderOpen size={13} />
              Choose…
            </button>
          </div>
        )}

        {backup.locations && backup.locations.length > 1 && (
          <div className="text-[11.5px] leading-relaxed" style={{ color: AMBER }}>
            This game saves in {backup.locations.length} different places. They&apos;ll all be
            restored — each one into its own subfolder when you pick a destination, because moving
            only one of them would leave the save half broken.
          </div>
        )}

        {restore.isError && (
          <div className="rounded-[9px] border border-destructive/30 bg-destructive/8 px-3.25 py-2.5 text-[12px] text-destructive">
            {restore.error.message}
          </div>
        )}

        {plan && !done && <Plan plan={plan} />}

        {done && (
          <div
            className="rounded-[10px] border px-3.5 py-3 text-[12.5px]"
            style={{ borderColor: `${BLUE}55`, background: `${BLUE}10` }}
          >
            Done — {pluralize(plan?.files.length ?? 0, 'file')} restored.
            {mode !== 'in-place' && target && (
              <button
                type="button"
                onClick={() => window.api.saves.openPath(target)}
                className="ml-1.5 font-semibold underline underline-offset-2"
                style={{ color: BLUE }}
              >
                Open the folder
              </button>
            )}
          </div>
        )}
      </div>
    </ModalShell>
  );
};

// Tope por carpeta ya desplegada. Existe por los juegos con miles de
// archivos (InZOI son 1.040): la lista está para saber QUÉ se va a escribir,
// no para auditarla archivo por archivo.
const MAX_FILES_PER_GROUP = 40;

const dirOf = (path: string): string => path.slice(0, path.lastIndexOf('/'));
const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

type PlanGroup = {
  dir: string;
  // Solo cuando la carpeta cambia de sitio (hay redirect). Si el archivo
  // vuelve a donde estaba, repetir la ruta dos veces no dice nada.
  from: string | null;
  files: { name: string; bytes: number }[];
  bytes: number;
};

// Los archivos de una partida están casi siempre en la misma carpeta y
// comparten un prefijo larguísimo. Listarlos uno a uno con su ruta completa
// era una columna de rutas idénticas truncadas por la mitad, donde lo único
// que distinguía una fila de otra —el nombre del archivo— era justo lo que
// se cortaba. Se agrupa por carpeta: la ruta se dice UNA vez y debajo van
// los nombres, que es lo que de verdad se lee.
const groupPlan = (files: RestoreResult['files']): PlanGroup[] => {
  const groups = new Map<string, PlanGroup>();

  for (const file of files) {
    const dir = dirOf(file.target);
    const sourceDir = file.source ? dirOf(file.source) : null;
    const existing = groups.get(dir);
    if (existing) {
      existing.files.push({ name: nameOf(file.target), bytes: file.bytes });
      existing.bytes += file.bytes;
      // Si dentro de una misma carpeta destino confluyen orígenes distintos,
      // no se puede resumir con uno solo: mejor no enseñar ninguno que
      // enseñar el equivocado.
      if (existing.from && existing.from !== sourceDir) existing.from = null;
      continue;
    }
    groups.set(dir, {
      dir,
      from: sourceDir && sourceDir !== dir ? sourceDir : null,
      files: [{ name: nameOf(file.target), bytes: file.bytes }],
      bytes: file.bytes,
    });
  }

  return [...groups.values()];
};

// La carpeta madre que comparten TODAS las del plan. Es lo que permite
// decirla una sola vez en la cabecera y que cada fila sea solo lo que cambia.
const commonRoot = (dirs: string[]): string => {
  if (dirs.length === 0) return '';
  const lists = dirs.map((dir) => dir.split('/'));
  const [first, ...rest] = lists;
  const shared: string[] = [];
  for (let index = 0; index < first.length; index++) {
    const part = first[index];
    if (!rest.every((list) => list[index]?.toLowerCase() === part.toLowerCase())) break;
    shared.push(part);
  }
  // Una raíz de un solo segmento ("C:") no factoriza nada útil.
  return shared.length > 1 ? shared.join('/') : '';
};

// Una carpeta del plan, plegable. Plegada por defecto cuando hay varias: lo
// que se decide aquí es DÓNDE va a escribir, y para eso mandan las carpetas;
// los nombres de archivo son el detalle que se consulta si hace falta. Con
// una sola carpeta se abre de entrada, porque plegar lo único que hay solo
// añade un clic.
const PlanGroupRow = ({
  group,
  label,
  soloGroup,
}: {
  group: PlanGroup;
  // La ruta RELATIVA a la raíz común de la cabecera — lo único que distingue
  // esta carpeta de las demás, que es justo lo que hay que leer.
  label: string;
  soloGroup: boolean;
}): React.JSX.Element => {
  const [open, setOpen] = useState(soloGroup);
  const visible = group.files.slice(0, MAX_FILES_PER_GROUP);

  return (
    <div className="min-w-0">
      {group.from && (
        <div className="mt-1 mb-0.5 flex min-w-0 items-center gap-1.25 px-2">
          <span className="flex-none text-[9.5px] font-bold tracking-[.1em] text-muted-foreground">
            FROM
          </span>
          <span
            className="truncate font-mono text-[10px] text-muted-foreground/80"
            title={group.from}
          >
            {group.from}
          </span>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full min-w-0 items-center gap-2 rounded-[8px] px-2 py-1.5 text-left transition-colors duration-150 hover:bg-white/[0.04]"
      >
        <ChevronDown
          size={11}
          className="flex-none text-muted-foreground transition-transform duration-150"
          style={open ? undefined : { transform: 'rotate(-90deg)' }}
        />
        <span
          className="flex h-6 w-6 flex-none items-center justify-center rounded-[7px]"
          style={{ background: `${BLUE}1a` }}
        >
          {group.from ? (
            <ArrowRight size={12} style={{ color: BLUE }} />
          ) : (
            <Folder size={12} style={{ color: BLUE }} />
          )}
        </span>
        <span
          className="min-w-0 flex-1 truncate text-[12px] font-semibold text-foreground"
          title={group.dir}
        >
          {label}
        </span>
        <span className="flex-none text-[10px] text-muted-foreground tabular-nums">
          {pluralize(group.files.length, 'file')} · {formatBytes(group.bytes)}
        </span>
      </button>

      {open && (
        <div className="mt-0.5 mb-1.5 ml-5 flex flex-col gap-0.5 border-l border-white/8 pt-0.5 pl-4">
          {visible.map((file) => (
            <div key={file.name} className="flex min-w-0 items-center gap-2">
              <span
                className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-muted-foreground"
                title={file.name}
              >
                {file.name}
              </span>
              <span className="flex-none text-[9.5px] text-muted-foreground/60 tabular-nums">
                {formatBytes(file.bytes)}
              </span>
            </div>
          ))}
          {group.files.length > visible.length && (
            <span className="text-[10px] text-muted-foreground/70">
              and {group.files.length - visible.length} more in this folder
            </span>
          )}
        </div>
      )}
    </div>
  );
};

// El plan real, tal cual lo devuelve ludusavi: cada archivo con su ruta
// final y de dónde sale. Es lo que hace que confirmar sea una decisión
// informada en vez de un acto de fe.
//
// La raíz común de todas las carpetas se dice UNA vez, como cabecera del
// panel, y cada fila muestra solo su tramo propio. Antes, seis filas
// repetían el mismo prefijo kilométrico truncado y lo único que las
// distinguía quedaba cortado por la derecha.
const Plan = ({ plan }: { plan: RestoreResult }): React.JSX.Element => {
  const groups = groupPlan(plan.files);
  const root = commonRoot(groups.map((group) => group.dir));
  const labelOf = (dir: string): string =>
    root ? (dir.toLowerCase() === root.toLowerCase() ? '/' : dir.slice(root.length + 1)) : dir;

  return (
    <div className="flex flex-col gap-2.5">
      {plan.warnings.map((warning) => (
        <div
          key={warning}
          className="flex items-start gap-1.75 rounded-[9px] px-3 py-2 text-[11.5px] leading-relaxed"
          style={{ background: `${AMBER}12`, color: AMBER }}
        >
          <TriangleAlert size={13} className="mt-0.5 flex-none" />
          <span>{warning}</span>
        </div>
      ))}

      {plan.files.length === 0 ? (
        <div className="rounded-[9px] border border-border bg-white/[0.02] px-3 py-2.5 text-[12px] text-muted-foreground">
          Nothing to write — this backup matches what&apos;s already on disk.
        </div>
      ) : (
        <div className="overflow-hidden rounded-[10px] border border-border bg-white/[0.02]">
          {/* Cabecera: la carpeta madre + los totales, con el mismo lavado de
              color que las cabeceras de card. Es la respuesta a "¿dónde va a
              escribir?" en una sola línea. */}
          <div
            className="flex items-center gap-2.5 border-b px-3 py-2.5"
            style={{
              background: `linear-gradient(120deg, ${BLUE}14, transparent 65%)`,
              borderColor: `${BLUE}1f`,
            }}
          >
            <span
              className="flex h-7 w-7 flex-none items-center justify-center rounded-[8px]"
              style={{ background: `${BLUE}24`, border: `1px solid ${BLUE}3d` }}
            >
              <FolderDown size={14} style={{ color: BLUE }} />
            </span>
            <div className="min-w-0 flex-1">
              <div
                className="text-[9.5px] font-bold tracking-[.12em]"
                style={{ color: `${BLUE}b3` }}
              >
                WRITES INTO
              </div>
              {/* dir=rtl + truncate: una ruta se corta por la IZQUIERDA, que
                  es donde está lo que menos distingue — el final es lo que
                  importa. El bdi evita que el rtl reordene los segmentos. */}
              <div
                className="truncate font-mono text-[11px] text-foreground"
                style={{ direction: 'rtl', textAlign: 'left' }}
                title={root || undefined}
              >
                <bdi>{root || 'Several places on this PC'}</bdi>
              </div>
            </div>
            <div className="flex-none text-right">
              <div className="text-[12.5px] font-extrabold tabular-nums" style={{ color: BLUE }}>
                {formatBytes(plan.totalBytes)}
              </div>
              <div className="text-[9.5px] text-muted-foreground tabular-nums">
                {pluralize(plan.files.length, 'file')}
                {groups.length > 1 && ` · ${groups.length} folders`}
              </div>
            </div>
          </div>

          <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto px-1.5 py-1.5">
            {groups.map((group) => (
              <PlanGroupRow
                key={group.dir}
                group={group}
                label={labelOf(group.dir)}
                soloGroup={groups.length === 1}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
