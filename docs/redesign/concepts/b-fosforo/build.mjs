// Genera los HTML de la direccion B "Fosforo". Uso: node build.mjs
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const dir = dirname(fileURLToPath(import.meta.url))

/* ---------- datos ---------- */
const ST = { playing: '#FFB347', beaten: '#9BD67A', backlog: '#5FD3E0', resting: '#B9A6FF', dropped: '#8A9496' }
const STN = { playing: 'Playing', beaten: 'Beaten', backlog: 'Backlog', resting: 'Resting', dropped: 'Dropped' }
const SER = "'Playfair Display',serif"
const G = {
  silk: { n: 'Hollow Knight: Silksong', s: 'Silksong', a: '#9A1530', b: '#1B0509', c: '#EDE3CC', t: '#F6EEDB', k: 2, ts: '21cqw' },
  split: { n: 'Split Fiction', s: 'Split<br>Fiction', a: '#1F5FE0', b: '#F2792B', c: '#FFFFFF', k: 2, ts: '20cqw' },
  clair: { n: 'Clair Obscur: Expedition 33', s: 'Clair Obscur<br>Expedition 33', a: '#241C30', b: '#0A080E', c: '#D8AE5A', t: '#EBCB82', f: SER, tt: 'none', k: 4, ts: '12.5cqw' },
  hades2: { n: 'Hades II', s: 'Hades II', a: '#0F6B55', b: '#03100C', c: '#58E8B6', t: '#C6F7E5', k: 1, ts: '24cqw' },
  balatro: { n: 'Balatro', s: 'Balatro', a: '#B8232F', b: '#1D3F9C', c: '#F3E8C8', k: 2, ts: '25cqw' },
  outer: { n: 'Outer Wilds', s: 'Outer<br>Wilds', a: '#C95E24', b: '#1A1030', c: '#F8CB78', k: 1, ts: '23cqw' },
  celeste: { n: 'Celeste', s: 'Celeste', a: '#67AEEA', b: '#7B3F8F', c: '#FFFFFF', k: 5, ts: '24cqw' },
  disco: { n: 'Disco Elysium', s: 'Disco<br>Elysium', a: '#DB6E2C', b: '#2A2829', c: '#EBD8AA', k: 3, ts: '21cqw' },
  hollow: { n: 'Hollow Knight', s: 'Hollow<br>Knight', a: '#1D2838', b: '#05070B', c: '#C2D3E8', k: 1, ts: '21cqw' },
  hades: { n: 'Hades', s: 'Hades', a: '#A7151F', b: '#1A0507', c: '#F4AC3E', k: 4, ts: '26cqw' },
  tunic: { n: 'Tunic', s: 'Tunic', a: '#4F9D5B', b: '#12261A', c: '#F4D86E', k: 5, ts: '26cqw' },
  obra: { n: 'Return of the Obra Dinn', s: 'Obra<br>Dinn', a: '#E9E2CD', b: '#2B2B29', c: '#151515', t: '#F5F1E4', k: 3, ts: '25cqw' },
  sea: { n: 'Sea of Stars', s: 'Sea of<br>Stars', a: '#2C4DAA', b: '#E47D5C', c: '#FDE8A8', k: 1, ts: '23cqw' },
  cocoon: { n: 'Cocoon', s: 'Cocoon', a: '#EBB64E', b: '#2F5F75', c: '#FFFFFF', k: 1, ts: '24cqw' },
  pent: { n: 'Pentiment', s: 'Pentiment', a: '#BA8F4E', b: '#4B2C1F', c: '#F3E4BA', f: SER, tt: 'none', k: 3, ts: '15cqw' },
  inscr: { n: 'Inscryption', s: 'Inscryption', a: '#3C2B1D', b: '#0B0806', c: '#CBA56B', f: SER, tt: 'none', k: 4, ts: '13.5cqw' },
  dredge: { n: 'Dredge', s: 'Dredge', a: '#1F505B', b: '#0A1417', c: '#E3A64E', k: 3, ts: '25cqw' },
  well: { n: 'Animal Well', s: 'Animal<br>Well', a: '#2C1C5C', b: '#0B0B1F', c: '#5DF4C8', k: 4, ts: '23cqw' },
  lies: { n: 'Lies of P', s: 'Lies<br>of P', a: '#718089', b: '#14181C', c: '#E8DAB2', k: 2, ts: '25cqw' },
  wake: { n: 'Alan Wake 2', s: 'Alan<br>Wake 2', a: '#1F6E4C', b: '#0B1A14', c: '#E8E3AA', k: 2, ts: '24cqw' },
  bg3: { n: "Baldur's Gate 3", s: "Baldur's<br>Gate 3", a: '#7D1F30', b: '#1A0B14', c: '#E9CB92', f: SER, tt: 'none', k: 1, ts: '15cqw' },
  cyber: { n: 'Cyberpunk 2077', s: 'Cyberpunk<br>2077', a: '#F4E41C', b: '#D13A1E', c: '#00D8E8', t: '#FFFFFF', k: 2, ts: '16cqw' },
  stardew: { n: 'Stardew Valley', s: 'Stardew<br>Valley', a: '#70B65C', b: '#2F6EA8', c: '#F6D75F', k: 1, ts: '20cqw' },
  slay: { n: 'Slay the Spire', s: 'Slay the<br>Spire', a: '#5E3B2A', b: '#17100D', c: '#E86F3E', k: 5, ts: '22cqw' },
  meta: { n: 'Metaphor: ReFantazio', s: 'Metaphor<br>ReFantazio', a: '#7C40B8', b: '#EBA83B', c: '#FFFFFF', f: SER, tt: 'none', k: 5, ts: '14.5cqw' },
  octo: { n: 'Octopath Traveler II', s: 'Octopath<br>Traveler II', a: '#2F62A4', b: '#EBD9A8', c: '#FFFFFF', f: SER, tt: 'none', k: 1, ts: '14.5cqw' }
}
const vars = (g) => `--a:${g.a};--b:${g.b};--c:${g.c};${g.t ? `--t:${g.t};` : ''}${g.f ? `--f:${g.f};` : ''}${g.tt ? `--tt:${g.tt};` : ''}--ts:${g.ts}`
const cv = (k, o = {}) => {
  const g = G[k]
  return `<div class="art cv s${g.k} ${o.h !== undefined ? 'hs' : ''} ${o.cls || ''}" style="${vars(g)}"><span class="ct">${g.s}</span>${o.st ? `<i class="led" style="--st:${ST[o.st]}"></i>` : ''}${o.num ? `<span class="num">${o.num}</span>` : ''}${o.h !== undefined ? `<b class="hr">${o.h}</b>` : ''}</div>`
}
const bn = (k, hero = true, title = true) => {
  const g = G[k]
  return `<div class="art bn s${g.k} ${hero ? 'hero' : ''}" style="${vars(g)}">${title ? `<span class="bt">${g.s}</span>` : ''}</div>`
}
const dot = (st) => `<i class="dot" style="--st:${ST[st]}"></i>`
const chip = (st) => `<span class="chip">${dot(st)}${STN[st]}</span>`

