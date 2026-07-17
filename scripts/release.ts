import axios from 'axios';
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Publica una release de Afterplay en GitHub con changelog automático — sin
// esto, electron-builder sube los artefactos pero deja la release como
// BORRADOR y sin notas (su comportamiento por defecto). Este script hace
// las tres cosas que ese flujo no cubre solo: (1) genera el changelog desde
// los commits desde la última release, (2) manda a electron-builder a
// compilar y subir, (3) rellena las notas y quita el borrador — todo con
// GH_TOKEN, sin depender de tener el CLI de `gh` instalado.
//
// Uso: npm run release:win  (con GH_TOKEN en el entorno — el mismo que ya
// usa electron-builder para publicar).

const OWNER = 'IngeniousFox';
const REPO = 'Afterplay';

const projectRoot = resolve(fileURLToPath(import.meta.url), '../..');

const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
if (!token) {
  console.error('[release] falta GH_TOKEN (o GITHUB_TOKEN) en el entorno.');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf-8')) as {
  version: string;
};
// vPrefixedTagName es true por defecto en electron-builder — mismo formato
// de tag que la release que va a crear, para poder encontrarla después.
const tag = `v${pkg.version}`;

// Changelog = mensajes de commit desde el último tag (sin merges). Primera
// release (sin tags todavía) — se listan todos.
const previousTag = (() => {
  try {
    return execSync('git describe --tags --abbrev=0', { cwd: projectRoot }).toString().trim();
  } catch {
    return null;
  }
})();

const range = previousTag ? `${previousTag}..HEAD` : '';
const commitLog = execSync(`git log ${range} --pretty=format:%s --no-merges`, {
  cwd: projectRoot,
})
  .toString()
  .trim();

const changelog = commitLog
  ? commitLog
      .split('\n')
      .map((line) => `- ${line}`)
      .join('\n')
  : '_No changes recorded since the last release._';

const run = (command: string, args: string[]): void => {
  const result = spawnSync(command, args, { cwd: projectRoot, stdio: 'inherit', shell: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

// tsx compila este archivo como CJS (el proyecto no es "type": "module"),
// que no admite await a nivel superior — de ahí la función envolvente, igual
// que scripts/push-migrations-to-turso.ts.
const main = async (): Promise<void> => {
  console.log(`[release] compilando y publicando ${tag}...`);
  run('npm', ['run', 'build']);
  // --publish always: crea (o actualiza) la release en GitHub como BORRADOR
  // con el instalador + latest.yml + blockmap — falta rellenar las notas y
  // quitarle el borrador, que es justo lo que viene abajo.
  run('npx', ['electron-builder', '--win', '--publish', 'always']);

  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };

  console.log(`[release] rellenando changelog de ${tag}...`);
  // NO se puede usar GET /releases/tags/{tag} — ese endpoint solo devuelve
  // releases YA PUBLICADAS (confirmado en la doc de GitHub: "Get a
  // PUBLISHED release..."), y electron-builder la deja como borrador por
  // defecto. El listado sí incluye borradores para quien tiene push access,
  // así que se busca ahí por tag_name.
  const { data: releases } = await axios.get<{ id: number; tag_name: string }[]>(
    `https://api.github.com/repos/${OWNER}/${REPO}/releases`,
    { headers, params: { per_page: 50 } },
  );
  const release = releases.find((candidate) => candidate.tag_name === tag);
  if (!release) {
    console.error(
      `[release] electron-builder dijo que publicó, pero no encuentro ninguna release (borrador o no) con el tag ${tag}.`,
    );
    process.exit(1);
  }

  await axios.patch(
    `https://api.github.com/repos/${OWNER}/${REPO}/releases/${release.id}`,
    { body: changelog, draft: false },
    { headers },
  );

  console.log(`[release] ${tag} publicada:\n${changelog}`);
};

main();
