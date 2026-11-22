// Fosforo, segunda ronda: modo TV completo y PWA completa (prefijo tvpwa). Uso: node build-tvpwa.mjs
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { G, STN, ST, cv, bn, dot, chip, ic, doc, logoSvg } from './build.mjs'
const dir = dirname(fileURLToPath(import.meta.url))

/* ---------- datos propios (juegos que no estan en G) ---------- */
Object.assign(G, {
  dsouls: { n: 'Dark Souls III', s: 'Dark<br>Souls III', a: '#5A2A18', b: '#0E0806', c: '#F0A04B', k: 3, ts: '22cqw' },
  darkest: { n: 'Darkest Dungeon II', s: 'Darkest<br>Dungeon II', a: '#4A1620', b: '#0B0407', c: '#D8C28A', k: 4, ts: '17cqw' },
  darkwood: { n: 'Darkwood', s: 'Darkwood', a: '#27402E', b: '#07100A', c: '#C8D6A0', k: 1, ts: '22cqw' },
  dsrem: { n: 'Dark Souls: Remastered', s: 'Dark Souls<br>Remastered', a: '#3A3A44', b: '#0A0A0E', c: '#E2B66B', k: 5, ts: '15cqw' }
})

/* ---------- iconos extra ---------- */
const X = {
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5v1.5A3 3 0 0 0 8 10.5M16 6h3v1.5a3 3 0 0 1-3 3M12 13v4M9 20h6M10 17h4"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  cloudoff: '<path d="M7 18h9.5a3.5 3.5 0 0 0 .9-6.9A5.5 5.5 0 0 0 7.2 9.6 4 4 0 0 0 7 18zM4 4l16 16"/>',
  cloudup: '<path d="M7 18h9.5a3.5 3.5 0 0 0 .9-6.9A5.5 5.5 0 0 0 7.2 9.6 4 4 0 0 0 7 18z"/><path d="M12 15v-5M9.8 12l2.2-2.2 2.2 2.2"/>',
  flame: '<path d="M12 3c1 3.5 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  cl: '<path d="m14 6-6 6 6 6"/>',
  cr: '<path d="m10 6 6 6-6 6"/>',
  copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h1"/>',
  userplus: '<circle cx="10" cy="8" r="3.5"/><path d="M3.5 19a6.5 6.5 0 0 1 13 0M18 8v6M15 11h6"/>',
  alert: '<path d="M12 4 3 19h18z"/><path d="M12 10v4M12 16.8h.01"/>',
  spinner: '<path d="M12 3a9 9 0 1 0 9 9"/>',
  timer: '<circle cx="12" cy="13" r="7"/><path d="M12 9v4l2.5 1.5M9.5 3h5"/>',
  power: '<path d="M12 3v8M6.5 6.8a8 8 0 1 0 11 0"/>',
  logout: '<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 8l4 4-4 4M19 12H9"/>',
  book: '<path d="M4 5.5C6 4.5 9 4.5 12 6c3-1.5 6-1.5 8-.5V19c-2-1-5-1-8 .5-3-1.5-6-1.5-8-.5z"/><path d="M12 6v13.5"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
  wifioff: '<path d="M3 9a14 14 0 0 1 18 0M6 12.5a9.5 9.5 0 0 1 12 0M9.2 16a5 5 0 0 1 5.6 0M12 19.5h.01M4 4l16 16"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8 6.8 19.6l1-5.8-4.3-4.1 5.9-.8z"/>',
  shield: '<path d="M12 3.5 5 6v5.5c0 4.2 2.8 7.4 7 9 4.2-1.6 7-4.8 7-9V6z"/>',
  bolt: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>',
  gem: '<path d="M6 4h12l3 5-9 11L3 9z"/><path d="M3 9h18M9 4l-1 5 4 11M15 4l1 5-4 11"/>',
  swap: '<path d="M4 8h13M14 4l4 4-4 4M20 16H7M10 12l-4 4 4 4"/>',
  sword: '<path d="M5 19 17 7V4h3v3L8 19zM7 17l-3 3M13 11l3 3"/>',
  mask: '<path d="M4 6c5 1 11 1 16 0v6c0 4-3.5 7-8 8-4.5-1-8-4-8-8z"/><path d="M8.5 11h.01M15.5 11h.01M9 15c2 1.3 4 1.3 6 0"/>'
}
const ix = (k, extra = '') => (X[k] ? `<svg class="i ${extra}" viewBox="0 0 24 24">${X[k]}</svg>` : ic(k, extra))
const ixf = (k) => ix(k, 'f')

const page = (title, body) => doc(title, body).replace('</head>', '<link rel="stylesheet" href="tvpwa.css"></head>')
const NOW_LIVE = 'Living room PC'

/* =====================================================================
   TV
   ===================================================================== */