const P = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  note: '<path d="M5 4h14v12l-4 4H5z"/><path d="M15 20v-4h4M8.5 9h7M8.5 12.5h4"/>',
  edit: '<path d="M4 20h4l11-11-4-4L4 16z"/>',
  euro: '<path d="M17.5 6.5A7 7 0 1 0 17.5 17.5M4 10.5h9M4 13.5h9"/>',
  drag: '<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>',
  pc: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
  home: '<path d="M4 11 12 4l8 7v9h-5v-6H9v6H4z"/>',
  lib: '<rect x="4" y="4" width="4.5" height="16" rx="1"/><rect x="10" y="4" width="4.5" height="16" rx="1"/><path d="m16.5 6 3.5-.8 3 13-3.5.8z" transform="translate(-2 0)"/>',
  plan: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
  up: '<path d="m6 14 6-6 6 6"/>',
  down: '<path d="m6 10 6 6 6-6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  list: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14-4M4 5v3h3M4 13a8 8 0 0 0 14 4M20 19v-3h-3"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  db: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
  kbd: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/>',
  palette: '<path d="M12 4a8 8 0 1 0 0 16c1.5 0 2-1 1.5-2s0-2 1.5-2h2a3 3 0 0 0 3-3 9 9 0 0 0-8-9z"/>',
  chart: '<path d="M5 20V10M12 20V4M19 20v-7"/>'
}
const ic = (k, extra = '') => `<svg class="i ${extra}" viewBox="0 0 24 24">${P[k]}</svg>`
const icf = (k) => ic(k, 'f')

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Big+Shoulders+Display:wght@600;700;800&family=Playfair+Display:wght@700;800&display=swap" rel="stylesheet">`
const doc = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><meta name="viewport" content="width=device-width,initial-scale=1">${FONTS}<link rel="stylesheet" href="styles.css"></head><body>${body}</body></html>`

const logoSvg = `<svg width="26" height="26" viewBox="0 0 26 26" fill="none"><rect x="1" y="3" width="24" height="18" rx="4" stroke="#FFB347" stroke-width="2"/><path d="M10.5 8.2v7.6l6.2-3.8z" fill="#FFB347"/><path d="M8 24h10" stroke="#FFB347" stroke-width="2" stroke-linecap="round"/></svg>`

/* ---------- shell de escritorio ---------- */
const TABS = ['Home', 'Library', 'Plan', 'Sessions', 'Stats']
const np = `<footer class="np">${cv('silk')}<div><div class="nm">Hollow Knight: Silksong</div><div class="sub"><i class="pulse"></i>Playing on Desk PC · since 19:40</div></div><div class="timer">1:12:04</div><button class="btn live">${icf('stop')}Stop</button><div class="sp"></div><button class="btn">${ic('note')}Add note</button></footer>`
const shell = (title, active, inner) => doc(title, `<div class="app"><header class="top"><div class="logo">${logoSvg}Afterplay</div><nav class="tabs">${TABS.map((t) => `<a class="tab ${t === active ? 'on' : ''}">${t}</a>`).join('')}</nav><div class="search">${ic('search')}<span>Search your library</span><kbd>Ctrl K</kbd></div><div class="sync"><i></i>Synced</div><div class="gear">${ic('gear')}</div></header><main class="main">${inner}</main>${np}</div>`)

const hm = (m) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`

