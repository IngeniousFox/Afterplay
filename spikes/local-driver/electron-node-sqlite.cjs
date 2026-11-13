// S-02, segunda parte: ¿trae el Node de Electron el módulo `node:sqlite`?
//
//   npx electron spikes/local-driver/electron-node-sqlite.cjs
//
// El núcleo de sync del spike (spikes/sync-core) es SÍNCRONO, igual que la API
// SQL de un Durable Object. `@libsql/client` es asíncrono, así que para que el
// escritorio ejecute ese mismo núcleo hace falta un driver síncrono. Este
// script solo comprueba que el candidato sin dependencias existe y funciona
// dentro del proceso main de Electron. No abre ventanas ni toca datos de nadie.
const { app } = require('electron');

app.whenReady().then(() => {
  const versions = `electron ${process.versions.electron} | node ${process.versions.node}`;
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER)');
    const insert = db.prepare('INSERT INTO t VALUES (?, ?)');
    db.exec('BEGIN');
    for (let index = 0; index < 50000; index++) insert.run(`row-${index}`, index);
    db.exec('COMMIT');
    const { total, version } = db
      .prepare('SELECT count(*) AS total, sqlite_version() AS version FROM t')
      .get();
    console.log(
      `[node:sqlite] DISPONIBLE en ${versions} | sqlite ${version} | ${total} filas insertadas`,
    );
  } catch (error) {
    console.log(`[node:sqlite] NO disponible en ${versions}: ${error.message}`);
  }
  app.quit();
});