const rnd = (seed, i, k) => { const x = Math.sin(seed * 131.7 + i * 977.3 + k * 57.31) * 43758.5453; return x - Math.floor(x) }
// Luciernagas reinterpretadas: motas de fosforo, una por juego, del color de su estado.
const motes = (n = 46, seed = 3) => {
  const cols = ['#FFB347', '#FFB347', '#FFB347', '#9BD67A', '#5FD3E0', '#5FD3E0', '#B9A6FF']
  return `<div class="motes">${Array.from({ length: n }, (_, i) => `<i style="left:${(rnd(seed, i, 1) * 100).toFixed(1)}%;top:${(rnd(seed, i, 2) * 100).toFixed(1)}%;--s:${(2 + rnd(seed, i, 3) * 4).toFixed(1)}px;--c:${cols[Math.floor(rnd(seed, i, 4) * cols.length)]};opacity:${(0.25 + rnd(seed, i, 5) * 0.45).toFixed(2)}"></i>`).join('')}</div>`
}
const tvTop = (active) => `<header class="tvtop"><div class="logo">${logoSvg.replace('width="26" height="26"', 'width="38" height="38"')}Afterplay</div><nav class="tvtabs">${['Home', 'Library', 'Journey'].map((t) => `<a class="${t === active ? 'on' : ''}">${t}</a>`).join('')}</nav><div class="r"><div class="sync"><i></i>Synced</div><span>20:52</span></div></header>`
const gl = (g) => (Array.isArray(g) ? g.map((x) => `<b class="gp">${x}</b>`).join('') : `<b class="${g === 'A' ? 'a' : ''}">${g}</b>`)
const hints = (items, menu = true) => `<footer class="hints">${items.map(([g, t]) => `<span>${gl(g)}${t}</span>`).join('')}${menu ? `<span class="r"><b class="gp">${ic('list')}</b>Start menu</span>` : ''}</footer>`
const tvf = (cls, inner, extra = '') => `<div class="tv ${cls}">${motes(46, cls.length + 2)}${inner}${extra}</div>`
const stack = (title, frames) => page(title, `<div class="stk">${frames.map(([l, f]) => `<div class="lbl"><b>${l[0]}</b>${l[1] || ''}</div>${f}`).join('')}</div>`)

/* ----- biblioteca ----- */
const LIBX = [['silk', 'playing', '23h 15m'], ['clair', 'playing', '38h 10m'], ['balatro', 'playing', '61h 30m'], ['hades2', 'playing', '22h 05m'], ['split', 'playing', '4h 45m'], ['outer', 'beaten', '24h 10m'], ['celeste', 'beaten', '9h 40m'], ['disco', 'beaten', '31h 05m'], ['hollow', 'beaten', '52h 20m'], ['hades', 'beaten', '47h 20m'], ['tunic', 'beaten', '14h 00m'], ['obra', 'beaten', '11h 30m']]
const tile = (k, st, h, foc, cap = true) => `<div class="tpt ${foc ? 'foc' : ''}">${cv(k, { st, h })}${foc && cap ? `<div class="tcap">${G[k].n}</div>` : ''}</div>`
const libFrame = (kb) => {
  const list = kb ? LIBX.filter(([k]) => /hollow/i.test(G[k].n)) : LIBX
  const f = [['All', 331, 1], ['Playing', 5], ['Unplayed', 96], ['Beaten', 142], ['Endless', 12]]
  const pills = f.map(([l, n, on]) => `<span class="gpx ${on ? 'on' : ''}">${l}<small>${n}</small></span>`).join('')
  const search = kb
    ? `<span class="tpl-search on">${ic('search')}<b>hollow</b><span class="x">${ic('x')}</span></span>`
    : `<span class="tpl-search">${ic("search")}Search<b class="gp">Y</b></span>`
  const cnt = kb ? `<b>2</b><span>games · 75h 35m</span>` : `<b>331</b><span>games · 4,386h</span>`
  return tvf('lib', `${tvTop('Library')}
    <section class="tpl-head"><h1>Library</h1><div class="tpl-pills"><b class="gp lr">LB</b>${pills}<b class="gp lr">RB</b></div>${search}<div class="tpl-cnt">${cnt}</div></section>
    <section class="tpl-grid">${list.map(([k, s, h], i) => tile(k, s, h, !kb && i === 1)).join('')}</section>
    <div class="tpl-rail"><i></i></div>
    ${hints([['A', 'Open'], ['B', 'Back'], ['Y', 'Search'], [['LB', 'RB'], 'Filter']])}`,
  kb ? kbPanel() : '')
}
const kbPanel = () => {
  const rows = [['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'], ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'], ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ñ'], ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '-']]
  const off = [0, 0, 28, 56]
  return `<div class="scrim"></div><div class="kb"><div class="fld">${ic('search')}<span class="v">hollow</span><i class="caret"></i><span class="hint">2 matches</span></div>
    <div class="sug"><span class="ch">${cv('silk')}Hollow Knight: Silksong</span><span class="ch">${cv('hollow')}Hollow Knight</span></div>
    <div class="rows">${rows.map((r, ri) => `<div class="rw" style="margin-left:${off[ri]}px">${r.map((c) => `<span class="kk ${c === 'k' ? 'foc' : ''}">${c}</span>`).join('')}</div>`).join('')}
    <div class="rw" style="margin-left:28px"><span class="kk w1">${ix('x')}</span><span class="kk w2">${ic('plus').replace('<svg', '<svg style="opacity:0"')}<em>space</em></span><span class="kk w1">${ix('x')}</span><span class="kk w3 acc">done</span></div></div></div>`
}

/* ----- ficha ----- */
const TABS = [['overview', 'Overview'], ['achievements', 'Achievements', '38/52'], ['sessions', 'Sessions', '14'], ['history', 'History', '5'], ['notes', 'Notes', '3'], ['saves', 'Saves', '6']]
const remotePill = (remote) => (remote ? `<span class="rpill">${remote === 'live' ? '<i class="pulse"></i>' : '<i class="hol"></i>'}Playing on ${NOW_LIVE}${remote === 'nosig' ? '<small>No signal for 7 minutes</small>' : ''}</span>` : '')
const detailFrame = ({ tab, remote, body, side }) => {
  const cmp = tab !== 'overview'
  const tabs = TABS.map(([k, l, c]) => `<span class="tb ${k === tab ? 'on' : ''}">${l}${c ? `<small>${c}</small>` : ''}</span>`).join('')
  const head = `<div class="tpd-head"><div><h1 class="tt">Clair Obscur: Expedition 33</h1><div class="meta">${chip('playing')}<span class="sep"></span><span>RPG, Turn-based</span><span class="sep"></span><span>PC</span><span class="sep"></span><span>2025</span></div></div>
    <div class="acts"><span class="tbtn pri ${tab === 'overview' ? 'foc' : ''}">${ixf('play')}Play</span>${remotePill(remote)}<span class="tbtn">Set status</span></div></div>`
  return tvf(`tpd ${cmp ? 'cmp' : ''}`, `<div class="tpd-bg">${bn('clair', true, false)}</div>${tvTop('Library')}
    <div class="tpd-main ${cmp ? '' : 'ov'}">${head}<nav class="tpd-tabs">${tabs}<span class="lrb"><b class="gp">LB</b><b class="gp">RB</b></span></nav><div class="tpd-body">${body}</div></div>
    ${side ? sideCol() : ''}${hints([['A', 'Select'], ['B', 'Back'], ['X', 'Set status'], [['LB', 'RB'], 'Section']])}`)
}
const sideCol = () => `<aside class="tpd-side">${cv('clair')}
  <h4>Playthroughs <em>1</em></h4><div class="ptl"><span class="no">#1</span>${chip('playing')}<small>Oct 3, 2026 to now</small></div>
  <h4>Installed on</h4><div class="inst">${ic('pc')}Living room PC</div><div class="inst">${ic('pc')}Desk PC</div></aside>`

