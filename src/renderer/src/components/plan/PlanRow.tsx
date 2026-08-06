import {
  Clock3,
  Gamepad2,
  GripVertical,
  Hourglass,
  Newspaper,
  Pin,
  PinOff,
  Quote,
  ThumbsUp,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import type { PlannedGameItem } from '../../../../shared/types';
import { useImageSrc } from '../../hooks/useImageSrc';
import { useIsClamped } from '../../hooks/useIsClamped';
import { GRAY, TEAL } from '../../lib/colors';
import { daysBetween, humanizeSpan } from '../../lib/dateMath';
import { formatHours } from '../../lib/format';
import { STATUS_META } from '../../lib/gameStatus';
import { CRITICS_COLOR, PLAYERS_COLOR, resolveRatings, STEAM_BLUE } from '../../lib/ratings';
import { isUnreleased, releaseCountdown } from '../../lib/releaseDate';
import { RatingChip } from './RatingChip';
import { ReleaseBadge } from './ReleaseBadge';

const PLAN_COLOR = STATUS_META.plan.color;
const SUMMARY_TEXT_CLASS = 'text-[11.5px] leading-relaxed';

// Los cuatro manejadores del arrastre viven en UpNextList (que es quien ve la
// lista entera y puede mover a los vecinos); la fila solo pinta el asa y les
// pasa los eventos. `dragging` enciende el asa mientras dura el gesto.
export type RowReorderHandle = {
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerMove: (event: React.PointerEvent) => void;
  onPointerUp: (event: React.PointerEvent) => void;
  dragging: boolean;
};

type PlanRowProps = {
  game: PlannedGameItem;
  pinned: boolean;
  onSelect: () => void;
  onTogglePin: () => void;
  // Solo en Up next, y solo con más de una fila: la cola se ordena con las
  // lentes, no a mano — el asa ahí sería una promesa falsa.
  reorder?: RowReorderHandle;
  // La fila ACABA de cambiar de estantería por un pin/unpin: entra con la
  // animación de llegada (zoom sutil + halo del color del Plan que se apaga).
  // Señala A DÓNDE fue el juego sin que haya que buscarlo — al fijar, la fila
  // desaparece de la cola y reaparece arriba; sin el halo, encontrarla era
  // trabajo del ojo.
  landing?: boolean;
};

// La FILA DE DECISIÓN (PLAN-TO-PLAY.md §2.3) — la pieza que separa de verdad
// el Plan de la biblioteca.
//
// Library pregunta "¿qué tengo?" y la contesta una parrilla de carátulas:
// reconocimiento puro. El Plan pregunta "¿qué juego a continuación?", y una
// parrilla esconde justo lo que esa decisión necesita — cuánto dura, cuánto
// lleva esperando, por qué lo apunté, qué dicen de él. Aquí todo eso va a la
// vista y, sobre todo, ALINEADO: el valor de una fila no está en lo que dice
// de su juego, está en que se puede comparar con la de arriba y la de abajo
// sin abrir nada.
//
// La carátula va GRANDE (96×128 — creció dos veces desde el sello de 52×70
// con el que nació, a petición): reconocer un juego de un vistazo es la mitad
// del trabajo de esta lista, y a este tamaño el arte además le da a cada fila
// su color propio — la lista deja de ser un formulario gris.
export const PlanRow = ({
  game,
  pinned,
  onSelect,
  onTogglePin,
  reorder,
  landing = false,
}: PlanRowProps): React.JSX.Element => {
  const coverSrc = useImageSrc(game.coverUrl, 'covers');
  const [expanded, setExpanded] = useState(false);
  // Sin esto, una sinopsis de una sola línea corta seguía siendo un botón
  // clicable con hover y cursor de mano — una interacción que al pulsarla no
  // desplegaba nada, porque no había nada más que enseñar.
  const [measureRef, isClamped] = useIsClamped<HTMLParagraphElement>();
  const ratings = resolveRatings(game);

  // Lo que decide qué se pinta a la derecha lo dice el JUEGO, no la sección
  // en la que cae: un planeado sin salir que además has fijado se queda en Up
  // next (si te comprometiste a mano, la app no te lo esconde en una sección
  // plegada) — pero sigue necesitando su cuenta atrás, y decirle "esperando 8
  // meses" a un juego que aún no existe no significa nada.
  const unreleased = isUnreleased(game);
  // Y el caso simétrico: un planeado que ACABA de salir. Ya no está en el
  // horizonte (es jugable, así que su sitio es la cola), pero durante unas
  // semanas lleva su "OUT NOW" — el empujón a bajártelo y pasarlo a la
  // biblioteca. Sin esto, un juego que llevabas dos años esperando cambiaba
  // de sección en silencio y nadie se enteraba de que ya se puede jugar.
  const justOut = !unreleased && releaseCountdown(game)?.kind === 'out-now';
  const waiting = humanizeSpan(daysBetween(game.addedAt, new Date()));
  const hasRatings = ratings.critics !== null || ratings.players !== null || ratings.steam !== null;

  return (
    <div
      onClick={onSelect}
      className={`group relative flex cursor-pointer gap-4 overflow-hidden rounded-[15px] border p-3.5 transition-[border-color,background-color] duration-150 ${
        pinned ? '' : 'border-border bg-card hover:border-white/15 hover:bg-white/[0.045]'
      }`}
      style={{
        // Los fijados llevan el color del Plan puesto SIEMPRE, no solo al
        // pasar el ratón: Up next es la estantería del compromiso y tiene que
        // verse distinta sin tocar nada — el mismo velo degradado que ya usa
        // el panel "On your plan" de la ficha, para que las dos cosas se
        // reconozcan como la misma idea.
        ...(pinned
          ? {
              borderColor: `${PLAN_COLOR}38`,
              background: `linear-gradient(135deg, ${PLAN_COLOR}12, ${PLAN_COLOR}05 45%, transparent)`,
            }
          : undefined),
        // La animación corre al MONTAR: la fila que cambia de estantería se
        // desmonta de una sección y se monta en la otra, así que basta con
        // que la clase llegue puesta en ese primer render.
        ...(landing
          ? { animation: 'afterplay-pin-land 750ms cubic-bezier(.22,1,.36,1) both' }
          : undefined),
      }}
    >
      {/* La firma de color por la izquierda — siempre encendida en los
          fijados, asomando al pasar el ratón en el resto. */}
      <span
        className={`absolute inset-y-3 left-0 w-[3px] rounded-full transition-opacity duration-150 ${
          pinned ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'
        }`}
        style={{ background: PLAN_COLOR }}
      />

      {/* El asa de arrastre — SEPARADA del clic de la fila (que navega a la
          ficha) y del pin: agarrar y hacer clic son gestos distintos y cada
          uno necesita su sitio. touch-none es lo que permite arrastrar con el
          dedo sin que la lista haga scroll debajo. */}
      {reorder && (
        <div
          onPointerDown={reorder.onPointerDown}
          onPointerMove={reorder.onPointerMove}
          onPointerUp={reorder.onPointerUp}
          onPointerCancel={reorder.onPointerUp}
          onClick={(event) => event.stopPropagation()}
          title="Drag to reorder"
          className={`-my-1.5 -ml-2 flex w-5 flex-none touch-none items-center justify-center self-stretch text-muted-foreground/40 transition-[opacity,color] duration-150 hover:text-foreground/70 ${
            reorder.dragging
              ? 'cursor-grabbing opacity-100'
              : 'cursor-grab opacity-0 group-hover:opacity-100'
          }`}
        >
          <GripVertical size={15} />
        </div>
      )}

      <div className="relative h-32 w-24 flex-none overflow-hidden rounded-[10px] border border-white/10 bg-muted shadow-[0_8px_22px_rgba(0,0,0,.45)]">
        {coverSrc ? (
          <img
            src={coverSrc}
            loading="lazy"
            alt={game.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Gamepad2 size={22} strokeWidth={1.5} className="text-muted-foreground/40" />
          </div>
        )}
        {/* Un velo mínimo al pie ancla la carátula al fondo oscuro de la fila
            — sin él, los artes muy claros parecían pegatinas flotando. */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-6"
          style={{ background: 'linear-gradient(180deg, transparent, rgba(10,11,10,.35))' }}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-[15.5px] leading-tight font-extrabold tracking-[-.01em] text-foreground">
              {game.title}
            </span>
            {game.releaseYear !== null && (
              <span className="flex-none text-[11px] font-semibold text-muted-foreground/55 tabular-nums">
                {game.releaseYear}
              </span>
            )}
          </div>
          <div className="flex flex-none items-center gap-2">
            {(unreleased || justOut) && <ReleaseBadge game={game} />}
            <PinButton pinned={pinned} onToggle={onTogglePin} />
          </div>
        </div>

        {/* Los datos que deciden, en una sola línea comparable entre filas. */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {game.hltbMain !== null && (
            <span
              className="inline-flex flex-none items-center gap-1.25 rounded-lg border px-2 py-0.75 text-[11.5px] font-bold tabular-nums"
              style={{ color: TEAL, borderColor: `${TEAL}3d`, background: `${TEAL}14` }}
              title="Main Story, from HowLongToBeat"
            >
              <Clock3 size={11} className="flex-none" />
              {formatHours(game.hltbMain)}
            </span>
          )}

          {/* De un juego sin salir no se dice cuánto lleva esperando: lo que
              importa es cuánto QUEDA, y eso ya lo dice su badge de arriba. */}
          {!unreleased && (
            <span
              className="inline-flex flex-none items-center gap-1.25 rounded-lg border px-2 py-0.75 text-[11.5px] font-semibold"
              style={{
                color: GRAY,
                borderColor: 'var(--border)',
                background: 'rgba(255,255,255,.028)',
              }}
              title={`On your plan since ${game.addedAt.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })}`}
            >
              <Hourglass size={11} className="flex-none" />
              waiting {waiting}
            </span>
          )}

          {ratings.critics !== null && (
            <RatingChip
              Icon={Newspaper}
              color={CRITICS_COLOR}
              value={ratings.critics}
              title={`Critics: ${ratings.critics}/100 from ${ratings.criticsCount.toLocaleString()} reviews (IGDB)`}
            />
          )}
          {ratings.players !== null && (
            <RatingChip
              Icon={Users}
              color={PLAYERS_COLOR}
              value={ratings.players}
              title={`Players: ${ratings.players}/100 from ${ratings.playersCount.toLocaleString()} ratings (IGDB)`}
            />
          )}
          {ratings.steam !== null && (
            <RatingChip
              Icon={ThumbsUp}
              color={STEAM_BLUE}
              value={ratings.steam}
              suffix="%"
              title={`Steam: ${ratings.steam}% positive out of ${ratings.steamCount.toLocaleString()} reviews`}
            />
          )}
          {!hasRatings && game.hltbMain === null && !unreleased && (
            <span className="text-[11px] text-muted-foreground/60">
              No times or ratings yet — try Refresh data
            </span>
          )}
        </div>

        {/* Las etiquetas de Steam (§8): la verdad cultural del juego, dicha
            por quien lo ha jugado — "Metroidvania, Souls-like" cuenta qué
            noche te espera mejor que cualquier género de catálogo. Más
            apagadas que los chips de arriba a propósito: son contexto, no
            datos de decisión, y a un color competirían con las notas.
            TODAS las guardadas (top 8 de §8, ya recortadas ahí) — sin el
            "+N" de antes: un juego con etiquetas es precisamente la clase de
            dato que uno quiere leer entero de un vistazo, no adivinar
            cuántas se quedaron escondidas. flex-wrap deja que la fila crezca
            lo que haga falta. */}
        {game.steamTags && game.steamTags.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {game.steamTags.map((tag) => (
              <span
                key={tag.name}
                title={`${tag.votes.toLocaleString()} players tagged it`}
                className="flex-none rounded-md border border-white/8 bg-white/[0.03] px-1.75 py-0.5 text-[10.5px] font-semibold text-muted-foreground"
              >
                {tag.name}
              </span>
            ))}
          </div>
        )}

        {/* El hueco flexible ANTES del porqué y la sinopsis: con la carátula
            alta, las filas cortas estiran y el texto humano queda asentado
            abajo, alineado entre filas — no flotando a media altura. */}
        <div className="min-h-1.5 flex-1" />

        {/* EL PORQUÉ. Hasta ahora vivía enterrado en el historial de la ficha,
            a dos clics; en la fila cambia lo que la sección ES — de lista de
            deuda a lista de ilusiones. "Me lo recomendó Dani" no es un dato
            de catálogo, es la razón por la que ese juego está aquí. */}
        {game.planNote && (
          <div className="flex items-start gap-1.5">
            <Quote size={10.5} className="mt-[3px] flex-none" style={{ color: PLAN_COLOR }} />
            <span className="line-clamp-1 text-[12px] leading-snug font-medium text-foreground/85 italic">
              {game.planNote}
            </span>
          </div>
        )}

        {/* Y la respuesta a "¿qué era esto que apunté hace ocho meses?". Solo
            es un BOTÓN si de verdad hay algo que desplegar — con isClamped en
            false (la sinopsis ya cabe en dos líneas) es texto plano, sin
            cursor de mano, sin hover, sin interacción que no lleve a ningún
            sitio. */}
        {game.summary && (
          <div className="relative mt-1">
            {/* El clon de medida: invisible, SIEMPRE a 2 líneas — mide sin
                depender de si `expanded` ya quitó el recorte del texto
                visible. Mismo ancho que él (absolute inset-x-0). */}
            <p
              ref={measureRef}
              aria-hidden="true"
              className={`invisible absolute inset-x-0 top-0 line-clamp-2 ${SUMMARY_TEXT_CLASS}`}
            >
              {game.summary}
            </p>
            {isClamped ? (
              <button
                type="button"
                onClick={(event) => {
                  // La fila entera navega a la ficha: sin esto, desplegar la
                  // sinopsis te sacaba de la lista.
                  event.stopPropagation();
                  setExpanded((previous) => !previous);
                }}
                className={`block w-full cursor-pointer text-left ${SUMMARY_TEXT_CLASS} text-muted-foreground/85 transition-colors duration-150 hover:text-foreground/75 ${
                  expanded ? '' : 'line-clamp-2'
                }`}
                title={expanded ? 'Show less' : 'Show more'}
              >
                {game.summary}
              </button>
            ) : (
              <p className={`${SUMMARY_TEXT_CLASS} text-muted-foreground/85`}>{game.summary}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// Fijar/soltar en Up next. Fantasma hasta que pasas el ratón por la fila (o
// hasta que el juego está fijado, que entonces se queda encendido): es un
// gesto ocasional y no puede competir por atención con los datos de decisión,
// pero tampoco puede esconderse en un menú — es EL gesto de esta pantalla.
const PinButton = ({
  pinned,
  onToggle,
}: {
  pinned: boolean;
  onToggle: () => void;
}): React.JSX.Element => (
  <button
    type="button"
    onClick={(event) => {
      event.stopPropagation();
      onToggle();
    }}
    title={pinned ? 'Remove from Up next' : 'Pin to Up next'}
    aria-label={pinned ? 'Remove from Up next' : 'Pin to Up next'}
    className={`flex h-6.5 w-6.5 flex-none items-center justify-center rounded-lg border transition-[opacity,background-color,border-color] duration-150 ${
      pinned
        ? 'opacity-100'
        : 'border-transparent bg-transparent text-muted-foreground/70 opacity-0 group-hover:opacity-100 hover:border-input hover:bg-white/[0.06] hover:text-foreground focus-visible:opacity-100'
    }`}
    style={
      pinned
        ? { color: PLAN_COLOR, borderColor: `${PLAN_COLOR}47`, background: `${PLAN_COLOR}1c` }
        : undefined
    }
  >
    {pinned ? <PinOff size={12.5} /> : <Pin size={12.5} />}
  </button>
);