/* ---------- HOME ---------- */
function home() {
  const days = [['Mon', 93], ['Tue', 0], ['Wed', 150], ['Thu', 0], ['Fri', 175], ['Sat', 325], ['Sun', 117]]
  const bars = days.map(([d, m], i) => `<div class="${i === 6 ? 't' : ''}"><i style="height:${Math.max(3, (m / 325) * 66)}px"></i><span>${d}</span></div>`).join('')
  const play = [['silk', '23h 15m'], ['clair', '38h 10m'], ['balatro', '61h 30m'], ['hades2', '22h 05m'], ['split', '4h 45m']]
  const next = [['meta', 'HLTB 70h'], ['pent', 'HLTB 20h'], ['well', 'HLTB 6h'], ['lies', 'HLTB 30h'], ['octo', 'HLTB 55h']]
  const beat = [['outer', 'Nov 14'], ['celeste', 'Nov 9'], ['tunic', 'Nov 2'], ['hades', 'Oct 26'], ['obra', 'Oct 19'], ['cocoon', 'Oct 12'], ['hollow', 'Oct 4'], ['disco', 'Sep 28'], ['slay', 'Sep 21'], ['stardew', 'Sep 15'], ['bg3', 'Sep 3'], ['sea', 'Aug 29']]
  const it = (k, m, o) => `<div class="it">${cv(k, o)}<div class="cap">${G[k].n}</div><div class="meta">${m}</div></div>`
  return shell('Afterplay - Home', 'Home', `<div class="home">
  <div class="pgh"><h1>Tonight</h1><span class="dust">Sunday, November 22 · 20:52</span></div>
  <section class="row1">
    <article class="cont panel"><div class="bnw">${bn('silk')}</div><div class="ci">
      <div class="lab"><i class="pulse"></i>Session running on Desk PC</div>
      <h2>Hollow Knight: Silksong</h2>
      <div class="facts"><div class="fact"><b style="color:var(--phos)">1:12:04</b><span>this session</span></div><div class="fact"><b>23h 15m</b><span>total played</span></div><div class="fact"><b>11</b><span>sessions</span></div></div>
      <div class="acts"><button class="btn pri">Open game</button><button class="btn">${ic('note')}Add note</button></div>
    </div></article>
    <article class="week panel"><div class="hd"><span>This week</span><span class="dust" style="font-weight:400;font-size:13px">Nov 16 to Nov 22</span></div>
      <div class="figs"><div class="fig k"><b>14<small>h</small>20<small>m</small></b><span>played</span></div><div class="fig"><b>9</b><span>sessions</span></div><div class="fig"><b>3</b><span>games</span></div></div>
      <div class="bars">${bars}</div></article>
  </section>
  <section class="band">
    <div class="sh"><h3>Playing <em>5 games</em><a>See all</a></h3><div class="rail">${play.map(([k, m]) => it(k, m, { st: 'playing' })).join('')}</div></div>
    <div class="sh"><h3>Up next <em>from your plan</em><a>Open plan</a></h3><div class="rail">${next.map(([k, m], i) => it(k, m, { num: i + 1 })).join('')}</div></div>
  </section>
  <section class="sh"><h3>Recently beaten <em>142 in total</em><a>See all</a></h3><div class="rail tight">${beat.map(([k, d]) => `<div class="it">${cv(k, { st: 'beaten', h: d })}</div>`).join('')}</div></section>
  </div>`)
}