const segs = (n, f) => Array.from({ length: n }, (_, i) => `<i class="${i < f ? 'f' : i === f ? 'p' : ''}"></i>`).join('')
const pos = (h) => `${((h / 62) * 100).toFixed(1)}%`
const overviewBody = () => `<div class="vit"><div class="k"><b>38<small>h</small>10<small>m</small></b><span>Hours</span></div><div><b>14</b><span>Sessions</span></div><div><b>38<small>/52</small></b><span>Trophies</span></div><div><b>Nov 21</b><span>Last played</span></div><div><b>€49.99</b><span>Spent</span></div><div><b>Sep 2026</b><span>In library</span></div></div>
  <div class="ovr"><div class="hl"><h4>How long to beat<span>HowLongToBeat</span></h4><div class="seg62">${segs(62, 38)}</div>
    <div class="mk"><span style="left:${pos(30)}"><b>30h</b>Story</span><span style="left:${pos(45)}"><b>45h</b>+ Extras</span><span class="r"><b>62h</b>100%</span></div></div>
  <div class="lo"><h4>Where you left off<span>Nov 21</span></h4><p>Still missing the optional boss past the flooded cliffs. Come back after the next story beat.</p></div></div>
  <div class="cur">${ix('info').replace('class="i "', 'class="i " ')}<span>Developed by Sandfall Interactive, a studio of about thirty people.</span></div>`

const SESSX = [
  { w: 'Today, Sun Nov 22', t: 'Playing on Living room PC since 19:40', d: '1:12:04', live: 1, n: '' },
  { w: 'Sat, Nov 21 · 21:00 to 23:10', t: 'Living room PC · Tracked', d: '2h 10m', n: 'Finished the flooded cliffs.', a: '2 achievements' },
  { w: 'Sat, Nov 21 · 10:30 to 12:20', t: 'Desk PC · Tracked', d: '1h 50m', n: 'Gear swap before Act 2.', foc: 1 },
  { w: 'Fri, Nov 20 · 20:00 to 22:10', t: 'Desk PC · Tracked', d: '2h 10m', n: '', a: '1 achievement' },
  { w: 'Wed, Nov 18 · 21:00 to 23:30', t: 'Living room PC · Tracked', d: '2h 30m', n: 'Long one, stopped at a save point.', rec: 1 }
]
const sessionsBody = () => `<div class="tsum"><div><b>38h 10m</b><span>Played</span></div><div><b>2h 30m</b><span>Longest</span></div><div><b>2h 43m</b><span>Average</span></div><div><b>14</b><span>Sessions</span></div></div>
  <div class="tsl">${SESSX.map((s) => `<div class="tsr ${s.live ? 'live' : ''} ${s.foc ? 'foc' : ''}"><div><div class="w">${s.live ? `<i class="pulse"></i>${s.w}` : s.w}</div><div class="s">${s.t}</div></div><div class="du ${s.live ? 'lv' : ''}">${s.rec ? ixf('flame') : ''}${s.d}</div><div class="rt">${s.a ? `<span class="ac">${ix('trophy')}${s.a}</span>` : ''}${s.n ? `<span class="nt">${s.n}</span>` : ''}</div></div>`).join('')}</div>`

const HIST = [
  ['2026', null],
  ['Playing', 'playing', 'Nov 8', 'Back after a break, straight into Act 2.'],
  ['Resting', 'resting', 'Oct 19', 'Hades II took over for a while.'],
  ['Playing', 'playing', 'Oct 3', 'Started on the Desk PC.'],
  ['€49.99', 'spend', 'Sep 28', 'Purchase, Steam'],
  ['Added to Afterplay', 'added', 'Sep 12', 'From your plan.']
]
const historyBody = () => `<div class="thh"><h4>History</h4><span>5 entries</span></div><div class="thl">${HIST.map((e, i) => {
  if (e[1] === null) return `<div class="thy">${e[0]}</div>`
  const c = e[1] === 'spend' ? 'var(--phos)' : e[1] === 'added' ? 'var(--tube)' : ST[e[1]]
  return `<div class="thr ${i === 2 ? 'foc' : ''}"><div class="rl"><i style="--c:${c}"></i></div><div class="bd"><div class="ti" style="color:${e[1] === 'spend' ? 'var(--bone)' : c}">${e[1] === 'spend' ? `${ix('euro')}${e[0]}` : e[0]}</div><div class="nt2">${e[3]}</div></div><div class="dt">${e[2]}</div></div>`
}).join('')}</div>`

