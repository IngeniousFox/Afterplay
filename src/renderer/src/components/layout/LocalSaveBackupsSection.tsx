import { Archive, Check, Trash2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useCleanLocalBackups, useLocalBackupsUsage } from '../../hooks/saves';
import { AMBER, GRAY, TEAL } from '../../lib/colors';
import { formatBytes } from '../../lib/format';
import { SettingsCard } from './SettingsCard';
import { UsageBreakdownBar } from './UsageBreakdownBar';

// Ajustes → Save backups: qué ocupa en tu disco la carpeta de trabajo local
// de las copias de partidas (save-backups/), y el único botón que tiene
// sentido sobre ella — liberar lo prescindible.
//
// La carpeta NO es tu copia de seguridad: es la fuente desde la que se sube
// a R2, que es de donde SIEMPRE se restaura (nunca de aquí). Una vez algo
// está confirmado arriba, la copia local es pura caché de disco. Y como la
// retención de ludusavi solo poda versiones VIEJAS de un juego cuando llega
// una NUEVA para ESE MISMO juego, un juego que dejas de tocar —lo terminas,
// lo desinstalas, apagas su backup— se queda con su carpeta entera
// congelada para siempre: sin esto, nada lo vuelve a mirar jamás.

const buttonClass =
  'flex flex-none items-center gap-1.75 rounded-[9px] border border-input bg-white/[0.03] px-3.25 py-2 text-[12.5px] font-semibold text-foreground transition-colors duration-150 hover:border-primary/45 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50';

// Lo que dura la confirmación de la limpieza antes de devolverle el renglón
// al estado real — mismo criterio que ImagesSection y el mismo motivo: un
// resultado de un instante no puede vivir para siempre en el sitio del
// estado.
const CONFIRMATION_MS = 5000;

export const LocalSaveBackupsSection = (): React.JSX.Element => {
  const { data: usage } = useLocalBackupsUsage();
  const clean = useCleanLocalBackups();

  const [freed, setFreed] = useState<{ files: number; bytes: number; folders: number } | null>(
    null,
  );
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => clearTimeout(hideTimer.current ?? undefined), []);

  const handleClean = (): void => {
    clean.mutate(undefined, {
      onSuccess: (result) => {
        setFreed(result);
        clearTimeout(hideTimer.current ?? undefined);
        hideTimer.current = setTimeout(() => setFreed(null), CONFIRMATION_MS);
      },
    });
  };

  const reclaimableBytes = (usage?.reclaimableBytes ?? 0) + (usage?.orphanBytes ?? 0);

  const badge = ((): { text: string; color: string; icon?: LucideIcon } | null => {
    if (clean.isPending) return { text: 'Cleaning up…', color: AMBER };
    if (freed) {
      return freed.files === 0 && freed.folders === 0
        ? { text: 'Nothing to free', color: 'var(--muted-foreground)', icon: Check }
        : { text: `Freed ${formatBytes(freed.bytes)}`, color: TEAL, icon: Check };
    }
    if (!usage) return null;
    return reclaimableBytes > 0
      ? { text: `${formatBytes(reclaimableBytes)} reclaimable`, color: AMBER }
      : { text: 'All in use', color: 'var(--muted-foreground)' };
  })();

  // Reparto en dos: lo que se queda (mantiene una copia que aún no está
  // confirmada en la nube, o no hay nube configurada) y lo prescindible —
  // mismo lenguaje que Images: gris para lo que un clic se puede llevar. La
  // barra y la leyenda (con el hover de Status Breakdown) son la MISMA
  // UsageBreakdownBar que usa Images.
  const keptBytes = Math.max(0, (usage?.totalBytes ?? 0) - reclaimableBytes);
  const segments = usage
    ? [
        { key: 'kept', label: 'Still needed', bytes: keptBytes, color: TEAL },
        { key: 'reclaimable', label: 'Reclaimable', bytes: reclaimableBytes, color: GRAY },
      ].filter((segment) => segment.bytes > 0)
    : [];

  return (
    <SettingsCard
      layout="column"
      title="Local copies"
      description="The working copy of your cloud saves on this PC's disk. Restores always come from the cloud, so anything already uploaded — or left behind by deleted games — can be cleaned up safely."
      icon={Archive}
      color={TEAL}
      headerRight={
        <button
          type="button"
          onClick={handleClean}
          disabled={clean.isPending || usage === undefined || reclaimableBytes === 0}
          className={buttonClass}
        >
          <Trash2 size={14} />
          Clean up
        </button>
      }
    >
      <div className="flex flex-col gap-2.75">
        <div className="flex items-baseline justify-between gap-3 text-[11px]">
          <div className="flex items-baseline gap-1.5">
            <span className="font-semibold tabular-nums text-foreground">
              {usage ? formatBytes(usage.totalBytes) : '—'}
            </span>
            <span className="text-muted-foreground">
              {usage ? `across ${usage.totalFiles.toLocaleString()} files` : 'measuring…'}
            </span>
          </div>
          {badge && (
            <span
              className="flex flex-none items-center gap-1 font-semibold tabular-nums"
              style={{ color: badge.color }}
            >
              {badge.icon && <badge.icon size={11} strokeWidth={3} />}
              {badge.text}
            </span>
          )}
        </div>

        {segments.length > 0 ? (
          <UsageBreakdownBar segments={segments} />
        ) : (
          usage && (
            <div className="text-[11px] text-muted-foreground">
              Nothing here yet — this fills up once cloud backup uploads a first save.
            </div>
          )
        )}

        {/* Lo que un botón que borra ficheros tiene que decir ANTES de que
            lo pulses: qué se va y por qué eso no pierde ninguna versión. */}
        <div className="text-[10.5px] leading-[1.45] text-muted-foreground/70">
          Cleaning up removes local copies already confirmed in the cloud, plus folders no game
          claims anymore — never a version that only exists here.
        </div>
      </div>
    </SettingsCard>
  );
};