/* ---------- LIBRARY ---------- */
const LIB = [
  ['silk', 'playing', '23h 15m'], ['split', 'playing', '4h 45m'], ['clair', 'playing', '38h 10m'], ['hades2', 'playing', '22h 05m'], ['balatro', 'playing', '61h 30m'], ['outer', 'beaten', '24h 10m'], ['celeste', 'beaten', '9h 40m'], ['disco', 'beaten', '31h 05m'],
  ['hollow', 'beaten', '52h 20m'], ['hades', 'beaten', '47h 20m'], ['tunic', 'beaten', '14h 00m'], ['obra', 'beaten', '11h 30m'], ['sea', 'backlog', '3h 00m'], ['cocoon', 'beaten', '6h 10m'], ['pent', 'backlog', 'Not played'], ['inscr', 'resting', '8h 00m'],
  ['dredge', 'resting', '5h 20m'], ['well', 'backlog', 'Not played'], ['lies', 'backlog', '2h 05m'], ['wake', 'resting', '12h 40m'], ['bg3', 'resting', '74h 15m'], ['cyber', 'dropped', '9h 10m'], ['stardew', 'resting', '120h 30m'], ['slay', 'beaten', '88h 45m']
]
function library() {
  const sts = [['All games', 331, null, true], ['Playing', 5, 'playing'], ['Beaten', 142, 'beaten'], ['Backlog', 96, 'backlog'], ['Resting', 61, 'resting'], ['Dropped', 27, 'dropped']]
  const fl = sts.map(([l, n, s, on]) => `<div class="fl ${on ? 'on' : ''}">${s ? dot(s) : ic('grid')}<span>${l}</span><span class="n">${n}</span></div>`).join('')
  const plat = [['PC', 318, 1], ['Steam Deck', 74, 0], ['Nintendo Switch', 9, 0], ['PlayStation', 4, 0]].map(([l, n, on]) => `<div class="fl"><i class="bx ${on ? 'on' : ''}"></i><span>${l}</span><span class="n">${n}</span></div>`).join('')
  const ord = ['Recently played', 'Name', 'Most hours', 'Recently added', 'Release year'].map((l, i) => `<div class="fl"><i class="rd ${i === 0 ? 'on' : ''}"></i><span>${l}</span></div>`).join('')
  return shell('Afterplay - Library', 'Library', `<div class="lib"><aside class="flt">
    <div><h4>Status</h4>${fl}</div>
    <div><h4>Platform</h4>${plat}</div>
    <div><h4>This PC</h4><div class="fl">${ic('pc')}<span>Installed on this PC</span><i class="tg on"></i></div></div>
    <div><h4>Order</h4>${ord}</div>
  </aside><section class="libm"><div class="libh"><span class="big">331</span><span>games</span><div class="ctl"><button class="btn">${ic('sliders')}Sorted by recently played</button><div class="seg"><span class="on">${ic('grid')}</span><span>${ic('list')}</span></div><button class="btn pri">${ic('plus')}Add game</button></div></div>
    <div class="grid8">${LIB.map(([k, s, h]) => `<div>${cv(k, { st: s, h })}<div class="cap">${G[k].n}</div></div>`).join('')}</div></section></div>`)
}

/* ---------- DETAIL ---------- */
function detail() {
  const segs = Array.from({ length: 62 }, (_, i) => `<i class="${i < 38 ? 'f' : i === 38 ? 'p' : ''}"></i>`).join('')
  const pos = (h) => `${((h / 62) * 100).toFixed(1)}%`
  return shell('Afterplay - Clair Obscur: Expedition 33', 'Library', `<div class="det">
  <div class="dban">${bn('clair', true, false)}<div style="position:absolute;inset:0;z-index:1;background:radial-gradient(45% 100% at 80% 35%,rgba(216,174,90,.32),transparent 70%),radial-gradient(circle at 80% 35%,transparent 0 9%,rgba(0,0,0,.0) 9%)"></div><div class="shade"></div><div class="inf"><div><h1>Clair Obscur: Expedition 33</h1>
    <div class="dmeta">${chip('playing')}<span class="sep"></span><span>RPG, Turn-based</span><span class="sep"></span><span>PC</span><span class="sep"></span><span>2025</span></div></div>
    <div class="btns"><button class="btn pri lg">${icf('play')}Play</button><button class="btn lg">${ic('edit')}Edit</button><button class="btn lg">${ic('euro')}Add spend</button></div></div></div>
  <nav class="dtabs"><a class="on">Overview</a><a>Sessions <small>14</small></a><a>Achievements <small>38/52</small></a><a>Saves <small>6</small></a><a>Notes <small>3</small></a></nav>
  <div class="dbody"><div>
    <div class="dfigs"><div class="dfig k"><b>38<small>h</small>10<small>m</small></b><span>Time played</span></div><div class="dfig"><b>14</b><span>Sessions</span></div><div class="dfig"><b>€49.99</b><span>Spent</span></div><div class="dfig"><b>€1.31</b><span>Per hour</span></div></div>
    <div class="sec"><h4><span>Notes</span><span class="lnk" style="font-weight:500">Edit</span></h4><div class="panel notes"><p>Act 2 is where the combat really opens up. Maelle's stance swaps carry most fights, so keep her gear ahead of the others.</p><p>Still missing the optional boss past the flooded cliffs. Come back after the next story beat.</p></div></div>
    <div class="sec"><h4><span>Recent sessions</span><span class="lnk" style="font-weight:500">See all</span></h4><div class="panel" style="overflow:hidden"><table class="tbl"><tbody>
      <tr><td style="width:120px">Sat 21</td><td style="width:200px">21:00 to 23:10</td><td class="dur" style="width:110px">2h 10m</td><td>Living room PC</td></tr>
      <tr><td>Sat 21</td><td style="width:200px">10:30 to 12:20</td><td class="dur">1h 50m</td><td>Desk PC</td></tr>
      <tr><td>Fri 20</td><td>20:00 to 22:10</td><td class="dur">2h 10m</td><td>Desk PC</td></tr></tbody></table></div></div>
  </div><div class="rcol">
    <div class="sec"><h4><span>How long to beat</span><span>HowLongToBeat</span></h4><div class="seg62">${segs}</div>
      <div class="mk"><span style="left:${pos(30)}"><b>30h</b>Main</span><span style="left:${pos(45)}"><b>45h</b>+Extra</span><span class="r"><b>62h</b>100%</span></div></div>
    <div class="sec"><h4><span>Playthrough</span><span class="lnk" style="font-weight:500">Mark as beaten</span></h4><div style="font-size:15px"><b style="font-weight:600">Playthrough #1</b> <span class="dust">· started Oct 3, 2026</span></div><div class="dust" style="font-size:13.5px;margin-top:2px">38h 10m in 14 sessions, already past the Main estimate of 30h.</div></div>
    <div class="sec"><h4><span>Installed on</span></h4><div class="dev">${ic('pc')}Desk PC<span class="tag">This PC</span></div><div class="dev">${ic('pc')}Living room PC</div></div>
  </div></div></div>`)
}

