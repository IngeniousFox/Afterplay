import {
  Cpu,
  Gamepad2,
  History,
  Infinity as InfinityIcon,
  NotebookPen,
  Plus,
  Rocket,
  ToggleLeft,
} from 'lucide-react';
import { useState } from 'react';
import { Controller, FormProvider, useForm, useWatch } from 'react-hook-form';
import type { GameDetail, IgdbSearchResult } from '../../../../shared/types';
import {
  useCreateGameWithDetails,
  useCreatePlannedGame,
  useGame,
  useGames,
  usePlannedGames,
  usePromotePlannedGame,
} from '../../hooks/games';
import { useIgdbSearch } from '../../hooks/igdb';
import { useCreateIteration } from '../../hooks/iterations';
import { useAssignSession } from '../../hooks/sessions';
import { useAddStateEvent } from '../../hooks/stateEvents';
import { ENDLESS_STATUS_OPTIONS, NORMAL_STATUS_OPTIONS } from '../../lib/gameStatus';
import { BLUE, GRAY, GREEN, TEAL, VIOLET } from '../../lib/colors';
import { accentGradientStyle, expandClass, revealClass, revealStyle } from '../../lib/styles';
import { ModalShell } from '../ui/modal-shell';
import { AddGameImagesField } from './add-game/AddGameImagesField';
import { CheckboxRow } from './add-game/CheckboxRow';
import type { CoverPickerTarget } from './add-game/CoverPicker';
import { CoverPicker } from './add-game/CoverPicker';
import { DateWithPrecisionPicker } from './add-game/DateWithPrecisionPicker';
import { Dropdown } from './add-game/Dropdown';
import { ExecutablePathField } from './add-game/ExecutablePathField';
import { FolderScanStep } from './add-game/FolderScanStep';
import { FormSection } from './add-game/FormSection';
import { GameNotesPanel } from './add-game/GameNotesPanel';
import { addManualPlaythrough, buildGameDetails, savePlannedGame } from './add-game/handleSave';
import { InstallDirectoryField } from './add-game/InstallDirectoryField';
import { ScanAutofillRow } from './add-game/ScanAutofillRow';
import { ManualPlaythroughsList } from './add-game/ManualPlaythroughsField';
import { MoneyAmountField } from './add-game/MoneyAmountField';
import { PlayedBeforePanel } from './add-game/PlayedBeforePanel';
import { todayValue } from './add-game/precisionDate';
import { useCredentials } from '../../hooks/settings';
import type { OwnedGameMatch } from './add-game/SearchStep';
import { SearchStep } from './add-game/SearchStep';
import { SegmentedButtonGroup } from './add-game/SegmentedButtonGroup';
import { SelectedGameSummary } from './add-game/SelectedGameSummary';
import { StatusSummaryLine } from './add-game/StatusSummaryLine';
import { fieldLabelClass, textInputClass, textInputFocusClass } from './add-game/styles';
import type { AddGameFormValues } from './add-game/types';
import {
  DEFAULT_FORM_VALUES,
  FORMAT_OPTIONS,
  ORIGIN_SEGMENT_OPTIONS,
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
  // Tras crear un juego nuevo (biblioteca o plan) — la pantalla dueña
  // navega a su ficha, para que lo recién añadido quede seleccionado en vez
  // de volver a la lista sin más.
  onCreated?: (gameId: number) => void;
  // Buscar algo que YA está en la biblioteca no da de alta nada: lleva a su
  // ficha. Sin esto, el resultado sale marcado pero apagado — que es lo que
  // toca donde abrir una ficha no tendría sentido (dentro de Sesiones) o
  // llevaría a la sección equivocada (el alta de un planeado).
  onOpenExisting?: (gameId: number) => void;
  // EMULADORES.md §6 — flujo "+ Add new game" desde el modal de asignación:
  // el checkbox de emulado arranca premarcado…
  defaultEmulated?: boolean;
  // …y al crear el juego, esta sesión pendiente se le asigna sola (montar
  // el modal solo al abrirlo, igual que promoteGame — el prellenado vive en
  // los inicializadores).
  assignSessionId?: number;
};

// Lo que el escaneo ya sabe del disco. Promocionar desde ahí no tiene por qué
// volver a preguntarlo: la carpeta acaba de aparecer en la lista.
export type PromoteDisk = {
  installDirectory: string;
  installSizeBytes: number | null;
  executablePath: string | null;
};

