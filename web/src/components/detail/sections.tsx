import { ChevronDown, HardDrive, Lightbulb, Newspaper, Tag, ThumbsUp, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { GameDetail } from '../../api';
import { cn } from '../../lib/cn';
import { formatByPrecision, formatCount, formatRelease } from '../../lib/format';
import { resolveRatings } from '../../lib/ratings';
import { Cell, CardTitle, DetailCard, InfoChip, SectionLabel } from './primitives';

// Un bloque de píldoras con su título dentro de Details.
const ChipGroup = ({
  label,
  Icon,
  children,
}: {
  label: string;
  Icon?: LucideIcon;
  children: React.ReactNode;
}): React.JSX.Element => (
  <div className="mt-4 border-t border-line pt-3">
    <div className="mb-2 flex items-center gap-1.5 text-micro text-dust">
      {Icon && <Icon size={12} aria-hidden="true" />}
      {label}
    </div>
    <div className="flex flex-wrap gap-1.5">{children}</div>
  </div>
);

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

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3">
        <Cell label="Developer" value={game.developer ?? '—'} />
        <Cell label="Publisher" value={game.publisher ?? '—'} />
        {/* La fecha COMPLETA cuando de verdad se sabe: "March 17, 2017" si
            IGDB conoce el día, "March 1995" si solo el mes, "1995" si solo el
            año — nunca un día inventado. */}
        <Cell label="Released" value={formatRelease(game) ?? '—'} />
        {/* Un endless nunca llega a "Beaten", así que "replayed" no significa
            nada para él: su única forma de generar una iteración nueva es
            Dropped -> empezar de cero, que no es volver a jugarlo entero. */}
        {game.endless ? (
          <Cell label="Last played" value={recentActivity} />
        ) : (
          <>
            <Cell label="Replayed" value={replaysLabel} />
            <Cell label="Last played" value={recentActivity} />
          </>
        )}
      </div>

      {game.officialPlatforms && game.officialPlatforms.length > 0 && (
        <ChipGroup label="Platforms">
          {game.officialPlatforms.map((platform) => (
            <InfoChip key={platform}>{platform}</InfoChip>
          ))}
        </ChipGroup>
      )}

      {game.genres && game.genres.length > 0 && (
        <ChipGroup label="Genres">
          {game.genres.map((genre) => (
            <InfoChip key={genre}>{genre}</InfoChip>
          ))}
        </ChipGroup>
      )}

      {/* Las etiquetas de Steam, justo debajo de los géneros: son lo mismo
          —cómo se clasifica este juego— dicho por quien lo ha jugado. Sin
          cifra: el número que traen es un PESO relativo de Steam, no un
          recuento de personas. El orden ya dice lo que importa. */}
      {game.steamTags && game.steamTags.length > 0 && (
        <ChipGroup label="Steam tags" Icon={Tag}>
          {game.steamTags.map((tag) => (
            <InfoChip key={tag.name} title="Player tag on Steam">
              {tag.name}
            </InfoChip>
          ))}
        </ChipGroup>
      )}

      {/* Dónde está instalado: el dispositivo, nunca su ruta (F-31). */}
      {game.installedOn.length > 0 && (
        <ChipGroup label="Installed on">
          {game.installedOn.map((device) => (
            <InfoChip key={device.deviceId} Icon={HardDrive}>
              {device.deviceName}
            </InfoChip>
          ))}
        </ChipGroup>
      )}
    </DetailCard>
  );
};

// ── About ──────────────────────────────────────────────────────────────────

// La sinopsis de IGDB. Es `summary` y NUNCA `storyline`: el segundo es la
// trama entera, más largo y con spoilers de un juego que precisamente aún no
// has jugado.
//
// Siempre nace recogida: quien quiera leerla tiene el "Read more" a un toque.
export const AboutCard = ({ game }: { game: GameDetail }): React.JSX.Element | null => {
  const [expanded, setExpanded] = useState(false);
  if (!game.summary) return null;

  // El "Read more" solo si de verdad hay recorte. El ancho de la columna es
  // conocido (un móvil) y el umbral cae muy lejos de la frontera.
  const clamped = game.summary.length > 180;

  return (
    <section>
      <div className="flex items-baseline justify-between gap-3">
        <SectionLabel>About</SectionLabel>
        <span className="text-micro text-dust">via IGDB</span>
      </div>

      <p className={cn('mt-1.5 text-body text-dust', clamped && !expanded && 'line-clamp-4')}>
        {game.summary}
      </p>

      {clamped && (
        <button
          type="button"
          onClick={() => setExpanded((previous) => !previous)}
          aria-expanded={expanded}
          className="-ml-1 inline-flex min-h-11 items-center gap-1 rounded-sm px-1 text-small font-semibold text-tube focus-visible:outline-2 focus-visible:outline-phosphor"
        >
          {expanded ? 'Show less' : 'Read more'}
          <ChevronDown
            size={15}
            aria-hidden="true"
            className={cn(
              'transition-transform duration-200 motion-reduce:transition-none',
              expanded && 'rotate-180',
            )}
          />
        </button>
      )}
    </section>
  );
};