const ACH = [
  ['First Light', 'Complete the prologue.', 'Oct 3', '92%', 'bolt', 1],
  ['Dawn of the Expedition', 'Complete Act 1.', 'Oct 11', '71%', 'flame', 1],
  ['Stance Dancer', 'Swap stances 100 times.', 'Nov 8', '34%', 'swap', 1],
  ['Perfect Parry', 'Parry 25 attacks without being hit.', 'Nov 21', '18%', 'shield', 1],
  ['Hidden achievement', 'Hidden: press A to reveal.', '', '', 'lock', 0, 'hid'],
  ['Master of Pictos', 'Equip 30 different Pictos.', 'Oct 29', '27%', 'gem', 1],
  ['Cliffside Hunter', 'Defeat the optional boss past the flooded cliffs.', 'Locked', '9%', 'sword', 0],
  ['Lumina Collector', 'Unlock 20 Lumina.', 'Locked', '12%', 'star', 0]
]
const achBody = () => `<div class="tah"><div class="big"><b>38</b><small>/52</small></div><div class="mid"><div class="pc">73% unlocked</div><div class="seg52">${Array.from({ length: 52 }, (_, i) => `<i class="${i < 38 ? 'f' : ''}"></i>`).join('')}</div></div><div class="src"><span>Steam <b>38 of 52</b></span><span>RetroAchievements <em>not synced yet</em></span></div></div>
  <div class="tag">${ACH.map(([n, d, dt, r, ico, un, hid]) => `<div class="tac ${un ? '' : 'lk'} ${hid ? 'foc' : ''}"><div class="ico">${ix(ico)}</div><div class="tx"><div class="nm">${n}</div><div class="ds">${d}</div></div><div class="rr">${r ? `<b>${r}</b>` : ''}<span>${dt}</span></div></div>`).join('')}</div>`

const savesBody = () => `<div class="tsv"><div class="l"><div class="hero2"><span class="ok">${ixf('check').replace('<svg', '<svg style="width:60px;height:60px;stroke:#101416;stroke-width:3;fill:none"')}</span><div><div class="big">Up to date</div><div class="ds">Your saves match the cloud copy from today, 21:02.</div></div></div>
    <div class="ph"><span class="ph-i">${ix('folder')}</span><div><div class="n">Expedition33<em class="tag1">Detected</em></div><div class="pa">%LOCALAPPDATA%/Sandfall/Saved/SaveGames</div></div></div>
    <div class="ph"><span class="ph-i">${ix('file')}</span><div><div class="n">EXPEDITION_0.sav<em class="tag1 c">Custom</em></div><div class="pa">D:/Games/Clair Obscur/Saves</div></div></div>
    <div class="dash">Backup locations are managed from your desk.</div></div>
  <div class="r"><div class="vh"><h4>Versions</h4><span class="cn">${ix('cloudup')}6 in cloud</span></div>${[
    ['Today, 21:02', 'LATEST', '148 MB · Desk PC · incremental'],
    ['Yesterday, 23:14', '', '147 MB · Living room PC · incremental'],
    ['Nov 20, 22:11', '', '146 MB · Desk PC · incremental'],
    ['Nov 18, 23:31', '', '141 MB · Living room PC'],
    ['Nov 14, 18:02', '', '133 MB · Desk PC · incremental']
  ].map((v, i) => `<div class="vr ${i === 1 ? 'foc' : ''}"><div class="d"><b>${v[0]}</b>${v[1] ? `<em>${v[1]}</em>` : ''}</div><div class="m">${v[2]}</div></div>`).join('')}</div></div>`

const notesBody = () => `<div class="tnt"><div class="l"><div class="ph3">${ix('note')}Your notes</div><div class="pr"><p>Act 2 is where the combat really opens up. Maelle's stance swaps carry most fights, so keep her gear ahead of the others.</p><p>Still missing the optional boss past the flooded cliffs. Come back after the next story beat.</p></div><div class="dash">${ix('edit')}Notes are written from your desk.</div></div>
  <div class="r"><div class="vh"><h4>Session notes</h4><span class="cn">3</span></div>${[['Sat, Nov 21 · 21:00', 'Finished the flooded cliffs.', 0], ['Sat, Nov 21 · 10:30', 'Gear swap before Act 2.', 1], ['Wed, Nov 18 · 21:00', 'Long one, stopped at a save point.', 0]].map((n) => `<div class="sn ${n[2] ? 'foc' : ''}"><div class="d">${n[0]}</div><div class="q">${n[1]}</div></div>`).join('')}</div></div>`

/* ----- Journey ----- */
const journeyFrame = () => {
  const jc = [['clair', 'playing', '21h 30m'], ['silk', 'playing', '11h 15m'], ['balatro', 'playing', '8h 40m'], ['hades2', 'playing', '4h 20m'], ['split', 'playing', '2h 35m'], ['outer', 'beaten', '1h 50m']]
  const mon = 'JFMAMJJASOND'.split('')
  const act = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0]
  return tvf('jr', `<div class="jbg">${bn('clair', true, false)}</div>${tvTop('Journey')}
  <section class="jpage"><span class="spine"></span><span class="edge1"></span><span class="edge2"></span>
    <b class="parr l off">${ix('cl')}</b><b class="parr r">${ix('cr')}</b>
    <div class="jh"><div class="ttl"><h1>November</h1><span>2026</span></div><div class="jf"><div class="k"><b>50<small>h</small>10<small>m</small></b><span>played</span></div><div><b>6</b><span>games</span></div><div><b>21</b><span>sessions</span></div></div></div>
    <div class="jrec"><h4>The story of November</h4><p>November belonged to Clair Obscur: twenty-one hours across nine evenings, and the flooded cliffs finally gave way. Silksong took the weekend mornings, Balatro filled the gaps on the phone, and Outer Wilds closed out on the 14th with its last loop.</p></div>
    <div class="jcov">${jc.map(([k, s, h], i) => `<div class="tpt ${i === 0 ? 'foc' : ''}">${cv(k, { st: s, h })}</div>`).join('')}</div>
    <div class="jidx"><span class="yr">2026</span>${mon.map((m, i) => `<span class="mo ${i === 10 ? 'on' : ''} ${act[i] ? '' : 'z'}"><i></i>${m}</span>`).join('')}<span class="pg">Page 3 of 29</span></div>
  </section>${hints([['A', 'Open'], ['B', 'Back'], [['LB', 'RB'], 'Page'], [['LT', 'RT'], 'Year']])}`)
}

