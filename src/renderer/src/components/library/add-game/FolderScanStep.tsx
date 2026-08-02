import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  FolderPlus,
  FolderSearch,
  HardDrive,
  Loader2,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { useState } from 'react';
import type { IgdbSearchResult, ScanCandidate } from '../../../../../shared/types';
import { useIgdbSearch } from '../../../hooks/igdb';
import { useScanFolders, useScanResults, useSetScanFolders } from '../../../hooks/scan';
import { AMBER, BLUE, GREEN } from '../../../lib/colors';
import { formatBytes } from '../../../lib/format';
import { accentGradientStyle, expandClass, revealClass, revealStyle } from '../../../lib/styles';
import { CoverThumb } from './CoverThumb';
import { ExecutablePicker } from './ExecutablePicker';
import type { OwnedGameMatch } from './SearchStep';

// "hace 3 min" / "hace 2 h" / "ayer". Basta con el trazo gordo: el dato
// solo está para saber si lo que se ve es de hace un momento o de otro día.
const formatAgo = (iso: string): string => {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
};

type FolderScanStepProps = {
  onBack: () => void;
  // Elegir un resultado sale de este paso hacia el formulario normal, pero
  // llevándose lo que el escaneo YA sabe del disco: carpeta, tamaño y .exe.
  // Ese es todo el valor de escanear frente a buscar a mano.
  onSelect: (match: IgdbSearchResult, folder: ScanCandidate) => void;
  // Lo mismo para uno que ya estaba en tu plan: no se da de alta, se
  // promociona — y se lleva igual la carpeta y el .exe encontrados. Sin él
  // (alta con una sesión pendiente esperando, donde promocionar dejaría la
  // sesión huérfana) esas filas se marcan pero se apagan.
  onPromotePlanned?: (gameId: number, folder: ScanCandidate) => void;
  // Lo que ya tienes, por igdbId — el mismo mapa que usa el buscador. Aquí
  // hace falta para las fichas ALTERNATIVAS y para el buscador de las
  // carpetas sin match, que no pasan por la comprobación del main.
  ownedByIgdbId: Map<number, OwnedGameMatch>;
};

