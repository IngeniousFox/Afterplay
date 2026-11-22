import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ExternalDataStatus } from '../../../../shared/types';
import {
  externalRefreshBar,
  useExternalDataStatus,
  useExternalRefreshProgress,
  useIsExternalRefreshRunning,
  useRefreshAllExternalData,
} from '../../hooks/external';
import { useCredentials } from '../../hooks/settings';
import { missingKeyHint } from '../../lib/settingsTabs';
import { buttonSize, secondaryButtonClass } from '../shell/controls';
import { SettingsCard, StatusLine } from './SettingsCard';

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

const BAR_CLASS = 'h-1.5 overflow-hidden rounded-full bg-inset';

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
}: {
  label: string;
  have: number;
  total: number;
}): React.JSX.Element => (
  <div className="flex flex-col gap-1.5">
    <div className="flex items-baseline justify-between gap-3 text-small">
      <span className="text-bone">{label}</span>
      <span className="text-dust tabular-nums">
        {have} of {total}
      </span>
    </div>
    <div className={BAR_CLASS}>
      {/* width y no transform A PROPÓSITO (a diferencia de la barra de
          progreso de abajo): estas son frías — solo transicionan cuando
          cambia la cobertura, unas pocas veces por pasada — y pueden REPOSAR
          en anchos menores que su alto (p.ej. 5/994), donde el rounded-full
          encoge los casquetes y el truco del relleno desplazado ya no es
          idéntico píxel a píxel. */}
      <div
        className="h-full rounded-full bg-phosphor transition-[width] duration-500 ease-out motion-reduce:transition-none"
        style={{ width: `${total > 0 ? (have / total) * 100 : 0}%` }}
      />
    </div>
  </div>
);

