import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
export const dir = dirname(fileURLToPath(import.meta.url))

export const FONTS = 'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@400;500;600;700&family=Cinzel:wght@600;700&family=Cormorant+Garamond:wght@600;700&family=Bebas+Neue&family=Archivo+Black&family=Playfair+Display:wght@700;800&family=Space+Grotesk:wght@600;700&display=swap'

// icons
const P = {
  today: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/>',
  library: '<path d="M4 4v16M9 4v16M14 6l5 14M4 4h5"/>',
  plan: '<path d="M10 6h10M10 12h10M10 18h10M4 5l1.5-1v4M4 11.2c0-.9 2-.9 2 .2 0 1-2 1.6-2 2.6h2M4 17.4h2l-1.2 1.2c.8 0 1.2.4 1.2 1s-.6 1-1.2 1-1-.2-1.3-.5"/>',
  sessions: '<path d="M6 3.5h11a1 1 0 0 1 1 1V20H7a1 1 0 0 1-1-1zM6 17a1 1 0 0 1 1-1h11M9.5 8h5"/>',
  stats: '<path d="M5 20V11M12 20V4M19 20v-6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6"/>',
  play: '<path d="M7 5l12 7-12 7z" fill="currentColor"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.2-4.2"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  chev: '<path d="m6 9 6 6 6-6"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  more: '<circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>',
  euro: '<path d="M17 6.5A6.5 6.5 0 0 0 7.5 9.5M17 17.5a6.5 6.5 0 0 1-9.5-3M5 10.5h8M5 13.5h8"/>',
  pc: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14-4.5L4 9M4 4v5h5M4 13a8 8 0 0 0 14 4.5L20 15M20 20v-5h-5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  folder: '<path d="M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
  save: '<path d="M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6"/>',
  pad: '<path d="M7 8h10a4 4 0 0 1 4 4.2l-.6 4a2 2 0 0 1-3.4 1l-2-2.2h-4l-2 2.2a2 2 0 0 1-3.4-1l-.6-4A4 4 0 0 1 7 8zM8 11v3M6.5 12.5h3"/>',
  plug: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11h14V8M10 12h4"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  trash: '<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/>',
  hourglass: '<path d="M7 4h10M7 20h10M8 4c0 5 8 5 8 8s-8 3-8 8"/>'
}
export const ic = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24">${P[n]}</svg>`

