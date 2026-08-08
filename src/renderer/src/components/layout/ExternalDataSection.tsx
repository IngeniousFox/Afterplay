import { Globe, RefreshCw } from 'lucide-react';
import type { ExternalDataStatus } from '../../../../shared/types';
import {
  useExternalDataStatus,
  useExternalRefreshProgress,
  useIsExternalRefreshRunning,
  useRefreshAllExternalData,
} from '../../hooks/external';
import { useCredentials } from '../../hooks/settings';
import { AMBER, TEAL, VIOLET } from '../../lib/colors';
import { STEAM_BLUE } from '../../lib/ratings';
import { SettingsCard } from './SettingsCard';

// Ajustes → External data (PLAN-TO-PLAY.md §5.1, la puerta de mantenimiento).
//
// Evolución de la vieja sección "Ratings": el refresco por lotes trae ahora,
// del MISMO viaje, todo lo que la app le pide a fuentes externas de catálogo —
// notas de crítica y jugadores, la sinopsis, la fecha de salida completa con
// su precisión y las sagas (IGDB), más las etiquetas y las reseñas de la
// propia Steam. Un botón, porque son los mismos juegos y la misma pasada.
//
// La otra puerta es la cabecera del Plan, que hace lo mismo pero solo sobre
// los planeados: esa es la del día a día, esta es la de "ponlo todo al día".
//
// Y HowLongToBeat sigue FUERA a propósito (§5.2): sin API de lotes, con
// matching difuso contra una API no oficial, 300 juegos serían una ráfaga
// frágil de fallos mudos. Su botón por-juego de la ficha es la vía correcta.
//
// Layout 'column' y no 'row' como su antecesora: esta pasada dura MINUTOS
// (las reseñas se piden juego a juego) y una tarjeta con un solo renglón
// de texto para contarlo se queda corta — hace falta el ancho entero para una
// barra, igual que en Images.

const BAR_CLASS = 'h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.07]';

const buttonClass =
  'flex flex-none items-center gap-1.75 rounded-[9px] border border-input bg-white/[0.03] px-3.25 py-2 text-[12.5px] font-semibold text-foreground transition-colors duration-150 hover:border-primary/45 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50';

// Un renglón de cobertura: cuánta biblioteca tiene YA cada dato. Mismo
// lenguaje que los Split de la card de Backlog debt (etiqueta, barra
// proporcional, cifra a la derecha).
//
// Cuatro barras SUELTAS y no una apilada, a propósito: los cuatro datos se
// solapan —un mismo juego puede tener notas Y sinopsis Y fecha— así que
// apilarlos sumaría cosas que no son partes de un todo. Cada uno mide su
// propia cobertura contra su propio denominador.
const CoverageRow = ({
  label,
  have,
  total,
  color,
}: {
  label: string;
  have: number;
  total: number;
  color: string;
}): React.JSX.Element => (
  <div className="flex items-center gap-2.5">
    <span className="w-26 flex-none text-[11px] text-muted-foreground">{label}</span>
    <div className={BAR_CLASS}>
      <div
        className="h-full rounded-full transition-[width] duration-500 ease-[cubic-bezier(.16,1,.3,1)]"
        style={{ width: `${total > 0 ? (have / total) * 100 : 0}%`, background: color }}
      />
    </div>
    <span className="w-20 flex-none text-right text-[11px] font-semibold text-foreground tabular-nums">
      {have}
      <span className="font-normal text-muted-foreground"> / {total}</span>
    </span>
  </div>
);

const Coverage = ({ status }: { status: ExternalDataStatus }): React.JSX.Element => (
  <div className="flex flex-col gap-1.5">
    <CoverageRow label="Ratings" have={status.withRatings} total={status.total} color={TEAL} />
    <CoverageRow label="Summaries" have={status.withSummary} total={status.total} color={VIOLET} />
    <CoverageRow
      label="Release dates"
      have={status.withFullDate}
      total={status.total}
      color={AMBER}
    />
    {/* Denominador propio: solo los juegos con appid pueden tener etiquetas.
        Medirlas contra la biblioteca entera daría siempre un suspenso por
        culpa de todo lo emulado de consola, que no es un fallo que arreglar. */}
    {status.steamEligible > 0 && (
      <CoverageRow
        label="Steam tags"
        have={status.withSteamData}
        total={status.steamEligible}
        color={STEAM_BLUE}
      />
    )}
  </div>
);