/* ----- menu Start y panel de cierre ----- */
const homeBg = () => `${tvTop('Home')}<section class="tvhero" style="height:300px">${bn('silk', true, false)}<div class="shade"></div><div class="in"><div class="lab"><i class="pulse" style="width:12px;height:12px"></i>Playing now on Desk PC</div><h1>Hollow Knight: Silksong</h1></div></section>
  <section class="tvsh"><h3>Playing <em>and recently played</em></h3><div class="hr6">${['silk', 'clair', 'balatro', 'hades2', 'split', 'outer', 'celeste'].map((k) => `<div class="tpt">${cv(k, { st: 'playing', h: '12h 00m' })}</div>`).join('')}</div></section>`
const menuFrame = () => tvf('mn', `${homeBg()}${hints([['A', 'Select'], ['B', 'Close']], false)}<div class="scrim"></div>
  <aside class="smn"><div class="hd"><i class="pulse ph"></i>Big Picture</div>
    ${[['Home', 'home', 1], ['Library', 'lib'], ['Journey', 'book']].map(([l, i, f]) => `<div class="mi ${f ? 'foc' : ''}"><span class="ib">${ix(i)}</span>${l}</div>`).join('')}
    <div class="dv"></div>
    <div class="mi"><span class="ib">${ix('logout')}</span>Exit Big Picture</div><div class="mi danger"><span class="ib">${ix('power')}</span>Quit Afterplay</div>
    <div class="ft"><i></i>Afterplay<small>Fósforo 2.0</small></div></aside>`)
const endedFrame = () => tvf('en', `${homeBg()}${hints([['A', 'Select'], ['B', 'Dismiss']], false)}<div class="scrim"></div>
  <div class="ep"><div class="epb">${bn('clair', true, false)}</div><div class="eps"></div><div class="epi">${cv('clair')}<div class="r">
    <div class="lb">${ix('timer')}Session ended</div><div class="gn">Clair Obscur: Expedition 33</div>
    <div class="du"><b>2h 40m</b><span>· 40h 50m total</span></div>
    <div class="rec">${ixf('flame')}Your longest session with this game</div>
    <div class="ba"><span class="qb">${ix('check')}Beaten</span><span class="qb">${ix('x')}Dropped</span><i></i><span class="qb pri foc">Continue</span></div>
    <div class="ft">You can write the session note from your desk.</div></div></div></div>`)

/* =====================================================================
   PWA
   ===================================================================== */
const stb = '<div class="stb"><span>20:52</span><span>5G<i></i></span></div>'
const miniP = `<div class="mini">${cv('silk')}<div><div class="nm">Hollow Knight: Silksong</div><div class="sub"><i class="pulse" style="width:7px;height:7px"></i>Desk PC</div></div><span class="tm">1:12:04</span><span class="stop">${ixf('stop')}</span></div>`
const tbar = (a) => `<nav class="tbar">${[['Home', 'home'], ['Library', 'lib'], ['Plan', 'plan'], ['Sessions', 'clock']].map(([l, i]) => `<a class="${l === a ? 'on' : ''}">${ic(i)}${l}</a>`).join('')}</nav>`
const phone = (body, o = {}) => `<div class="phone"><div class="scr">${stb}${o.top || ''}<div class="pgc ${o.pgc || ''}">${body}</div>${o.mini === false ? '' : miniP}${o.mini === false && o.bar === false ? '' : tbar(o.active === undefined ? 'Home' : o.active)}${o.over || ''}</div></div>`
const board = (items) => page('Afterplay - PWA', `<div class="board"><div class="row">${items.map(([l, s]) => `<div class="pw">${s}<span>${l}</span></div>`).join('')}</div></div>`)
const mhead = (t, s, right = '') => `<div class="mh"><h2>${t}</h2>${right || `<span>${s}</span>`}</div>`
const backhead = (t) => `<div class="mh bk"><span class="bkb">${ix('cl')}</span><h2>${t}</h2></div>`

/* ----- QR de mentira, determinista ----- */
const qr = () => {
  const N = 25
  let s = 7391
  const r = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
  const fin = (x, y) => { const ex = (x < 7 && y < 7) || (x >= N - 7 && y < 7) || (x < 7 && y >= N - 7); return ex }
  const cells = []
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (fin(x, y)) continue
    if (r() > 0.52) cells.push(`<rect x="${x + 2}" y="${y + 2}" width="1" height="1"/>`)
  }
  const finder = (ox, oy) => `<rect x="${ox + 2.5}" y="${oy + 2.5}" width="6" height="6" fill="none" stroke="#101416" stroke-width="1"/><rect x="${ox + 4}" y="${oy + 4}" width="3" height="3"/>`
  return `<svg viewBox="0 0 ${N + 4} ${N + 4}" shape-rendering="crispEdges"><rect width="${N + 4}" height="${N + 4}" fill="#E9E4D8"/><g fill="#101416">${cells.join('')}${finder(0, 0)}${finder(N - 7, 0)}${finder(0, N - 7)}</g></svg>`
}

