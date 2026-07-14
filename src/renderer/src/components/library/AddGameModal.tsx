import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Controller, FormProvider, useForm, useWatch } from 'react-hook-form';
import type { IgdbSearchResult } from '../../../../shared/types';
import { useCreateGameWithDetails } from '../../hooks/games';
import { useIgdbSearch } from '../../hooks/igdb';
import { Dialog, DialogContent } from '../ui/dialog';
import { AddGameImagesField } from './add-game/AddGameImagesField';
import { CheckboxRow } from './add-game/CheckboxRow';
import type { CoverPickerTarget } from './add-game/CoverPicker';
import { CoverPicker } from './add-game/CoverPicker';
import { Dropdown } from './add-game/Dropdown';
import { ExecutablePathField } from './add-game/ExecutablePathField';
import { GameNotesPanel } from './add-game/GameNotesPanel';
import { InstallDirectoryField } from './add-game/InstallDirectoryField';
import { PlayedBeforePanel } from './add-game/PlayedBeforePanel';
import { SearchStep } from './add-game/SearchStep';
import { SegmentedButtonGroup } from './add-game/SegmentedButtonGroup';
import { SelectedGameSummary } from './add-game/SelectedGameSummary';
import { StatusSummaryLine } from './add-game/StatusSummaryLine';
import { fieldLabelClass, textInputClass } from './add-game/styles';
import type { AddGameFormValues } from './add-game/types';
import {
  DEFAULT_FORM_VALUES,
  ENDLESS_STATUS_OPTIONS,
  FORMAT_OPTIONS,
  NORMAL_STATUS_OPTIONS,
  ORIGIN_OPTIONS,
  PLATFORM_OPTIONS,
  STATUS_TO_STATE_TYPE,
} from './add-game/types';

type AddGameModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const toBackendDate = (
  value: AddGameFormValues['started'],
): { date: Date; precision: 'year' | 'month' | 'day' } | null =>
  value ? { date: new Date(value.isoDate), precision: value.precision } : null;

const parseOptionalNumber = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isNaN(value) ? null : value;
};

