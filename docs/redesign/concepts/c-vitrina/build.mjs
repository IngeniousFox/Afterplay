import { writeFileSync } from 'node:fs';
import { home, library, detail } from './screens-a.mjs';
import { sessions, plan, settings } from './screens-b.mjs';
import { tv, pwa } from './screens-c.mjs';

const out = { home, library, detail, sessions, plan, settings, tv, pwa };
for (const [n, f] of Object.entries(out)) writeFileSync(new URL(`./${n}.html`, import.meta.url), f());
console.log('html listo');
