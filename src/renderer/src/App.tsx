import { Button } from './components/ui/button';
import { Card } from './components/ui/card';
import { useGames } from './hooks/games';
import { tintVariants } from './lib/tint';

function App(): React.JSX.Element {
  const { data: games = [], isLoading, isError, error } = useGames();
  console.log({ games, isLoading, isError, error });

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 overflow-y-auto p-10">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6">
        <h1 className="text-lg font-bold text-foreground">Afterplay palette check</h1>
        <p className="mt-1 text-sm text-muted-foreground">Dark theme applied by default.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button className={tintVariants({ tone: 'primary', intensity: 'strong' })}>
            Stop (strong)
          </Button>
          <Button>Play</Button>
          <Button
            variant="secondary"
            className={tintVariants({ tone: 'secondary', intensity: 'strong' })}
          >
            Secondary tint
          </Button>
          <Button variant="outline">Outline</Button>
          <Button
            variant="destructive"
            className={tintVariants({ tone: 'destructive', intensity: 'strong' })}
          >
            Destructive
          </Button>
          <div
            className={`${tintVariants({ tone: 'primary', intensity: 'soft' })} flex items-center gap-2 rounded-xl px-4 py-3 text-sm tabular-nums`}
          >
            00:44:26
          </div>
          <Card>
            <p className="mr-4 ml-4">
              Lorem ipsum dolor sit amet consectetur adipisicing elit. Voluptates sed facilis quidem
              nobis fuga reprehenderit id enim illum, incidunt quo aliquam, veritatis ipsa non sint
              culpa pariatur voluptatem voluptatum dicta.
            </p>
          </Card>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">{games.length} juegos en la biblioteca</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Click en un juego para pedir su detalle (games:getById) y verlo en la consola.
        </p>
        <ul className="mt-2 space-y-1 text-sm text-foreground">
          {games.map((game) => (
            <li
              key={game.id}
              className="cursor-pointer underline decoration-dotted"
              onClick={() =>
                window.api.games.getById(game.id).then((detail) => console.log(detail))
              }
            >
              {game.title} — {game.totalHours.toFixed(1)}h — {game.sessionCount} sesiones —{' '}
              {game.currentState ?? 'sin empezar'} {game.isLive ? '🔴 LIVE' : ''}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default App;