export const ExternalDataSection = (): React.JSX.Element => {
  const { data: creds } = useCredentials();
  const { data: status } = useExternalDataStatus();
  const refresh = useRefreshAllExternalData();
  // El "ocupado" y el progreso salen del MAIN, no de la mutation: la pasada
  // dura minutos y sobrevive a cerrar este modal, así que reabrirlo tiene que
  // encontrarla justo donde estaba en vez de con el botón como si nada.
  const running = useIsExternalRefreshRunning();
  const progress = useExternalRefreshProgress();

  // Casi todo sale de IGDB, así que sin sus claves no hay nada que pedir —
  // mismo aviso-en-línea que Trivia con la de Anthropic. Lo de Steam no
  // necesita ninguna, pero por sí solo no justifica el botón.
  const hasKey = Boolean(creds?.twitchClientId && creds?.twitchClientSecret);

  // Solo la fase de Steam avanza juego a juego: IGDB entero son 1-2
  // peticiones que terminan antes de que dé tiempo a leer la primera cifra, y
  // la escritura es una transacción. Fingirles un porcentaje sería inventarse
  // un progreso — esas dos fases se dicen con palabras y la barra latiendo.
  const measurable = running && progress?.phase === 'steam' && progress.total > 0;
  const percent = measurable && progress ? (progress.done / progress.total) * 100 : 0;

  const statusLine = ((): string | null => {
    if (running) {
      // Sin repetir el contador: ya está en la barra de arriba, a la derecha.
      // Lo que la barra NO puede decir es a QUÉ juego está esperando ahora
      // mismo, y eso es lo único que hace que una espera de minutos se sienta
      // viva en vez de colgada.
      if (measurable && progress) {
        return progress.currentTitle
          ? `Now asking Steam about ${progress.currentTitle}…`
          : 'Asking Steam for reviews, game by game…';
      }
      if (progress?.phase === 'saving') return 'Saving what came back…';
      return 'Asking IGDB for ratings, summaries and release dates…';
    }
    if (!hasKey) return 'Add your IGDB keys in Connections to turn this on.';
    if (progress?.error) return null; // ya lo dice el renglón de error de abajo
    // Al terminar manda el resumen del evento, que es el que llega aunque
    // este modal estuviera cerrado cuando la pasada acabó.
    const summary = progress?.summary;
    if (summary && summary.total > 0) {
      // Lo primero, si pasó: es la única noticia de la pasada que abre datos
      // NUEVOS (etiquetas, reseñas y logros de un juego que hasta hoy la app
      // daba por no-Steam), y pasa callada si no se dice. El caso típico es un
      // juego que se dio de alta antes de salir.
      if (summary.appIdsFound > 0) {
        return summary.appIdsFound === 1
          ? 'Done. 1 game just turned up on Steam — its tags and reviews are in.'
          : `Done. ${summary.appIdsFound} games just turned up on Steam — their tags and reviews are in.`;
      }
      const skipped = summary.total - summary.updated;
      return skipped > 0
        ? `Done. ${skipped} no longer in IGDB's catalog, kept as they were.`
        : 'Done — everything is up to date.';
    }
    // Los nunca-preguntados son el motivo de que este botón exista: dilo.
    if (status && status.neverChecked > 0) {
      return `${status.neverChecked} games were added before this existed — refresh to fill them in.`;
    }
    return null;
  })();

  return (
    <SettingsCard
      layout="column"
      title="External data"
      description="Ratings, summaries, full release dates, Steam tags and Steam reviews for every game — from IGDB and Steam, in one pass. Your plan has its own refresh button for just the games you're deciding between."
      icon={Globe}
      color={TEAL}
      headerRight={
        <button
          type="button"
          onClick={() => refresh.mutate()}
          disabled={!hasKey || running}
          className={buttonClass}
        >
          <RefreshCw size={14} className={running ? 'animate-spin' : undefined} />
          {running ? 'Refreshing…' : 'Refresh all'}
        </button>
      }
    >
      <div className="flex flex-col gap-2.5">
        {/* El progreso se SUMA a la cobertura en vez de sustituirla. Probado
            de las dos formas: sustituyéndola, la tarjeta encogía 68px de golpe
            justo al pulsar el botón y el resto del modal pegaba un salto — el
            mismo tipo de brinco que ya hubo que quitar de Ajustes. Y además la
            cobertura sigue siendo verdad durante la pasada: es precisamente lo
            que esas barras están a punto de llenar. Así el único cambio de
            altura es un renglón que aparece, y se ve crecer lo de abajo
            mientras corre lo de arriba. */}
        {running && (
          <div className="flex animate-in items-center gap-2.5 duration-250 fade-in-0">
            {/* En GERUNDIO y no "Steam tags" a secas: justo debajo hay un
                renglón de cobertura que se llama así, y dos "Steam tags" uno
                encima del otro con cifras distintas (97/194 y 71/194) se leen
                como una contradicción en vez de como "esto es lo que hay" y
                "esto es lo que estoy haciendo". */}
            <span className="w-26 flex-none text-[11px] font-semibold" style={{ color: TEAL }}>
              {progress?.phase === 'saving'
                ? 'Saving'
                : measurable
                  ? 'Fetching tags'
                  : 'Fetching IGDB'}
            </span>
            <div className={BAR_CLASS}>
              <div
                className={`h-full rounded-full transition-[width] duration-500 ease-out ${
                  measurable ? '' : 'animate-pulse'
                }`}
                style={{ width: measurable ? `${percent}%` : '100%', background: TEAL }}
              />
            </div>
            <span
              className="w-20 flex-none text-right text-[11px] font-semibold tabular-nums"
              style={{ color: TEAL }}
            >
              {measurable && progress ? `${progress.done} / ${progress.total}` : '…'}
            </span>
          </div>
        )}
        {status && (
          // Con la pasada en marcha, una línea separa lo que está pasando
          // AHORA (arriba, en color) de lo que ya hay (abajo, en reposo).
          <div className={running ? 'border-t border-white/5 pt-2.5' : undefined}>
            <Coverage status={status} />
          </div>
        )}

        {statusLine && (
          <div
            className="text-[11px] font-semibold"
            style={{ color: running ? TEAL : 'var(--muted-foreground)' }}
          >
            {statusLine}
          </div>
        )}
        {/* El fallo de ARRANCAR (mutation) y el de la pasada (evento) son dos
            momentos distintos y los dos tienen que verse: sin esto, un rechazo
            antes del primer evento devolvía el botón a su reposo sin dejar ni
            rastro de por qué — el mismo agujero que ya se tapó en Trivia. */}
        {(refresh.isError || progress?.error) && (
          <div className="text-[11px] font-semibold text-destructive">
            Couldn&apos;t refresh — {refresh.error?.message ?? progress?.error}
          </div>
        )}
      </div>
    </SettingsCard>
  );
};
