// Ficha de juego completa y sus modales (Fosforo). Uso: node build-ficha.mjs
import { writeFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { G, SER, cv, bn, dot, chip, ic, doc, hm, TABS, np, logoSvg } from './build.mjs'
const dir = dirname(fileURLToPath(import.meta.url))

/* ---------- juegos extra (solo para esta tanda) ---------- */
Object.assign(G, {
  oct1: { n: 'Octopath Traveler', s: 'Octopath<br>Traveler', a: '#2C5F8E', b: '#E9C37A', c: '#FFF4D6', f: SER, tt: 'none', k: 3, ts: '14.5cqw' },
  oct0: { n: 'Octopath Traveler 0', s: 'Octopath<br>Traveler 0', a: '#6B4DB8', b: '#F0A04B', c: '#FFFFFF', f: SER, tt: 'none', k: 5, ts: '14.5cqw' },
  octc: { n: 'Octopath Traveler: Champions of the Continent', s: 'Champions<br>of the<br>Continent', a: '#2F8F83', b: '#E8D4A0', c: '#FFFFFF', f: SER, tt: 'none', k: 2, ts: '12.5cqw' },
  octd: { n: 'Octodad: Dadliest Catch', s: 'Octodad', a: '#E8683A', b: '#2A1F4D', c: '#FFE9B8', k: 1, ts: '21cqw' },
  seki: { n: 'Sekiro: Shadows Die Twice', s: 'Sekiro<br>Shadows<br>Die Twice', a: '#8C2B1E', b: '#14100E', c: '#E9D3A2', k: 2, ts: '16cqw' },
  vamp: { n: 'Vampire Survivors', s: 'Vampire<br>Survivors', a: '#4B1F6B', b: '#1A0A24', c: '#7CE09A', k: 5, ts: '18cqw' },
  hifi: { n: 'Hi-Fi Rush', s: 'Hi-Fi<br>Rush', a: '#1FB4C9', b: '#E83C6E', c: '#FFFFFF', k: 2, ts: '24cqw' },
  clair2: { n: 'Clair Obscur: Expedition Thirty-Three', s: 'Expedition<br>Thirty-Three', a: '#241C30', b: '#0A080E', c: '#D8AE5A', t: '#EBCB82', f: SER, tt: 'none', k: 4, ts: '13cqw' }
})

/* ---------- iconos propios ---------- */
const PX = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  edit: '<path d="M4 20h4l11-11-4-4L4 16z"/>',
  euro: '<path d="M17.5 6.5A7 7 0 1 0 17.5 17.5M4 10.5h9M4 13.5h9"/>',
  pc: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
  note: '<path d="M5 4h14v12l-4 4H5z"/><path d="M15 20v-4h4M8.5 9h7M8.5 12.5h4"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14-4M4 5v3h3M4 13a8 8 0 0 0 14 4M20 19v-3h-3"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  down: '<path d="m6 10 6 6 6-6"/>',
  up: '<path d="m6 14 6-6 6 6"/>',
  left: '<path d="m14 6-6 6 6 6"/>',
  right: '<path d="m10 6 6 6-6 6"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 18 5-5 4 4 3-3 4 4"/>',
  trash: '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 12.5h8L17 7M10.5 11v5M13.5 11v5"/>',
  merge: '<circle cx="6.5" cy="5.5" r="2"/><circle cx="6.5" cy="18.5" r="2"/><circle cx="17.5" cy="14.5" r="2"/><path d="M6.5 7.5v9M6.5 8.5c0 4 11 1.5 11 4"/>',
  warn: '<path d="M12 4 3 19.5h18z"/><path d="M12 10v4.5M12 17h.01"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  cloudup: '<path d="M7 18a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 9.5 4 4 0 0 1 17.5 18z"/><path d="M12 15v-5m-2.2 2.2L12 10l2.2 2.2"/>',
  clouddown: '<path d="M7 18a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 9.5 4 4 0 0 1 17.5 18z"/><path d="M12 10v5m-2.2-2.2L12 15l2.2-2.2"/>',
  branch: '<circle cx="6" cy="5.5" r="2"/><circle cx="6" cy="18.5" r="2"/><circle cx="18" cy="9" r="2"/><path d="M6 7.5v9M18 11c0 4-12 2-12 5.5"/>',
  restore: '<path d="M4 12a8 8 0 1 1 2.5 5.8M4 5v5h5"/><path d="M12 8v4l2.5 2"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5v1.5a3 3 0 0 0 3 3M16 6h3v1.5a3 3 0 0 1-3 3M12 13v4M8.5 20h7"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  eyeoff: '<path d="M4 4l16 16M10.6 6.2A9 9 0 0 1 21 12a13 13 0 0 1-3 3.6M6.5 7.8A13 13 0 0 0 3 12c1.5 3 4.8 6 9 6a9 9 0 0 0 3.4-.7"/>',
  stopwatch: '<circle cx="12" cy="13.5" r="6.5"/><path d="M12 10v3.5l2.2 1.5M9.5 3.5h5"/>',
  bullets: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  quote: '<path d="M5 17v-4a4 4 0 0 1 4-4M13 17v-4a4 4 0 0 1 4-4"/>',
  code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4"/>',
  codeblock: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m9.5 10-2 2 2 2M14.5 10l2 2-2 2"/>',
  divider: '<path d="M4 12h16"/>',
  undo: '<path d="M9 7 4.5 11.5 9 16"/><path d="M4.5 11.5H15a4.5 4.5 0 0 1 0 9"/>',
  redo: '<path d="m15 7 4.5 4.5L15 16"/><path d="M19.5 11.5H9a4.5 4.5 0 0 0 0 9"/>',
  star: '<path d="m12 4 2.4 5 5.4.7-4 3.7 1 5.4L12 16.2 7.2 18.8l1-5.4-4-3.7 5.4-.7z"/>',
  shield: '<path d="M12 4 5 7v5c0 4 3 7 7 8 4-1 7-4 7-8V7z"/>',
  flame: '<path d="M12 4c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3 0-6 1-9z"/>',
  crown: '<path d="m4 8 4 4 4-6 4 6 4-4-1.5 10h-13z"/>',
  book: '<path d="M5 5h6a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H5zM19 5h-6a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h6z"/>',
  key: '<circle cx="8" cy="12" r="3.5"/><path d="M11.5 12H20M17 12v3M20 12v2.5"/>',
  sword: '<path d="M5 19 17 7V4h3v3L8 19zM6 14l4 4"/>',
  compass: '<circle cx="12" cy="12" r="8"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  brush: '<path d="M5 19c3 0 4-1 4-3l9-9-3-3-9 9c-2 0-1 4-1 6z"/>',
  music: '<path d="M9 17V6l9-2v11M9 17a2.5 2.5 0 1 1-2.5-2.5M18 15a2.5 2.5 0 1 1-2.5-2.5"/>',
  tent: '<path d="M3 19 12 5l9 14zM12 19v-5"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  hdd: '<rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M3 14l2.5-8h13L21 14M7 17h.01"/>',
  export: '<path d="M5 12v7h14v-7M12 15V4m-4 4 4-4 4 4"/>',
  swap: '<path d="M7 7h11l-3-3M17 17H6l3 3"/>'
}
const ico = (k, c = '') => `<svg class="i ${c}" viewBox="0 0 24 24">${PX[k]}</svg>`
const icof = (k) => ico(k, 'f')
const dv = (name, me) => `<span class="dvn">${ico(name === 'Phone timer' ? 'phone' : 'pc')}${name}${me ? '<em>This PC</em>' : ''}</span>`