type AddGameModalBodyProps = AddGameModalProps & {
  // Elegir un juego que YA está en el plan (en el buscador o en el escaneo)
  // no da de alta nada: avisa al envoltorio, que vuelve a montar este mismo
  // cuerpo en modo promote. Hace falta montarlo de cero porque todo el
  // prellenado vive en los inicializadores de useState/useForm (ver
  // promoteGame) — y por eso el disco viaja como argumento y no por setValue.
  onPickPlanned?: (gameId: number, disk?: PromoteDisk) => void;
  promoteDisk?: PromoteDisk;
};

const AddGameModalBody = ({
  open,
  onOpenChange,
  mode = 'library',
  promoteGame,
  onPromoted,
  onCreated,
  onOpenExisting,
  defaultEmulated = false,
  assignSessionId,
  onPickPlanned,
  promoteDisk,
}: AddGameModalBodyProps): React.JSX.Element => {
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
  // Modo "escanear carpetas" del primer paso — alternativa al buscador, no un
  // paso más: se sale de él eligiendo un juego (que lleva al formulario) o
  // volviendo a la búsqueda.
  const [scanning, setScanning] = useState(false);
  const [notesOpen, setNotesOpen] = useState(() => Boolean(promoteGame?.notes));
  // Sentido de la transición entre "pasos" del modal (buscador -> ficha ->
  // picker de imagen y vuelta) — mismo mecanismo que ya usan CompletedGallery/
  // HltbCompareList para sus flechas de página: +1 al avanzar (entra
  // deslizando desde la derecha), -1 al volver (desde la izquierda). Standalone
  // de `selected`/`pickerTarget`: son la fuente de qué paso se ve, esto es
  // solo POR DÓNDE entra.
  const [stepDirection, setStepDirection] = useState<1 | -1>(1);

  const methods = useForm<AddGameFormValues>({
    defaultValues: promoteGame
      ? {
          ...DEFAULT_FORM_VALUES,
          platform: promoteIteration?.playedPlatform ?? DEFAULT_FORM_VALUES.platform,
          origin: promoteIteration?.origin ?? DEFAULT_FORM_VALUES.origin,
          format: promoteIteration?.format ?? DEFAULT_FORM_VALUES.format,
          endless: promoteGame.endless,
          isEmulated: promoteGame.isEmulated,
          // El disco que trae el escaneo manda sobre lo guardado: si se llegó
          // aquí desde una carpeta recién encontrada, ESA es la buena.
          executablePath: promoteDisk?.executablePath ?? promoteGame.executablePath ?? '',
          installDirectory: promoteDisk?.installDirectory ?? promoteGame.installDirectory ?? '',
          installSizeBytes: promoteDisk?.installSizeBytes ?? promoteGame.installSizeBytes,
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
  // Para el fondo de la ficha del juego elegido — AddGameImagesField lo
  // auto-rellena con la primera candidata de IGDB, así que en cuanto llega
  // el detalle la ficha "se enciende" sola.
  const heroUrl = useWatch({ control, name: 'heroUrl' });

  const search = useIgdbSearch(query);
  // Lo que ya tienes, para que el buscador lo reconozca: IGDB devuelve su
  // catálogo entero sin saber nada de tu biblioteca ni de tu plan, así que un
  // juego que ya tenías salía como un resultado más.
  const { data: plannedGames } = usePlannedGames();
  const { data: libraryGames } = useGames();
  const createGame = useCreateGameWithDetails();
  const createPlanned = useCreatePlannedGame();
  const promote = usePromotePlannedGame();
  const assignSession = useAssignSession();
  // Playthroughs manuales de más (allá del primero, ya cubierto por
  // createGame/promote) — mismas mutations que EditGameModal usa para su
  // modo "+ Add manual" (ver addManualPlaythrough más abajo).
  const addIteration = useCreateIteration();
  const addStateEvent = useAddStateEvent();
  const activeMutation = isPromote ? promote : isPlan ? createPlanned : createGame;
  const isSaving =
    activeMutation.isPending ||
    assignSession.isPending ||
    addIteration.isPending ||
    addStateEvent.isPending;
  // El juego/promoción YA se creó en un intento anterior, pero un paso de
  // detrás (asignar la sesión, un playthrough extra) falló a mitad — sin
  // esto, reintentar "Add to library" volvía a llamar a createGame/promote
  // con el MISMO igdbId, y eso revienta contra la unicidad de games.igdbId
  // con un error que no tiene nada que ver con lo que de verdad falló. Se
  // guarda el id ya creado para que el reintento se salte justo ese paso.
  const [partialSave, setPartialSave] = useState<{ gameId: number } | null>(null);
  // El banner de error solo miraba la mutación PRIMARIA — un fallo en
  // assignSession/addIteration/addStateEvent (los pasos que corren DESPUÉS de
  // crear el juego) pasaba totalmente inadvertido: el botón volvía a su
  // estado normal y no había ni rastro de qué había ido mal.
  const saveError =
    activeMutation.error ??
    assignSession.error ??
    addIteration.error ??
    addStateEvent.error ??
    null;

  const resetAll = (): void => {
    setQuery('');
    setSelected(null);
    setPickerTarget(null);
    // El modal no se desmonta al cerrarse, así que sin esto la próxima
    // apertura aterrizaría en el escaneo. Los RESULTADOS sí sobreviven (viven
    // en la caché de queries), así que volver a entrar al escaneo los enseña
    // al instante sin releer el disco.
    setScanning(false);
    setNotesOpen(false);
    setPartialSave(null);
    resetForm({ ...DEFAULT_FORM_VALUES, moneySpentDate: todayValue() });
    createGame.reset();
    createPlanned.reset();
    promote.reset();
    assignSession.reset();
    addIteration.reset();
    addStateEvent.reset();
  };

  const handleClose = (): void => {
    if (isSaving) return;
    resetAll();
    onOpenChange(false);
  };

  // Los dos atajos se apagan a la vez en el alta de un planeado (desde el
  // Plan no se entra a la biblioteca por la puerta de atrás) y con una sesión
  // pendiente esperando (EMULADORES.md §6): ahí el modal existe para crear el
  // juego al que colgar esa sesión, y ni promocionar ni abrir una ficha la
  // asignan — irse por cualquiera de los dos la dejaría huérfana.
  const canLeaveForOwned = !isPlan && assignSessionId === undefined;
  const ownedByIgdbId = new Map<number, OwnedGameMatch>();
  for (const game of libraryGames ?? []) {
    const reachable = canLeaveForOwned && onOpenExisting !== undefined;
    ownedByIgdbId.set(game.igdbId, {
      gameId: game.id,
      where: 'library',
      label: 'IN YOUR LIBRARY',
      color: GREEN,
      hint: reachable
        ? 'Already in your library — pick it to open its page.'
        : 'Already in your library.',
      onPick: reachable
        ? () => {
            handleClose();
            onOpenExisting(game.id);
          }
        : undefined,
    });
  }
  for (const game of plannedGames ?? []) {
    const reachable = canLeaveForOwned && onPickPlanned !== undefined;
    ownedByIgdbId.set(game.igdbId, {
      gameId: game.id,
      where: 'plan',
      label: 'IN YOUR PLAN',
      color: BLUE,
      hint: reachable
        ? 'Already in your plan — pick it to move it into your library.'
        : 'Already in your plan.',
      onPick: reachable ? () => onPickPlanned(game.id) : undefined,
    });
  }

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

  const handleSave = async (): Promise<void> => {
    if (!selected) return;
    const values = getValues();

    if (isPlan) {
      // Un único paso, sin nada detrás que pueda fallar por separado: si
      // esto revienta, activeMutation.isError ya lo refleja tal cual, y
      // reintentar no puede duplicar nada porque no llegó a crearse nada.
      const planned = await savePlannedGame(selected, values, createPlanned);
      resetAll();
      onOpenChange(false);
      onCreated?.(planned.id);
      return;
    }

    const details = buildGameDetails(values);

    // Playthroughs de más allá del primero — solo tienen sentido si se
    // marcó "jugado antes" y el juego no es endless (mismo hueco que
    // EditGameModal deja sin IterationSection para endless: no hay
    // playthroughs discretos que registrar).
    const extraPlaythroughs =
      values.playedBefore && !values.endless ? values.extraPlaythroughs : [];

    // Promote y New game encadenan varios pasos tras el principal
    // (assignSession/extraPlaythroughs), y NINGUNO de ellos puede reventar
    // sin control: antes, un fallo aquí no se atrapaba en ningún sitio, así
    // que el modal se quedaba abierto y CALLADO — sin cerrar, sin
    // resetAll(), y sin que el banner de error (que solo miraba la mutación
    // primaria) dijera una palabra. Con el try/catch de aquí abajo, el
    // rechazo se recoge y saveError (que sí mira las cuatro mutaciones) lo
    // enseña.
    try {
      if (isPromote && promoteGame) {
        // Guard de reintento: si "promote" YA salió bien en un intento
        // anterior (partialSave puesto), no se vuelve a llamar — promover
        // dos veces el mismo Plan revienta con "no está en el Plan" en vez
        // de decir la verdad sobre qué falló de verdad.
        if (!partialSave) {
          await promote.mutateAsync({ gameId: promoteGame.id, ...details });
          setPartialSave({ gameId: promoteGame.id });
        }
        for (const entry of extraPlaythroughs) {
          await addManualPlaythrough(
            promoteGame.id,
            { ...entry, status: entry.pastStatus },
            { addIteration, addStateEvent },
          );
        }
        resetAll();
        onOpenChange(false);
        onPromoted?.();
        return;
      }

      // Mismo guard para el alta normal: createGame.igdbId es UNIQUE (ver
      // schema.ts), así que repetir la llamada tras un fallo posterior
      // revienta con un error de fila duplicada que no explica nada al
      // usuario — el juego ya está, solo falta lo de detrás.
      let gameId = partialSave?.gameId;
      if (gameId === undefined) {
        const created = await createGame.mutateAsync({ igdbId: selected.igdbId, ...details });
        gameId = created.id;
        setPartialSave({ gameId });
      }

      // Flujo "+ Add new game" del modal de asignación (EMULADORES.md §6): la
      // sesión pendiente que lo originó se asigna sola al juego recién creado.
      if (assignSessionId !== undefined) {
        await assignSession.mutateAsync({ sessionId: assignSessionId, gameId });
      }

      for (const entry of extraPlaythroughs) {
        await addManualPlaythrough(
          gameId,
          { ...entry, status: entry.pastStatus },
          { addIteration, addStateEvent },
        );
      }

      resetAll();
      onOpenChange(false);
      onCreated?.(gameId);
    } catch (error) {
      console.error('[add-game] fallo guardando:', error);
    }
  };

  const stepTransitionClass = `duration-300 animate-in fade-in-0 ${
    stepDirection > 0 ? 'slide-in-from-right-4' : 'slide-in-from-left-4'
  }`;

  return (
    <ModalShell
      open={open}
      onClose={handleClose}
      title={isPromote ? 'Add to library' : 'Add game'}
      icon={Gamepad2}
      color={GREEN}
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
            className="[will-change:transform] flex items-center gap-2 rounded-[10px] px-5.5 py-2.5 text-[13.5px] font-bold transition-transform duration-200 ease-[cubic-bezier(.16,1,.3,1)] disabled:cursor-not-allowed enabled:hover:-translate-y-1 enabled:hover:shadow-[0_10px_24px_rgba(47,220,126,.32)]"
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
      ) : selected === null && scanning ? (
        <div key="scan" className={stepTransitionClass}>
          <FolderScanStep
            onBack={() => {
              setStepDirection(-1);
              setScanning(false);
            }}
            onSelect={(match, folder) => {
              // Lo que el escaneo ya sabe del disco entra en el formulario:
              // carpeta, tamaño y el ejecutable adivinado. Es TODO el valor
              // de escanear frente a buscar a mano — si no se prellenara,
              // habría que volver a señalar la misma carpeta con el picker.
              methods.setValue('installDirectory', folder.path);
              methods.setValue('installSizeBytes', folder.sizeBytes);
              if (folder.executablePath) {
                methods.setValue('executablePath', folder.executablePath);
              }
              setStepDirection(1);
              setSelected(match);
            }}
            // Un planeado que aparece en el escaneo es el mejor caso posible:
            // ya lo querías jugar y resulta que ya está instalado. En vez de
            // darlo de alta otra vez, se promociona — llevándose la carpeta y
            // el .exe que el escaneo acaba de encontrar, que es justo lo que
            // el formulario de promoción tendría que preguntar.
            onPromotePlanned={
              canLeaveForOwned && onPickPlanned
                ? (gameId, folder) =>
                    onPickPlanned(gameId, {
                      installDirectory: folder.path,
                      installSizeBytes: folder.sizeBytes,
                      executablePath: folder.executablePath,
                    })
                : undefined
            }
            ownedByIgdbId={ownedByIgdbId}
          />
        </div>
      ) : selected === null ? (
        <div key="search" className={stepTransitionClass}>
          <SearchStep
            query={query}
            onQueryChange={setQuery}
            isLoading={search.isLoading}
            results={search.data}
            isError={search.isError}
            onScanFolders={() => {
              setStepDirection(1);
              setScanning(true);
            }}
            onSelect={(result) => {
              setStepDirection(1);
              setSelected(result);
            }}
            ownedByIgdbId={ownedByIgdbId}
          />
        </div>
      ) : pickerTarget !== null ? (
        <div key="picker" className={stepTransitionClass}>
          <CoverPicker
            target={pickerTarget}
            igdbId={selected.igdbId}
            title={selected.title}
            releaseYear={selected.releaseYear}
            steamGridDbId={steamGridDbId}
            onSelect={(url) => {
              setValue(pickerTarget === 'cover' ? 'coverUrl' : 'heroUrl', url);
              setStepDirection(-1);
              setPickerTarget(null);
            }}
            onCancel={() => {
              setStepDirection(-1);
              setPickerTarget(null);
            }}
          />
        </div>
      ) : (
        <FormProvider {...methods}>
          <div key="form" className={stepTransitionClass}>
            <SelectedGameSummary
              selected={selected}
              heroUrl={heroUrl}
              // En modo promote no hay botón "Change": el juego viene
              // fijado desde su ficha del Plan, cambiarlo aquí no tiene
              // sentido.
              onChangeSelection={
                isPromote
                  ? undefined
                  : () => {
                      setStepDirection(-1);
                      setSelected(null);
                      setValue('coverUrl', null);
                      setValue('heroUrl', null);
                      setValue('steamGridDbId', null);
                    }
              }
            />

            <div className="mt-4.5 flex flex-col gap-5">
              <AddGameImagesField
                selected={selected}
                onPick={(target) => {
                  setStepDirection(1);
                  setPickerTarget(target);
                }}
              />
              {/* Todo lo de playthrough/gasto/exe se pregunta al pasar el
                    juego a la biblioteca, no al planearlo — un Plan to Play
                    solo lleva el juego, sus imágenes y tus notas. */}
              {!isPlan && (
                <>
                  <FormSection
                    icon={Gamepad2}
                    title="Your playthrough"
                    color={GREEN}
                    className={revealClass}
                    style={revealStyle(0)}
                  >
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
                      <div className={`flex items-end gap-2.5 ${expandClass}`}>
                        <Controller
                          control={control}
                          name="moneySpent"
                          render={({ field }) => (
                            <MoneyAmountField
                              {...field}
                              label="MONEY SPENT (€)"
                              hint="· saved as a purchase"
                            />
                          )}
                        />

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
                  </FormSection>

                  <FormSection
                    icon={ToggleLeft}
                    title="Game type"
                    color={VIOLET}
                    className={revealClass}
                    style={revealStyle(1)}
                  >
                    <CheckboxRow
                      checked={endless}
                      onToggle={() => handleEndlessToggle(!endless)}
                      title="Endless game"
                      description={`No ending (Minecraft, Factorio…). Hides "Complete", never counts as backlog.`}
                      accent="green"
                      icon={InfinityIcon}
                    />

                    <CheckboxRow
                      checked={isEmulated}
                      onToggle={() => handleEmulatedToggle(!isEmulated)}
                      title="Emulated game"
                      description="Runs inside an emulator — sessions are detected from the emulator and assigned manually."
                      accent="green"
                      icon={Cpu}
                    />
                  </FormSection>

                  <FormSection
                    icon={History}
                    title="History"
                    color={BLUE}
                    className={revealClass}
                    style={revealStyle(2)}
                  >
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
                      icon={History}
                    />

                    {playedBefore && (
                      <div className={expandClass}>
                        <PlayedBeforePanel />
                      </div>
                    )}
                    {/* Playthroughs pasados de más, allá del primero — un
                          endless no tiene playthroughs discretos que registrar
                          (mismo hueco que EditGameModal deja para endless). */}
                    {playedBefore && !endless && (
                      <div className={expandClass}>
                        <Controller
                          control={control}
                          name="extraPlaythroughs"
                          render={({ field }) => (
                            <ManualPlaythroughsList
                              entries={field.value}
                              onChange={field.onChange}
                              // El 1 es el de PlayedBeforePanel; estos son los de MÁS.
                              firstNumber={2}
                              addLabel="Add another playthrough"
                            />
                          )}
                        />
                      </div>
                    )}
                  </FormSection>

                  <FormSection
                    icon={Rocket}
                    title="Launch & install"
                    color={TEAL}
                    className={revealClass}
                    style={revealStyle(3)}
                  >
                    {/* El atajo primero: si el juego está en una carpeta
                        vigilada, el escaneo ya sabe su ruta, tamaño y .exe —
                        un clic rellena los dos campos de abajo. */}
                    <ScanAutofillRow
                      title={selected.title}
                      igdbId={selected.igdbId}
                      fillExecutable={!isEmulated}
                    />

                    {/* Un juego emulado no tiene .exe propio que vigilar —
                          lo vigilado es el emulador (EMULADORES.md §5). */}
                    {!isEmulated && <ExecutablePathField />}

                    <InstallDirectoryField />
                  </FormSection>
                </>
              )}

              <FormSection
                icon={NotebookPen}
                title="Notes"
                color={GRAY}
                className={revealClass}
                style={revealStyle(isPlan ? 0 : 4)}
              >
                <div>
                  <CheckboxRow
                    checked={notesOpen}
                    onToggle={() => setNotesOpen(!notesOpen)}
                    title="Add notes"
                    description="Personal notes about this game — markdown supported."
                    accent="blue"
                    icon={NotebookPen}
                  />
                  {notesOpen && (
                    <div className={`mt-2.75 ${expandClass}`}>
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
                        className={`${textInputClass} ${textInputFocusClass}`}
                      />
                    )}
                  />
                </div>
              </FormSection>

              {!isPlan && <StatusSummaryLine />}

              {saveError && (
                <div className="rounded-[10px] border border-destructive/40 bg-destructive/10 px-3.25 py-2.5 text-[12.5px] text-destructive">
                  Couldn&apos;t {isPromote ? 'move' : 'add'} the game — {saveError.message}
                </div>
              )}
            </div>
          </div>
        </FormProvider>
      )}
    </ModalShell>
  );
};

// Puente para promocionar un planeado elegido desde el buscador. El cuerpo
// del modal necesita el juego ENTERO (GameDetail: notas, iteración, exe…) ya
// cargado en el instante de montarse, y la lista del plan solo trae la forma
// corta — así que aquí se espera a tenerlo antes de dárselo.
const PromotePickedGame = ({
  gameId,
  ...props
}: AddGameModalProps & { gameId: number; promoteDisk?: PromoteDisk }): React.JSX.Element => {
  const { data: game, isError } = useGame(gameId);

  if (!game) {
    return (
      <ModalShell
        open
        onClose={() => props.onOpenChange(false)}
        title="Add to library"
        icon={Gamepad2}
        color={GREEN}
        widthClass="w-160"
      >
        <p className="py-10 text-center text-[13px] text-muted-foreground">
          {isError ? 'Couldn’t load this game.' : 'Loading…'}
        </p>
      </ModalShell>
    );
  }

  return (
    <AddGameModalBody
      {...props}
      promoteGame={game}
      // Al promocionar deja de estar en el plan, así que se avisa por la
      // misma puerta que un alta normal: la pantalla dueña navega a su ficha
      // de biblioteca en vez de dejarte mirando la lista.
      onPromoted={() => props.onCreated?.(game.id)}
    />
  );
};

// Envoltorio con el único estado que sobrevive a cambiar de "modo": qué
// juego del plan se eligió en el buscador. El cuerpo se monta de cero al
// pasar a promote (su prellenado vive en los inicializadores), y por eso
// vive aquí fuera y no dentro.
export const AddGameModal = (props: AddGameModalProps): React.JSX.Element => {
  const [picked, setPicked] = useState<{ gameId: number; disk?: PromoteDisk } | null>(null);

  // Cerrar el modal descarta la elección: la próxima apertura vuelve a
  // empezar por el buscador y no en la ficha del último planeado. Ajuste
  // durante el render (react.dev), sin useEffect, como el resto de la app.
  const [seenOpen, setSeenOpen] = useState(props.open);
  if (props.open !== seenOpen) {
    setSeenOpen(props.open);
    if (!props.open) setPicked(null);
  }

  if (picked !== null) {
    return <PromotePickedGame {...props} gameId={picked.gameId} promoteDisk={picked.disk} />;
  }

  return (
    <AddGameModalBody {...props} onPickPlanned={(gameId, disk) => setPicked({ gameId, disk })} />
  );
};