/* ---------- SESSIONS ---------- */
const GC = { silk: '#E0405B', clair: '#D3A94F', balatro: '#4C8DFF' }
const SESS = [
  { d: 'Sun 22', day: 6, g: 'silk', s: '19:40', e: '20:52', dur: '1h 12m', dev: 'Desk PC', note: 'Running now', run: 1 },
  { d: 'Sun 22', day: 6, g: 'balatro', s: '13:05', e: '13:50', dur: '45m', dev: 'Phone timer', note: 'Won with the Anaglyph deck at stake 4' },
  { d: 'Sat 21', day: 5, g: 'clair', s: '21:00', e: '23:10', dur: '2h 10m', dev: 'Living room PC', note: 'Finished the flooded cliffs' },
  { d: 'Sat 21', day: 5, g: 'silk', s: '15:00', e: '16:25', dur: '1h 25m', dev: 'Desk PC', note: '' },
  { d: 'Sat 21', day: 5, g: 'clair', s: '10:30', e: '12:20', dur: '1h 50m', dev: 'Desk PC', note: 'Gear swap before Act 2' },
  { d: 'Fri 20', day: 4, g: 'balatro', s: '22:20', e: '23:05', dur: '45m', dev: 'Phone timer', note: '' },
  { d: 'Fri 20', day: 4, g: 'clair', s: '20:00', e: '22:10', dur: '2h 10m', dev: 'Desk PC', note: '' },
  { d: 'Wed 18', day: 2, g: 'clair', s: '21:00', e: '23:30', dur: '2h 30m', dev: 'Living room PC', note: 'Long one, stopped at a save point' },
  { d: 'Mon 16', day: 0, g: 'silk', s: '21:15', e: '22:48', dur: '1h 33m', dev: 'Desk PC', note: 'Started the game' }
]
const mins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
function sessions() {
  const dn = ['Mon 16', 'Tue 17', 'Wed 18', 'Thu 19', 'Fri 20', 'Sat 21', 'Sun 22']
  const tot = ['1h 33m', 'No play', '2h 30m', 'No play', '2h 55m', '5h 25m', '1h 57m']
  const rows = dn.map((d, i) => {
    const bl = SESS.filter((s) => s.day === i).map((s) => `<i class="blk ${s.run ? 'run' : ''}" style="--g:${GC[s.g]};left:${(mins(s.s) / 1440 * 100).toFixed(2)}%;width:${((mins(s.e) - mins(s.s)) / 1440 * 100).toFixed(2)}%" title="${G[s.g].n}"></i>`).join('')
    const now = i === 6 ? `<i class="nowl" style="left:${(mins('20:52') / 1440 * 100).toFixed(2)}%"></i>` : ''
    return `<div class="rrow"><span class="d ${i === 6 ? 't' : ''}">${i === 6 ? 'Today' : d}</span><div class="trk">${bl}${now}</div><span class="tt">${tot[i]}</span></div>`
  }).join('')
  const ax = Array.from({ length: 9 }, (_, i) => `<span style="left:${(i * 3 / 24 * 100)}%">${String(i * 3).padStart(2, '0')}</span>`).join('')
  const tr = SESS.map((s) => `<tr class="${s.run ? 'live' : ''}"><td>${s.d}</td><td><span class="gm" style="--g:${GC[s.g]}"><i></i>${G[s.g].n}</span></td><td>${s.s} to ${s.run ? '<span style="color:var(--live);font-weight:600">now</span>' : s.e}</td><td class="dur">${s.dur}</td><td>${s.dev}</td><td class="nt">${s.note || '<span style="opacity:.5">No note</span>'}</td></tr>`).join('')
  return shell('Afterplay - Sessions', 'Sessions', `<div class="ses">
  <div class="pgh"><h1>Sessions</h1><span class="dust">Week of November 16</span><div class="wk"><button class="btn ic">${ic('up').replace('<svg class="i "', '<svg class="i " style="transform:rotate(-90deg)"')}</button><button class="btn">This week</button><button class="btn ic">${ic('up').replace('<svg class="i "', '<svg class="i " style="transform:rotate(90deg)"')}</button><button class="btn pri" style="margin-left:8px">${ic('plus')}Add session</button></div></div>
  <section class="ribbon panel"><div class="rhead"><span class="lg" style="--g:${GC.clair}"><i></i>Clair Obscur</span><span class="lg" style="--g:${GC.silk}"><i></i>Silksong</span><span class="lg" style="--g:${GC.balatro}"><i></i>Balatro</span><span class="tot"><b>14h 20m</b>in 9 sessions</span></div>${rows}<div class="axis"><div></div><div>${ax}</div><div></div></div></section>
  <section class="panel" style="flex:none;overflow:hidden"><table class="tbl"><thead><tr><th style="width:110px">Date</th><th style="width:330px">Game</th><th style="width:170px">Start to end</th><th class="dur" style="width:110px">Duration</th><th style="width:170px">Device</th><th>Note</th></tr></thead><tbody>${tr}</tbody></table></section></div>`)
}