/* ----- Sessions ----- */
const wk = [['M', 93], ['T', 0], ['W', 150], ['T', 0], ['F', 175], ['S', 325], ['S', 117]]
const srow = (k, t, dev, d, live) => `<div class="mrow">${cv(k)}<div><div class="tt">${G[k].n}</div><div class="ss">${t} · ${dev}</div></div>${live ? '<div class="hh now"><i class="pulse" style="width:7px;height:7px"></i>now</div>' : `<div class="hh">${d}</div>`}</div>`
const sessionsP = phone(`${mhead('Sessions', '126 sessions')}
  <div class="wkp"><div class="wl"><b>14h 20m</b><span>this week · 9 sessions</span></div><div class="mbars sm2">${wk.map(([d, m], i) => `<div class="${i === 6 ? 't' : ''}"><i style="height:${Math.max(3, m / 325 * 30)}px"></i><span>${d}</span></div>`).join('')}</div></div>
  <div class="gh"><h3>Today</h3><span>1h 57m</span></div>
  ${srow('silk', '19:40 to now', 'Desk PC', '', 1)}${srow('balatro', '13:05 to 13:50', 'Phone timer', '45m')}
  <div class="gh"><h3>Yesterday</h3><span>5h 25m</span></div>
  ${srow('clair', '21:00 to 23:10', 'Living room PC', '2h 10m')}${srow('silk', '15:00 to 16:25', 'Desk PC', '1h 25m')}${srow('clair', '10:30 to 12:20', 'Desk PC', '1h 50m')}
  <div class="gh"><h3>Fri, Nov 20</h3><span>2h 55m</span></div>${srow('balatro', '22:20 to 23:05', 'Phone timer', '45m')}`, { active: 'Sessions' })

/* ----- Ajustes ----- */
const settingsTop = (inner) => `${backhead('Settings')}${inner}`
const addDevice = `<section class="pcard"><h3>Add device</h3><p>On your PC, open Settings, then Sync (or the 2.0 migration screen), and enter the address and this code.</p>
  <div class="code2"><span>7KQF 92MX</span></div>
  <div class="qrr"><div class="qrb">${qr()}</div><div class="qri"><div class="ex">Expires in <b>9:42</b></div><div class="sgl">Single use</div><button class="btn">${ix('copy')}Copy code</button></div></div>
  <div class="adr"><label>Address</label><div class="fx"><code>https://afterplay.mi-hub.dev</code><span class="cb">${ix('copy')}</span></div></div>
  <button class="btn pri full">${ix('plus')}Generate a new code</button></section>`
const settings1 = phone(settingsTop(addDevice), { active: null })
const devRow = (n, s, o = {}) => `<li class="dvr ${o.confirm ? 'cf' : ''}"><div class="dtp"><span class="ico">${ic('pc')}</span><div class="nn"><div class="n">${n}</div><div class="s">${s}</div></div>${o.confirm ? '' : '<span class="rv">Revoke</span>'}</div>${o.confirm ? `<div class="cm"><p>Revoke <b>${n}</b>? It will stop syncing and will need a new code to come back.</p><div class="bb"><span class="btn full">Cancel</span><span class="btn dng full">Revoke device</span></div></div>` : ''}</li>`
const settings2 = phone(`${backhead('Settings')}
  <section class="pcard"><h3>Add device</h3><p class="bad">This code has expired. Generate a new one.</p><button class="btn pri full">${ix('plus')}Generate a new code</button></section>
  <section class="devs"><h3 class="sh2">Devices <em>3</em></h3><ul>${devRow('Desk PC', 'Last seen today')}${devRow('Living room PC', 'Last seen yesterday', { confirm: 1 })}${devRow('Steam Deck', "Added Nov 20, hasn't synced yet")}</ul></section>`, { active: null })
const settings3 = phone(`${backhead('Settings')}
  <section class="devs"><h3 class="sh2">Devices <em>3</em></h3><ul>${devRow('Steam Deck', "Added Nov 20, hasn't synced yet")}</ul></section>
  <section class="pcard inv"><h3>Invite a person</h3><p>They get their own library, separate from yours. They also need to be allowed by the Cloudflare Access policy to sign in.</p>
    <div class="inp"><span class="ph">friend@example.com</span></div>
    <p class="okm">${ix('check')}<span><b>maya@example.com</b> can now sign in and get their own space.</span></p>
    <p class="bad">That person already has their own Afterplay space.</p>
    <button class="btn pri full dis">${ix('userplus')}Invite</button></section>`, { active: null })

/* ----- hojas ----- */
const gameBack = `${`<div class="mban gb">${bn('clair', false, false)}<div class="shade"></div><h1>Clair Obscur: Expedition 33</h1></div>`}<div class="mdet"><div class="meta">${chip('playing')}<span class="dust">RPG, Turn-based · PC · 2025</span></div><div class="btns"><button class="btn pri">${ixf('play')}Start a session</button><button class="btn">${ic('note')}Add note</button></div></div>`
const timerSheet = (err) => `<div class="dim"></div><div class="sheet"><div class="grab"></div><h3 class="sh">Start a session</h3>
  <div class="sg2">${cv('clair')}<div><div class="tt">Clair Obscur: Expedition 33</div><div class="ss">${chip('playing')} · 38h 10m played</div></div></div>
  <div class="note2">${ix('info')}<span>For consoles and anything Afterplay can't see running. Counts as a normal session.</span></div>
  ${err ? `<div class="err2">${ix('alert')}<span>Clair Obscur: Expedition 33 is being played on Desk PC. Stop it there first, or open its page to see the running session.</span></div>` : ''}
  <button class="btn pri full lg2">${err ? 'Try again' : `${ixf('play')}Start timer`}</button><button class="btn ghost full">Cancel</button></div>`