const ficha = (html) => html.replace('</head>', '<link rel="stylesheet" href="ficha.css"></head>')
const AMB = '#FFB347'
const TUBE = '#5FD3E0'
const LIVE = '#FF5E57'
const GRN = '#9BD67A'

/* ---------- ventana ---------- */
const nowRemote = `<footer class="np f-np2">
  <div class="nb">${cv('silk')}<div><div class="nm">Hollow Knight: Silksong</div><div class="sub"><i class="pulse"></i>Playing on Desk PC · since 19:40</div></div><div class="timer">1:12:04</div><button class="btn live"><svg class="i f" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>Stop</button></div>
  <div class="nb rem">${cv('clair')}<div><div class="nm">Clair Obscur: Expedition 33</div><div class="sub"><i class="pulse"></i>Playing on <b>Living room PC</b> · since 20:15</div></div><div class="timer dim">0:37:12</div><span class="nostop">Stop it from that PC</span></div>
  <div class="sp"></div><button class="btn">${ico('note')}Add note</button></footer>`
function shellX(title, inner, foot = np, active = 'Library') {
  return ficha(doc(title, `<div class="app"><header class="top"><div class="logo">${logoSvg}Afterplay</div><nav class="tabs">${TABS.map((t) => `<a class="tab ${t === active ? 'on' : ''}">${t}</a>`).join('')}</nav><div class="search">${ico('search')}<span>Search your library</span><kbd>Ctrl K</kbd></div><div class="sync"><i></i>Synced</div><div class="gear">${ico('cog')}</div></header><main class="main">${inner}</main>${foot}</div>`))
}

/* ---------- cabecera de la ficha ---------- */
const TABN = [['Overview'], ['Sessions', 14], ['Achievements', '38/52'], ['Saves', 6], ['Notes', 3]]
const tabsHtml = (on, dots = {}) =>
  `<nav class="dtabs">${TABN.map(([n, c]) => `<a class="${n === on ? 'on' : ''}">${n}${c !== undefined ? ` <small>${c}</small>` : ''}${dots[n] ? `<i class="tdot" style="--c:${dots[n]}"></i>` : ''}</a>`).join('')}</nav>`

const tools = (nolink) => `<button class="btn ic bt" title="Change cover / hero">${ico('image')}</button><button class="btn ic bt${nolink ? ' dis' : ''}" title="${nolink ? 'No install folder on this PC' : 'Open install folder'}">${ico('folder')}</button><button class="btn ic bt" title="Refresh ratings, how long to beat, tags and achievements">${ico('sync')}</button><button class="btn ic bt del" title="Delete game">${ico('trash')}</button>`

function actions(variant, lg) {
  const L = lg ? ' lg' : ''
  const edit = `<button class="btn${L}">${ico('edit')}Edit</button><button class="btn${L}">${ico('euro')}Add spend</button>`
  if (variant === 'nolink') return `<button class="btn dis${L}" disabled title="Not installed on this PC">${icof('play')}Play</button><button class="btn link${L}">${ico('link')}Link installation</button>${edit}`
  if (variant === 'remote') return `<div class="livepill${L}"><i class="pulse"></i><span>Playing on <b>Living room PC</b></span><em>0:37:12</em></div>${edit}`
  return `<button class="btn pri${L}">${icof('play')}Play</button>${edit}`
}

function header({ tab, compact = false, variant = 'play', strip = '', dots = {}, bh, meta = '' }) {
  const metaHtml = `<div class="dmeta"><span class="chip"><i class="dot" style="--st:#FFB347"></i>Playing</span><span class="sep"></span><span>RPG, Turn-based</span><span class="sep"></span><span>PC</span><span class="sep"></span><span>2025</span>${meta}</div>`
  return `<div class="dban ${compact ? 'cp' : ''}" ${bh ? `style="height:${bh}px"` : ''}>${bn('clair', true, false)}<div style="position:absolute;inset:0;z-index:1;background:radial-gradient(45% 100% at 80% 35%,rgba(216,174,90,.32),transparent 70%)"></div><div class="shade"></div>${compact ? '' : `<div class="btools">${tools(variant === 'nolink')}</div>`}<div class="inf"><div><h1>Clair Obscur: Expedition 33</h1>${metaHtml}</div><div class="btns">${actions(variant, !compact)}${compact ? `<span class="tl">${tools(variant === 'nolink')}</span>` : ''}</div></div></div>${strip}${tabsHtml(tab, dots)}`
}

/* ---------- Overview (compartido por las variantes) ---------- */
const seg = `<div class="seg62">${'<i class="f"></i>'.repeat(38)}<i class="p"></i>${'<i></i>'.repeat(23)}</div>`
const figs = `<div class="dfigs"><div class="dfig k"><b>38<small>h</small>10<small>m</small></b><span>Time played</span></div><div class="dfig"><b>14</b><span>Sessions</span></div><div class="dfig"><b>€49.99</b><span>Spent</span></div><div class="dfig"><b>€1.31</b><span>Per hour</span></div></div>`
const notesBlock = `<div class="sec"><h4><span>Notes</span><span class="lnk" style="font-weight:500">Edit</span></h4><div class="panel notes"><p>Act 2 is where the combat really opens up. Maelle's stance swaps carry most fights, so keep her gear ahead of the others.</p><p>Still missing the optional boss past the flooded cliffs. Come back after the next story beat.</p></div></div>`
const recentRows = (live) => `<tr class="live-row"${live ? '' : ' hidden'}>${live ? `<td style="width:120px"><b>Today</b></td><td style="width:200px">since 20:15</td><td class="dur lv" style="width:110px">0h 37m</td><td>Living room PC <span class="rl">Playing now</span></td>` : ''}</tr>
 <tr><td style="width:120px">Sat 21</td><td style="width:200px">21:00 to 23:10</td><td class="dur" style="width:110px">2h 10m</td><td>Living room PC</td></tr>
 <tr><td>Sat 21</td><td>10:30 to 12:20</td><td class="dur">1h 50m</td><td>Desk PC</td></tr>
 <tr><td>Fri 20</td><td>20:00 to 22:10</td><td class="dur">2h 10m</td><td>Desk PC</td></tr>`
const recentBlock = (live) => `<div class="sec"><h4><span>Recent sessions</span><span class="lnk" style="font-weight:500">See all</span></h4><div class="panel" style="overflow:hidden"><table class="tbl"><tbody>${recentRows(live)}</tbody></table></div></div>`
const hltb = `<div class="sec"><h4><span>How long to beat</span><span>HowLongToBeat</span></h4>${seg}<div class="mk"><span style="left:48.4%"><b>30h</b>Main</span><span style="left:72.6%"><b>45h</b>+Extra</span><span class="r"><b>62h</b>100%</span></div></div>`
const ptDefault = `<div class="sec"><h4><span>Playthrough</span><span class="lnk" style="font-weight:500">Mark as beaten</span></h4><div style="font-size:15px"><b style="font-weight:600">Playthrough #1</b> <span class="dust">· started Oct 3, 2026</span></div><div class="dust" style="font-size:13.5px;margin-top:2px">38h 10m in 14 sessions, already past the Main estimate of 30h.</div></div>`
const pcRow = (n, sub, tag) => `<div class="fdev"><span class="ic">${ico('pc')}</span><div><b>${n}</b>${sub ? `<small>${sub}</small>` : ''}</div>${tag || ''}</div>`
const instDefault = `<div class="sec"><h4><span>Installed on</span></h4>${pcRow('Desk PC', 'D:\\Games\\Expedition 33 · 71.4 GB', '<span class="tag">This PC</span>')}${pcRow('Living room PC', 'D:\\Games\\Expedition 33 · 71.4 GB', '')}</div>`

