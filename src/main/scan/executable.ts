import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

// Adivinar el .exe de un juego a partir de su carpeta. Al contrario que el
// listado de carpetas (que NO baja de nivel a propósito), esto sí recorre en
// profundidad: casi ningún juego deja su ejecutable en la raíz — está en
// Binaries/Win64, en Retail, en un subdirectorio con el nombre del motor…
//
// No hay forma de acertar siempre, así que esto PUNTÚA en vez de decidir: lo
// que devuelve es el candidato más probable, y el usuario lo ve y lo puede
// cambiar en el formulario antes de guardar. Preferimos no proponer nada a
// proponer un desinstalador.

// Cosas que NUNCA son el juego. Se comparan en minúsculas contra el nombre
// del ejecutable y contra la carpeta que lo contiene.
const NEVER = [
  'unins',
  'uninstall',
  'setup',
  'install',
  'redist',
  'vcredist',
  'directx',
  'dxsetup',
  'dotnet',
  'crashreport',
  'crashhandler',
  'crash_report',
  'error',
  'report',
  'launcher_installer',
  'benchmark',
  'config',
  'settings',
  'editor',
  'server',
  'dedicated',
  'anticheat',
  'easyanticheat',
  'battleye',
  'activation',
  'keygen',
  'patch',
];

// Carpetas que no vale la pena ni recorrer: engordan el escaneo y nunca
// tienen el ejecutable del juego.
const SKIP_DIRS = new Set([
  '_commonredist',
  'commonredist',
  'redist',
  '_redist',
  'directx',
  'dotnet',
  'vcredist',
  '_crack',
  'crack',
  'engine',
  'content',
  'plugins',
  'mods',
  'saves',
  'savegames',
  'screenshots',
  'logs',
  'cache',
]);

const MAX_DEPTH = 5;
// Cortafuegos: una carpeta de juego con decenas de miles de ficheros no debe
// convertir esto en un paseo de minutos. Con este tope se cubren de sobra
// los layouts reales y se sale antes en los patológicos.
const MAX_ENTRIES = 4000;

type Candidate = { path: string; name: string; dir: string; size: number; depth: number };

const collect = async (
  root: string,
  dir: string,
  depth: number,
  found: Candidate[],
  budget: { left: number },
): Promise<void> => {
  if (depth > MAX_DEPTH || budget.left <= 0) return;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    // Carpeta sin permisos o que desapareció a mitad — no es motivo para
    // tumbar el escaneo entero.
    return;
  }

  for (const entry of entries) {
    if (budget.left-- <= 0) return;
    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name.toLowerCase())) continue;
      await collect(root, full, depth + 1, found, budget);
      continue;
    }

    if (!entry.name.toLowerCase().endsWith('.exe')) continue;
    try {
      const info = await stat(full);
      found.push({
        path: full,
        name: entry.name,
        dir,
        size: info.size,
        depth,
      });
    } catch {
      // idem: un fichero ilegible no invalida el resto.
    }
  }
};

// Normaliza para comparar nombre de exe contra nombre de carpeta: fuera
// separadores y espacios, todo junto y en minúsculas. Así "BomberCrew.exe"
// casa con "Bomber Crew" y "dotage.exe" con "dotAge".
const squash = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const score = (candidate: Candidate, folderName: string): number => {
  const name = candidate.name.toLowerCase().replace(/\.exe$/, '');
  const haystack = `${candidate.dir.toLowerCase()}/${name}`;

  // Descalificación directa: mejor no proponer nada que proponer el
  // desinstalador o el instalador de DirectX.
  if (NEVER.some((bad) => haystack.includes(bad))) return -1;

  let points = 0;
  const squashedName = squash(name);
  const squashedFolder = squash(folderName);

  // Coincidir con el nombre de la carpeta es la señal más fuerte que hay.
  if (squashedName === squashedFolder) points += 100;
  else if (squashedFolder.includes(squashedName) && squashedName.length >= 4) points += 60;
  else if (squashedName.includes(squashedFolder) && squashedFolder.length >= 4) points += 50;

  // Los shippings de Unreal (`FooGame-Win64-Shipping.exe`) son el ejecutable
  // de verdad; el `Foo.exe` de la raíz suele ser un lanzador de dos líneas.
  if (name.includes('shipping')) points += 45;
  if (name.endsWith('-win64') || name.includes('win64')) points += 10;

  // Un ejecutable de juego pesa; un lanzador o una utilidad, no. Escala
  // suave (log) para que un binario enorme no gane solo por serlo.
  points += Math.min(35, Math.log10(Math.max(1, candidate.size)) * 5);

  // A igualdad de todo, lo que está más arriba en el árbol suele ser el
  // punto de entrada.
  points -= candidate.depth * 3;

  return points;
};

export type ExecutableGuess = {
  path: string;
  // Cuántos ejecutables plausibles había. Con más de uno, la UI puede
  // advertir de que la elección es una apuesta y no un hecho.
  alternatives: number;
};

export const guessExecutable = async (
  gameDir: string,
  folderName: string,
): Promise<ExecutableGuess | null> => {
  const found: Candidate[] = [];
  await collect(gameDir, gameDir, 0, found, { left: MAX_ENTRIES });

  const ranked = found
    .map((candidate) => ({ candidate, points: score(candidate, folderName) }))
    .filter((entry) => entry.points >= 0)
    .sort((a, b) => b.points - a.points);

  if (ranked.length === 0) return null;
  return { path: ranked[0].candidate.path, alternatives: ranked.length };
};
