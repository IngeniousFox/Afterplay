import { spawn } from 'node:child_process';
import { isValidProfileName } from '../src/main/lib/devProfileRules';

// Arranca la app en desarrollo dentro de un PERFIL (lib/devProfile.ts): su
// propia carpeta de datos, sin tocar la de la app instalada.
//
//   npm run dev:v2            -> perfil "v2"
//   tsx scripts/dev-profile.ts otro-nombre
//
// Existe como script, y no como `set VAR=... && electron-vite dev` en el
// package.json, porque esa sintaxis depende de con qué shell lance npm los
// scripts. Aquí la variable se pone en el entorno del proceso hijo y ya.

const profile = process.argv[2] ?? 'v2';

if (!isValidProfileName(profile)) {
  console.error(
    `"${profile}" no vale como nombre de perfil (minúsculas, dígitos y guiones, hasta 32 caracteres).`,
  );
  process.exit(1);
}

const child = spawn('npx', ['electron-vite', 'dev'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, AFTERPLAY_DEV_PROFILE: profile },
});

child.on('exit', (code) => process.exit(code ?? 0));