const sheet1 = phone(gameBack, { active: 'Library', mini: false, over: timerSheet(false) })
const sheet2 = phone(gameBack, { active: 'Library', mini: false, over: timerSheet(true) })
const addRes = [['dsouls', 'Dark Souls III', '2016'], ['darkest', 'Darkest Dungeon II', '2023', 'done'], ['dsrem', 'Dark Souls: Remastered', '2018', 'lib'], ['darkwood', 'Darkwood', '2017'], ['pent', 'Pentiment', '2022', 'plan']]
const addSheet = `<div class="full"><div class="sb"><div class="sf">${ic('search')}<span>dark</span><i class="caret2"></i></div><span class="cl">${ic('x')}</span></div>
  <div class="rs">${addRes.map(([k, n, y, st]) => `<div class="ar ${st === 'lib' || st === 'plan' ? 'ow' : ''}">${cv(k)}<div><div class="tt">${n}</div><div class="ss"><span>${y}</span>${st === 'lib' ? '<em>In your library</em>' : st === 'plan' ? '<em class="t">Already planned</em>' : ''}</div></div>${st === 'lib' || st === 'plan' ? `<span class="ab dim2">${ix('check')}</span>` : st === 'done' ? `<span class="ab ok">${ix('check')}</span>` : `<span class="ab">${ix('plus')}</span>`}</div>`).join('')}</div>
  <div class="fn">Games you add show up in your plan right away. Your PC fills in the times and store data the next time it syncs.</div></div>`
const sheet3 = phone('', { active: 'Plan', mini: false, bar: false, over: addSheet })
const planRow = (k, n, h, o = {}) => `<div class="pr2 ${o.drag ? 'drag' : ''} ${o.ghost ? 'ghost' : ''}"><span class="hd2">${ic('drag')}</span><span class="no">${n}</span>${cv(k)}<div class="mid"><div class="tt">${G[k].n}</div><div class="ss">${ix('clock')}${h}</div></div><div class="ud"><span class="ub">${ic('up')}</span><span class="ub">${ic('down')}</span></div></div>`
const planDrag = phone(`${mhead('Plan', '', '<span class="dn">Done</span>')}
  <div class="gh"><h3>Up next <em>drag to reorder</em></h3><span>5 games</span></div>
  <div class="dl">${planRow('meta', 1, '70h')}${planRow('well', 2, '6h')}<div class="pr2 ghost"></div>${planRow('lies', 4, '30h')}${planRow('octo', 5, '55h')}
  <div class="pr2 drag fl">${'<span class="hd2">' + ic('drag') + '</span>'}<span class="no">3</span>${cv('pent')}<div class="mid"><div class="tt">Pentiment</div><div class="ss">${ix('clock')}20h</div></div><div class="ud"><span class="ub">${ic('up')}</span><span class="ub">${ic('down')}</span></div></div></div>`, { active: 'Plan' })

/* ----- secciones de la ficha ----- */
const dtop = `<div class="dtop"><span class="bkb">${ix('cl')}</span><div class="tl">Clair Obscur: Expedition 33</div>${dot('playing')}</div>`
const detP = (body) => phone(body, { top: dtop, active: 'Library', pgc: 'dpg' })
const achItem = ([n, d, dt, r, ico, un, hid]) => `<div class="ai ${un ? '' : 'lk'}"><span class="ic">${ix(ico)}</span><div class="x"><div class="n">${hid ? 'Hidden achievement' : n}</div><div class="d">${hid ? 'Keep playing to find out.' : d}</div></div><div class="y">${r ? `<b>${r}</b>` : ''}<span>${dt}</span></div></div>`
const detAch = detP(`<h3 class="dh">Achievements</h3><div class="ahd"><b>38</b><small>/52</small><span class="pcx">73% unlocked</span></div><div class="seg52 sbar2">${Array.from({ length: 52 }, (_, i) => `<i class="${i < 38 ? 'f' : ''}"></i>`).join('')}</div>
  <div class="srcs"><span>Steam <b>38 of 52</b></span><span>RetroAchievements <em>not synced yet</em></span></div>
  ${ACH.slice(0, 6).map(achItem).join('')}<div class="more">Show all 52</div>`)
const detHltb = detP(`<h3 class="dh">How long to beat <span>HowLongToBeat</span></h3><p class="hs">Marker shows what you've played</p>
  <div class="tiers"><div><span>Main Story</span><b>30h</b></div><div><span>+ Extra</span><b>45h</b></div><div><span>100%</span><b>62h</b></div></div>
  <div class="seg62">${segs(62, 38)}</div><div class="mk"><span style="left:48.4%"><b>30h</b>Main</span><span style="left:72.6%"><b>45h</b>+Extra</span><span class="r"><b>62h</b>100%</span></div>
  <div class="past">${ix('check')}<span><b>38h 10m</b> in 14 sessions, already past the Main estimate of 30h.</span></div>
  <div class="nm2"><div class="h">How long to beat</div><div class="s">No confident match yet</div></div>`)
const detHist = detP(`<h3 class="dh">Session history <em>14</em></h3>${[['Sat, Nov 21', '21:00 to 23:10', '2h 10m'], ['Sat, Nov 21', '10:30 to 12:20', '1h 50m'], ['Fri, Nov 20', '20:00 to 22:10', '2h 10m'], ['Wed, Nov 18', '21:00 to 23:30', '2h 30m']].map((s) => `<div class="sr"><div><div class="n">${s[0]}</div><div class="d">${s[1]}</div></div><b>${s[2]}</b></div>`).join('')}<div class="more">Show all 14</div>
  <h3 class="dh">History <em>5</em></h3><div class="tlm">${HIST.filter((e) => e[1]).slice(0, 4).map((e) => { const c = e[1] === 'spend' ? 'var(--phos)' : ST[e[1]] || 'var(--tube)'; return `<div class="te"><i style="--c:${c}"></i><div><div class="n" style="color:${e[1] === 'spend' ? 'var(--bone)' : c}">${e[0]}</div><div class="d">${e[3]}</div></div><span class="dt">${e[2]}</span></div>` }).join('')}</div>`)