// ---------- games ----------
export const G = {
  silksong: { t: 'Hollow Knight: Silksong', a: 'Silksong', c: ['#8f1226', '#2a0610', '#eadfc8'], p: 'rings', ff: 'Cinzel', tc: '#f4ead4', h: '24h 05m' },
  split: { t: 'Split Fiction', a: 'Split Fiction', c: ['#2c6bed', '#f08a24', '#fff3d6'], p: 'tri', ff: 'Bebas Neue', fw: 400, tt: 'uppercase', fs: '19cqw', h: '4h 45m' },
  exp33: { t: 'Clair Obscur: Expedition 33', a: 'Expedition 33', c: ['#c9a24b', '#15110b', '#f1dc9a'], p: 'rays', ff: 'Cormorant Garamond', tc: '#fff6dc', h: '38h 10m' },
  hades2: { t: 'Hades II', a: 'Hades II', c: ['#1d8a6b', '#04100d', '#8ff0c6'], p: 'moon', ff: 'Cinzel', h: '22h 05m' },
  balatro: { t: 'Balatro', a: 'Balatro', c: ['#cc2f2a', '#1b3a8c', '#ffd9a0'], p: 'diamond', ff: 'Archivo Black', fw: 400, tt: 'uppercase', fs: '15cqw', h: '61h 30m' },
  outer: { t: 'Outer Wilds', a: 'Outer Wilds', c: ['#e38a3c', '#1c2a55', '#ffd08a'], p: 'rings', ff: 'Space Grotesk', h: '19h 40m' },
  celeste: { t: 'Celeste', a: 'Celeste', c: ['#e8689b', '#3c2b7a', '#ffd0e4'], p: 'tri', ff: 'Playfair Display', h: '12h 15m' },
  disco: { t: 'Disco Elysium', a: 'Disco Elysium', c: ['#d9a441', '#3d2a22', '#f0d79a'], p: 'stripes', ff: 'Archivo Black', fw: 400, tt: 'uppercase', fs: '12cqw', h: '41h 20m' },
  hk: { t: 'Hollow Knight', a: 'Hollow Knight', c: ['#3b4a63', '#090d16', '#cfd8e8'], p: 'moon', ff: 'Cinzel', h: '52h 30m' },
  hades: { t: 'Hades', a: 'Hades', c: ['#c4332b', '#1b0707', '#ffb27a'], p: 'sun', ff: 'Cinzel', h: '47h 55m' },
  tunic: { t: 'Tunic', a: 'Tunic', c: ['#8cc66a', '#1f4a36', '#f4f0a0'], p: 'hills', ff: 'Playfair Display', h: '14h 05m' },
  obra: { t: 'Return of the Obra Dinn', a: 'Obra Dinn', c: ['#e9e2cc', '#2a2a2a', '#111'], p: 'stripes', ff: 'Playfair Display', tc: '#fff', h: '9h 10m' },
  sos: { t: 'Sea of Stars', a: 'Sea of Stars', c: ['#4aa3e0', '#241a5a', '#ffe9a0'], p: 'moon', ff: 'Space Grotesk', h: '26h 40m' },
  cocoon: { t: 'Cocoon', a: 'Cocoon', c: ['#f0a14a', '#6b2d5c', '#ffe3b5'], p: 'rings', ff: 'Space Grotesk', h: '7h 30m' },
  pentiment: { t: 'Pentiment', a: 'Pentiment', c: ['#c99a4a', '#5a2a1e', '#f4dfae'], p: 'arc', ff: 'Playfair Display', h: '' },
  inscr: { t: 'Inscryption', a: 'Inscryption', c: ['#7a5a35', '#120c07', '#d8b27a'], p: 'grid', ff: 'Cinzel', fs: '11cqw', h: '18h 15m' },
  dredge: { t: 'Dredge', a: 'Dredge', c: ['#2f7a78', '#0a1f26', '#f0b36a'], p: 'hills', ff: 'Playfair Display', h: '11h 50m' },
  animal: { t: 'Animal Well', a: 'Animal Well', c: ['#7b3fe4', '#0b0720', '#7ff0d8'], p: 'dots', ff: 'Space Grotesk', h: '' },
  lies: { t: 'Lies of P', a: 'Lies of P', c: ['#b8b0a0', '#16181c', '#e8d9a8'], p: 'arc', ff: 'Cinzel', h: '33h 05m' },
  alan: { t: 'Alan Wake 2', a: 'Alan Wake 2', c: ['#2a7a5a', '#0a1410', '#e8c46a'], p: 'stripes', ff: 'Bebas Neue', fw: 400, tt: 'uppercase', fs: '18cqw', h: '21h 10m' },
  bg3: { t: "Baldur's Gate 3", a: "Baldur's Gate 3", c: ['#b8402a', '#1a0d12', '#f0c27a'], p: 'sun', ff: 'Cinzel', h: '112h 40m' },
  cyber: { t: 'Cyberpunk 2077', a: 'Cyberpunk 2077', c: ['#f2e23a', '#12141c', '#e8282f'], p: 'tri', ff: 'Bebas Neue', fw: 400, tt: 'uppercase', fs: '17cqw', tc: '#fff', h: '64h 25m' },
  stardew: { t: 'Stardew Valley', a: 'Stardew Valley', c: ['#6cc24a', '#2c6b3c', '#ffe27a'], p: 'sun', ff: 'Archivo Black', fw: 400, fs: '12cqw', h: '88h 05m' },
  sts: { t: 'Slay the Spire', a: 'Slay the Spire', c: ['#a8402e', '#2a1218', '#f5d890'], p: 'diamond', ff: 'Cinzel', h: '73h 15m' },
  ori: { t: 'Ori and the Will of the Wisps', a: 'Ori Wisps', c: ['#5fd0e8', '#1a2a66', '#ffffff'], p: 'moon', ff: 'Space Grotesk', h: '16h 20m' },
  ds: { t: 'Death Stranding', a: 'Death Stranding', c: ['#8a9aa8', '#10161c', '#f0f4f8'], p: 'arc', ff: 'Space Grotesk', h: '48h 35m' },
  elden: { t: 'Elden Ring', a: 'Elden Ring', c: ['#d9b45a', '#1a1710', '#fff1c0'], p: 'arc', ff: 'Cinzel', h: '134h 10m' },
  metaphor: { t: 'Metaphor: ReFantazio', a: 'Metaphor', c: ['#e8b23a', '#7a1f3c', '#fff0b8'], p: 'rays', ff: 'Playfair Display', fw: 800, h: '' },
  octo: { t: 'Octopath Traveler II', a: 'Octopath II', c: ['#4a6fd0', '#1a1f40', '#f4e6b0'], p: 'hills', ff: 'Cormorant Garamond', h: '' }
}

