import { Trophy } from 'lucide-react';
import { useImageSrc } from '../../hooks/useImageSrc';
import { isRare, percentLabel, rarityAccent } from '../../lib/achievements';

// Los trofeos de UNA sesión, como pieza compartida (LOGROS-IDEAS.md §2.1):
// la píldora con la cuenta —teñida del más raro de la tanda, el mismo
// lenguaje que las píldoras de momentos de SessionRow— y los ICONOS de
// verdad al lado, que son lo que convierte la fila en un recuerdo con caras
// en vez de un número. La usan la pantalla de Sesiones, el historial de la
// ficha y el aviso de cierre.

// Forma mínima a propósito: AchievementEntry y SessionUnlock encajan los dos
// por estructura, sin adaptadores.
export type SessionAchievementEntry = {
  displayName: string;
  iconUrl: string | null;
  globalPercent: number | null;
};

// Iconos visibles antes del "+N" — una noche normal deja 1-3; el arrastre de
// un catálogo recuperado puede dejar veinte y la fila no es el sitio para
// desfilarlos todos.
const MAX_ICONS = 5;

// Exportado aparte: el aviso de cierre compone su propia banda (que ya dice
// la cuenta) y solo quiere los iconos.
export const AchievementMiniIcon = ({
  entry,
}: {
  entry: SessionAchievementEntry;
}): React.JSX.Element => {
  const src = useImageSrc(entry.iconUrl, 'achievements');
  const rare = isRare(entry.globalPercent);
  const accent = rarityAccent(entry.globalPercent);
  return (
    <div
      title={`${entry.displayName}${
        entry.globalPercent !== null ? ` · ${percentLabel(entry.globalPercent)} of players` : ''
      }`}
      className="h-5.5 w-5.5 flex-none overflow-hidden rounded-[5px]"
      // El aro de color solo en los raros — el mismo "se gana, no se regala"
      // de la vitrina.
      style={{
        boxShadow: `inset 0 0 0 1px ${rare ? `${accent}99` : 'rgba(255,255,255,.12)'}`,
      }}
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-muted">
          <Trophy size={9} className="text-muted-foreground/40" />
        </div>
      )}
    </div>
  );
};

export const SessionAchievements = ({
  entries,
}: {
  entries: SessionAchievementEntry[];
}): React.JSX.Element | null => {
  if (entries.length === 0) return null;

  // Los más raros primero: son los que merecen la cara visible si hay "+N".
  const sorted = [...entries].sort(
    (a, b) =>
      (a.globalPercent ?? Number.POSITIVE_INFINITY) - (b.globalPercent ?? Number.POSITIVE_INFINITY),
  );
  const accent = rarityAccent(sorted[0]?.globalPercent ?? null);
  const shown = sorted.slice(0, MAX_ICONS);
  const hidden = sorted.length - shown.length;

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <span
        className="flex items-center gap-1 rounded-full px-2 py-0.75 text-[9.5px] font-bold tracking-[.02em]"
        style={{
          color: accent,
          background: `${accent}14`,
          boxShadow: `inset 0 0 0 1px ${accent}33`,
        }}
        title={sorted.map((entry) => entry.displayName).join(' · ')}
      >
        <Trophy size={10} className="flex-none" />
        {entries.length === 1 ? 'Achievement' : `${entries.length} achievements`}
      </span>
      {shown.map((entry) => (
        <AchievementMiniIcon key={entry.displayName} entry={entry} />
      ))}
      {hidden > 0 && (
        <span className="text-[9.5px] font-bold text-muted-foreground/60 tabular-nums">
          +{hidden}
        </span>
      )}
    </div>
  );
};