const Coverage = ({ status }: { status: ExternalDataStatus }): React.JSX.Element => (
  <div className="flex flex-col gap-3">
    <CoverageRow label="Ratings" have={status.withRatings} total={status.total} />
    <CoverageRow label="Summaries" have={status.withSummary} total={status.total} />
    <CoverageRow label="Release dates" have={status.withFullDate} total={status.total} />
    {/* Denominador propio: solo los juegos con appid pueden tener etiquetas.
        Medirlas contra la biblioteca entera daría siempre un suspenso por
        culpa de todo lo emulado de consola, que no es un fallo que arreglar. */}
    {status.steamEligible > 0 && (
      <CoverageRow label="Steam tags" have={status.withSteamData} total={status.steamEligible} />
    )}
    {/* Contra la biblioteca entera, sin denominador propio: a diferencia de
        las etiquetas, cualquier juego puede tener tiempos de HLTB. Lo que
        falte aquí son los huérfanos que la repesca de la pasada intenta
        curar cada semana — esta fila es donde se ve que lo consigue. En el
        verde de la casa, que además es el color del tramo 100% en la card
        de la ficha. */}
    <CoverageRow label="HowLongToBeat times" have={status.withHltb} total={status.total} />
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

  // Qué fases tienen porcentaje y cuáles se dicen con palabras lo decide el
  // helper compartido: la cabecera del Plan pinta esta misma barra con el
  // mismo evento, y la regla escrita a mano en los dos sitios se desincroniza
  // a la primera fase nueva (ver externalRefreshBar).
  const { measurable, percent } = externalRefreshBar(progress, running);

  const statusLine = ((): string | null => {
    if (running) {
      // Sin repetir el contador: ya está en la barra de arriba, a la derecha.
      // Lo que la barra NO puede decir es a QUÉ juego está esperando ahora
      // mismo, y eso es lo único que hace que una espera de minutos se sienta
      // viva en vez de colgada.
      if (measurable && progress) {
        if (progress.phase === 'hltb') {
          return progress.currentTitle
            ? `Asking HowLongToBeat about ${progress.currentTitle}…`
            : 'Asking HowLongToBeat about the games missing times…';
        }
        return progress.currentTitle
          ? `Now asking Steam about ${progress.currentTitle}…`
          : 'Asking Steam for reviews, game by game…';
      }
      if (progress?.phase === 'saving') return 'Saving what came back…';
      return 'Asking IGDB for ratings, summaries and release dates…';
    }
    if (!hasKey) return missingKeyHint('IGDB keys');
    if (progress?.error) return null; // ya lo dice el renglón de error de abajo
    // Al terminar manda el resumen del evento, que es el que llega aunque
    // este modal estuviera cerrado cuando la pasada acabó.
    const summary = progress?.summary;
    if (summary && summary.total > 0) {
      // Lo primero, si pasó: son las dos noticias de la pasada que abren
      // datos NUEVOS y pasan calladas si no se dicen. Los ESTRENOS (un juego
      // que la app daba por no-Steam y ya tiene appid — el caso típico es uno
      // dado de alta antes de salir) y las CORRECCIONES (un appid guardado
      // que apuntaba al playtest o a otro producto: sus reseñas y etiquetas
      // eran de otra cosa). Frases separadas porque son noticias distintas —
      // sumarlas hacía cantar "43 games just turned up on Steam" en una
      // pasada donde no había entrado ninguno.
      if (summary.appIdsFound > 0 || summary.appIdsFixed > 0 || summary.hltbFound > 0) {
        const parts: string[] = [];
        if (summary.appIdsFound > 0) {
          parts.push(
            summary.appIdsFound === 1
              ? '1 game just turned up on Steam — its tags and reviews are in'
              : `${summary.appIdsFound} games just turned up on Steam — their tags and reviews are in`,
          );
        }
        if (summary.appIdsFixed > 0) {
          parts.push(
            summary.appIdsFixed === 1
              ? '1 game was pointing at the wrong Steam app and got fixed'
              : `${summary.appIdsFixed} games were pointing at the wrong Steam app and got fixed`,
          );
        }
        // Tercera noticia posible: huérfanos de HowLongToBeat que por fin
        // tienen tiempos (feed de la Deuda del Backlog). Solo cuando pasó:
        // "0 recuperados" no es noticia, es la semana normal.
        if (summary.hltbFound > 0) {
          parts.push(
            summary.hltbFound === 1
              ? '1 game finally got its HowLongToBeat times'
              : `${summary.hltbFound} games finally got their HowLongToBeat times`,
          );
        }
        return `Done. ${parts.join('. ')}.`;
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
      title="External data"
      description="Ratings, summaries, full release dates, Steam tags and Steam reviews for every game, from IGDB and Steam in one pass. Your plan has its own refresh button for just the games you're deciding between."
      action={
        <button
          type="button"
          onClick={() => refresh.mutate()}
          disabled={!hasKey || running}
          className={cn(secondaryButtonClass, buttonSize.md)}
        >
          <RefreshCw
            aria-hidden
            size={15}
            className={cn(running && 'animate-spin motion-reduce:animate-none')}
          />
          {running ? 'Refreshing…' : 'Refresh all'}
        </button>
      }
    >
      <div className="flex flex-col gap-3.5">
        {/* El progreso se SUMA a la cobertura en vez de sustituirla: así la
            tarjeta no encoge de golpe al pulsar el botón, y la cobertura
            sigue siendo verdad durante la pasada (es lo que esas barras están
            a punto de llenar). */}
        {running && (
          <div className="flex animate-fade-in flex-col gap-1.5 text-tube">
            {/* En GERUNDIO y no "Steam tags" a secas: justo debajo hay un
                renglón de cobertura que se llama así, y dos iguales con
                cifras distintas se leen como una contradicción. */}
            <div className="flex items-baseline justify-between gap-3 text-small font-semibold">
              <span>
                {progress?.phase === 'saving'
                  ? 'Saving'
                  : progress?.phase === 'hltb'
                    ? 'Fetching HowLongToBeat'
                    : measurable
                      ? 'Fetching tags'
                      : 'Fetching IGDB'}
              </span>
              <span className="tabular-nums">
                {measurable && progress ? `${progress.done} of ${progress.total}` : '…'}
              </span>
            </div>
            <div className={BAR_CLASS}>
              {/* transform y no width: en la fase de Steam llega un evento por
                  juego y cada uno redirige esta transición, así que la barra
                  está en transición casi continua; translateX corre en el
                  compositor. El overflow-hidden + rounded-full del contenedor
                  recorta el borde con el mismo radio. */}
              <div
                className={cn(
                  'h-full w-full rounded-full bg-tube transition-transform duration-500 ease-out motion-reduce:transition-none',
                  !measurable && 'animate-pulse motion-reduce:animate-none',
                )}
                style={{ transform: `translateX(${measurable ? percent - 100 : 0}%)` }}
              />
            </div>
          </div>
        )}
        {status && (
          // Con la pasada en marcha, una línea separa lo que está pasando
          // AHORA (arriba, en color) de lo que ya hay (abajo, en reposo).
          <div className={running ? 'border-t border-line pt-3.5' : undefined}>
            <Coverage status={status} />
          </div>
        )}

        {statusLine && (
          <div className={cn('text-small', running ? 'font-semibold text-tube' : 'text-dust')}>
            {statusLine}
          </div>
        )}
        {/* El fallo de ARRANCAR (mutation) y el de la pasada (evento) son dos
            momentos distintos y los dos tienen que verse: sin esto, un rechazo
            antes del primer evento devolvía el botón a su reposo sin dejar ni
            rastro de por qué. */}
        {(refresh.isError || progress?.error) && (
          <StatusLine tone="error">
            Couldn&apos;t refresh: {refresh.error?.message ?? progress?.error}
          </StatusLine>
        )}
      </div>
    </SettingsCard>
  );
};