const overview = ({ live = false, pt = ptDefault, inst = instDefault, bh = 360, head } = {}) =>
  `<div class="det f" style="--bh:${bh}px">${head}<div class="dbody"><div>${figs}${notesBlock}${recentBlock(live)}</div><div class="rcol">${hltb}${pt}${inst}</div></div></div>`

/* ---------- 1. Overview: sin instalacion ---------- */
function pageNoInstall() {
  const inst = `<div class="sec"><h4><span>Installed on</span></h4>
    <div class="fdev miss"><span class="ic">${ico('pc')}</span><div><b>Desk PC</b><small>Not installed on this PC</small></div><span class="tag">This PC</span></div>
    <button class="btn link wide" title="Pick the executable and Afterplay tracks it from this PC">${ico('link')}Link installation</button>
    
    ${pcRow('Living room PC', 'D:\\Games\\Expedition 33 · 71.4 GB', '')}</div>`
  return shellX('Afterplay - Clair Obscur: Expedition 33', overview({ head: header({ tab: 'Overview', variant: 'nolink', meta: `<span class="sep"></span><span class="noinst">${ico('warn')}Not installed on this PC</span>` }), inst }))
}

/* ---------- 2. Overview: en marcha en otro PC ---------- */
function pageRemote() {
  const pt = `<div class="sec"><h4><span>Playthrough</span><span class="lnk" style="font-weight:500">Mark as beaten</span></h4><div style="font-size:15px"><b style="font-weight:600">Playthrough #1</b> <span class="dust">· started Oct 3, 2026</span></div><div class="dust" style="font-size:13.5px;margin-top:2px">38h 10m in 14 sessions, already past the Main estimate of 30h.</div></div>`
  const remoteNote = ''
  return shellX('Afterplay - Clair Obscur: Expedition 33', overview({ live: true, pt: pt + remoteNote, head: header({ tab: 'Overview', variant: 'remote' }) }), nowRemote)
}

/* ---------- 3. Overview: avisos de fusion ---------- */
function pageNotices() {
  const strip = `<div class="fwarn tube">${ico('merge')}<div class="tx"><b>Looks like the same game as “Clair Obscur: Expedition Thirty-Three”</b><span>Same IGDB id. It was added from your phone on Nov 20 and has 1 session. Merging moves its sessions, notes and saves into this one.</span></div>${cv('clair2')}<button class="btn">${ico('merge')}Merge</button><button class="btn ic ghost" title="Dismiss">${ico('x')}</button></div>`
  const pt = `<div class="sec"><h4><span>Playthrough</span><span class="pgr"><i>${ico('left')}</i>2 of 2<i>${ico('right')}</i></span></h4>
    <div style="font-size:15px"><b style="font-weight:600">Playthrough #2</b> <span class="dust">· started Nov 21, 2026</span></div>
    <div class="dust" style="font-size:13.5px;margin-top:2px">2h 10m in 1 session on Living room PC. Still going.</div>
    <div class="fwarn amb sm2">${ico('merge')}<div class="tx"><b>Two playthroughs are in progress</b><span>Probably started on two PCs at once.</span></div><button class="btn">${ico('merge')}Merge into Playthrough #1</button></div></div>`
  return shellX('Afterplay - Clair Obscur: Expedition 33', overview({ pt, bh: 300, head: header({ tab: 'Overview', bh: 300, strip }) }))
}

/* ---------- 4. Sessions ---------- */
const WK = [
  ['Nov 16 to 22', 'this week', [
    ['Sat Nov 21', '21:00 to 23:10', 130, 'Living room PC', { ach: '2 achievements · Perfect Rhythm 2.4%' }],
    ['Sat Nov 21', '10:30 to 12:20', 110, 'Desk PC', {}],
    ['Fri Nov 20', '20:00 to 22:10', 130, 'Desk PC', { note: 'Flooded cliffs: the optional boss is still too tough. Back after upgrading Maelle’s gear.' }],
    ['Wed Nov 18', '21:15 to 23:05', 110, 'Desk PC', { note: 'Finished the Act 2 story beat. Next up: the optional boss past the cliffs.', ach: '1 achievement · Last Dawn Standing 0.9%' }],
    ['Mon Nov 16', '20:40 to 22:55', 135, 'Desk PC', { auto: true }]
  ]],
  ['Nov 9 to 15', '', [
    ['Sat Nov 14', '14:00 to 18:20', 260, 'Living room PC', {}],
    ['Thu Nov 12', '21:00 to 22:30', 90, 'Desk PC', {}]
  ]],
  ['Nov 2 to 8', '', [
    ['Sun Nov 8', '15:00 to 18:30', 210, 'Living room PC', {}],
    ['Fri Nov 6', '20:30 to 23:10', 160, 'Desk PC', {}],
    ['Tue Nov 3', '21:00 to 22:20', 80, 'Phone timer', {}]
  ]],
  ['Oct 26 to Nov 1', '', [
    ['Sat Oct 31', '13:00 to 18:10', 310, 'Living room PC', {}],
    ['Mon Oct 26', '20:00 to 22:30', 150, 'Desk PC', {}]
  ]],
  ['Oct 12 to 18', '', [['Sun Oct 18', '11:00 to 16:35', 335, 'Desk PC', {}]]],
  ['Sep 28 to Oct 4', 'first week', [['Sat Oct 3', '22:00 to 23:20', 80, '', { manual: true }]]]
]
function sessRow([d, t, m, dev, f]) {
  const flags = []
  if (f.auto) flags.push(`<span class="auto" title="Afterplay closed this session itself after losing the PC's signal. The end time is the last one it saw.">${ico('stopwatch')}Closed automatically</span>`)
  if (f.manual) flags.push(`<span class="auto">${ico('edit')}Added by hand</span>`)
  if (f.ach) flags.push(`<span class="achp">${ico('trophy')}${f.ach}</span>`)
  const [dd, mm, ...rest] = d.split(' ')
  return `<div class="srow"><div class="d"><b>${dd}</b> ${mm} ${rest.join(' ')}</div><div class="t">${t}</div><div class="dur bs">${hm(m)}</div><div class="dvc">${dev ? dv(dev) : '<span class="dust">No device</span>'}</div><div class="fl">${flags.join('')}</div>${f.note ? `<div class="sn">${ico('note')}<span>${f.note}</span></div>` : ''}</div>`
}
const wkTotal = (rows) => hm(rows.reduce((a, r) => a + r[2], 0))
function pageSessions() {
  const left = WK.map(([w, tag, rows]) => `<div class="wgrp"><div class="wl"><b>${w}</b>${tag ? `<small>${tag}</small>` : ''}<span>${wkTotal(rows)}</span></div><div class="wr">${rows.map(sessRow).join('')}</div></div>`).join('')
  const devs = [['Desk PC', 1220, 'pc', AMB], ['Living room PC', 910, 'pc', TUBE], ['Phone timer', 80, 'phone', '#B9A6FF']]
  const devHtml = devs.map(([n, m, i, c]) => `<div class="tb"><div class="r1">${dv(n)}<span class="bs">${hm(m)}</span></div><div class="bar"><i style="width:${(m / 1220) * 100}%;background:${c}"></i></div></div>`).join('') + `<div class="tb pre"><div class="r1"><span class="dvn dust">Before devices (1.x)</span><span class="bs">1h 20m</span></div></div>`
  const hist = [
    ['Marked as Playing', 'Oct 3, 2026', 'Chapter 1', 'play'],
    ['Purchase', 'Oct 3, 2026', '€49.99 on Steam', 'euro'],
    ['Left the Plan', 'Oct 3, 2026', 'Was #4 in your plan', 'plan'],
    ['Added to Plan', 'Sep 18, 2026', '', 'plus'],
    ['Added to Afterplay', 'Sep 18, 2026', '', 'check']
  ]
  const histHtml = hist.map(([t, d, n, i]) => `<div class="ev"><i>${i === 'plan' ? ico('bullets') : ico(i)}</i><div><b>${t}</b>${n ? `<span class="dust">${n}</span>` : ''}</div><small>${d}</small><span class="evact">${ico('edit')}${ico('trash')}</span></div>`).join('')
  const main = `<div class="fpage"><div class="fmain">
    <div class="pth"><div><b class="bs">Playthrough #1</b><span class="dust">Started Oct 3, 2026 · still going</span></div><div class="pst"><div><b class="bs">38h 10m</b><span>played</span></div><div><b class="bs">14</b><span>sessions</span></div><div><b class="bs">2h 44m</b><span>average</span></div></div></div>
    
    <div class="slist">${left}</div></div>
   <aside class="fside"><div class="sec"><h4><span>Time by device</span></h4>${devHtml}</div>
    <div class="sec"><h4><span>History</span><span class="dust" style="font-weight:400">Playthrough #1</span></h4><div class="evs">${histHtml}</div></div></aside></div>`
  return shellX('Afterplay - Sessions of Clair Obscur: Expedition 33', `<div class="det f">${header({ tab: 'Sessions', compact: true })}${main}</div>`)
}

