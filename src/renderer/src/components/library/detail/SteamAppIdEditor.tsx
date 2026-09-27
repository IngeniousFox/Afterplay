import { useQueryClient } from '@tanstack/react-query';
import { Hash } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { GameDetail } from '../../../../../shared/types';
import { queryKeys } from '../../../hooks/queryKeys';
import { AMBER } from '../../../lib/colors';
import { ModalFooter, ModalShell } from '../../ui/modal-shell';
import { fieldLabelClass, textInputClass, textInputFocusClass } from '../add-game/styles';

export const SteamAppIdEditor = ({
  game,
  onClose,
}: {
  game: GameDetail;
  onClose: () => void;
}): React.JSX.Element => {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(game.steamAppId?.toString() ?? '');
  const [saving, setSaving] = useState(false);
  const appId = Number(value.trim());
  const valid =
    /^[1-9]\d*$/.test(value.trim()) && Number.isSafeInteger(appId) && appId <= 0xffffffff;

  const save = async (): Promise<void> => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await window.api.games.setSteamAppId(game.id, appId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.games.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.achievements.all }),
      ]);
      toast.success('Steam App ID saved');
      onClose();
    } catch (error) {
      console.error('[steam-app-id] failed to save:', error);
      toast.error("Couldn't save the Steam App ID.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      open
      onClose={onClose}
      title="Steam App ID"
      icon={Hash}
      color={AMBER}
      widthClass="w-112"
      footer={
        <ModalFooter
          onCancel={onClose}
          onSubmit={() => void save()}
          submitting={saving}
          submitLabel="Save App ID"
          submittingLabel="Saving…"
        />
      }
    >
      <label htmlFor="steam-app-id" className={fieldLabelClass}>
        STEAM APP ID
      </label>
      <input
        id="steam-app-id"
        inputMode="numeric"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Enter the correct App ID"
        className={`${textInputClass} ${textInputFocusClass} font-mono tabular-nums`}
      />
      {!valid && value.trim() !== '' && (
        <p className="mt-2 text-[12px] text-destructive">Enter a valid numeric App ID.</p>
      )}
      <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
        Afterplay will use this ID and resync achievements from Steam and local game files.
      </p>
    </ModalShell>
  );
};