export const AddGameModal = ({ open, onOpenChange }: AddGameModalProps): React.JSX.Element => {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<IgdbSearchResult | null>(null);
  const [pickerTarget, setPickerTarget] = useState<CoverPickerTarget | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);

  const methods = useForm<AddGameFormValues>({ defaultValues: DEFAULT_FORM_VALUES });
  const { control, setValue, getValues, reset: resetForm } = methods;
  const endless = useWatch({ control, name: 'endless' });
  const playedBefore = useWatch({ control, name: 'playedBefore' });
  const origin = useWatch({ control, name: 'origin' });

  const search = useIgdbSearch(query);
  const createGame = useCreateGameWithDetails();

  const resetAll = (): void => {
    setQuery('');
    setSelected(null);
    setPickerTarget(null);
    setNotesOpen(false);
    resetForm(DEFAULT_FORM_VALUES);
    createGame.reset();
  };

  const handleClose = (): void => {
    if (createGame.isPending) return;
    resetAll();
    onOpenChange(false);
  };

  // Cambiar endless puede dejar pastStatus apuntando a una opción que ya no
  // existe en el dropdown (ej. "Beaten" al activar endless) — se corrige aquí
  // en vez de dejar que el Status muestre un valor fuera de su propia lista.
  const handleEndlessToggle = (checked: boolean): void => {
    setValue('endless', checked);
    const nextOptions = checked ? ENDLESS_STATUS_OPTIONS : NORMAL_STATUS_OPTIONS;
    if (!nextOptions.includes(getValues('pastStatus'))) {
      setValue('pastStatus', nextOptions[0]);
    }
  };

  const handleSave = async (): Promise<void> => {
    if (!selected) return;
    const values = getValues();

    const initialStatus = values.playedBefore
      ? STATUS_TO_STATE_TYPE[values.pastStatus]
      : values.endless
        ? 'resting'
        : null;

    await createGame.mutateAsync({
      igdbId: selected.igdbId,
      endless: values.endless,
      iteration: {
        playedPlatform: values.platform,
        origin: values.origin,
        format: values.format,
      },
      hoursPlayed: values.playedBefore ? parseOptionalNumber(values.hoursPlayed) : null,
      started: values.playedBefore && !values.endless ? toBackendDate(values.started) : null,
      finished: values.playedBefore && !values.endless ? toBackendDate(values.finished) : null,
      initialStatus,
      note: values.note.trim() || null,
      gameNotes: values.gameNotes.trim() || null,
      moneySpent: values.origin === 'Purchased' ? parseOptionalNumber(values.moneySpent) : null,
      executablePath: values.executablePath.trim() || null,
      installDirectory: values.installDirectory.trim() || null,
      installSizeBytes: values.installDirectory.trim() ? values.installSizeBytes : null,
      coverUrl: values.coverUrl,
      heroUrl: values.heroUrl,
    });

    resetAll();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[80vh] w-160 max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-[18px] border border-input bg-[#121413] p-0 shadow-[0_30px_80px_rgba(0,0,0,.6)] sm:max-w-[calc(100%-2rem)]"
      >
        <div className="flex items-center justify-between border-b border-border px-5.5 py-4.5">
          <div>
            <div className="text-[17px] font-extrabold tracking-[-.01em] text-foreground">
              Add game
            </div>
            <div className="mt-0.5 text-[12.5px] text-muted-foreground">
              Search the catalog, then fill the details
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="flex h-8.5 w-8.5 flex-none items-center justify-center rounded-[9px] border border-border bg-white/3 text-foreground"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-5.5 py-5">
          {selected === null ? (
            <SearchStep
              query={query}
              onQueryChange={setQuery}
              isLoading={search.isLoading}
              results={search.data}
              onSelect={setSelected}
            />
          ) : pickerTarget !== null ? (
            <CoverPicker
              target={pickerTarget}
              igdbId={selected.igdbId}
              title={selected.title}
              releaseYear={selected.releaseYear}
              onSelect={(url) => {
                setValue(pickerTarget === 'cover' ? 'coverUrl' : 'heroUrl', url);
                setPickerTarget(null);
              }}
              onCancel={() => setPickerTarget(null)}
            />
          ) : (
            <FormProvider {...methods}>
              <SelectedGameSummary
                selected={selected}
                onChangeSelection={() => {
                  setSelected(null);
                  setValue('coverUrl', null);
                  setValue('heroUrl', null);
                }}
              />

              <div className="mt-4.5 flex flex-col gap-4">
                <AddGameImagesField selected={selected} onPick={setPickerTarget} />
                <div>
                  <div className={fieldLabelClass}>PLATFORM YOU PLAY ON</div>
                  <Controller
                    control={control}
                    name="platform"
                    render={({ field }) => (
                      <Dropdown
                        value={field.value}
                        options={PLATFORM_OPTIONS}
                        onChange={field.onChange}
                        renderOption={(option) => option}
                      />
                    )}
                  />
                </div>

                <div>
                  <div className={fieldLabelClass}>ORIGIN</div>
                  <Controller
                    control={control}
                    name="origin"
                    render={({ field }) => (
                      <SegmentedButtonGroup
                        value={field.value}
                        options={ORIGIN_OPTIONS.map((option) => ({ value: option, label: option }))}
                        onChange={field.onChange}
                        wrap
                      />
                    )}
                  />
                </div>

                <div>
                  <div className={fieldLabelClass}>FORMAT</div>
                  <Controller
                    control={control}
                    name="format"
                    render={({ field }) => (
                      <SegmentedButtonGroup
                        value={field.value}
                        options={FORMAT_OPTIONS}
                        onChange={field.onChange}
                      />
                    )}
                  />
                </div>

                {origin === 'Purchased' && (
                  <div>
                    <div className={fieldLabelClass}>
                      MONEY SPENT (€){' '}
                      <span className="font-medium tracking-normal normal-case">
                        · saved as a purchase
                      </span>
                    </div>
                    <Controller
                      control={control}
                      name="moneySpent"
                      render={({ field }) => (
                        <input
                          {...field}
                          type="number"
                          min={0}
                          step="0.01"
                          placeholder="0.00"
                          className={textInputClass}
                        />
                      )}
                    />
                  </div>
                )}

                <CheckboxRow
                  checked={endless}
                  onToggle={() => handleEndlessToggle(!endless)}
                  title="Endless game"
                  description={`No ending (Minecraft, Factorio…). Hides "Complete", never counts as backlog.`}
                  borderColorChecked="rgba(47,220,126,.7)"
                  fillColorChecked="#2fdc7e"
                  checkIconColor="#08120c"
                />

                <CheckboxRow
                  checked={playedBefore}
                  onToggle={() => setValue('playedBefore', !playedBefore)}
                  title="I played this before, outside the app"
                  description={
                    endless
                      ? 'Log the hours you already put in instead of starting fresh.'
                      : 'Add a past playthrough with your own dates instead of starting as Unplayed.'
                  }
                  borderColorChecked="rgba(133,163,214,.6)"
                  fillColorChecked="#85a3d6"
                  checkIconColor="#0a0b0a"
                  rowBorderFollowsChecked
                />

                {playedBefore && <PlayedBeforePanel />}

                <ExecutablePathField />

                <InstallDirectoryField />

                <div>
                  <CheckboxRow
                    checked={notesOpen}
                    onToggle={() => setNotesOpen(!notesOpen)}
                    title="Add notes"
                    description="Personal notes about this game — markdown supported."
                    borderColorChecked="rgba(133,163,214,.6)"
                    fillColorChecked="#85a3d6"
                    checkIconColor="#0a0b0a"
                  />
                  {notesOpen && (
                    <div className="mt-2.75">
                      <GameNotesPanel />
                    </div>
                  )}
                </div>

                <div>
                  <div className={fieldLabelClass}>
                    NOTE{' '}
                    <span className="font-medium tracking-normal normal-case">
                      · saved to status history
                    </span>
                  </div>
                  <Controller
                    control={control}
                    name="note"
                    render={({ field }) => (
                      <input
                        {...field}
                        placeholder="e.g. Birthday gift · GOG winter sale…"
                        className={textInputClass}
                      />
                    )}
                  />
                </div>

                <StatusSummaryLine />

                {createGame.isError && (
                  <div className="rounded-[10px] border border-destructive/40 bg-destructive/10 px-3.25 py-2.5 text-[12.5px] text-destructive">
                    Couldn&apos;t add the game — {createGame.error.message}
                  </div>
                )}
              </div>
            </FormProvider>
          )}
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-border px-5.5 py-4">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-[10px] border border-input bg-white/3 px-4.5 py-2.5 text-[13.5px] font-semibold text-foreground hover:bg-white/6"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!selected || createGame.isPending}
            className="flex items-center gap-2 rounded-[10px] px-5.5 py-2.5 text-[13.5px] font-bold disabled:cursor-not-allowed"
            style={
              selected
                ? { background: 'linear-gradient(135deg,#2fdc7e,#16a35a)', color: '#08120c' }
                : { background: 'rgba(255,255,255,.06)', color: '#888f8a', opacity: 0.6 }
            }
          >
            <Plus size={16} />
            <span>{createGame.isPending ? 'Adding…' : 'Add to library'}</span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