/* ---------- 5. Achievements ---------- */
const AC = [
  // nombre, descripcion, %, fecha, glifo, tono
  ['Last Dawn Standing', 'Defeat an optional boss without taking damage', 0.9, 'Nov 18, 2026', 'crown'],
  ['Perfect Rhythm', 'Land 20 perfect dodges in a single fight', 2.4, 'Nov 21, 2026', 'music'],
  ['Stance Dancer', 'Swap stances five times in one turn', 5.7, 'Nov 8, 2026', 'swap'],
  ['Cartographer', 'Fully explore the first region', 9.3, 'Nov 6, 2026', 'compass'],
  ['Steady Hand', 'Parry 50 attacks', 14.8, 'Oct 26, 2026', 'shield'],
  ['Well Read', 'Read 20 journals', 41.6, 'Nov 3, 2026', 'book'],
  ['Gear Up', 'Upgrade a weapon for the first time', 52.0, 'Oct 5, 2026', 'sword'],
  ['Camp Followers', 'Rest at ten camps', 63.5, 'Oct 12, 2026', 'tent'],
  ['First Expedition', 'Finish the prologue', 71.2, 'Oct 3, 2026', 'flame'],
  ['Brush Strokes', 'Land your first critical hit', 77.9, 'Oct 3, 2026', 'brush']
]
const ACL = [
  ['Every Last Page', 'Find every journal in the game', 0.6, 'book', false],
  ['Untouchable', 'Win ten fights without anyone being knocked out', 1.7, 'shield', false],
  ['Master of Stances', 'Use every stance at least once in a fight', 3.9, 'swap', false],
  ['Hidden achievement', 'Hidden until you unlock it', 4.2, 'lock', true],
  ['Hidden achievement', 'Hidden until you unlock it', 12.0, 'lock', true],
  ['Flawless Run', 'Finish an area without resting', 18.5, 'flame', false]
]
const tier = (p) => (p < 1 ? ['Ultra rare', 'ultra'] : p < 10 ? ['Rare', 'rare'] : p < 40 ? ['Uncommon', 'unc'] : ['Common', 'com'])
const glyph = (g, cls = '') => `<span class="gl ${cls}">${ico(g)}</span>`
function acRow([n, d, p, date, g], lock) {
  const [tn, tc] = tier(p)
  return `<div class="arow ${lock ? 'lock' : ''} ${tc}">${glyph(g, tc)}<div class="at"><b>${n}</b><span>${d}</span></div><div class="ap"><b class="bs">${p}%</b><span>${tn}</span></div><div class="ad">${lock ? 'Locked' : date}</div></div>`
}
function pageAchievements() {
  const hidden = (e) => `<div class="arow lock hid">${glyph('lock', 'com')}<div class="at"><b>Hidden achievement</b><span>Click to reveal its description</span></div><div class="ap"><b class="bs">${e[2]}%</b><span>${tier(e[2])[0]}</span></div><div class="ad">Locked</div></div>`
  const star = AC[0]
  const also = [AC[1], AC[2]]
  const main = `<div class="fpage col"><div class="atop">
    <div class="aprog"><div class="big bs">38<small>/52</small></div><div class="lab">achievements unlocked <b>73%</b></div><div class="seg52">${'<i class="f"></i>'.repeat(38)}${'<i></i>'.repeat(14)}</div><div class="srcs"><span>${ico('check')}Steam: 38 of 52</span><span class="dust">Last checked 4 min ago</span></div></div>
    <div class="astar panel"><div class="sg2">${glyph(star[4], 'ultra big')}<div><span class="k">Your rarest piece</span><b>${star[0]}</b><span class="dd">${star[1]}</span><div class="pc"><b class="bs">${star[2]}%</b><span>of players · unlocked ${star[3]}</span></div></div></div>
      <div class="also"><span class="k">Also rare</span>${also.map((a) => `<div class="mini">${glyph(a[4], 'rare')}<div><b>${a[0]}</b><span>${a[2]}% of players</span></div></div>`).join('')}</div></div></div>
    <div class="atool"><div class="srch">${ico('search')}<span>Search achievements…</span></div><div class="fchips"><span class="on">All <small>52</small></span><span>Unlocked <small>38</small></span><span>Locked <small>14</small></span><span>Rare <small>9</small></span></div><button class="btn ic" title="Re-fetch this game’s achievements from Steam">${ico('sync')}</button></div>
    <div class="alists"><div><div class="ghead">${ico('check')}Unlocked <small>38</small></div>${AC.slice(0, 6).map((a) => acRow(a)).join('')}<div class="more">Show 32 more</div></div>
    <div><div class="ghead lk">${ico('lock')}Locked <small>14</small></div>${ACL.slice(0, 3).map((a) => acRow([a[0], a[1], a[2], '', a[3]], true)).join('')}${hidden(ACL[3])}${hidden(ACL[4])}${acRow([ACL[5][0], ACL[5][1], ACL[5][2], '', ACL[5][3]], true)}<div class="more">Show 8 more</div></div></div></div>`
  return shellX('Afterplay - Achievements of Clair Obscur: Expedition 33', `<div class="det f">${header({ tab: 'Achievements', compact: true })}${main}</div>`)
}