/* ---------- PLAN ---------- */
function plan() {
  const q = [['pent', 'Pentiment', 'PC, Steam Deck', '20h', 'Oct 30', 2], ['well', 'Animal Well', 'PC', '6h', 'Nov 3', 3], ['lies', 'Lies of P', 'PC', '30h', 'Nov 8', 4], ['octo', 'Octopath Traveler II', 'PC', '55h', 'Nov 15', 5]]
  const rows = q.map(([k, , p, h, a, n]) => `<div class="qrow"><span>${ic('drag').replace('class="i "', 'class="i " style="color:var(--dust)"')}</span><span class="no">${n}</span>${cv(k)}<div class="ti">${G[k].n}<span>${p}</span></div><span class="hl">${h}</span><span class="dust">${a}</span><div class="ac"><button class="btn">${icf('play')}Start</button><button class="btn ic">${ic('up')}</button><button class="btn ic">${ic('x')}</button></div></div>`).join('')
  const sug = [['sea', 'Backlog, 18h'], ['cyber', 'Dropped, 25h'], ['wake', 'Resting, 20h'], ['dredge', 'Resting, 9h']].map(([k, m]) => `<div class="sg">${cv(k)}<div><b>${G[k].n}</b><span>${m}</span></div><button class="btn ic">${ic('plus')}</button></div>`).join('')
  return shell('Afterplay - Plan', 'Plan', `<div class="plan">
  <div class="pgh"><h1>Plan</h1><span class="dust">5 games in the queue · about 181h to play</span><button class="btn" style="margin-left:auto">${ic('plus')}Add to queue</button></div>
  <section class="next">${bn('meta', true, false)}<div class="shade"></div><div class="cvw">${cv('meta')}</div>
    <div class="nin"><div class="lab">Next up<span class="dust" style="font-weight:400">first in your queue</span></div><h2>Metaphor: ReFantazio</h2><div class="mt"><span>HLTB Main <b>70h</b></span><span>Added <b>Oct 28</b></span><span>PC</span></div>
    <div class="acts"><button class="btn pri lg">${icf('play')}Start playing</button><button class="btn lg">${ic('down')}Move down</button><button class="btn lg">${ic('x')}Remove</button></div></div></section>
  <section class="pl2"><div class="panel" style="overflow:hidden"><div class="qrow h"><span></span><span style="text-align:center">#</span><span></span><span>Game</span><span>HLTB Main</span><span>Added</span><span></span></div>${rows}</div>
    <aside class="panel sug"><h4>From your library</h4><p>Games that are not in the queue yet.</p>${sug}</aside></section></div>`)
}

