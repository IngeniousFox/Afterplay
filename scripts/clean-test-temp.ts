import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isTestTempDirectoryName, resolveTestTempDirectory } from './lib/testTempDirectories';

// Temporales de tests recogidos fuera de los procesos que abren SQLite.
//
// El andamio de los tests de unidad (db/__tests__/harness.ts) abre UNA base
// por proceso en una carpeta temporal, y cleanupDbs() suelta la conexion pero
// NO borra la carpeta. No era un descuido tonto: borrar la carpeta con el
// handle nativo de SQLite todavia vivo es justo una de las cosas que se
// probaron persiguiendo el crash 0xC0000005 (ver la cicatriz en harness.ts),
// asi que nadie quiso volver a meter un rmSync ahi dentro.
//
// El precio de no borrar se vio el 29-ago-2026: 32.586 carpetas
// `afterplay-test-*` acumuladas en %TEMP%.
//
// posttest recoge los restos DESPUÉS de que tsx --test y sus procesos hijos
// terminen: ningún handle nativo sigue vivo. pretest conserva la recuperación
// al empezar la siguiente pasada si la anterior falló o fue interrumpida
// (npm no ejecuta posttest cuando test falla). No ejecutar simultáneamente
// con otra suite independiente que esté usando sus propios temporales.
//
// Los sandboxes de E2E (afterplay-e2e-*) SI se borran solos al terminar cada
// test, pero entran igual en la barrida: una pasada interrumpida a media
// (Ctrl+C) deja el suyo, y aqui no cuesta nada.
//
// Solo familias de mkdtemp verificadas en los tests, con sus seis caracteres
// aleatorios completos. El prefijo afterplay- por si solo NO prueba que una
// carpeta sea desechable: tambien puede ser una copia de trabajo o backup.
// Una familia nueva debe añadirse a lib/testTempDirectories.ts expresamente.

const temp = tmpdir();
let removed = 0;
let failed = 0;

for (const entry of readdirSync(temp)) {
  if (!isTestTempDirectoryName(entry)) continue;
  try {
    const target = resolveTestTempDirectory(temp, entry);
    if (target === null) continue;
    rmSync(target, { recursive: true, force: true });
    removed += 1;
  } catch {
    // Una carpeta que no se deja borrar (antivirus, un proceso zombi) no
    // puede impedir que la suite arranque: se cuenta y se sigue.
    failed += 1;
  }
}

if (removed > 0 || failed > 0) {
  // Solo ASCII, convencion de la casa.
  console.log(`[test] limpiadas ${removed} carpetas temporales de tests (${failed} resistieron)`);
}