/* ---------- 6. Saves ---------- */
const STATES = {
  ok: { c: GRN, i: 'check', t: 'Up to date', s: 'The save on this PC matches the latest backup.', who: ['Desk PC', 'this PC, 2 h ago'], acts: [['ghost', 'cloudup', 'Back up now']] },
  local: { c: AMB, i: 'cloudup', t: 'Changes to back up', s: 'There are changes here that aren’t backed up yet.', who: ['Desk PC', 'last backup yesterday at 12:22'], acts: [['pri', 'cloudup', 'Back up now']] },
  behind: { c: TUBE, i: 'clouddown', t: 'There’s a newer save from Living room PC', s: 'Nothing changed on this PC since its last backup, so restoring it loses no progress.', who: ['Living room PC', '3 h ago'], acts: [['pri', 'restore', 'Restore that version'], ['', 'folder', 'Choose another version']] },
  div2: { c: LIVE, i: 'branch', t: 'You have changes here and there’s a newer save from Living room PC', s: 'Both sides have progress the other lacks. Restoring Living room PC’s version replaces the save on this PC.', who: ['Living room PC', '3 h ago'], acts: [['pri', 'restore', 'Restore Living room PC’s version'], ['', 'cloudup', 'Back up this PC’s save']] },
  div: { c: LIVE, i: 'branch', t: 'The saves from Desk PC and Living room PC have gone different ways', s: 'Each one has progress the other lacks. Restore the one you want to continue from; the other stays in the history.', who: ['Desk PC', '1 day ago · Living room PC, 3 h ago'], acts: [['pri', 'restore', 'Restore Living room PC’s version'], ['', 'restore', 'Restore Desk PC’s version']] },
  avail: { c: TUBE, i: 'clouddown', t: 'There’s a save from Living room PC', s: 'This PC has no backup of its own yet. Restore it to continue where you left off.', who: ['Living room PC', '3 h ago'], acts: [['pri', 'restore', 'Restore that version']] },
  info: { c: '#8A9496', i: 'info', t: 'Latest backup: Living room PC, 3 h ago', s: 'Afterplay can’t tell yet whether it’s newer than the save on this PC. It was made before 2.0 and doesn’t say where it came from.', who: null, acts: [['', 'restore', 'Restore that version'], ['', 'cloudup', 'Back up now']] }
}
function stateCard(k, extra = '') {
  const s = STATES[k]
  return `<div class="fstate st-${k}" style="--c:${s.c}"><span class="sico">${ico(s.i)}</span><div class="tx"><b>${s.t}</b><span>${s.s}</span>${s.who ? `<div class="who">${ico('pc')}<em>${s.who[0]}</em><span>${s.who[1]}</span></div>` : ''}</div><div class="sact">${s.acts.map(([c, i, l]) => `<button class="btn ${c}">${ico(i)}${l}</button>`).join('')}</div>${extra}</div>`
}
// versiones: [cuando, antiguedad, dispositivo, tamano, padre(txt), tip, lane]
const VER = [
  ['Nov 21, 23:14', '3 h ago', 'Living room PC', '2.4 MB', 'Continues Desk PC, Nov 20 22:14', true, 1, 2],
  ['Nov 21, 12:22', '1 day ago', 'Desk PC', '2.3 MB', 'Continues Desk PC, Nov 20 22:14', true, 0, 2],
  ['Nov 20, 22:14', '2 days ago', 'Desk PC', '2.3 MB', 'Continues Desk PC, Nov 18 23:07', false, 0, 3],
  ['Nov 18, 23:07', '4 days ago', 'Desk PC', '2.1 MB', 'Continues Living room PC, Nov 14 18:22', false, 0, 4],
  ['Nov 14, 18:22', '8 days ago', 'Living room PC', '2.0 MB', 'Continues Desk PC, Nov 12 22:32', false, 1, 5],
  ['Nov 12, 22:32', '10 days ago', 'Desk PC', '1.8 MB', 'No lineage: made before 2.0', false, 0, -1]
]
function graph(RH = 58) {
  const X = [20, 46]
  const H = VER.length * RH
  const ys = VER.map((_, i) => RH / 2 + i * RH)
  let p = ''
  VER.forEach((v, i) => {
    if (v[7] < 0) return
    const j = v[7] - 1 + 0 // indice del padre = v[7]
    const a = ys[i], b = ys[v[7]], xa = X[v[6]], xb = X[VER[v[7]][6]]
    const col = v[6] ? TUBE : AMB
    p += xa === xb ? `<path d="M${xa} ${a}V${b}" stroke="${col}"/>` : `<path d="M${xa} ${a}C${xa} ${a + 30} ${xb} ${b - 30} ${xb} ${b}" stroke="${col}"/>`
  })
  const nodes = VER.map((v, i) => `<circle cx="${X[v[6]]}" cy="${ys[i]}" r="${v[5] ? 6.5 : 5}" fill="${v[6] ? TUBE : AMB}" ${v[5] ? `stroke="#101416" stroke-width="2.5"` : ''}/>${v[5] ? `<circle cx="${X[v[6]]}" cy="${ys[i]}" r="10.5" fill="none" stroke="${v[6] ? TUBE : AMB}" stroke-opacity=".45"/>` : ''}`).join('')
  return `<svg class="gr" width="70" height="${H}" viewBox="0 0 70 ${H}" fill="none" stroke-width="2.2">${p}${nodes}</svg>`
}
function pageSaves(variant = 'div') {
  const rows = VER.map((v, i) => `<div class="vrow ${v[5] ? 'tip' : ''}"><div class="vw"><b>${v[0]}</b><span>${v[1]}</span></div><div class="vd">${dv(v[2], v[2] === 'Desk PC')}</div><div class="vl">${v[4].startsWith('No') ? `<span class="dust">${v[4]}</span>` : `${ico('branch')}<span>${v[4]}</span>`}${v[5] ? `<span class="lt" style="--c:${v[6] ? TUBE : AMB}">Latest</span>` : ''}</div><div class="vs">${v[3]}</div><div class="va"><button class="btn ${v[5] ? 'rest' : 'ghost'}">${ico('restore')}Restore</button><button class="btn ic ghost" title="Delete this version from the cloud">${ico('trash')}</button></div></div>`).join('')
  const main = `<div class="fpage col">
   ${stateCard(variant)}
   <div class="svcols"><section class="vers"><div class="vhead"><h3>Versions <small>6</small></h3><div class="leg"><span><i style="background:${AMB}"></i>Desk PC</span><span><i style="background:${TUBE}"></i>Living room PC</span><span class="dust">Lines join where one version continues another</span></div></div>
    <div class="vbody">${graph()}<div class="vlist">${rows}</div></div></section>
    <aside class="sside"><div class="sec"><h4><span>Cloud backup</span></h4><div class="cb"><i class="tg on"></i><div><b>On</b><span>Runs when you close a session</span></div></div><button class="btn wide">${ico('cloudup')}Back up now</button><p class="hint">Last backup from this PC: Nov 21, 12:22 · 2.3 MB</p></div>
    <div class="sec"><h4><span>Where it saves on this PC</span></h4>
      <div class="pth2"><code>%LOCALAPPDATA%\\Sandfall\\Saved\\SaveGames</code><span>Found automatically · 3 files · 2.3 MB</span></div>
      <div class="pth2"><code>D:\\Backups\\E33 extra</code><span>Added by you · 1 file<button class="btn ic ghost sm" title="Stop backing up this folder">${ico('x')}</button></span></div>
      <p class="hint">The path has your Steam account ID in it. It only carries over to a PC on the same account.</p>
      <div class="rowb"><button class="btn">${ico('folder')}Add a folder</button><button class="btn">${ico('plus')}Add a single file</button></div>
      <a class="lnk sm">Not the right game? Reset detection</a></div>
    <div class="sec"><h4><span>Restores to</span></h4><div class="cb"><span class="ic2">${ico('folder')}</span><div><b>The original paths</b><span>Or pick another folder on this PC</span></div></div></div></aside></div></div>`
  const dot2 = variant === 'ok' ? null : variant === 'local' ? AMB : variant === 'avail' || variant === 'behind' ? TUBE : LIVE
  return shellX('Afterplay - Saves of Clair Obscur: Expedition 33', `<div class="det f">${header({ tab: 'Saves', compact: true, dots: { Saves: dot2 } })}${main}</div>`)
}
function pageSaveStates() {
  const order = [['ok', 'Up to date', 'The disk matches this PC’s last backup, and that backup is the newest anywhere.'], ['local', 'Changes not backed up', 'The disk changed since this PC’s last backup. Nobody has a newer one.'], ['behind', 'Behind', 'Another PC has a newer save and this PC hasn’t changed. Restoring is safe.'], ['div2', 'Diverged: here and there', 'This PC has changes and another PC has a newer save.'], ['div', 'Diverged: two lines', 'More than one latest save exists. Every PC sees it, including the one that backed up last.'], ['avail', 'Available', 'This PC has none of its own and another PC does.'], ['info', 'Can’t tell yet', 'A 1.x backup with no lineage. Compared by date only and never called diverged.']]
  const cells = order.map(([k, t, d]) => `<div class="scell"><div class="sl"><b>${t}</b><span>${d}</span></div>${stateCard(k)}</div>`).join('')
  return shellX('Afterplay - Saves states', `<div class="det f"><div class="fpage col sbd"><div class="sbi"><h3>Saves tab: the seven sync states</h3><span class="dust">One block at the top of the tab, always the same shape: icon, sentence, who and when, and the main action. The Saves tab gets a coloured dot whenever the state asks for attention.</span></div><div class="sgrid">${cells}</div></div></div>`)
}

