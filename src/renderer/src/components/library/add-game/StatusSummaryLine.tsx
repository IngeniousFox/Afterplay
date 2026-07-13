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

  return (
    <div className="flex items-center gap-2.25 rounded-[10px] border border-border bg-white/3 px-3.25 py-2.5">
      <meta.Icon size={15} color={meta.color} />
      <span className="text-[12.5px] text-muted-foreground">
        Will be added with status{' '}
        <span className="font-bold" style={{ color: meta.color }}>
          {meta.label}
        </span>
      </span>
    </div>
  );
};
