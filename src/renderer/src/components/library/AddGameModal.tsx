import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Controller, FormProvider, useForm, useWatch } from 'react-hook-form';
import type { GameDetail, IgdbSearchResult } from '../../../../shared/types';
import {
  useCreateGameWithDetails,
  useCreatePlannedGame,
  usePromotePlannedGame,
} from '../../hooks/games';
import { useIgdbSearch } from '../../hooks/igdb';
import { useAddIteration } from '../../hooks/iterations';
import { useAddSession, useAssignSession } from '../../hooks/sessions';
import { useAddStateEvent } from '../../hooks/stateEvents';
import {
  ENDLESS_STATUS_OPTIONS,
  NORMAL_STATUS_OPTIONS,
  STATUS_TO_STATE_TYPE,
} from '../../lib/gameStatus';
import { accentGradientStyle } from '../../lib/styles';
import { ModalShell } from '../ui/modal-shell';
import { NumberInput } from '../ui/number-input';
import { AddGameImagesField } from './add-game/AddGameImagesField';
import { CheckboxRow } from './add-game/CheckboxRow';
import type { CoverPickerTarget } from './add-game/CoverPicker';
import { CoverPicker } from './add-game/CoverPicker';
import { DateWithPrecisionPicker } from './add-game/DateWithPrecisionPicker';
import { Dropdown } from './add-game/Dropdown';
import { ExecutablePathField } from './add-game/ExecutablePathField';
import { GameNotesPanel } from './add-game/GameNotesPanel';
import { InstallDirectoryField } from './add-game/InstallDirectoryField';
import { ManualPlaythroughsField } from './add-game/ManualPlaythroughsField';
import { PlayedBeforePanel } from './add-game/PlayedBeforePanel';
import { parseIsoDate, todayValue } from './add-game/precisionDate';
import { useCredentials } from '../../hooks/settings';
import { SearchStep } from './add-game/SearchStep';
import { SegmentedButtonGroup } from './add-game/SegmentedButtonGroup';
import { SelectedGameSummary } from './add-game/SelectedGameSummary';
import { StatusSummaryLine } from './add-game/StatusSummaryLine';
import { fieldLabelClass, textInputClass } from './add-game/styles';
import type { AddGameFormValues, ManualPlaythroughEntry } from './add-game/types';
import {
  DEFAULT_FORM_VALUES,
  FORMAT_OPTIONS,
  ORIGIN_SEGMENT_OPTIONS,
  parseOptionalNumber,
  PLATFORM_OPTIONS,
} from './add-game/types';

type AddGameModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // 'library' (por defecto): alta normal. 'plan': alta reducida — el juego
  // nace en la sección Plan to Play, así que todo lo de playthrough/gasto/
  // exe se oculta (eso se pregunta al pasarlo a la biblioteca de verdad).
  mode?: 'library' | 'plan';
  // Si viene, este modal ES el paso de un juego planeado a la biblioteca: la
  // búsqueda se salta (el juego ya está fijado), el formulario arranca
  // prellenado con lo que ya se sabe de él, y guardar llama a promote en
  // vez de crear un juego nuevo. Montar el modal SOLO cuando se abre — el
  // prellenado vive en los inicializadores de useState/useForm.
  promoteGame?: GameDetail;
  // Tras promocionar con éxito (el juego ya no está en el Plan) — para que
  // la pantalla dueña navegue a donde toque (su ficha de biblioteca).
  onPromoted?: () => void;
  // EMULADORES.md §6 — flujo "+ Add new game" desde el modal de asignación:
  // el checkbox de emulado arranca premarcado…
  defaultEmulated?: boolean;
  // …y al crear el juego, esta sesión pendiente se le asigna sola (montar
  // el modal solo al abrirlo, igual que promoteGame — el prellenado vive en
  // los inicializadores).
  assignSessionId?: number;
};