/* ---------- 7. Notes ---------- */
const tb = (i, t, on) => `<button class="${on ? 'on' : ''}" title="${t}">${i}</button>`
function shotArt(i) {
  const L = [
    ['#2B2140', '#0B0912', 72, 30, 'rgba(216,174,90,.85)'],
    ['#1D2A3A', '#080C12', 30, 38, 'rgba(235,203,130,.8)'],
    ['#3A2330', '#0E0709', 60, 55, 'rgba(255,179,71,.75)'],
    ['#172A2C', '#060E0F', 80, 28, 'rgba(95,211,224,.55)'],
    ['#33283A', '#0C0910', 45, 42, 'rgba(216,174,90,.7)'],
    ['#26202F', '#09070D', 20, 33, 'rgba(235,203,130,.75)']
  ][i % 6]
  return `background:radial-gradient(circle at ${L[2]}% ${L[3]}%,${L[4]} 0 4%,transparent 12%),radial-gradient(60% 70% at ${L[2]}% ${L[3]}%,rgba(216,174,90,.25),transparent 70%),linear-gradient(180deg,${L[0]},${L[1]})`
}
function pageNotes() {
  const editor = `<div class="ed panel"><div class="edt">${[
    tb('<b>B</b>', 'Bold (Ctrl+B)'), tb('<i>I</i>', 'Italic (Ctrl+I)'), tb('<s>S</s>', 'Strikethrough'), tb(ico('code'), 'Inline code'), '<u></u>',
    tb('H1', 'Heading 1'), tb('H2', 'Heading 2', true), tb('H3', 'Heading 3'), '<u></u>',
    tb(ico('bullets'), 'Bullet list'), tb('1.', 'Numbered list'), tb(ico('quote'), 'Quote'), tb(ico('codeblock'), 'Code block'), '<u></u>',
    tb(ico('link'), 'Link'), tb(ico('divider'), 'Divider'), '<u></u>', tb(ico('undo'), 'Undo (Ctrl+Z)'), tb(ico('redo'), 'Redo (Ctrl+Y)')].join('')}<span class="sv">${ico('check')}Saved</span></div>
   <div class="edb"><h2>Act 2: where the combat opens up</h2>
   <p>Maelle's <b>stance swaps</b> carry most fights, so keep her gear <i>ahead</i> of the others. Lune is the safety net when a fight goes long.</p>
   <h3>Still to do</h3>
   <ul><li>Optional boss past the flooded cliffs</li><li>Find the journals I skipped in the first region</li><li>Try the <a>weapon swap</a> trick before the next story beat</li></ul>
   <blockquote>Come back after the next story beat, not before.</blockquote><hr><h3>Build</h3><ol><li>Maelle on stance swaps, gear first</li><li>Lune as the safety net for long fights</li><li>Sciel for the finishing turns</li></ol>
   <p class="ph">Type to keep writing… markdown shortcuts work too.<span class="caret"></span></p></div></div>`
  const slides = [0, 1, 2, 3, 4, 5].map((i) => `<span class="th ${i === 1 ? 'on' : ''}" style="${shotArt(i)}">${i === 0 ? ico('play', 'f') : ''}</span>`).join('')
  const side = `<aside class="fside nside"><div class="sec"><h4><span>Screenshots</span><span class="dust" style="font-weight:400">2 of 13</span></h4>
    <div class="shot"><div class="big" style="${shotArt(1)}"></div><button class="nav l">${ico('left')}</button><button class="nav r">${ico('right')}</button></div><div class="ths">${slides}</div></div>
    <div class="sec"><h4><span>Session notes</span><span class="dust" style="font-weight:400">2</span></h4>
     <div class="sn2"><div class="h"><b>Fri Nov 20</b><span>20:00 to 22:10 · ${dv('Desk PC')}</span></div><p>Flooded cliffs: the optional boss is still too tough. Back after upgrading Maelle’s gear.</p></div>
     <div class="sn2"><div class="h"><b>Wed Nov 18</b><span>21:15 to 23:05 · ${dv('Desk PC')}</span></div><p>Finished the Act 2 story beat. Next up: the optional boss past the cliffs.</p></div></div></aside>`
  return shellX('Afterplay - Notes of Clair Obscur: Expedition 33', `<div class="det f">${header({ tab: 'Notes', compact: true })}<div class="fpage"><div class="fmain"><div class="nh"><h3>Game notes</h3><span class="dust">Markdown shortcuts work. Saved as you type.</span></div>${editor}</div>${side}</div></div>`)
}

