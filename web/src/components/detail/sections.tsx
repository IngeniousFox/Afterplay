import {
  BookOpen,
  ChevronDown,
  Folder,
  HardDrive,
  Lightbulb,
  Newspaper,
  Tag,
  ThumbsUp,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { GameDetail } from '../../api';
import { formatByPrecision, formatBytes, formatCount, formatRelease } from '../../lib/format';
import { CRITICS_COLOR, PLAYERS_COLOR, resolveRatings, STEAM_BLUE } from '../../lib/ratings';
import { Cell, CardTitle, DetailCard, InfoChip, SectionLabel } from './primitives';

// ── Details ────────────────────────────────────────────────────────────────

export const DetailsCard = ({ game }: { game: GameDetail }): React.JSX.Element => {
  const replays = Math.max(0, game.iterations.length - 1);
  const replaysLabel = replays === 0 ? 'Never' : `${replays} ${replays === 1 ? 'time' : 'times'}`;

  const lastSession = game.iterations
    .flatMap((iteration) => iteration.sessions)
    .sort((a, b) => b.startedAt - a.startedAt)[0];
  const recentActivity = lastSession ? formatByPrecision(lastSession.startedAt, 'day') : '—';

  return (
    <DetailCard>
      <CardTitle>Details</CardTitle>

      <div className="mt-3.5 grid grid-cols-2 gap-x-3 gap-y-3.5">
        <Cell label="DEVELOPER" value={game.developer ?? '—'} />
        <Cell label="PUBLISHER" value={game.publisher ?? '—'} />
        {/* La fecha COMPLETA cuando de verdad se sabe: "March 17, 2017" si
            IGDB conoce el día, "March 1995" si solo el mes, "1995" si solo el
            año — nunca un día inventado. */}
        <Cell label="RELEASED" value={formatRelease(game) ?? '—'} />
        {/* Un endless nunca llega a "Beaten", así que "replayed" no significa
            nada para él: su única forma de generar una iteración nueva es
            Dropped -> empezar de cero, que no es volver a jugarlo entero. */}
        {game.endless ? (
          <Cell label="LAST PLAYED" value={recentActivity} />
        ) : (
          <>
            <Cell label="REPLAYED" value={replaysLabel} />
            <Cell label="LAST PLAYED" value={recentActivity} />
          </>
        )}
      </div>

      {game.officialPlatforms && game.officialPlatforms.length > 0 && (
        <div className="mt-4 border-t border-white/5 pt-3.5">
          <div className="mb-2 text-[9.5px] font-bold tracking-[.12em] text-muted-foreground">
            PLATFORMS
          </div>
          <div className="flex flex-wrap gap-1.5">
            {game.officialPlatforms.map((platform) => (
              <InfoChip key={platform}>{platform}</InfoChip>
            ))}
          </div>
        </div>
      )}

      {game.genres && game.genres.length > 0 && (
        <div className="mt-4 border-t border-white/5 pt-3.5">
          <div className="mb-2 text-[9.5px] font-bold tracking-[.12em] text-muted-foreground">
            GENRES
          </div>
          <div className="flex flex-wrap gap-1.5">
            {game.genres.map((genre) => (
              <InfoChip key={genre}>{genre}</InfoChip>
            ))}
          </div>
        </div>
      )}

      {/* Las etiquetas de Steam, justo debajo de los géneros: son lo mismo
          —cómo se clasifica este juego— dicho por quien lo ha jugado. IGDB
          dice "Platform, Adventure" y Steam dice Metroidvania, Souls-like.
          Vocabulario de jugadores, no de catálogo, y por eso van pegadas y no
          sustituyen a los géneros: las dos cosas son ciertas. */}
      {game.steamTags && game.steamTags.length > 0 && (
        <div className="mt-4 border-t border-white/5 pt-3.5">
          <div className="mb-2 flex items-center gap-1.25 text-[9.5px] font-bold tracking-[.12em] text-muted-foreground">
            <Tag size={10} />
            STEAM TAGS
          </div>
          {/* Sin cifra: el número que traen es un PESO relativo de Steam, no
              un recuento de personas — enseñarlo como "N players" sería
              inventarse un dato. El orden ya dice lo que importa. */}
          <div className="flex flex-wrap gap-1.5">
            {game.steamTags.map((tag) => (
              <InfoChip key={tag.name} title="Player tag on Steam">
                {tag.name}
              </InfoChip>
            ))}
          </div>
        </div>
      )}

      {game.installDirectory && (
        <div className="mt-4 border-t border-white/5 pt-3.5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[9.5px] font-bold tracking-[.12em] text-muted-foreground">
              INSTALLED AT
            </span>
            {game.installSizeBytes !== null && (
              <span className="flex items-center gap-1.25 text-[11px] font-semibold text-muted-foreground tabular-nums">
                <HardDrive size={11} />
                {formatBytes(game.installSizeBytes)}
              </span>
            )}
          </div>
          <div
            className="flex items-center gap-2 rounded-[9px] border border-border bg-white/[0.02] px-2.5 py-2"
            title={game.installDirectory}
          >
            <Folder size={13} className="flex-none text-muted-foreground" />
            <span className="truncate font-mono text-[11px] text-foreground">
              {game.installDirectory}
            </span>
          </div>
        </div>
      )}
    </DetailCard>
  );
};

// ── About ──────────────────────────────────────────────────────────────────

// La sinopsis de IGDB. Es `summary` y NUNCA `storyline`: el segundo es la
// trama entera, más largo y con spoilers de un juego que precisamente aún no
// has jugado.
//
// Siempre nace recogida. Una card gigante de texto plantada en medio de la
// ficha en cada visita tapa los datos que sí se comparan; quien quiera leerla
// tiene el "Read more" a un toque.
export const AboutCard = ({ game }: { game: GameDetail }): React.JSX.Element | null => {
  const [expanded, setExpanded] = useState(false);
  if (!game.summary) return null;

  // El "Read more" solo si de verdad hay recorte. En el escritorio esto se
  // mide con un clon invisible a 3 líneas; aquí basta el largo del texto,
  // porque el ancho de la columna es conocido (un móvil) y el umbral cae muy
  // lejos de la frontera: no hay caso ambiguo que medir.
  const clamped = game.summary.length > 180;

  return (
    <DetailCard>
      <div className="flex items-center gap-1.75">
        <BookOpen size={13} className="flex-none text-muted-foreground" />
        <span className="text-[13.5px] font-bold text-foreground">About</span>
        <span className="ml-auto flex-none text-[10.5px] font-semibold text-muted-foreground/70">
          via IGDB
        </span>
      </div>

      <p
        className={`mt-2.5 text-[12.5px] leading-relaxed text-muted-foreground ${
          clamped && !expanded ? 'line-clamp-3' : ''
        }`}
      >
        {game.summary}
      </p>

      {clamped && (
        <button
          type="button"
          onClick={() => setExpanded((previous) => !previous)}
          className="mt-2 flex items-center gap-1 text-[11.5px] font-semibold text-muted-foreground/70"
        >
          {expanded ? 'Show less' : 'Read more'}
          <ChevronDown
            size={12}
            className="transition-transform duration-200"
            style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
          />
        </button>
      )}
    </DetailCard>
  );
};

// ── Ratings ────────────────────────────────────────────────────────────────

const ScoreTile = ({
  icon: Icon,
  label,
  color,
  score,
  suffix,
  countLabel,
}: {
  icon: LucideIcon;
  label: string;
  color: string;
  // null = sin muestra suficiente. El tile se queda apagado con el motivo
  // debajo en vez de desaparecer, que era lo que hacía que las notas pasaran
  // desapercibidas cuando vivían dentro de Details.
  score: number | null;
  suffix?: string;
  countLabel: string;
}): React.JSX.Element => {
  const active = score !== null;
  return (
    <div
      className="min-w-0 flex-1 rounded-[10px] border px-1.5 py-2.5 text-center"
      style={
        active
          ? { borderColor: `${color}5c`, background: `${color}17` }
          : { borderColor: 'var(--border)', background: 'rgba(255,255,255,.02)' }
      }
    >
      <div className="mb-1.25 flex items-center justify-center gap-1">
        <Icon size={11} style={{ color: active ? color : 'var(--muted-foreground)' }} />
        <span
          className="text-[9px] font-bold tracking-[.04em]"
          style={{ color: active ? color : 'var(--muted-foreground)' }}
        >
          {label}
        </span>
      </div>
      <div
        className="text-[21px] leading-none font-extrabold tabular-nums"
        style={{ color: active ? color : 'var(--muted-foreground)' }}
      >
        {active ? `${score}${suffix ?? ''}` : '—'}
      </div>
      <div className="mt-1.25 truncate text-[9.5px] text-muted-foreground">{countLabel}</div>
    </div>
  );
};

// Tres fuentes, tres poblaciones, y cada juego tiene las que tiene. Nunca se
// funden en una: una media de las tres no dice de quién es la opinión.
//
// El de Steam solo aparece CUANDO HAY DATO, y su ausencia no se enseña — a
// diferencia de los otros dos, que sí dejan su hueco apagado. Un juego moderno
// sin crítica dice algo; un retro emulado sin Steam es lo normal.
export const RatingsCard = ({ game }: { game: GameDetail }): React.JSX.Element => {
  const ratings = resolveRatings(game);
  const hasAny = ratings.critics !== null || ratings.players !== null || ratings.steam !== null;

  return (
    <DetailCard>
      <CardTitle
        aside={
          <span className="flex-none text-[10.5px] font-semibold text-muted-foreground/70">
            out of 100
          </span>
        }
      >
        Ratings
      </CardTitle>
      <div className="mt-0.5 mb-3.5 text-[11.5px] text-muted-foreground">
        Critics cover modern releases; players cover the classics.
      </div>

      {hasAny ? (
        <div className="flex gap-2">
          <ScoreTile
            icon={Newspaper}
            label="CRITICS"
            color={CRITICS_COLOR}
            score={ratings.critics}
            countLabel={
              ratings.critics !== null
                ? `${formatCount(ratings.criticsCount)} ${ratings.criticsCount === 1 ? 'review' : 'reviews'}`
                : 'No critic reviews'
            }
          />
          <ScoreTile
            icon={Users}
            label="PLAYERS"
            color={PLAYERS_COLOR}
            score={ratings.players}
            countLabel={
              ratings.players !== null
                ? `${formatCount(ratings.playersCount)} ${ratings.playersCount === 1 ? 'rating' : 'ratings'}`
                : ratings.playersCount > 0
                  ? `Only ${ratings.playersCount} so far`
                  : 'No player ratings'
            }
          />
          {ratings.steam !== null && (
            <ScoreTile
              icon={ThumbsUp}
              label="STEAM"
              color={STEAM_BLUE}
              score={ratings.steam}
              suffix="%"
              countLabel={`${formatCount(ratings.steamCount)} reviews`}
            />
          )}
        </div>
      ) : (
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          No ratings on IGDB yet — check back once more people have played it.
        </p>
      )}
    </DetailCard>
  );
};

// ── Notes ──────────────────────────────────────────────────────────────────

// En markdown, igual que en el escritorio. Solo lectura: la web no escribe
// (§1.1), así que sin notas la sección no existe — la invitación a escribirlas
// que sí tiene el escritorio aquí sería un botón que no lleva a ninguna parte.
//
// Al final del fichero quedaba un `EmptyNotesHint` exportado "para el caso sin
// nada" que no importaba nadie: era el placeholder que esta decisión ya había
// rechazado, esperando a que alguien lo montara sin leer estas tres líneas.
export const NotesSection = ({ notes }: { notes: string | null }): React.JSX.Element | null => {
  if (!notes) return null;

  return (
    <section>
      <SectionLabel className="mb-2.5">NOTES</SectionLabel>
      <div className="rounded-[14px] border border-border bg-card px-4 py-3.5">
        <div className="prose-afterplay text-[12.5px] leading-relaxed text-muted-foreground">
          <ReactMarkdown>{notes}</ReactMarkdown>
        </div>
      </div>
    </section>
  );
};

// ── Curiosidades ───────────────────────────────────────────────────────────

export const CuriositiesSection = ({
  curiosities,
}: {
  curiosities: string[];
}): React.JSX.Element | null => {
  if (curiosities.length === 0) return null;

  return (
    <section>
      <SectionLabel className="mb-2.5">DID YOU KNOW</SectionLabel>
      <div className="flex flex-col gap-2">
        {curiosities.map((text, index) => (
          <div
            key={index}
            className="flex gap-2.5 rounded-[12px] border border-border bg-card px-3.5 py-3"
          >
            <Lightbulb size={13} className="mt-0.5 flex-none text-muted-foreground/50" />
            <p className="text-[12px] leading-relaxed text-muted-foreground">{text}</p>
          </div>
        ))}
      </div>
    </section>
  );
};
