import { useFormContext, useWatch } from 'react-hook-form';
import type { StatusKey } from '../../../lib/gameStatus';
import { STATUS_META } from '../../../lib/gameStatus';
import type { AddGameFormValues } from './types';

export const StatusSummaryLine = (): React.JSX.Element => {
  const { control } = useFormContext<AddGameFormValues>();
  const endless = useWatch({ control, name: 'endless' });
  const playedBefore = useWatch({ control, name: 'playedBefore' });
  const pastStatus = useWatch({ control, name: 'pastStatus' });

  const willStatus: StatusKey = playedBefore ? pastStatus : endless ? 'resting' : 'unplayed';
  const meta = STATUS_META[willStatus];

  // Teñida del color del estado (borde/fondo al mínimo, icono en su propio
  // chip) — es el resumen de todo el formulario, merece destacar del gris.
  return (
    <div
      className="flex items-center gap-2.5 rounded-[10px] border px-3.25 py-2.5 transition-colors duration-300"
      style={{ borderColor: `${meta.color}2e`, background: `${meta.color}0d` }}
    >
      <span
        className="flex h-6.5 w-6.5 flex-none items-center justify-center rounded-full"
        style={{ background: `${meta.color}1a` }}
      >
        <meta.Icon size={14} color={meta.color} />
      </span>
      <span className="text-[12.5px] text-muted-foreground">
        Will be added with status{' '}
        <span className="font-bold" style={{ color: meta.color }}>
          {meta.label}
        </span>
      </span>
    </div>
  );
};
