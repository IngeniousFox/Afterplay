import { Infinity as InfinityIcon } from 'lucide-react';

const VIOLET = '#7c86c8';

// SPEC 10.7 / prototipo — sustituye la card "Playthrough" en el sidebar
// cuando el juego es endless: no hay playthroughs que completar, solo
// sesiones sueltas. Mismo lenguaje que el banner de Status (degradado del
// color propio) para que no cante al ir uno encima del otro.
export const EndlessBadge = (): React.JSX.Element => (
  <div
    className="flex items-center gap-3.5 rounded-[14px] border px-5 py-4"
    style={{
      borderColor: `${VIOLET}2e`,
      background: `linear-gradient(135deg, ${VIOLET}1a, ${VIOLET}08 60%, transparent)`,
    }}
  >
    <div
      className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px]"
      style={{ background: `${VIOLET}24`, border: `1px solid ${VIOLET}3d` }}
    >
      <InfinityIcon size={20} color={VIOLET} />
    </div>
    <div>
      <div className="text-[13.5px] font-bold" style={{ color: VIOLET }}>
        Endless game
      </div>
      <div className="mt-0.25 text-xs text-muted-foreground">
        No playthroughs to complete — tracked by sessions.
      </div>
    </div>
  </div>
);
