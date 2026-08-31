import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// LA BASURA QUE DEJAN LOS TESTS EN %TEMP%, RECOGIDA ANTES DE CADA PASADA.
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
// La solucion que no toca esa cicatriz: recogerlas DESDE FUERA, antes de que
// empiece la pasada siguiente, cuando no hay ni un proceso de test vivo y por
// tanto ningun handle que pueda pelearse con el borrado. Se ejecuta como
// `pretest`, asi que no hay que acordarse de nada.
//
// Los sandboxes de E2E (afterplay-e2e-*) SI se borran solos al terminar cada
// test, pero entran igual en la barrida: una pasada interrumpida a media
// (Ctrl+C) deja el suyo, y aqui no cuesta nada.
//
// EL PREFIJO ES `afterplay-` A SECAS, Y ESO ES DELIBERADO. La primera version
// listaba tres prefijos exactos y se dejaba fuera lo que mas pesaba: los
// andamios del worker se llaman `afterplay-worker-test-` y
// `afterplay-worker-paridad-`, que no empiezan por `afterplay-test-`. El
// barrido decia "0 restantes" con 13.890 carpetas delante. Hoy los prefijos
// vivos son ocho (test, e2e, keys, worker-test, worker-paridad, ficha-test,
// backups, migrations) y manana habra otro: una lista cerrada vuelve a
// quedarse corta sola.
//
// Barrer todo lo que empiece por `afterplay-` es seguro porque la app de
// PRODUCCION no crea ni una carpeta temporal: todo lo suyo cuelga de userData
// (comprobado). Aqui dentro solo hay andamios de test.
const PREFIXES = ['afterplay-'];

const temp = tmpdir();
let removed = 0;
let failed = 0;

for (const entry of readdirSync(temp)) {
  if (!PREFIXES.some((prefix) => entry.startsWith(prefix))) continue;
  try {
    rmSync(join(temp, entry), { recursive: true, force: true });
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
