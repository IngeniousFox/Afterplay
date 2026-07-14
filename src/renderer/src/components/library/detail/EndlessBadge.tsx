import { Infinity as InfinityIcon } from 'lucide-react';

// SPEC 10.7 / prototipo — sustituye la card "Playthrough" en el sidebar
// cuando el juego es endless: no hay playthroughs que completar, solo
// sesiones sueltas.
export const EndlessBadge = (): React.JSX.Element => (
  <div className="flex items-center gap-3 rounded-[14px] border border-border bg-card px-5 py-4">
    <InfinityIcon size={20} className="flex-none" color="#7c86c8" />
    <div>
      <div className="text-[13px] font-bold text-foreground">Endless game</div>
      <div className="mt-0.25 text-xs text-muted-foreground">
        No playthroughs to complete — tracked by sessions.
      </div>
    </div>
  </div>
);