const detPlay = detP(`<h3 class="dh">Playthrough</h3><div class="ptp"><div class="st"><span class="live"><i class="pulse" style="width:8px;height:8px"></i>Ongoing</span><span class="ds">#1 · started Oct 3, 2026 · still going</span></div>
  <div class="pt4"><div class="k"><b>38<small>h</small>10<small>m</small></b><span>Played</span></div><div><b>14</b><span>Sessions</span></div><div><b>€49.99</b><span>Spent</span></div><div><b>Digital</b><span>Format</span></div></div>
  <div class="seg62 s3">${segs(62, 38)}</div><div class="mk m3"><span style="left:48.4%"><b>30h</b>Main</span><span class="r"><b>62h</b>100%</span></div>
  <div class="acts2"><button class="btn pri">${ix('check')}Mark as beaten</button><button class="btn">${ix('edit')}Edit</button></div></div>
  <div class="ptn"><span>${ix('info')}</span><span>Finished or dropped playthroughs stay in the list, so a second run starts a new #2 with its own hours and spend.</span></div>`)

/* ----- estados ----- */
const skel = Array.from({ length: 7 }, () => '<div class="sk"><i class="c"></i><div><i class="l1"></i><i class="l2"></i></div><i class="r"></i></div>').join('')
const stLoading = phone(`${mhead('Library', '')}<div class="msearch">${ic('search')}Search your library</div><div class="loadl">${ix('spinner', 'spin')}<span>Reading your library</span></div><div class="sks">${skel}</div>`, { active: 'Library', mini: false })
const stateBox = (icon, title, hint, btn) => `<div class="sbox"><span class="si">${ix(icon)}</span><h3>${title}</h3><p>${hint}</p>${btn || ''}</div>`
const stNet = phone(`${mhead('Sessions', '')}${stateBox('cloudoff', "Can't reach your library", 'Check your connection and try again.', '<button class="btn">Try again</button>')}`, { active: 'Sessions', mini: false })
const stExp = phone(`${mhead('Plan', '')}${stateBox('lock', 'Session expired', 'Your Access session expired. Sign in again to keep using Afterplay.', '<button class="btn pri">Sign in again</button><div class="sm2">Your timer and changes already saved are safe.</div>')}`, { active: 'Plan', mini: false })
const stOff = phone(`<div class="offb">${ix('wifioff')}<span>You're offline</span></div>${mhead('Library', '331 games')}${stateBox('wifioff', 'No connection', 'Afterplay on the web needs a connection to read and write your library. It reloads by itself when you are back.', '<button class="btn">Try again</button>')}`, { active: 'Library', mini: false, over: '' })
// el offline lleva ademas el mini-reproductor con el fallo de "parar"
const stOff2 = stOff.replace('<nav class="tbar">', `<div class="stoperr"><div class="mini2">${cv('silk')}<div><div class="nm">Hollow Knight: Silksong</div><div class="sub"><i class="pulse" style="width:7px;height:7px"></i>Desk PC</div></div><span class="tm">1:12:04</span><span class="stop">${ixf('stop')}</span></div><div class="er">${ix('alert')}<span>Couldn't stop the timer, it's still counting here. Try again.</span><span class="xx">${ix('x')}</span></div></div><nav class="tbar">`)

/* ---------- salida ---------- */
const out = {
  'tvpwa-tv-library': stack('Afterplay TV - Library', [[['Library', ' · filters, grid, search chip (focus on a cover)'], libFrame(false)], [['Library', ' · on-screen keyboard open with the search "hollow"'], libFrame(true)]]),
  'tvpwa-tv-detail': stack('Afterplay TV - Game', [[['Game overview', ' · playing on another PC'], detailFrame({ tab: 'overview', remote: 'live', body: overviewBody(), side: true })], [['Game overview', ' · the other PC stopped answering (no signal)'], detailFrame({ tab: 'overview', remote: 'nosig', body: overviewBody(), side: true })]]),
  'tvpwa-tv-sections-1': stack('Afterplay TV - Sessions and history', [[['Game · Sessions'], detailFrame({ tab: 'sessions', remote: 'live', body: sessionsBody() })], [['Game · History'], detailFrame({ tab: 'history', remote: 'live', body: historyBody() })]]),
  'tvpwa-tv-sections-2': stack('Afterplay TV - Achievements and saves', [[['Game · Achievements'], detailFrame({ tab: 'achievements', remote: 'live', body: achBody() })], [['Game · Saves'], detailFrame({ tab: 'saves', remote: 'live', body: savesBody() })]]),
  'tvpwa-tv-notes-journey': stack('Afterplay TV - Notes and Journey', [[['Game · Notes'], detailFrame({ tab: 'notes', remote: 'live', body: notesBody() })], [['Journey · a month page'], journeyFrame()]]),
  'tvpwa-tv-menus': stack('Afterplay TV - Start menu and session end', [[['Start menu', ' · over Home'], menuFrame()], [['Session ended panel', ' · over Home'], endedFrame()]]),
  'tvpwa-pwa-sessions-settings': board([['Sessions', sessionsP], ['Settings · Add device (code and QR)', settings1], ['Settings · expired code, Devices, revoke', settings2], ['Settings · Invite a person', settings3]]),
  'tvpwa-pwa-sheets': board([['Start a session', sheet1], ['Start a session · conflict', sheet2], ['Add game', sheet3], ['Plan · dragging', planDrag]]),
  'tvpwa-pwa-detail': board([['Game · Achievements', detAch], ['Game · How long to beat', detHltb], ['Game · History', detHist], ['Game · Playthrough', detPlay]]),
  'tvpwa-pwa-states': board([['Loading', stLoading], ['Network error', stNet], ['Access session expired', stExp], ['Offline', stOff2]])
}
for (const [k, v] of Object.entries(out)) writeFileSync(join(dir, `${k}.html`), v)
console.log('HTML generado:', Object.keys(out).join(', '))