/* ---------- modales ---------- */
const libBase = () => readFileSync(join(dir, 'library.html'), 'utf8')
function overLibrary(modal, title) {
  let h = libBase().replace('</head>', '<link rel="stylesheet" href="ficha.css"></head>').replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
  return h.replace('</body>', `<div class="f-scrim">${modal}</div></body>`)
}
function overPage(shellHtml, modal) {
  return shellHtml.replace('</body>', `<div class="f-scrim">${modal}</div></body>`)
}
const mhead = (icon, title, sub) => `<header class="mh"><span class="mi">${ico(icon)}</span><div><h2>${title}</h2><p>${sub}</p></div><button class="btn ic ghost" title="Close">${ico('x')}</button></header>`
const plat = (a) => `<span class="plats">${a.map((p) => `<em>${p}</em>`).join('')}</span>`

function modalSearch() {
  const R = [
    ['octo', 'Octopath Traveler II', '2023', ['PC', 'PS4', 'PS5', 'Switch', 'Xbox'], 'plan', false],
    ['oct1', 'Octopath Traveler', '2018', ['PC', 'Switch', 'Xbox One'], 'lib', false],
    ['oct0', 'Octopath Traveler 0', '2025', ['PC', 'PS5', 'Switch', 'Xbox Series'], '', true],
    ['octc', 'Octopath Traveler: Champions of the Continent', '2020', ['Android', 'iOS'], '', false],
    ['octd', 'Octodad: Dadliest Catch', '2014', ['PC', 'Mac', 'Linux', 'PS4', 'Switch'], '', false]
  ]
  const rows = R.map(([k, n, y, p, st, foc]) => `<div class="rr ${foc ? 'foc' : ''} ${st === 'lib' ? 'off' : ''}">${cv(k)}<div class="rt"><b>${n}</b><span class="yr">${y}</span>${plat(p)}</div>${st === 'lib' ? `<span class="rst">${ico('check')}In your library</span>` : st === 'plan' ? `<span class="rst inplan">${ico('bullets')}In your plan. Pick it to move it into your library</span>` : foc ? `<span class="rst pick"><kbd>↵</kbd>Pick</span>` : ''}</div>`).join('')
  const modal = `<div class="f-modal" style="width:800px;height:870px">${mhead('plus', 'Add game', 'Search the catalog, then fill the details')}
   <div class="mseg"><span class="on">${ico('search')}Search the catalog</span><span>${ico('folder')}Scan your folders</span></div>
   <div class="msearch">${ico('search')}<span class="q">octopath<i class="caret"></i></span><button class="btn ic ghost sm" title="Clear search">${ico('x')}</button></div>
   <div class="mbody scroll"><div class="rhd">5 results from IGDB</div>${rows}</div>
   <footer class="mf"><span class="dust">↑ ↓ to browse · ↵ to pick</span><div class="sp"></div><button class="btn">Cancel</button><button class="btn pri" disabled style="opacity:.45">Continue</button></footer></div>`
  return overLibrary(modal, 'Afterplay - Add game')
}

function modalScan() {
  const chk = (on = true) => `<i class="cb2 ${on ? 'on' : ''}">${on ? ico('check') : ''}</i>`
  const row = (k, name, match, meta, right, on = true) => `<div class="sr">${chk(on)}${cv(k)}<div class="st"><b>${match}</b><span class="mt">${meta}</span></div><div class="sx">${right}</div></div>`
  const fold = (t, n, hint) => `<div class="sgh"><b>${t}</b><small>${n}</small><span>${hint}</span></div>`
  const modal = `<div class="f-modal" style="width:1000px;height:920px">${mhead('plus', 'Add game', 'Pick the games you want from your folders')}
   <div class="mseg"><span>${ico('search')}Search the catalog</span><span class="on">${ico('folder')}Scan your folders</span></div>
   <div class="fld"><div class="fl2"><div><span class="fp">${ico('folder')}D:\\Games<button class="btn ic ghost sm" title="Remove this folder">${ico('x')}</button></span><span class="fp">${ico('folder')}E:\\SteamLibrary\\steamapps\\common<button class="btn ic ghost sm" title="Remove this folder">${ico('x')}</button></span><button class="btn">${ico('plus')}Add another</button></div><button class="btn">${ico('sync')}Rescan</button></div>
    <p class="hint">One level per folder: each subfolder is a game. Afterplay keeps watching these folders, so anything you install later shows up here.</p></div>
   <div class="mbody scroll">
    ${fold('New to your library', '3', 'Matched in IGDB by folder name')}
    ${row('seki', 'Sekiro Shadows Die Twice', 'Sekiro: Shadows Die Twice <em>2019</em>', 'D:\\Games\\Sekiro Shadows Die Twice · 14.2 GB · sekiro.exe', '<a class="lnk">3 other matches</a>')}
    ${row('hifi', 'HiFi Rush', 'Hi-Fi Rush <em>2023</em>', 'D:\\Games\\HiFi Rush · 21.8 GB · Hibiki.exe', '<a class="lnk">2 other matches</a>')}
    ${row('vamp', 'VampireSurvivors', 'Vampire Survivors <em>2022</em>', 'E:\\SteamLibrary\\steamapps\\common\\Vampire Survivors · 0.3 GB · VampireSurvivors.exe', '<a class="lnk">1 other match</a>', false)}
    ${fold('In your plan and installed here', '1', 'Move it into your library')}
    ${row('pent', 'Pentiment', 'Pentiment <em>2022</em>', 'D:\\Games\\Pentiment · 12.5 GB · Pentiment.exe', '<span class="rst inplan">In your plan, #2</span>')}
    ${fold('Already in your library, not installed on this PC', '2', 'Link them so Play works here')}
    ${row('celeste', 'Celeste', 'Celeste <em>2018</em>', 'D:\\Games\\Celeste · 1.2 GB · Celeste.exe', '<span class="rst lk">' + ico('link') + 'Link installation</span>')}
    ${row('tunic', 'TUNIC', 'Tunic <em>2022</em>', 'E:\\SteamLibrary\\steamapps\\common\\TUNIC · 3.4 GB · Tunic.exe', '<span class="rst lk">' + ico('link') + 'Link installation</span>')}
    <div class="sgh"><b>Not matched</b><small>1</small><span>Search the catalog yourself</span></div>
    <div class="sr un">${chk(false)}<span class="cvx">?</span><div class="st"><b>gb_launcher_2_final</b><span class="mt">D:\\Games\\gb_launcher_2_final · 0.9 GB · launcher.exe</span></div><div class="sx"><div class="mini-s">${ico('search')}<span>Search the catalog…</span></div></div></div>
    <div class="sgh dim"><b>Already in your library and linked on this PC</b><small>9</small><span>${ico('down')}</span></div>
   </div>
   <footer class="mf"><span><b>6</b> selected: <span class="dust">3 new, 1 moved from your plan, 2 linked</span></span><div class="sp"></div><button class="btn">Cancel</button><button class="btn pri">Add 4 and link 2</button></footer></div>`
  return overLibrary(modal, 'Afterplay - Add game, scan your folders')
}