// ── Ratings ────────────────────────────────────────────────────────────────

const ScoreTile = ({
  icon: Icon,
  label,
  score,
  suffix,
  countLabel,
}: {
  icon: LucideIcon;
  label: string;
  // null = sin muestra suficiente. El tile se queda apagado con el motivo
  // debajo en vez de desaparecer.
  score: number | null;
  suffix?: string;
  countLabel: string;
}): React.JSX.Element => {
  const active = score !== null;
  return (
    <div
      className={cn(
        'min-w-0 flex-1 rounded-sm border px-2.5 py-2',
        active ? 'border-line-strong bg-raised' : 'border-line bg-panel',
      )}
    >
      <div className="flex items-center gap-1 text-micro text-dust">
        <Icon size={12} aria-hidden="true" />
        {label}
      </div>
      <div
        className={cn(
          'mt-0.5 font-display text-[30px] leading-8 font-bold',
          active ? 'text-bone' : 'text-dust',
        )}
      >
        {active ? `${score}${suffix ?? ''}` : '—'}
      </div>
      <div className="text-micro text-dust">{countLabel}</div>
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
    <section>
      <div className="flex items-baseline justify-between gap-3">
        <SectionLabel>Ratings</SectionLabel>
        <span className="text-micro text-dust">out of 100</span>
      </div>
      <p className="mt-0.5 mb-3 text-small text-dust">
        Critics cover modern releases; players cover the classics.
      </p>

      {hasAny ? (
        <div className="flex gap-2">
          <ScoreTile
            icon={Newspaper}
            label="Critics"
            score={ratings.critics}
            countLabel={
              ratings.critics !== null
                ? `${formatCount(ratings.criticsCount)} ${ratings.criticsCount === 1 ? 'review' : 'reviews'}`
                : 'No critic reviews'
            }
          />
          <ScoreTile
            icon={Users}
            label="Players"
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
              label="Steam"
              score={ratings.steam}
              suffix="%"
              countLabel={`${formatCount(ratings.steamCount)} reviews`}
            />
          )}
        </div>
      ) : (
        <p className="text-small text-dust">
          No ratings on IGDB yet. Check back once more people have played it.
        </p>
      )}
    </section>
  );
};

// ── Notes ──────────────────────────────────────────────────────────────────

// En markdown, igual que en el escritorio. Solo lectura: la web no escribe
// (§1.1), así que sin notas la sección no existe — una invitación a escribirlas
// aquí sería un botón que no lleva a ninguna parte.
//
// La PWA no lleva el plugin de tipografía del escritorio (notesProseClass), así
// que los elementos de markdown se estilan aquí con variantes de hijo.
const notesClass = cn(
  'text-body text-bone',
  '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
  '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5',
  '[&_li]:marker:text-phosphor [&_a]:text-tube [&_a]:underline [&_strong]:font-semibold',
  '[&_h1]:mt-3 [&_h1]:font-display [&_h1]:text-[24px] [&_h1]:font-bold',
  '[&_h2]:mt-3 [&_h2]:font-display [&_h2]:text-[21px] [&_h2]:font-bold',
  '[&_h3]:mt-3 [&_h3]:font-display [&_h3]:text-[18px] [&_h3]:font-bold',
  '[&_blockquote]:border-l-2 [&_blockquote]:border-line-strong [&_blockquote]:pl-3 [&_blockquote]:text-dust',
  '[&_code]:rounded-sm [&_code]:bg-inset [&_code]:px-1 [&_hr]:my-3 [&_hr]:border-line',
);

export const NotesSection = ({ notes }: { notes: string | null }): React.JSX.Element | null => {
  if (!notes) return null;

  return (
    <section>
      <SectionLabel className="mb-1.5">Notes</SectionLabel>
      <div className={notesClass}>
        <ReactMarkdown>{notes}</ReactMarkdown>
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
      <SectionLabel className="mb-2">Did you know</SectionLabel>
      <ul className="flex flex-col gap-2">
        {curiosities.map((text, index) => (
          <li
            key={index}
            className="flex gap-2.5 rounded-md border border-line bg-panel px-3 py-2.5"
          >
            <Lightbulb size={15} className="mt-0.5 shrink-0 text-phosphor" aria-hidden="true" />
            <p className="text-small text-dust">{text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
};