export function cv(key, o = {}) {
  const g = G[key]
  const [c1, c2, c3] = g.c
  const st = [`--c1:${c1}`, `--c2:${c2}`, `--c3:${c3}`, `--ff:'${g.ff}'`]
  if (g.fw) st.push(`--fw:${g.fw}`)
  if (g.tt) st.push(`--tt:${g.tt}`)
  if (g.fs) st.push(`--fs:${g.fs}`)
  if (g.tc) st.push(`--tc:${g.tc}`)
  if (o.w) st.push(`width:${o.w}px`)
  if (o.style) st.push(o.style)
  const wide = o.wide ? ' wide' : ''
  return `<div class="cv p-${g.p}${wide}" style="${st.join(';')}"><b>${g.a}</b>${o.live ? '<i class="dotlive"></i>' : ''}</div>`
}

export function head(title, extra = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}"><link rel="stylesheet" href="styles.css"><style>${extra}</style></head>`
}

export const NAV = [['today', 'Today'], ['library', 'Library'], ['plan', 'Plan'], ['sessions', 'Sessions'], ['stats', 'Stats']]
export function shell(active, inner, title = 'Afterplay', css = '') {
  const nav = NAV.map(([k, l]) => `<a class="${active === k ? 'on' : ''}">${ic(k)}${l}</a>`).join('')
  return head(title, css) + `<body><div class="win">
<aside class="side">
  <div class="logo">Afterplay<i></i></div>
  <nav class="nav">${nav}</nav>
  <div class="sp"></div>
  <nav class="nav"><a class="${active === 'settings' ? 'on' : ''}">${ic('settings')}Settings</a></nav>
  <div class="now">${cv('silksong', { w: 36 })}<div class="tx"><div class="nm">Hollow Knight: Silksong</div><div class="tm">1:12:04</div><div class="dv">Desk PC</div></div></div>
  <div class="sync"><span class="dot"></span>Up to date · 3 devices</div>
</aside>
<section class="main">
  <div class="tb"><span><svg viewBox="0 0 12 12"><path d="M1 6h10"/></svg></span><span><svg viewBox="0 0 12 12"><rect x="1.5" y="1.5" width="9" height="9"/></svg></span><span><svg viewBox="0 0 12 12"><path d="M1.5 1.5l9 9M10.5 1.5l-9 9"/></svg></span></div>
  <div class="page">${inner}</div>
</section></div></body></html>`
}

export function write(name, html) { writeFileSync(join(dir, name), html) }