/* ---------- SETTINGS ---------- */
function settings() {
  const nav = [['General', 'sliders'], ['Library', 'lib'], ['Sessions', 'clock'], ['Sync', 'sync', 1], ['Appearance', 'palette'], ['Shortcuts', 'kbd'], ['Data', 'db'], ['About', 'info']].map(([l, i, on]) => `<a class="${on ? 'on' : ''}">${ic(i)}${l}</a>`).join('')
  const dv = [['Desk PC', 'pc', 'Windows 11, Afterplay 2.0', 'Just now', 1], ['Living room PC', 'pc', 'Windows 11, Afterplay 2.0', 'Yesterday, 23:12'], ['Phone', 'phone', 'Web app on Android', 'Today, 13:51']]
  const tr = dv.map(([n, i, p, l, me]) => `<tr class="${me ? 'me' : ''}"><td><div class="dvn"><span class="ico">${ic(i)}</span><div>${n}${me ? '<span class="pill">This PC</span>' : ''}<small>${p}</small></div></div></td><td>${l}</td><td><span class="chip"><i class="dot" style="--st:var(--tube)"></i>Up to date</span></td><td style="text-align:right"><button class="btn ghost">Rename</button>${me ? '' : '<button class="btn ghost">Remove</button>'}</td></tr>`).join('')
  return shell('Afterplay - Settings', '', `<div class="set"><aside class="snav"><h1>Settings</h1>${nav}</aside><section class="scont">
    <div class="ttl"><h2>Sync</h2><span class="dust">Keep your library, sessions and notes the same on every device.</span></div>
    <div style="display:flex;flex-direction:column;gap:20px">
      <div class="panel sstat"><div><div class="big"><i></i>Up to date</div><div class="info">Last synced 2 minutes ago · 331 games on 3 devices</div></div><div class="r"><label class="auto"><i class="tg on"></i>Sync automatically</label><button class="btn pri lg">${ic('sync')}Sync now</button></div></div>
      <div class="panel dvt" style="overflow:hidden"><table class="tbl"><thead><tr><th>Devices</th><th style="width:170px">Last sync</th><th style="width:150px">Status</th><th style="width:190px"></th></tr></thead><tbody>${tr}</tbody></table></div>
      <div class="panel" style="overflow:hidden"><h3 class="ph3">Recent activity</h3><div class="act"><span>Today, 20:50</span><span style="color:var(--bone)">Desk PC sent a note on Silksong</span><span>Desk PC</span></div><div class="act"><span>Today, 13:51</span><span style="color:var(--bone)">Phone sent a session (Balatro, 45m)</span><span>Phone</span></div><div class="act"><span>Yesterday, 23:12</span><span style="color:var(--bone)">Living room PC sent 1 session and 2 saves</span><span>Living room PC</span></div><div class="act"><span>Yesterday, 12:21</span><span style="color:var(--bone)">Desk PC sent a session (Clair Obscur, 1h 50m)</span><span>Desk PC</span></div><div class="act"><span>Fri, 22:11</span><span style="color:var(--bone)">Desk PC sent a session (Clair Obscur, 2h 10m)</span><span>Desk PC</span></div></div>
    </div>
    <aside class="panel addd"><h3>Add device</h3><p>Open Afterplay on the new device, choose Join with a code and type this one.</p><div class="code">7KQF 92MX</div><div class="exp"><span>Expires in <b>9:42</b></span><span>Single use</span></div><div style="display:flex;gap:10px"><button class="btn">Copy code</button><button class="btn ghost">New code</button></div></aside>
  </section></div>`)
}

/* ---------- TV ---------- */
function tv() {
  const tvit = (k, o = {}, cap = G[k].n, foc = false) => `<div class="tvi ${foc ? 'foc' : ''}">${cv(k, o)}<div class="cap">${cap}</div></div>`
  const r1 = [['silk', '23h 15m', 1], ['clair', '38h 10m'], ['balatro', '61h 30m'], ['hades2', '22h 05m'], ['split', '4h 45m'], ['outer', '24h 10m'], ['celeste', '9h 40m'], ['disco', '31h 05m'], ['hollow', '52h 20m'], ['tunic', '14h 00m']]
  const r2 = ['meta', 'pent', 'well', 'lies', 'octo']
  return doc('Afterplay - TV', `<div class="tv"><header class="tvtop"><div class="logo">${logoSvg.replace('width="26" height="26"', 'width="38" height="38"')}Afterplay</div><nav class="tvtabs"><a class="on">Home</a><a>Library</a><a>Plan</a><a>Sessions</a></nav><div class="r"><div class="sync"><i></i>Synced</div><span>20:52</span></div></header>
  <section class="tvhero">${bn('silk', true, false)}<div class="shade"></div><div class="in"><div class="lab"><i class="pulse" style="width:12px;height:12px"></i>Playing now on Desk PC</div><h1>Hollow Knight: Silksong</h1><div class="row"><span class="tm">1:12:04</span><span class="mt">23h 15m played · 11 sessions</span><button class="btn pri">${icf('play')}Open game</button></div></div></section>
  <section class="tvsh"><h3>Playing <em>and recently played</em></h3><div class="tvr">${r1.map(([k, h, f]) => tvit(k, { st: ['outer','celeste','disco','hollow','tunic'].includes(k) ? 'beaten' : 'playing', h }, G[k].n, f)).join('')}</div></section>
  <section class="tvsh" style="margin-top:6px"><h3>Up next <em>your plan</em></h3><div class="tvr s2">${r2.map((k, i) => tvit(k, { num: i + 1 }, G[k].n)).join('')}</div></section>
  <footer class="hints"><span><b class="a">A</b>Select</span><span><b>B</b>Back</span><span><b>X</b>Options</span><span><b>Y</b>Search</span><span class="r"><b>LB</b><b>RB</b>Switch section</span></footer></div>`)
}