function modalEdit() {
  const man = (t) => `<span class="hand">Set by hand<a>Reset to automatic</a></span>`
  const modal = `<div class="f-modal" style="width:1180px;height:940px">${mhead('edit', 'Edit game', 'Clair Obscur: Expedition 33')}
   <div class="mbody ed2"><div class="c1">
    <section class="fs"><h3>Game info</h3>
     <label>Title<div class="in">Clair Obscur: Expedition 33</div></label>
     <div class="g2"><label>Developer<div class="in">Sandfall Interactive</div></label><label>Publisher${man()}<div class="in hl">Kepler Interactive</div></label></div>
     <label>Genres${man()}<div class="in tags"><span>RPG<i>${ico('x')}</i></span><span>Turn-based<i>${ico('x')}</i></span><span>Adventure<i>${ico('x')}</i></span></div></label>
     <div class="g2"><label>Released<div class="in">Apr 24, 2025</div></label><label>Steam App ID<div class="in mono">1903340</div></label></div></section>
    <section class="fs"><h3>Cover and banner</h3><div class="imgs">
      <div class="im"><div class="cvw">${cv('clair')}</div><div><b>Cover</b><span class="hand">Set by hand</span><a class="lnk sm" style="display:block;margin-bottom:8px">Reset to automatic</a><button class="btn">${ico('image')}Change</button></div></div>
      <div class="im b"><div class="bw">${bn('clair', false, false)}</div><div><b>Banner</b><span class="auto2">${ico('check')}Chosen automatically</span><button class="btn">${ico('image')}Change</button></div></div></div></section>
    <section class="fs"><h3>Playthrough #1</h3><div class="g3"><label>Status<div class="in sel">Playing${ico('down')}</div></label><label>Started<div class="in">Oct 3, 2026</div></label><label>Hours played<div class="in">38h 10m</div></label>
      <label>Platform<div class="in sel">PC${ico('down')}</div></label><label>Origin<div class="in sel">Steam${ico('down')}</div></label><label>Money spent<div class="in">€49.99</div></label></div></section>
   </div><div class="c2">
    <section class="fs"><h3>Launch and install <span class="thispc">${ico('pc')}On this PC</span></h3>
     <div class="scan">${ico('search')}<span>Find in my game folders</span><button class="btn">Search</button></div>
     <label>Install folder<span class="where">Desk PC</span><div class="in mono">D:\\Games\\Expedition 33<button class="btn ic ghost sm">${ico('folder')}</button></div></label>
     <label>Executable<span class="where">Desk PC</span><div class="in mono">D:\\Games\\Expedition 33\\Sandfall\\Binaries\\Win64\\Expedition33.exe<button class="btn ic ghost sm">${ico('folder')}</button></div></label>
     <div class="others">${ico('info')}<span>Other PCs keep their own paths. <b>Living room PC</b> has this game at D:\\Games\\Expedition 33. You can change that one from there.</span></div></section>
    <section class="fs"><h3>Game type</h3>
     <div class="ck"><i class="cb2"></i><div><b>Endless game</b><span>No ending (Minecraft, Factorio…). Hides “Complete”, never counts as backlog.</span></div></div>
     <div class="ck"><i class="cb2"></i><div><b>Emulated game</b><span>Runs inside an emulator. Sessions are detected from the emulator and assigned manually.</span></div></div></section>
    <section class="fs"><h3>Notes</h3><div class="edt mini">${[tb('<b>B</b>', ''), tb('<i>I</i>', ''), tb('H2', ''), tb(ico('bullets'), ''), tb(ico('link'), '')].join('')}</div><div class="in note">Act 2 is where the combat really opens up. Maelle's stance swaps carry most fights, so keep her gear ahead of the others.</div></section>
   </div></div>
   <footer class="mf"><span class="dust">Changes apply to this PC's paths only.</span><div class="sp"></div><button class="btn">Cancel</button><button class="btn pri">Save changes</button></footer></div>`
  return overPage(pageOverviewDim(), modal)
}
const pageOverviewDim = () => shellX('Afterplay - Edit game', overview({ head: header({ tab: 'Overview' }) }))

function modalRestore() {
  const modes = [
    ['hdd', 'Where it belongs', 'Back to the paths the backup came from. Overwrites the save currently on disk.', true, 'danger'],
    ['folder', 'Another folder on this PC', 'For when the game lives on a different drive here. Remembered for next time.', false, ''],
    ['export', 'Save a copy to…', 'Just drop the files in a folder. Doesn’t touch the game or the registry.', false, '']
  ]
  const mrow = ([i, t, d, on, cls]) => `<div class="mode ${on ? 'on ' + cls : ''}"><span class="mc">${ico(i)}</span><div><b>${t}</b><span>${d}</span></div>${on ? `<i class="sel">${ico('check')}</i>` : ''}</div>`
  const modal = `<div class="f-modal rsm" style="width:640px;height:860px">${mhead('restore', 'Restore save', 'Clair Obscur: Expedition 33 · Nov 21, 23:14 · from <b>Living room PC</b>')}
   <div class="mbody pd">
    <div class="fwarn tube sm3">${ico('branch')}<div class="tx"><b>This version continues Desk PC’s Nov 20 save</b><span>Desk PC also has a newer save from Nov 21, 12:22. It stays in the history after this.</span></div></div>
    <div class="modes">${modes.map(mrow).join('')}</div>
    <label class="exact"><i class="cb2"></i><span><b>Leave the save folder exactly as in this version</b><span>Deletes save files it doesn’t have. Off by default.</span></span></label>
    <div class="safe">${ico('shield')}<span>Before writing anything, the save on this PC is backed up so you can come back to it.</span></div>
    <div class="rplan"><div class="ph"><span class="pi">${ico('folder')}</span><div><b>Writes into</b><code>%LOCALAPPDATA%\\Sandfall\\Saved\\SaveGames</code></div><div class="pt"><b class="bs">3 files</b><span>2.4 MB</span></div></div>
     <div class="pf"><span>${ico('down')}</span><b>SaveGames</b><small>3 files</small><span class="dust"></span></div>
     <div class="pl"><span>EXPEDITION_0.sav</span><em>1.6 MB</em></div><div class="pl"><span>EXPEDITION_0_backup.sav</span><em>0.7 MB</em></div><div class="pl"><span>Settings.sav</span><em>0.1 MB</em></div></div>
   </div>
   <footer class="mf"><button class="btn">Cancel</button><div class="sp"></div><button class="btn danger">${ico('restore')}Restore for real</button></footer></div>`
  return overPage(pageSaves('div'), modal)
}

/* ---------- salida ---------- */
const out = {
  'ficha-sin-instalacion': pageNoInstall(),
  'ficha-otro-pc': pageRemote(),
  'ficha-avisos': pageNotices(),
  'ficha-sesiones': pageSessions(),
  'ficha-logros': pageAchievements(),
  'ficha-saves': pageSaves('div'),
  'ficha-saves-estados': pageSaveStates(),
  'ficha-notas': pageNotes(),
  'ficha-add-buscar': modalSearch(),
  'ficha-add-escanear': modalScan(),
  'ficha-editar': modalEdit(),
  'ficha-restaurar': modalRestore()
}
for (const [k, v] of Object.entries(out)) writeFileSync(join(dir, `${k}.html`), v)
console.log('HTML generado:', Object.keys(out).join(', '))