// Modo "Scan your folders" de Add Game. La idea: señalas dónde tienes los
// juegos, se lee UN nivel de subcarpetas (sin recursividad — un nivel es
// como organiza la gente sus juegos), cada nombre de carpeta se busca en
// IGDB y tú eliges. No añade nada solo: propone.
export const FolderScanStep = ({
  onBack,
  onSelect,
  onPromotePlanned,
  ownedByIgdbId,
}: FolderScanStepProps): React.JSX.Element => {
  const { data: folders = [] } = useScanFolders();
  const setFolders = useSetScanFolders();
  // Los resultados llegan ya hechos: el main los guarda entre cierres y los
  // refresca solo cuando aparece o desaparece una carpeta. Aquí no se pide
  // nada, se lee lo que ya hay — y `rescan` queda para forzarlo a mano.
  const { data: report, isLoading, rescan, isRescanning } = useScanResults();
  const results = report?.candidates;

  const handleAddFolder = async (): Promise<void> => {
    const folder = await window.api.dialog.pickFolder();
    if (!folder || folders.includes(folder)) return;
    await setFolders.mutateAsync([...folders, folder]).catch(() => undefined);
  };

  const handleRemoveFolder = async (folder: string): Promise<void> => {
    await setFolders
      .mutateAsync(folders.filter((current) => current !== folder))
      .catch(() => undefined);
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-[9px] border border-input bg-white/[0.03] px-2.75 py-1.75 text-[12px] font-semibold text-foreground transition-colors duration-150 hover:border-primary/45 hover:bg-white/[0.06]"
        >
          <ArrowLeft size={13} />
          Search instead
        </button>
        <div className="flex-1 text-[12px] text-muted-foreground">
          One level per folder — each subfolder is a game.
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {folders.map((folder) => (
          <span
            key={folder}
            className="flex max-w-full items-center gap-1.5 rounded-[8px] border px-2.25 py-1.25"
            style={{ borderColor: `${BLUE}2e`, background: `${BLUE}0d` }}
          >
            <HardDrive size={11} className="flex-none" style={{ color: BLUE }} />
            <span className="truncate font-mono text-[10.5px] text-foreground" title={folder}>
              {folder}
            </span>
            <button
              type="button"
              onClick={() => handleRemoveFolder(folder)}
              title="Remove this folder"
              className="flex-none rounded p-0.5 text-muted-foreground hover:text-destructive"
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <button
          type="button"
          onClick={handleAddFolder}
          className="flex items-center gap-1.5 rounded-[8px] border border-dashed border-input px-2.25 py-1.25 text-[11px] font-semibold text-muted-foreground transition-colors duration-150 hover:border-primary/45 hover:text-foreground"
        >
          <FolderPlus size={12} />
          {folders.length === 0 ? 'Choose a games folder' : 'Add another'}
        </button>
      </div>

      <button
        type="button"
        onClick={rescan}
        disabled={folders.length === 0 || isRescanning}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-[10px] border border-input bg-white/[0.04] px-4 py-2.5 text-[13px] font-bold text-foreground transition-colors duration-150 hover:border-primary/45 hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isRescanning ? <Loader2 size={15} className="animate-spin" /> : <FolderSearch size={15} />}
        {/* "Rescan" cuando ya hay algo: el botón dejó de ser la única forma
            de llegar a la lista (la app la mantiene sola) y pasó a ser la vía
            de escape — rehacerlo TODO ignorando lo que ya se sabía. */}
        {isRescanning ? 'Scanning your folders…' : results?.length ? 'Rescan' : 'Scan'}
      </button>

      {/* De cuándo es lo que se está viendo. Con una lista que se refresca
          sola en segundo plano, no decirlo dejaría al usuario sin saber si
          mira algo de hace un minuto o de la semana pasada. */}
      {report?.scannedAt && !isRescanning && (
        <div className="mt-1.75 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
          <RefreshCw size={10.5} className="flex-none" />
          Updated {formatAgo(report.scannedAt)} · watching {folders.length}{' '}
          {folders.length === 1 ? 'folder' : 'folders'} for new games
        </div>
      )}

      {/* Con un escaneo hecho, Results se pinta AUNQUE esté vacío: dentro
          vive el aviso de "señala la carpeta que contiene tus juegos, no un
          juego" — volver a la pantalla de bienvenida tras escanear cero
          carpetas escondía justo la pista que explica el porqué. */}
      {results && (results.length > 0 || report?.scannedAt) && !isRescanning && (
        <Results
          results={results}
          onSelect={onSelect}
          onPromotePlanned={onPromotePlanned}
          ownedByIgdbId={ownedByIgdbId}
        />
      )}

      {!isLoading && !isRescanning && !results?.length && !report?.scannedAt && (
        <div className="mt-6 flex flex-col items-center gap-2.5 px-4 py-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.04]">
            <FolderSearch size={20} strokeWidth={1.5} className="text-muted-foreground/50" />
          </div>
          <p className="text-[13px] font-semibold text-foreground">Add games from your disk</p>
          <p className="max-w-72 text-[12px] leading-relaxed text-muted-foreground">
            Point at the folders where your games live. Each subfolder is looked up in IGDB by its
            name, and the game&apos;s executable is found for you — you pick which ones to add.
          </p>
          <p className="max-w-72 text-[11.5px] leading-relaxed text-muted-foreground/70">
            Afterplay keeps watching them afterwards, so anything you install later shows up here on
            its own.
          </p>
        </div>
      )}
    </>
  );
};

// Lo escaneado, repartido en cuatro montones según lo que puedes hacer con
// cada carpeta — que es lo único que le importa a quien mira esta pantalla:
//
//   · estaba en tu plan y la tienes instalada -> pasarla a la biblioteca
//   · reconocida y no la tienes               -> añadir de un clic
//   · no se ha reconocido                     -> buscarla tú, con su buscador
//   · ya está en la biblioteca                -> nada (al final, plegada)
//
// El último montón podría no enseñarse, pero entonces faltarían carpetas sin
// explicación y parecería que el escaneo se las dejó.
//
// Los planeados van PRIMEROS: son pocos y son la mejor noticia que este
// escaneo puede darte — el juego que ya querías jugar resulta que ya lo
// tienes instalado.
const Results = ({
  results,
  onSelect,
  onPromotePlanned,
  ownedByIgdbId,
}: {
  results: ScanCandidate[];
  onSelect: (match: IgdbSearchResult, folder: ScanCandidate) => void;
  onPromotePlanned?: (gameId: number, folder: ScanCandidate) => void;
  ownedByIgdbId: Map<number, OwnedGameMatch>;
}): React.JSX.Element => {
  // Con matches > 0 en los planeados a propósito: la fila se pinta con la
  // ficha propuesta (carátula, año…), así que sin ninguna no habría qué
  // enseñar. Los planeados que el main reconoció solo por parecido de nombre
  // caen a "unmatched", y ahí su buscador los vuelve a marcar por igdbId.
  const planned = results.filter(
    (entry) => !entry.alreadyInLibrary && entry.plannedGameId !== null && entry.matches.length > 0,
  );
  const addable = results.filter(
    (entry) => !entry.alreadyInLibrary && entry.plannedGameId === null && entry.matches.length > 0,
  );
  const unmatched = results.filter(
    (entry) => !entry.alreadyInLibrary && entry.matches.length === 0,
  );
  const known = results.filter((entry) => entry.alreadyInLibrary);

  if (results.length === 0) {
    return (
      <div className="mt-4 rounded-[10px] border border-dashed border-border px-4 py-6 text-center text-[12.5px] text-muted-foreground">
        No subfolders found there. Point at the folder that CONTAINS your games, not at one game.
      </div>
    );
  }

  return (
    <div className="mt-3.5">
      <div className="mb-2 flex items-center justify-between px-0.5">
        <span className="text-[11px] font-bold tracking-[.11em] text-muted-foreground">
          {addable.length} {addable.length === 1 ? 'GAME' : 'GAMES'} TO ADD
        </span>
        <span className="flex items-center gap-2.5">
          {planned.length > 0 && (
            <span className="text-[10.5px]" style={{ color: BLUE }}>
              {planned.length} from your plan
            </span>
          )}
          {unmatched.length > 0 && (
            <span className="text-[10.5px]" style={{ color: AMBER }}>
              {unmatched.length} to match by hand
            </span>
          )}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {planned.map((entry, index) => (
          <CandidateRow
            key={entry.path}
            entry={entry}
            index={index}
            onSelect={onSelect}
            onPromotePlanned={onPromotePlanned}
            ownedByIgdbId={ownedByIgdbId}
          />
        ))}

        {addable.map((entry, index) => (
          <CandidateRow
            key={entry.path}
            entry={entry}
            index={planned.length + index}
            onSelect={onSelect}
            onPromotePlanned={onPromotePlanned}
            ownedByIgdbId={ownedByIgdbId}
          />
        ))}

        {/* Sin match automático, pero no callejón sin salida: cada una lleva
            su propio mini-buscador prellenado — corregir el match aquí
            conserva la carpeta y el .exe encontrados, que es justo lo que se
            perdería yéndose al buscador normal. */}
        {unmatched.map((entry) => (
          <FixMatchRow
            key={entry.path}
            entry={entry}
            onSelect={onSelect}
            onPromotePlanned={onPromotePlanned}
            ownedByIgdbId={ownedByIgdbId}
          />
        ))}
      </div>

      {known.length > 0 && <InLibraryList entries={known} />}
    </div>
  );
};

// El .exe elegido para una carpeta, arrancando en la apuesta del escaneo.
// Si un re-escaneo cambia esa apuesta (la fila NO se remonta: la clave es la
// ruta, que no cambia) se descarta lo elegido antes, que puede que ya ni
// exista. Ajuste durante el render, sin efecto.
const useChosenExecutable = (entry: ScanCandidate): [string | null, (path: string) => void] => {
  const [chosen, setChosen] = useState(entry.executablePath);
  const [guess, setGuess] = useState(entry.executablePath);

  if (guess !== entry.executablePath) {
    setGuess(entry.executablePath);
    setChosen(entry.executablePath);
  }

  return [chosen, setChosen];
};

// El picker de .exe vive ahora en ExecutablePicker.tsx (compartido con el
// autorrelleno del formulario) — aquí solo quedan sus dos usos.

// Fila de juego propuesto — el mismo lenguaje visual (y las mismas medidas)
// que los resultados del buscador normal: carátula 72×100, título+año,
// chips, elevación al hover. La diferencia es QUÉ cuenta debajo: en vez del
// summary del catálogo, lo que se sabe del disco — su carpeta y su .exe.
const CandidateRow = ({
  entry,
  index,
  onSelect,
  onPromotePlanned,
  ownedByIgdbId,
}: {
  entry: ScanCandidate;
  index: number;
  onSelect: (match: IgdbSearchResult, folder: ScanCandidate) => void;
  onPromotePlanned?: (gameId: number, folder: ScanCandidate) => void;
  ownedByIgdbId: Map<number, OwnedGameMatch>;
}): React.JSX.Element => {
  const [showAlternatives, setShowAlternatives] = useState(false);
  const [executablePath, setExecutablePath] = useChosenExecutable(entry);
  const plannedGameId = entry.plannedGameId;
  // Planeado pero sin sitio al que llevarlo: se marca y se apaga, igual que
  // en el buscador — darlo de alta reventaría contra el UNIQUE de igdbId.
  const isLocked = plannedGameId !== null && onPromotePlanned === undefined;
  // El primero es la apuesta (el main los devuelve ordenados por parecido de
  // título) y va grande, con carátula; los demás quedan escondidos tras "otro
  // juego". Enseñarlos todos por igual obligaría a elegir en cada fila, y en
  // la inmensa mayoría el primero acierta.
  const proposed = entry.matches[0];
  const alternatives = entry.matches.slice(1);

  return (
    <div className={revealClass} style={revealStyle(Math.min(index, 6))}>
      <button
        type="button"
        disabled={isLocked}
        onClick={() =>
          plannedGameId === null
            ? onSelect(proposed, { ...entry, executablePath })
            : onPromotePlanned?.(plannedGameId, { ...entry, executablePath })
        }
        className={`group/result flex w-full items-start gap-3.25 rounded-[11px] border bg-white/[0.02] p-2.75 text-left transition-[transform,border-color,background-color,box-shadow] duration-150 ${
          isLocked
            ? 'cursor-default border-border opacity-55'
            : `hover:-translate-y-0.5 hover:bg-white/[0.05] hover:shadow-[0_8px_20px_rgba(0,0,0,.35)] ${
                plannedGameId === null ? 'border-border hover:border-primary/35' : ''
              }`
        }`}
        style={plannedGameId === null || isLocked ? undefined : { borderColor: `${BLUE}55` }}
      >
        <div className="h-25 w-18 flex-none overflow-hidden rounded-[8px] border border-border bg-muted">
          <CoverThumb
            url={proposed.coverUrl}
            alt=""
            className="h-full w-full scale-100 object-cover transition-transform duration-300 group-hover/result:scale-108"
          />
        </div>

        <div className="min-w-0 flex-1 py-0.5">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-sm font-bold text-foreground">{proposed.title}</span>
            {proposed.releaseYear !== null && (
              <span className="flex-none text-[12px] font-semibold text-muted-foreground/80 tabular-nums">
                {proposed.releaseYear}
              </span>
            )}
            {plannedGameId !== null && (
              <span
                className="flex-none rounded-md px-1.75 py-0.5 text-[10px] font-bold tracking-[.08em]"
                style={{ background: `${BLUE}22`, color: BLUE }}
              >
                IN YOUR PLAN
              </span>
            )}
          </div>

          {proposed.genres.length > 0 && (
            <div className="mt-1.25 flex flex-wrap items-center gap-1.25">
              {proposed.genres.slice(0, 2).map((genre) => (
                <span
                  key={genre}
                  className="rounded-md border border-input bg-white/[0.04] px-1.75 py-0.5 text-[10px] font-semibold text-muted-foreground"
                >
                  {genre}
                </span>
              ))}
            </div>
          )}

          {/* De qué carpeta salió — es lo que hace verificable la propuesta:
              "esta ficha viene de ESTA carpeta tuya". */}
          <div className="mt-1.75 flex items-center gap-1.5">
            <HardDrive size={11} className="flex-none" style={{ color: BLUE }} />
            <span
              className="truncate text-[11px] font-semibold text-foreground/90"
              title={entry.path}
            >
              {entry.folderName}
            </span>
            <span className="flex-none text-[10.5px] text-muted-foreground tabular-nums">
              {formatBytes(entry.sizeBytes)}
            </span>
          </div>

          {/* El escaneo acaba de juntar las dos mitades: lo tenías fichado y
              resulta que ya está instalado. Se dice explícitamente porque el
              clic NO hace lo mismo que en las demás filas. */}
          {plannedGameId !== null && (
            <p className="mt-1.5 text-[11px] leading-relaxed" style={{ color: BLUE }}>
              {isLocked
                ? 'Already in your plan.'
                : 'Planned and already installed — move it into your library.'}
            </p>
          )}
        </div>

        <ArrowRight
          size={15}
          className="mt-1 flex-none text-muted-foreground transition-[transform,color] duration-150 group-hover/result:translate-x-0.75 group-hover/result:text-primary"
        />
      </button>

      {/* Faldón de la ficha: el .exe y las otras fichas de IGDB. Los dos
          salieron FUERA del botón grande porque los dos son elegibles, y un
          botón dentro de otro no es ni HTML válido ni clicable sin pelearse
          con el click del padre. */}
      <div className="mx-2 rounded-b-[9px] border border-t-0 border-border bg-white/[0.015]">
        <ExecutablePicker
          basePath={entry.path}
          candidates={entry.executableCandidates}
          value={executablePath}
          onChange={setExecutablePath}
        />

        {alternatives.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setShowAlternatives((current) => !current)}
              className="flex w-full items-center gap-2 border-t border-border px-3 py-1.75 text-left outline-none transition-colors duration-150 hover:bg-white/[0.03] focus-visible:bg-white/[0.05]"
            >
              <ChevronDown
                size={12}
                className="flex-none text-muted-foreground transition-transform duration-150"
                style={showAlternatives ? undefined : { transform: 'rotate(-90deg)' }}
              />
              {/* Abanico de carátulas: enseña QUÉ hay detrás del desplegable
                antes de abrirlo — tres portadas dicen "hay otros candidatos
                reales" mejor que cualquier frase. */}
              <span className="flex flex-none -space-x-2">
                {alternatives.slice(0, 3).map((match) => (
                  <span
                    key={match.igdbId}
                    className="h-7 w-5 overflow-hidden rounded-[4px] border border-border bg-muted ring-2 ring-[#141614]"
                  >
                    <CoverThumb
                      url={match.coverUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  </span>
                ))}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-muted-foreground">
                Not this one? Pick from {alternatives.length} other{' '}
                {alternatives.length === 1 ? 'match' : 'matches'}
              </span>
            </button>

            {showAlternatives && (
              <div
                className={`border-t border-border bg-black/20 px-2.5 pt-2 pb-2.5 ${expandClass}`}
              >
                <div className="mb-2 flex items-center justify-between px-0.5">
                  <span className="text-[9.5px] font-bold tracking-[.12em] text-muted-foreground">
                    OTHER MATCHES
                  </span>
                  <span className="text-[9.5px] text-muted-foreground/60">
                    Click a cover to use it
                  </span>
                </div>
                <MatchCardGrid
                  matches={alternatives}
                  onPick={(match) => onSelect(match, { ...entry, executablePath })}
                  onPickPlanned={
                    onPromotePlanned
                      ? (gameId) => onPromotePlanned(gameId, { ...entry, executablePath })
                      : undefined
                  }
                  ownedByIgdbId={ownedByIgdbId}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

// Carpeta sin match: su propio mini-buscador, prellenado con el nombre de la
// carpeta y editable. Elegir aquí conserva carpeta/tamaño/.exe del escaneo.
const FixMatchRow = ({
  entry,
  onSelect,
  onPromotePlanned,
  ownedByIgdbId,
}: {
  entry: ScanCandidate;
  onSelect: (match: IgdbSearchResult, folder: ScanCandidate) => void;
  onPromotePlanned?: (gameId: number, folder: ScanCandidate) => void;
  ownedByIgdbId: Map<number, OwnedGameMatch>;
}): React.JSX.Element => {
  const [open, setOpen] = useState(false);
  // Vacío hasta abrir: useIgdbSearch dispara en cuanto hay texto, y una
  // docena de filas buscando a la vez nada más pintar la lista sería
  // machacar el rate limit de IGDB para resultados que quizá nadie mira.
  const [query, setQuery] = useState('');
  const [executablePath, setExecutablePath] = useChosenExecutable(entry);
  const search = useIgdbSearch(query);

  const handleToggle = (): void => {
    if (!open && query === '') setQuery(entry.folderName);
    setOpen((current) => !current);
  };

  return (
    <div
      className="overflow-hidden rounded-[11px] border border-dashed transition-colors duration-150"
      style={{ borderColor: open ? `${AMBER}55` : 'var(--input)' }}
    >
      <button
        type="button"
        onClick={handleToggle}
        className="flex w-full items-center gap-2.5 px-3 py-2.25 text-left transition-colors duration-150 hover:bg-white/[0.03]"
      >
        <Search size={13} className="flex-none" style={{ color: AMBER }} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-semibold text-foreground">
            {entry.folderName}
          </span>
          <span className="block text-[10.5px] text-muted-foreground">
            No match found — search the catalog yourself
          </span>
        </span>
        <span className="flex-none text-[10.5px] text-muted-foreground tabular-nums">
          {formatBytes(entry.sizeBytes)}
        </span>
        <ChevronDown
          size={13}
          className="flex-none text-muted-foreground transition-transform duration-150"
          style={open ? { transform: 'rotate(180deg)' } : undefined}
        />
      </button>

      {/* El .exe se encontró igual aunque el título no casara, y elegirlo
          aquí es lo que hace que arreglar el match a mano no salga perdiendo
          frente a la ficha con propuesta. */}
      <div className="border-t border-border bg-white/[0.015]">
        <ExecutablePicker
          basePath={entry.path}
          candidates={entry.executableCandidates}
          value={executablePath}
          onChange={setExecutablePath}
        />
      </div>

      {open && (
        <div className={`border-t border-border px-3 pt-2.5 pb-2 ${expandClass}`}>
          <div className="group/fix relative">
            <Search
              size={13}
              className="pointer-events-none absolute top-1/2 left-2.75 -translate-y-1/2 text-muted-foreground"
            />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search the catalog…"
              className="w-full rounded-[9px] border border-input bg-white/[0.03] py-2 pr-3 pl-8.5 text-[12.5px] text-foreground outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground focus:border-primary/45 focus:shadow-[0_0_0_3px_rgba(47,220,126,.12)]"
            />
          </div>

          <div className="mt-2 max-h-80 overflow-y-auto">
            {search.isLoading && query.trim() ? (
              <div className="flex items-center gap-2 px-1 py-2 text-[11.5px] text-muted-foreground">
                <Loader2 size={12} className="animate-spin" />
                Searching…
              </div>
            ) : search.data?.length === 0 ? (
              <div className="px-1 py-2 text-[11.5px] text-muted-foreground">
                Nothing found — try fewer words.
              </div>
            ) : search.data && search.data.length > 0 ? (
              <MatchCardGrid
                matches={search.data.slice(0, 8)}
                onPick={(match) => onSelect(match, { ...entry, executablePath })}
                onPickPlanned={
                  onPromotePlanned
                    ? (gameId) => onPromotePlanned(gameId, { ...entry, executablePath })
                    : undefined
                }
                ownedByIgdbId={ownedByIgdbId}
              />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};

// Rejilla de candidatos como GALERÍA de carátulas, no como lista de texto:
// elegir "cuál de estos cinco Nuts es el mío" es reconocimiento visual puro,
// y una portada grande con su año encima responde más rápido que cualquier
// fila. La comparten el desplegable de alternativas y el buscador del
// arreglador — mismo problema, misma forma.
const MatchCardGrid = ({
  matches,
  onPick,
  onPickPlanned,
  ownedByIgdbId,
}: {
  matches: IgdbSearchResult[];
  onPick: (match: IgdbSearchResult) => void;
  // Elegir aquí uno que ya está en tu plan lo promociona, no lo da de alta.
  onPickPlanned?: (gameId: number) => void;
  ownedByIgdbId: Map<number, OwnedGameMatch>;
}): React.JSX.Element => (
  <div className="grid grid-cols-4 gap-2.5">
    {matches.map((match, index) => {
      const owned = ownedByIgdbId.get(match.igdbId);
      const canPromote = owned?.where === 'plan' && onPickPlanned !== undefined;
      // Lo que ya está en la biblioteca no tiene segunda alta posible; lo
      // planeado sin promoción a mano tampoco. En los dos casos se enseña —
      // esconderlo dejaría un hueco sin explicar en la rejilla.
      const isLocked = owned !== undefined && !canPromote;
      return (
        <button
          key={match.igdbId}
          type="button"
          disabled={isLocked}
          onClick={() => (owned && canPromote ? onPickPlanned?.(owned.gameId) : onPick(match))}
          className={`group/alt relative overflow-hidden rounded-[10px] border border-border bg-muted text-left outline-none transition-[transform,border-color,box-shadow] duration-200 ease-[cubic-bezier(.16,1,.3,1)] ${
            isLocked
              ? 'cursor-default opacity-45'
              : 'hover:-translate-y-1 hover:border-primary/60 hover:shadow-[0_12px_28px_rgba(0,0,0,.5)] focus-visible:border-primary/60'
          } ${revealClass}`}
          // La proporción EXACTA de cover_big de IGDB (264×374): con aspect-[3/4]
          // el object-cover recortaba la carátula por los lados — en portadas
          // con texto (dotAge y sus expansiones) se comía letras enteras.
          style={{ aspectRatio: '264 / 374', ...revealStyle(Math.min(index, 6)) }}
        >
          <CoverThumb
            url={match.coverUrl}
            alt=""
            className="h-full w-full scale-100 object-cover transition-transform duration-300 group-hover/alt:scale-105"
          />

          {/* El año SOBRE la carátula: entre cinco juegos homónimos es el dato
              que desempata, y aquí no puede perderse por truncado. */}
          {match.releaseYear !== null && (
            <span className="absolute top-1.5 right-1.5 rounded-[6px] bg-black/75 px-1.5 py-0.5 text-[10px] font-bold text-white tabular-nums shadow-[0_2px_6px_rgba(0,0,0,.4)] backdrop-blur-sm">
              {match.releaseYear}
            </span>
          )}

          {/* Ya es tuyo: se dice sobre la propia carátula, que es donde está
              mirando el ojo al elegir de una rejilla. */}
          {owned && (
            <span
              className="absolute top-1.5 left-1.5 rounded-[6px] px-1.5 py-0.5 text-[9px] font-bold tracking-[.06em] shadow-[0_2px_6px_rgba(0,0,0,.4)] backdrop-blur-sm"
              style={{ background: 'rgba(8,12,10,.82)', color: owned.color }}
            >
              {owned.label}
            </span>
          )}

          {/* Título como rótulo al pie de la propia carátula, sobre un degradado
              que SIEMPRE está (no solo al hover): así la card es carátula pura
              de esquina a esquina y aun así se puede leer qué juego es. */}
          <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-2 pt-5 pb-1.75">
            <span
              className="line-clamp-2 text-[10.5px] leading-tight font-bold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,.8)]"
              title={match.title}
            >
              {match.title}
            </span>
          </span>

          {/* Al hover, el rótulo cede el sitio a la acción: píldora verde con
              el mismo acento que el botón principal de la app. En los apagados
              no aparece — no hay acción que ofrecer. */}
          {!isLocked && (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-[opacity,background-color] duration-150 group-hover/alt:bg-black/35 group-hover/alt:opacity-100">
              <span
                className="flex items-center gap-1.25 rounded-full px-2.75 py-1.25 text-[10.5px] font-bold"
                style={accentGradientStyle}
              >
                <Check size={11} strokeWidth={3} />
                {canPromote ? 'To library' : 'Use this'}
              </span>
            </span>
          )}
        </button>
      );
    })}
  </div>
);

// Los que ya están en la biblioteca, plegados al final y cerrados por
// defecto: son la confirmación de que el escaneo los vio, no una lista de
// trabajo — abiertos solo estorbaban entre el usuario y lo añadible.
const InLibraryList = ({ entries }: { entries: ScanCandidate[] }): React.JSX.Element => {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-2 rounded-[9px] px-1 py-1.5 text-left transition-colors duration-150 hover:bg-white/[0.03]"
      >
        <ChevronDown
          size={13}
          className="flex-none text-muted-foreground transition-transform duration-150"
          style={open ? undefined : { transform: 'rotate(-90deg)' }}
        />
        <Check size={13} className="flex-none" style={{ color: GREEN }} />
        <span className="flex-1 text-[11.5px] font-semibold text-muted-foreground">
          Already in your library
        </span>
        <span
          className="flex-none rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums"
          style={{ background: `${GREEN}1f`, color: GREEN }}
        >
          {entries.length}
        </span>
      </button>

      {open && (
        <div className={`mt-1 flex flex-col gap-1 ${expandClass}`}>
          {entries.map((entry) => (
            <div
              key={entry.path}
              className="flex items-center gap-2.5 rounded-[9px] border border-border bg-white/[0.015] px-3 py-1.75"
            >
              <Check size={12} className="flex-none" style={{ color: GREEN }} />
              <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
                {entry.folderName}
              </span>
              <span className="flex-none text-[10.5px] text-muted-foreground/60 tabular-nums">
                {formatBytes(entry.sizeBytes)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