/* ---------- PWA ---------- */
function pwa() {
  const stb = '<div class="stb"><span>20:52</span><span>5G<i></i></span></div>'
  const mini = `<div class="mini">${cv('silk')}<div><div class="nm">Hollow Knight: Silksong</div><div class="sub"><i class="pulse" style="width:7px;height:7px"></i>Desk PC</div></div><span class="tm">1:12:04</span><span class="stop">${icf('stop')}</span></div>`
  const tb = (a) => `<nav class="tbar">${[['Home', 'home'], ['Library', 'lib'], ['Plan', 'plan'], ['Sessions', 'clock']].map(([l, i]) => `<a class="${l === a ? 'on' : ''}">${ic(i)}${l}</a>`).join('')}</nav>`
  const scr = (a, body) => `<div class="phone"><div class="scr">${stb}<div class="pgc">${body}</div>${mini}${tb(a)}</div></div>`
  const days = [['M', 93], ['T', 0], ['W', 150], ['T', 0], ['F', 175], ['S', 325], ['S', 117]]
  const bars = days.map(([d, m], i) => `<div class="${i === 6 ? 't' : ''}"><i style="height:${Math.max(3, m / 325 * 34)}px"></i><span>${d}</span></div>`).join('')
  const s1 = scr('Home', `<div class="mh"><h2>Tonight</h2><span>Sun, Nov 22</span></div>
    <div class="mfig"><div class="k"><b>14<small>h</small>20<small>m</small></b><span>this week</span></div><div><b>9</b><span>sessions</span></div><div><b>3</b><span>games</span></div></div>
    <div class="mbars">${bars}</div>
    <div class="mcont"><div class="bw">${bn('silk')}</div><div class="tx"><h3>Hollow Knight: Silksong</h3><p>Session running · 23h 15m played</p><button class="btn pri">Open game</button></div></div>`)
  const lib = [['silk', 'playing', '23h 15m'], ['clair', 'playing', '38h 10m'], ['balatro', 'playing', '61h 30m'], ['hades2', 'playing', '22h 05m'], ['outer', 'beaten', '24h 10m'], ['celeste', 'beaten', '9h 40m'], ['tunic', 'beaten', '14h 00m']]
  const s2 = scr('Library', `<div class="mh"><h2>Library</h2><span>331 games</span></div><div class="msearch">${ic('search')}Search your library</div>
    <div class="chips"><span class="on">All</span><span>${dot('playing')}Playing</span><span>${dot('beaten')}Beaten</span><span>${dot('backlog')}Backlog</span></div>
    ${lib.map(([k, s, h]) => `<div class="mrow">${cv(k)}<div><div class="tt">${G[k].n}</div><div class="ss">${dot(s)}${STN[s]}</div></div><div class="hh">${h}</div></div>`).join('')}`)
  const s3 = scr('Library', `<div class="mdet"><div class="mban">${bn('clair', false, false)}<div class="shade"></div><h1>Clair Obscur: Expedition 33</h1></div>
    <div class="meta">${chip('playing')}<span class="dust">RPG, Turn-based · PC · 2025</span></div>
    <div class="btns"><button class="btn pri">${icf('play')}Start timer</button><button class="btn">${ic('note')}Add note</button></div>
    <div class="m4"><div class="k"><b>38<small>h</small></b><span>Played</span></div><div><b>14</b><span>Sessions</span></div><div><b>€49.99</b><span>Spent</span></div><div><b>€1.31</b><span>Per hour</span></div></div>
    <h4>How long to beat</h4><div class="seg62">${Array.from({ length: 62 }, (_, i) => `<i class="${i < 38 ? 'f' : ''}"></i>`).join('')}</div>
    <div class="mk"><span style="left:48.4%"><b>30h</b>Main</span><span style="left:72.6%"><b>45h</b>+Extra</span><span class="r"><b>62h</b>100%</span></div>
    <h4>Playthrough</h4><div style="font-size:14px"><b style="font-weight:600">#1</b> <span class="dust">started Oct 3, 2026</span></div><h4>Notes</h4><div style="font-size:14px;line-height:1.5">Act 2 is where the combat really opens up. Keep Maelle's gear ahead of the others.</div></div>`)
  const q = [['pent', '20h'], ['well', '6h'], ['lies', '30h'], ['octo', '55h']]
  const s4 = scr('Plan', `<div class="mh"><h2>Plan</h2><span>5 games · about 181h</span></div>
    <div class="mnext">${cv('meta')}<div><div class="lab">Next up</div><h3>Metaphor: ReFantazio</h3><p>HLTB Main 70h</p><button class="btn pri" style="height:34px;margin-top:8px">${icf('play')}Start</button></div></div>
    ${q.map(([k, h], i) => `<div class="mrow"><span class="no">${i + 2}</span>${cv(k)}<div><div class="tt">${G[k].n}</div><div class="ss">PC</div></div><div class="hh">${h}</div></div>`).join('')}`)
  return doc('Afterplay - PWA', `<div class="board"><div class="row">${[['Home', s1], ['Library', s2], ['Game page', s3], ['Plan', s4]].map(([l, s]) => `<div class="pw">${s}<span>${l}</span></div>`).join('')}</div></div>`)
}

export { G, ST, STN, SER, vars, cv, bn, dot, chip, ic, icf, doc, shell, hm, mins, FONTS, TABS, np, logoSvg }

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
const out = { home: home(), library: library(), detail: detail(), sessions: sessions(), plan: plan(), settings: settings(), tv: tv(), pwa: pwa() }
for (const [k, v] of Object.entries(out)) writeFileSync(join(dir, `${k}.html`), v)
console.log('HTML generado:', Object.keys(out).join(', '))
}
