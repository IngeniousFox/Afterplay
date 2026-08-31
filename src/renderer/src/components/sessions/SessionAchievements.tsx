import { Trophy } from 'lucide-react';
import { useImageSrc } from '../../hooks/useImageSrc';
import { isRare, percentLabel, rarityAccent } from '../../lib/achievements';

// Los trofeos de UNA sesión, como pieza compartida (LOGROS-IDEAS.md §2.1):
// la píldora con la cuenta —teñida del más raro de la tanda, el mismo
// lenguaje que las píldoras de momentos de SessionRow— y los ICONOS de
// verdad al lado, que son lo que convierte la fila en un recuerdo con caras
// en vez de un número. La usan la pantalla de Sesiones, el historial de la
// ficha y el aviso de cierre.
//
// Desde el rediseño (LOGROS-REDISENO §1) cada icono es además un ENLACE a su
// logro: quien lo pulsa aterriza en la sección de logros de la ficha con esa
// fila desplegada y parpadeando en dorado (ver lib/achievementFlash). Por eso
// el id viaja en la entrada — opcional, porque quien no lo tenga (o no quiera
// enlazar) pinta el icono de siempre, quieto.

// Forma mínima a propósito: AchievementEntry y SessionUnlock encajan casi
// enteros por estructura. El id NO se puede unificar por estructura (uno lo
// llama `id`, el otro `achievementId`), así que viaja explícito.
export type SessionAchievementEntry = {
  achievementId?: number;
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
  onOpen,
}: {
  entry: SessionAchievementEntry;
  // Con onOpen (y un id que abrir), el icono es un botón que navega al
  // logro; sin él, la miniatura decorativa de siempre.
  onOpen?: (achievementId: number) => void;
}): React.JSX.Element => {
  const src = useImageSrc(entry.iconUrl, 'achievements');
  const rare = isRare(entry.globalPercent);
  const accent = rarityAccent(entry.globalPercent);
  const canOpen = onOpen !== undefined && entry.achievementId !== undefined;

  const face = src ? (
    <img src={src} alt="" className="h-full w-full object-cover" />
  ) : (
    <div className="flex h-full w-full items-center justify-center bg-muted">
      <Trophy size={9} className="text-muted-foreground/40" />
    </div>
  );

  const title = `${entry.displayName}${
    entry.globalPercent !== null ? ` · ${percentLabel(entry.globalPercent)} of players` : ''
  }${canOpen ? ' — click to open' : ''}`;

  // El aro de color solo en los raros — el mismo "se gana, no se regala"
  // de la vitrina.
  const ring = `inset 0 0 0 1px ${rare ? `${accent}99` : 'rgba(255,255,255,.12)'}`;

  if (!canOpen) {
    return (
      <div
        title={title}
        className="h-5.5 w-5.5 flex-none overflow-hidden rounded-[5px]"
        style={{ boxShadow: ring }}
      >
        {face}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(entry.achievementId as number)}
      title={title}
      aria-label={`Open achievement: ${entry.displayName}`}
      // La crecida y la sombra al pasar son lo que dice "esto se pulsa" sin
      // añadir un solo pixel en reposo: quieta, es idéntica a la decorativa.
      className="h-5.5 w-5.5 flex-none cursor-pointer overflow-hidden rounded-[5px] border-0 bg-transparent p-0 transition-[transform,box-shadow] duration-150 ease-[cubic-bezier(.2,.7,.3,1)] hover:-translate-y-0.5 hover:scale-110"
      style={{ boxShadow: ring }}
      onMouseEnter={(event) => {
        // El aro sube a pleno color bajo el ratón — también en los comunes,
        // que en reposo van neutros: la invitación es del gesto, no del rango.
        event.currentTarget.style.boxShadow = `inset 0 0 0 1px ${accent}, 0 5px 12px rgba(0,0,0,.5)`;
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.boxShadow = ring;
      }}
    >
      {face}
    </button>
  );
};

export const SessionAchievements = ({
  entries,
  onOpen,
}: {
  entries: SessionAchievementEntry[];
  onOpen?: (achievementId: number) => void;
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
        <AchievementMiniIcon key={entry.displayName} entry={entry} onOpen={onOpen} />
      ))}
      {hidden > 0 && (
        <span className="text-[9.5px] font-bold text-muted-foreground/60 tabular-nums">
          +{hidden}
        </span>
      )}
    </div>
  );
};