// parseIsoDate (medianoche LOCAL) y no new Date(isoDate) a secas: ese parseo
// interpreta la fecha como medianoche UTC y era la única vía de guardado de
// la app que difería del resto (Edit Game, gastos, historial ya guardaban en
// local) — misma fecha elegida, timestamps distintos según el modal.
const toBackendDate = (
  value: AddGameFormValues['started'],
): { date: Date; precision: 'year' | 'month' | 'day' } | null =>
  value ? { date: parseIsoDate(value.isoDate), precision: value.precision } : null;

export const AddGameModal = ({
  open,
  onOpenChange,
  mode = 'library',
  promoteGame,
  onPromoted,
  defaultEmulated = false,
  assignSessionId,
}: AddGameModalProps): React.JSX.Element => {
  const isPlan = mode === 'plan';
  const isPromote = promoteGame != null;
  // El playthrough por defecto que createPlannedGame dejó creado — de él
  // salen los valores iniciales de plataforma/origen/formato del prellenado.
  const promoteIteration = promoteGame?.iterations[0];

  // Sin las claves de Twitch/IGDB no hay catálogo que buscar — se enseña un
  // aviso con el porqué en vez del buscador mudo (la búsqueda fallaría en
  // silencio). Solo aplica al alta nueva: promover un Plan ya trae el juego.
  const { data: credentials } = useCredentials();
  const igdbReady = Boolean(credentials?.twitchClientId && credentials?.twitchClientSecret);

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<IgdbSearchResult | null>(() =>
    promoteGame
      ? {
          igdbId: promoteGame.igdbId,
          title: promoteGame.title,
          coverUrl: promoteGame.coverUrl,
          releaseYear: promoteGame.releaseYear,
          platforms: promoteGame.officialPlatforms ?? [],
          genres: promoteGame.genres ?? [],
          summary: null,
        }
      : null,
  );
  const [pickerTarget, setPickerTarget] = useState<CoverPickerTarget | null>(null);
  const [notesOpen, setNotesOpen] = useState(() => Boolean(promoteGame?.notes));

  const methods = useForm<AddGameFormValues>({
    defaultValues: promoteGame
      ? {
          ...DEFAULT_FORM_VALUES,
          platform: promoteIteration?.playedPlatform ?? DEFAULT_FORM_VALUES.platform,
          origin: promoteIteration?.origin ?? DEFAULT_FORM_VALUES.origin,
          format: promoteIteration?.format ?? DEFAULT_FORM_VALUES.format,
          endless: promoteGame.endless,
          isEmulated: promoteGame.isEmulated,
          executablePath: promoteGame.executablePath ?? '',
          installDirectory: promoteGame.installDirectory ?? '',
          installSizeBytes: promoteGame.installSizeBytes,
          gameNotes: promoteGame.notes ?? '',
          coverUrl: promoteGame.coverUrl,
          heroUrl: promoteGame.heroUrl,
          steamGridDbId: promoteGame.steamGridDbId,
          moneySpentDate: todayValue(),
        }
      : {
          ...DEFAULT_FORM_VALUES,
          moneySpentDate: todayValue(),
          ...(defaultEmulated ? { isEmulated: true, platform: 'Emulated' } : {}),
        },
  });
  const { control, setValue, getValues, reset: resetForm } = methods;
  const endless = useWatch({ control, name: 'endless' });
  const isEmulated = useWatch({ control, name: 'isEmulated' });
  const playedBefore = useWatch({ control, name: 'playedBefore' });
  const origin = useWatch({ control, name: 'origin' });
  // Leído aquí (no solo dentro de AddGameImagesField) porque el CoverPicker
  // se pinta como hermano del FormProvider, no dentro de él.
  const steamGridDbId = useWatch({ control, name: 'steamGridDbId' });

  const search = useIgdbSearch(query);
  const createGame = useCreateGameWithDetails();
  const createPlanned = useCreatePlannedGame();
  const promote = usePromotePlannedGame();
  const assignSession = useAssignSession();
  // Playthroughs manuales de más (allá del primero, ya cubierto por
  // createGame/promote) — mismas mutations que EditGameModal usa para su
  // modo "+ Add manual" (ver addManualPlaythrough más abajo).
  const addIteration = useAddIteration();
  const addSession = useAddSession();
  const addStateEvent = useAddStateEvent();
  const activeMutation = isPromote ? promote : isPlan ? createPlanned : createGame;
  const isSaving =
    activeMutation.isPending ||
    assignSession.isPending ||
    addIteration.isPending ||
    addSession.isPending ||
    addStateEvent.isPending;

  const resetAll = (): void => {
    setQuery('');
    setSelected(null);
    setPickerTarget(null);
    setNotesOpen(false);
    resetForm({ ...DEFAULT_FORM_VALUES, moneySpentDate: todayValue() });
    createGame.reset();
    createPlanned.reset();
    promote.reset();
  };

  const handleClose = (): void => {
    if (isSaving) return;
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

  // EMULADORES.md §5 — marcar "Emulated game" preselecciona la plataforma
  // "Emulated" (coherencia sin esfuerzo); desmarcarlo la devuelve al default
  // solo si nadie la tocó entremedias.
  const handleEmulatedToggle = (checked: boolean): void => {
    setValue('isEmulated', checked);
    if (checked && getValues('platform') !== 'Emulated') {
      setValue('platform', 'Emulated');
    } else if (!checked && getValues('platform') === 'Emulated') {
      setValue('platform', DEFAULT_FORM_VALUES.platform);
    }
  };

  // Un playthrough manual DE MÁS, más allá del primero (que createGame/
  // promote ya crean junto al propio juego) — mismo guion que EditGameModal
  // usa en su modo "+ Add manual" (iteración + sesiones de borde + log de
  // estado), aplicado sobre el juego que se acaba de crear.
  const addManualPlaythrough = async (
    gameId: number,
    entry: ManualPlaythroughEntry,
  ): Promise<void> => {
    const iteration = await addIteration.mutateAsync({
      gameId,
      label: entry.label.trim() || null,
      playedPlatform: entry.platform,
      origin: entry.origin,
      format: entry.format,
      manualTotalPlayed: parseOptionalNumber(entry.hoursPlayed),
    });

    const isOngoing = entry.pastStatus === 'playing';

    if (entry.started) {
      const date = parseIsoDate(entry.started.isoDate);
      await addSession.mutateAsync({
        iterationId: iteration.id,
        startedAt: date,
        endedAt: date,
        durationSec: 0,
        datePrecision: entry.started.precision,
        milestone: 'started',
        anchorAs: 'start',
      });
    }

    if (entry.finished && !isOngoing) {
      const date = parseIsoDate(entry.finished.isoDate);
      await addSession.mutateAsync({
        iterationId: iteration.id,
        startedAt: date,
        endedAt: date,
        durationSec: 0,
        datePrecision: entry.finished.precision,
        milestone: STATUS_TO_STATE_TYPE[entry.pastStatus] as 'completed' | 'dropped' | 'on_hold',
        anchorAs: 'end',
      });
    }

    // SPEC 4.5 — el log de una iteración siempre arranca por "started" antes
    // de un estado terminal (mismo fix que writeInitialPlaythrough.ts y
    // EditGameModal para su propio "+ Add manual").
    if (entry.started && STATUS_TO_STATE_TYPE[entry.pastStatus] !== 'started') {
      await addStateEvent.mutateAsync({
        iterationId: iteration.id,
        type: 'started',
        occurredAt: parseIsoDate(entry.started.isoDate),
        datePrecision: entry.started.precision,
        note: null,
      });
    }

    const anchorDate = entry.finished ?? entry.started;
    await addStateEvent.mutateAsync({
      iterationId: iteration.id,
      type: STATUS_TO_STATE_TYPE[entry.pastStatus],
      occurredAt: anchorDate ? parseIsoDate(anchorDate.isoDate) : new Date(),
      datePrecision: anchorDate?.precision ?? 'day',
      note: null,
    });
  };

  const handleSave = async (): Promise<void> => {
    if (!selected) return;
    const values = getValues();

    if (isPlan) {
      // Alta reducida (Plan to Play): un juego planeado no tiene playthrough
      // real todavía — solo el juego elegido, las imágenes y las notas.
      await createPlanned.mutateAsync({
        igdbId: selected.igdbId,
        note: values.note.trim() || null,
        gameNotes: values.gameNotes.trim() || null,
        coverUrl: values.coverUrl,
        heroUrl: values.heroUrl,
        steamGridDbId: values.steamGridDbId,
      });
      resetAll();
      onOpenChange(false);
      return;
    }

    const initialStatus = values.playedBefore
      ? STATUS_TO_STATE_TYPE[values.pastStatus]
      : values.endless
        ? 'resting'
        : null;

    const details = {
      endless: values.endless,
      isEmulated: values.isEmulated,
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
      moneySpentDate: values.origin === 'Purchased' ? toBackendDate(values.moneySpentDate) : null,
      // Un juego emulado no tiene .exe propio (el campo ni se muestra) — si
      // quedó un valor de antes de marcar el checkbox, no debe viajar.
      executablePath: values.isEmulated ? null : values.executablePath.trim() || null,
      installDirectory: values.installDirectory.trim() || null,
      installSizeBytes: values.installDirectory.trim() ? values.installSizeBytes : null,
      coverUrl: values.coverUrl,
      heroUrl: values.heroUrl,
      steamGridDbId: values.steamGridDbId,
    };

    // Playthroughs de más allá del primero — solo tienen sentido si se
    // marcó "jugado antes" y el juego no es endless (mismo hueco que
    // EditGameModal deja sin IterationSection para endless: no hay
    // playthroughs discretos que registrar).
    const extraPlaythroughs =
      values.playedBefore && !values.endless ? values.extraPlaythroughs : [];

    if (isPromote && promoteGame) {
      await promote.mutateAsync({ gameId: promoteGame.id, ...details });
      for (const entry of extraPlaythroughs) {
        await addManualPlaythrough(promoteGame.id, entry);
      }
      resetAll();
      onOpenChange(false);
      onPromoted?.();
      return;
    }

    const created = await createGame.mutateAsync({ igdbId: selected.igdbId, ...details });

    // Flujo "+ Add new game" del modal de asignación (EMULADORES.md §6): la
    // sesión pendiente que lo originó se asigna sola al juego recién creado.
    if (assignSessionId !== undefined) {
      await assignSession.mutateAsync({ sessionId: assignSessionId, gameId: created.id });
    }

    for (const entry of extraPlaythroughs) {
      await addManualPlaythrough(created.id, entry);
    }

    resetAll();
    onOpenChange(false);
  };

  return (
    <ModalShell
      open={open}
      onClose={handleClose}
      title={isPromote ? 'Add to library' : 'Add game'}
      widthClass="w-160"
      maxHClass="max-h-[80vh]"
      headerExtra={
        <div className="mt-0.5 text-[12.5px] text-muted-foreground">
          {isPromote
            ? 'Fill the details — it moves out of your Plan to play'
            : isPlan
              ? 'Search the catalog — saved to your Plan to play'
              : 'Search the catalog, then fill the details'}
        </div>
      }
      footer={
        <>
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
            disabled={!selected || isSaving}
            className="flex items-center gap-2 rounded-[10px] px-5.5 py-2.5 text-[13.5px] font-bold disabled:cursor-not-allowed"
            style={
              selected
                ? accentGradientStyle
                : { background: 'rgba(255,255,255,.06)', color: '#888f8a', opacity: 0.6 }
            }
          >
            <Plus size={16} />
            <span>
              {isSaving
                ? isPromote
                  ? 'Moving…'
                  : 'Adding…'
                : isPlan
                  ? 'Add to plan'
                  : 'Add to library'}
            </span>
          </button>
        </>
      }
    >
      {selected === null && !igdbReady ? (
        <div className="flex flex-col items-center gap-2.5 rounded-xl border border-dashed border-border px-6 py-10 text-center">
          <p className="text-[13.5px] font-semibold text-foreground">
            Game search needs your IGDB keys.
          </p>
          <p className="max-w-90 text-[12.5px] leading-relaxed text-muted-foreground">
            Add your Twitch/IGDB credentials in Settings (the green button at the top of the
            sidebar) under API &amp; Sync — takes a minute and it&apos;s free. Until then the
            catalog can&apos;t be searched.
          </p>
        </div>
      ) : selected === null ? (
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
          steamGridDbId={steamGridDbId}
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
            // En modo promote no hay botón "Change": el juego viene
            // fijado desde su ficha del Plan, cambiarlo aquí no tiene
            // sentido.
            onChangeSelection={
              isPromote
                ? undefined
                : () => {
                    setSelected(null);
                    setValue('coverUrl', null);
                    setValue('heroUrl', null);
                    setValue('steamGridDbId', null);
                  }
            }
          />

          <div className="mt-4.5 flex flex-col gap-4">
            <AddGameImagesField selected={selected} onPick={setPickerTarget} />
            {/* Todo lo de playthrough/gasto/exe se pregunta al pasar el
                    juego a la biblioteca, no al planearlo — un Plan to Play
                    solo lleva el juego, sus imágenes y tus notas. */}
            {!isPlan && (
              <>
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
                        searchable
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
                        options={ORIGIN_SEGMENT_OPTIONS}
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
                  <div className="flex gap-2.5">
                    <div className="flex-1">
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
                          <NumberInput
                            {...field}
                            min={0}
                            step="0.01"
                            placeholder="0.00"
                            className={textInputClass}
                          />
                        )}
                      />
                    </div>

                    <Controller
                      control={control}
                      name="moneySpentDate"
                      render={({ field }) => (
                        // Cuándo se compró — por defecto hoy (ver el
                        // moneySpentDate: todayValue() de más arriba), no
                        // la fecha en la que se acaba guardando el gasto
                        // sin más: comprar algo hace tiempo y añadirlo
                        // hoy a la app no debería registrarlo como
                        // gastado hoy.
                        <DateWithPrecisionPicker
                          label="Purchased on"
                          value={field.value}
                          onChange={field.onChange}
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
                  accent="green"
                />

                <CheckboxRow
                  checked={isEmulated}
                  onToggle={() => handleEmulatedToggle(!isEmulated)}
                  title="Emulated game"
                  description="Runs inside an emulator — sessions are detected from the emulator and assigned manually."
                  accent="green"
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
                  accent="blue"
                  rowBorderFollowsChecked
                />

                {playedBefore && <PlayedBeforePanel />}
                {/* Playthroughs pasados de más, allá del primero — un
                        endless no tiene playthroughs discretos que registrar
                        (mismo hueco que EditGameModal deja para endless). */}
                {playedBefore && !endless && <ManualPlaythroughsField />}

                {/* Un juego emulado no tiene .exe propio que vigilar —
                        lo vigilado es el emulador (EMULADORES.md §5). */}
                {!isEmulated && <ExecutablePathField />}

                <InstallDirectoryField />
              </>
            )}

            <div>
              <CheckboxRow
                checked={notesOpen}
                onToggle={() => setNotesOpen(!notesOpen)}
                title="Add notes"
                description="Personal notes about this game — markdown supported."
                accent="blue"
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
                    placeholder={
                      isPlan
                        ? 'e.g. Recommended by Marta · looks like Hades…'
                        : 'e.g. Birthday gift · GOG winter sale…'
                    }
                    className={textInputClass}
                  />
                )}
              />
            </div>

            {!isPlan && <StatusSummaryLine />}

            {activeMutation.isError && (
              <div className="rounded-[10px] border border-destructive/40 bg-destructive/10 px-3.25 py-2.5 text-[12.5px] text-destructive">
                Couldn&apos;t {isPromote ? 'move' : 'add'} the game — {activeMutation.error.message}
              </div>
            )}
          </div>
        </FormProvider>
      )}
    </ModalShell>
  );
};
