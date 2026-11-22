// Fosforo: estados globales, ajustes, migracion, overlay y ambiente. Uso: node build-estados.mjs
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { G, ST, cv, bn, dot, chip, ic, icf, doc, vars, TABS, logoSvg } from './build.mjs'
const dir = dirname(fileURLToPath(import.meta.url))

/* ---------- juegos extra (solo en este fichero) ---------- */
G.sm = { n: 'Super Metroid', s: 'Super<br>Metroid', a: '#7A1E8C', b: '#12071A', c: '#9BF0A2', k: 4, ts: '21cqw' }
G.mdread = { n: 'Metroid Dread', s: 'Metroid<br>Dread', a: '#C23A1E', b: '#1A0A07', c: '#FFD36B', k: 2, ts: '21cqw' }
G.ct = { n: 'Chrono Trigger', s: 'Chrono<br>Trigger', a: '#2F6BC4', b: '#0B1530', c: '#F7D26A', k: 1, ts: '20cqw' }
G.la = { n: "Link's Awakening", s: 'Link’s<br>Awakening', a: '#3E9B5C', b: '#0F2E22', c: '#F6E7A0', k: 5, ts: '17cqw' }

/* ---------- iconos extra ---------- */
const P2 = {
  gamepad: '<path d="M7 8h10a4 4 0 0 1 4 4.5l-.7 3.2a2.2 2.2 0 0 1-3.8.9L15 15H9l-1.5 1.6a2.2 2.2 0 0 1-3.8-.9L3 12.5A4 4 0 0 1 7 8z"/><path d="M8 10.5v3M6.5 12h3M16 11.5h.01M18 13h.01"/>',
  cloud: '<path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 10.5a3.8 3.8 0 0 1-.5 7.5z"/>',
  key: '<circle cx="8" cy="15" r="3.5"/><path d="m10.5 12.5 8-8M15 8l2.5 2.5M17.5 5.5l2 2"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4.5v1.5A3 3 0 0 0 8 10.5M16 6h3.5v1.5A3 3 0 0 1 16 10.5M12 13v4M8.5 20h7M10 17h4"/>',
  save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  archive: '<rect x="3.5" y="4" width="17" height="4.5" rx="1"/><path d="M5 8.5V20h14V8.5M10 12.5h4"/>',
  warn: '<path d="M12 4 3 19.5h18z"/><path d="M12 10v4.5M12 17.2h.01"/>',
  wifioff: '<path d="M4 9.5a12 12 0 0 1 4-2.4M20 9.5a12 12 0 0 0-5.5-3M7 13a7 7 0 0 1 3-1.6M17 13a7 7 0 0 0-2-1.4M10 16.5a3.5 3.5 0 0 1 4 0M12 20h.01M4 4l16 16"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  folder: '<path d="M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4l2 2.5H19a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4.5 3.5"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
  trash: '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 12.5h8L17 7M10.5 11v5M13.5 11v5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="1.5"/><path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  joystick: '<circle cx="12" cy="7" r="3"/><path d="M12 10v4M6 20h12v-2.5a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2z"/>',
  flame: '<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 1.5.7 2.2 1.5 2.5C10 8.5 10.5 5.5 12 3z"/>',
  book: '<path d="M12 6.5C10.5 5 8 4.5 4.5 4.5v13c3.5 0 6 .5 7.5 2 1.5-1.5 4-2 7.5-2v-13C16 4.5 13.5 5 12 6.5zM12 6.5v13"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9" rx="1.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  external: '<path d="M13 5h6v6M19 5l-8 8M18 14v4.5a1 1 0 0 1-1 1H6.5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1H11"/>',
  power: '<path d="M12 4v8M7 7a7 7 0 1 0 10 0"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14-4M4 5v3h3M4 13a8 8 0 0 0 14 4M20 19v-3h-3"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5h4"/>'
}
const I = (k, c = '') => (P2[k] ? `<svg class="i ${c}" viewBox="0 0 24 24">${P2[k]}</svg>` : ic(k, c))
const IF = (k) => I(k, 'f')
const sz = (svg, n) => svg.replace('class="i', `style="width:${n}px;height:${n}px" class="i`)

const CSSLINK = '<link rel="stylesheet" href="estados.css">'
const page = (title, body) => doc(title, CSSLINK + body)

/* ---------- shell propio: sync de 4 estados, badge, sin barra opcional ---------- */
const SYNC = {
  ok: ['ok', 'Synced', ''],
  pend: ['pend', 'Pending', '3'],
  off: ['off', 'Offline', ''],
  err: ['err', 'Sync error', '']
}
const syncPill = (st = 'ok', open = false) => {
  const [cls, label, n] = SYNC[st]
  const text = st === 'pend' ? `${label} <b>${n}</b>` : label
  return `<div class="sy ${cls} ${open ? 'open' : ''}" tabindex="0"><i></i>${text}</div>`
}
const topbar = (active, st = 'ok', o = {}) => `<header class="top"><div class="logo">${logoSvg}Afterplay</div><nav class="tabs">${TABS.map((t) => `<a class="tab ${t === active ? 'on' : ''}">${t}${t === 'Sessions' && o.badge ? `<b class="bdg">${o.badge}</b>` : ''}</a>`).join('')}</nav><div class="search">${ic('search')}<span>Search your library</span><kbd>Ctrl K</kbd></div>${syncPill(st, o.open)}<div class="gear ${o.gearOn ? 'on' : ''}">${ic('gear')}</div></header>`
const appShell = ({ active = '', inner, np = '', rows = 72, sync = 'ok', badge, gearOn, extra = '', dim = false }) =>
  `<div class="app" style="grid-template-rows:56px 1fr${np ? ` ${rows}px` : ''}">${topbar(active, sync, { badge, gearOn })}<main class="main ${dim ? 'dimapp' : ''}">${inner}</main>${np}${extra}</div>`

/* ---------- barra Now playing: variantes ---------- */
const npLocal = `<footer class="np">${cv('silk')}<div><div class="nm">Hollow Knight: Silksong</div><div class="sub"><i class="pulse"></i>Playing on Desk PC · since 19:40</div></div><div class="timer">1:12:04</div><button class="btn live">${icf('stop')}Stop</button><div class="sp"></div><button class="btn">${ic('note')}Add note</button></footer>`
const npRemote = `<footer class="np remote">${cv('clair')}<div><div class="nm">Clair Obscur: Expedition 33</div><div class="sub"><i class="ring"></i><span class="dv">${ic('pc')}on Living room PC</span> · since 20:11</div></div><div class="timer">0:41:10</div><span class="hint">${ic('lock')}Only Living room PC can stop this session</span><div class="sp"></div><button class="btn">${ic('note')}Add note</button></footer>`
const npStrip = `<footer class="np strip remote">${cv('clair')}<div class="st2"><i class="ring"></i><span>Also playing</span></div><div class="nm">Clair Obscur: Expedition 33</div><div class="st2">${ic('pc')}on Living room PC</div><div class="tm2">0:41:10</div><div class="sp"></div><button class="btn ghost">Open game</button></footer>`
const npTwo = `<div class="npw np2">${npLocal}${npStrip}</div>`
const npQuiet = `<footer class="np quiet remote">${cv('balatro')}<div><div class="nm">Balatro</div><div class="sub"><i class="ring"></i><span class="dv">${ic('pc')}on Living room PC</span> · <span class="nosig">${I('warn')}no signal for 4 min</span></div></div><div class="timer">0:52:31</div><span class="hint">Last heard at 20:48. It closes by itself if the signal does not come back.</span><div class="sp"></div><button class="btn">${ic('note')}Add note</button></footer>`
const npPend = `<footer class="np pend"><div class="jt">${I('joystick')}</div><div><div class="nm">RetroArch</div><div class="sub"><i class="pulse" style="background:var(--phos);box-shadow:0 0 0 3px rgba(255,179,71,.2),0 0 10px var(--phos)"></i>Emulator session · not assigned to a game yet · since 20:31</div></div><div class="timer">0:21:14</div><button class="btn pri">${I('link')}Assign</button><div class="sp"></div></footer>`

function nowplaying() {
  const row = (tag, title, desc, bar) => `<div class="nprow"><div class="lbl"><span class="tag">${tag}</span><h3>${title}</h3><p>${desc}</p></div><div class="npf">${bar}</div></div>`
  const tiles = ['hades2', 'outer', 'celeste', 'disco', 'hollow', 'hades', 'tunic', 'obra', 'sea', 'cocoon', 'balatro', 'clair', 'split', 'silk'].map((k) => cv(k)).join('')
  const none = `<div class="npnone"><div class="tiles">${tiles}</div><div class="edge"></div><div class="mk"><span>The 72 px go back to the page</span></div></div>`
  return page('Afterplay - Now playing states', `<div class="board2"><div class="bh"><h1>Now playing</h1><span>Docked bar, 72 px, visible on every screen. One row per state.</span></div>
  ${row('Session on this PC', 'Playing here', 'Red pulse, phosphor timer, Stop and Add note. The only state that can end the session. Cover and title open the game.', npLocal)}
  ${row('Session on another PC', 'Playing elsewhere', 'Hollow cyan ring and "on Living room PC" instead of the red pulse. No Stop, and the reason is written next to the timer.', npRemote)}
  ${row('Two sessions', 'Local first', 'This PC keeps the full bar. The other session drops to a 40 px strip underneath; from three on, the strip says "+1 more".', npTwo)}
  ${row('No signal for 4 min', 'Switched off', 'Past 3 minutes of silence everything goes grey: no glow, no pulse. The timer keeps counting and the text says when it was last heard.', npQuiet)}
  ${row('Emulator, unassigned', 'Pending', 'Amber tint and Assign in place of Stop. Opens the assignment modal; the time is already running.', npPend)}
  ${row('No session', 'The bar disappears', 'No idle bar, no "last played". The last game already leads Home and the Library order, and 72 px on every screen is too much for repeated information.', none)}
  </div>`)
}

/* ---------- Sync en la barra superior ---------- */
function syncStates() {
  const drops = {
    ok: `<div class="hd"><div class="st"><i style="background:var(--tube);box-shadow:0 0 12px var(--tube)"></i>Up to date</div><div class="in">Last synced 2 minutes ago. Nothing waits to be sent.</div></div><div class="kv"><span>Pending changes</span><span class="k">0</span><span>Devices</span><span>3 · Desk PC (this PC), Living room PC, Phone</span><span>Sync service</span><span>Reachable</span></div><div class="ft"><button class="btn pri">${ic('sync')}Sync now</button><a class="lnk">Open sync settings</a></div>`,
    pend: `<div class="hd"><div class="st"><i style="background:var(--phos);box-shadow:0 0 12px var(--phos)"></i>3 changes to send</div><div class="in">They go out by themselves in a few seconds.</div></div><div class="chg"><div><i></i>Session · Hollow Knight: Silksong<span>1h 12m</span></div><div><i></i>Note · Hollow Knight: Silksong<span>20:50</span></div><div><i></i>Save copy · Clair Obscur<span>Yesterday</span></div></div><div class="ft"><button class="btn pri">${ic('sync')}Sync now</button><a class="lnk">Open sync settings</a></div>`,
    off: `<div class="hd"><div class="st"><i style="border:2px solid var(--dust)"></i>Offline</div><div class="in">Afterplay cannot reach your sync service. Everything keeps working; changes wait on this PC and go out when the connection is back.</div></div><div class="kv"><span>Last synced</span><span>Today, 18:02 (2 h 50 m ago)</span><span>Pending changes</span><span class="k">3</span><span>Last attempt</span><span>20:51, no connection</span></div><div class="ft"><button class="btn">${ic('sync')}Try again</button><a class="lnk">Open sync settings</a></div>`,
    err: `<div class="hd"><div class="st"><i style="background:var(--live);box-shadow:0 0 12px var(--live)"></i>Sync stopped</div><div class="in">The sync service refused this PC's sign-in. Your data is safe on this PC.</div></div><div class="cause">Last error, 20:47<code>401 · device token revoked</code></div><div class="kv"><span>Last good sync</span><span>Today, 18:02 · 3 changes waiting</span></div><div class="ft"><button class="btn pri">${ic('sync')}Sync now</button><button class="btn">${I('copy')}Copy details</button><a class="lnk">Settings</a></div>`
  }
  const names = { ok: ['Up to date', 'Everything sent, nothing waiting.'], pend: ['Pending 3 changes', 'Changes on this PC that have not left yet. Count in Big Shoulders.'], off: ['Offline', 'Hollow dot, no colour: nothing is wrong with the app.'], err: ['Error', 'The only state in red, plus the cause in the panel.'] }
  const heights = { ok: 266, pend: 266, off: 290, err: 290 }
  const cell = (st) => `<div class="qc2"><div class="lbl" style="display:flex;gap:12px;align-items:baseline"><h3>${names[st][0]}</h3><span class="dust" style="font-size:13.5px">${names[st][1]}</span></div><div class="mw" style="height:${heights[st] + 70}px;margin-top:8px"><header class="top" style="border-bottom:1px solid var(--line)"><div class="logo">${logoSvg}Afterplay</div><div class="search" style="width:220px;margin-left:auto">${ic('search')}<span>Search</span><kbd>Ctrl K</kbd></div>${syncPill(st, true)}<div class="gear">${ic('gear')}</div></header><div class="sd" style="top:60px;right:34px">${drops[st]}</div></div></div>`
  const notes = `<div class="nts" style="margin-top:16px"><div class="panel nt3">${I('download', '')}<div><b>Update Afterplay to sync again</b><span>This PC is older than the sync service expects. Error state, with Check for updates.</span></div></div><div class="panel nt3">${ic('clock')}<div><b>This PC's clock is 14 minutes ahead</b><span>Fix the time and sync again. Error state, with Open date settings.</span></div></div><div class="panel nt3">${ic('pc')}<div><b>Another PC has this identity</b><span>Shown here and on Saves, with the guided recovery.</span></div></div></div>`
  return page('Afterplay - Sync indicator', `<div class="board2"><div class="bh"><h1>Sync indicator</h1><span>Top bar, left of the gear. Click opens the panel; "Open sync settings" goes to Settings, Sync. The tray tooltip uses the same four states.</span></div><div class="quad" style="gap:12px 28px">${['ok', 'pend', 'off', 'err'].map(cell).join('')}</div>${notes}</div>`)
}

/* ---------- Avisos ---------- */
function libraryBackdrop() {
  const LIBX = [['silk', 'playing', '23h 15m'], ['split', 'playing', '4h 45m'], ['clair', 'playing', '38h 10m'], ['hades2', 'playing', '22h 05m'], ['balatro', 'playing', '61h 30m'], ['outer', 'beaten', '24h 10m'], ['celeste', 'beaten', '9h 40m'], ['disco', 'beaten', '31h 05m'], ['hollow', 'beaten', '52h 20m'], ['hades', 'beaten', '47h 20m'], ['tunic', 'beaten', '14h 00m'], ['obra', 'beaten', '11h 30m'], ['sea', 'backlog', '3h 00m'], ['cocoon', 'beaten', '6h 10m'], ['pent', 'backlog', 'Not played'], ['inscr', 'resting', '8h 00m']]
  const sts = [['All games', 331, null, true], ['Playing', 5, 'playing'], ['Beaten', 142, 'beaten'], ['Backlog', 96, 'backlog'], ['Resting', 61, 'resting'], ['Dropped', 27, 'dropped']]
  const fl = sts.map(([l, n, s, on]) => `<div class="fl ${on ? 'on' : ''}">${s ? dot(s) : ic('grid')}<span>${l}</span><span class="n">${n}</span></div>`).join('')
  return `<div class="lib"><aside class="flt"><div><h4>Status</h4>${fl}</div></aside><section class="libm"><div class="libh"><span class="big">331</span><span>games</span><div class="ctl"><button class="btn pri">${ic('plus')}Add game</button></div></div><div class="grid8">${LIBX.map(([k, s, h]) => `<div>${cv(k, { st: s, h })}<div class="cap">${G[k].n}</div></div>`).join('')}</div></section></div>`
}
const closedToast = (mode = 'default') => {
  const g = G.silk
  const note = mode === 'note'
  return `<div class="toast"><div class="hbg" style="${vars(g)};background:linear-gradient(160deg,var(--a),var(--b))"></div><div class="tb2">
    <div class="top2">${cv('silk')}<div><div class="se">${ic('clock')}Session ended</div><div class="gn">Hollow Knight: Silksong</div><div class="du"><b>1<small>h</small>12<small>m</small></b><span>· 24h 27m total</span></div></div></div>
    <div class="band am">${I('flame')}Your longest session with this game</div>
    <div class="band tu">${I('trophy')}2 achievements<span class="ach"><i style="--a:#4F9D5B;--b:#12261A"></i><i style="--a:#7C40B8;--b:#17102a"></i></span></div>
    ${note ? `<div class="noteinp"><div class="f">Past the Bellhart gate, need the silk spool<span class="caret"></span></div><button class="btn pri ic">${I('check')}</button></div>` : `<div class="acts2"><button class="btn">${ic('note')}Add note</button><button class="btn pri">Open game</button><button class="btn ghost ic x" aria-label="Dismiss">${ic('x')}</button></div>`}
    <div class="qs"><span>How did it end?</span><span class="qc">${dot('beaten')}Beaten</span><span class="qc">${dot('resting')}Resting</span><span class="qc">${dot('dropped')}Dropped</span></div>
  </div><div class="cd"><i style="width:${note ? 100 : 68}%"></i></div></div>`
}
const markedToast = `<div class="toast"><div class="hbg" style="${vars(G.clair)};background:linear-gradient(160deg,var(--a),var(--b))"></div><div class="tb2"><div class="top2">${cv('clair')}<div><div class="se">${ic('clock')}Session ended</div><div class="gn">Clair Obscur: Expedition 33</div><div class="du"><b>2<small>h</small>10<small>m</small></b><span>· 40h 20m total</span></div></div></div><div class="band ok">${I('check')}Marked as Beaten</div></div></div>`
const storyToast = `<div class="toast row st"><div class="tl">${I('book')}</div><div style="flex:1"><b>Your November story is ready</b><span class="s">62h 40m played · 31 sessions · 6 games. Read it in your Journey.</span></div>${I('right')}</div>`
const errToast = `<div class="toast row er"><div class="tl">${I('warn')}</div><div style="flex:1"><b>Could not save the note.</b><span class="s">Your text is still in the box. Try again.</span></div><button class="btn">Try again</button></div>`

function avisos() {
  const stack = `<div class="tstack">${errToast}${storyToast}${closedToast('default')}</div>`
  const col2 = `<div class="tcol2">${closedToast('note')}${markedToast}</div>`
  const anno = `<div style="position:absolute;left:0;top:56px;bottom:0;width:640px;background:rgba(11,14,15,.93);border-right:1px solid var(--line2);z-index:25"></div>
  <div class="anno" style="width:520px;left:56px;top:96px"><b><span class="n">1</span>Session ended</b><span>Appears when a session closes, on any screen, bottom right. Stays 15 s and the bar underneath pauses on hover or while the note has focus. It never takes focus by itself. Add note opens the field in place (centre column); Open game dismisses it.</span></div>
  <div class="anno" style="width:520px;left:56px;top:300px"><b><span class="n">2</span>Quick status</b><span>"How did it end?" is an offer, not a question. After the tap the chips become a confirmation line in the status colour; the toast keeps its countdown.</span></div>
  <div class="anno" style="width:520px;left:56px;top:455px"><b><span class="n">3</span>Story ready</b><span>Automatic recaps only. One tap goes to the Journey on that month. Two periods in a row stack, they do not replace each other. 12 s.</span></div>
  <div class="anno" style="width:520px;left:56px;top:600px"><b><span class="n">4</span>Error</b><span>Red edge and an action that fixes it. 8 s, or until dismissed if it has a button. Stack order: newest at the bottom, at most three visible.</span></div>`
  const inner = libraryBackdrop()
  return page('Afterplay - Toasts', appShell({ active: 'Library', inner, dim: true, extra: `${anno}${col2}${stack}` }))
}

/* ---------- Pendientes ---------- */
const sessionsBackdrop = () => {
  const rows = ['Mon 16', 'Tue 17', 'Wed 18', 'Thu 19', 'Fri 20', 'Sat 21', 'Sun 22'].map((d, i) => `<div class="rrow"><span class="d ${i === 6 ? 't' : ''}">${i === 6 ? 'Today' : d}</span><div class="trk">${[[0, 93], [2, 150], [4, 175], [5, 325], [6, 117]].filter(([x]) => x === i).map(([, m]) => `<i class="blk" style="--g:#D3A94F;left:${(i * 7 + 40) % 50}%;width:${m / 14.4}%"></i>`).join('')}</div><span class="tt">${m3(i)}</span></div>`).join('')
  return `<section class="ribbon panel fade"><div class="rhead"><span class="lg" style="--g:#D3A94F"><i></i>Clair Obscur</span><span class="tot"><b>14h 20m</b>in 9 sessions</span></div>${rows}</section>`
}
const m3 = (i) => ['1h 33m', 'No play', '2h 30m', 'No play', '2h 55m', '5h 25m', '1h 57m'][i]
const trayRows = [
  ['RetroArch', 'Desk PC', `<span class="livetag"><i class="pulse"></i>LIVE</span> Today, 20:31<small>Running for 0:21:14</small>`, true],
  ['Dolphin', 'Living room PC', `Sat 21, 14:02 to 15:07<small>1h 05m</small>`, false],
  ['RetroArch', 'Desk PC', `Fri 20, 23:10 to 23:48<small>38m</small>`, false]
]
const trayHtml = () => `<section class="panel tray"><div class="th"><h2>Pending sessions</h2><span class="ct2">3</span><p>Emulator time that does not belong to a game yet. It counts in your totals only after you assign it.</p></div>${trayRows.map(([n, d, w, live]) => `<div class="prow"><div class="jt">${I('joystick')}</div><div><div class="em">${n}</div><div class="dvc">${ic('pc')}${d}</div></div><div class="wh">${w}</div><div class="acts3"><button class="btn pri">${I('link')}Assign</button></div><div>${live ? '' : `<button class="btn ghost ic" aria-label="Discard">${I('trash')}</button>`}</div></div>`).join('')}</section>`
const sessionsPendingScreen = (extra = '', dim = false) => appShell({ active: 'Sessions', badge: 3, np: npPend, inner: `<div class="ses2"><div class="pgh"><h1>Sessions</h1><span class="dust">Week of November 16</span><div class="wk" style="margin-left:auto;display:flex;gap:8px"><button class="btn pri">${ic('plus')}Add session</button></div></div>${trayHtml()}${sessionsBackdrop()}</div>`, extra, dim })

function pendientes() {
  const a = (l, d) => `<div class="anno" style="left:${l}px;top:770px;width:470px"><b>${d[0]}</b><span>${d[1]}</span></div>`
  return page('Afterplay - Pending sessions', sessionsPendingScreen(`${a(28, ['Badge on the Sessions tab', 'Amber count of unassigned sessions, also for emulator time from other PCs (with their device name). It disappears at zero and the tray goes with it. No pulse: pending, not live.'])}${a(540, ['The tray', 'Always above the week ribbon. Assign opens the modal. Discard (trash) only exists once the session has ended, and asks for confirmation like any other session.'])}${a(1050, ['Now playing, pending', 'A live emulator session also shows in the bar with the same Assign. If assigning is not possible yet, the amber tint stays.'])}`))
}

function asignar() {
  const res = (k, y, g, p, hi) => `<div class="ares ${hi ? 'hi' : ''}">${cv(k)}<div><b>${G[k].n}<small>${y}</small></b><div class="gs">${g.map((x) => `<span>${x}</span>`).join('')}</div><div class="pl">${p}</div></div>${I('right', 'ar')}</div>`
  const m1 = `<div class="modal" style="left:150px;top:150px;width:640px"><div class="mh2"><div class="ti">${I('link')}</div><div><h3>Assign session</h3><p>RetroArch · Sat 21, 14:02 · 1h 05m · on Desk PC</p></div><button class="btn ghost ic x">${ic('x')}</button></div><div class="mb"><div class="msr">${ic('search')}<span>met<i class="caret"></i></span></div><div class="mcount"><span>2 games</span><span>↑ ↓ to browse · Enter to pick</span></div>${res('sm', '1994', ['Action', 'Platformer'], '12h 40m played · 4 sessions', true)}${res('mdread', '2021', ['Action', 'Adventure'], '9h 05m played · 3 sessions', false)}<div class="addn"><span class="bx2">${ic('plus')}</span>Add new game…</div></div></div>`
  const m2 = `<div class="modal" style="left:826px;top:150px;width:520px"><div class="mh2"><div class="ti">${I('link')}</div><div><h3>Assign session</h3><p>Dolphin · Sat 21, 15:07 · 38m · on Living room PC</p></div><button class="btn ghost ic x">${ic('x')}</button></div><div class="mb"><div class="emptyb"><div class="ico">${I('link')}</div><p class="t">No emulated games in your library yet.</p><p>Add the game you were playing. It will be marked as emulated and this session assigned to it.</p><button class="btn pri" style="margin-top:6px">${ic('plus')}Add new game</button></div></div></div>`
  const cap = (l, t, w, txt) => `<div class="anno" style="z-index:45;left:${l}px;top:${t}px;width:${w}px;text-align:left"><span>${txt}</span></div>`
  const extra = `<div class="modalback"></div>${m1}${m2}${cap(150, 86, 640, 'Typing filters. The first result is already highlighted; arrows move, Enter assigns, Esc closes (blocked while the assignment is in flight).')}${cap(826, 86, 520, 'Library without any emulated game: straight to creating one.')}<div class="anno" style="z-index:45;left:150px;top:740px;width:640px"><div class="notice lv2">${I('warn')}<span style="color:var(--bone)">Could not assign the session: the sync service did not answer. Nothing was changed. (Error band, appears under the list.)</span></div></div>`
  return page('Afterplay - Assign session', sessionsPendingScreen(extra, false))
}

/* ---------- Vacios ---------- */
function vacioBiblioteca() {
  const sts = [['All games', 0, null, true], ['Playing', 0, 'playing'], ['Beaten', 0, 'beaten'], ['Backlog', 0, 'backlog'], ['Resting', 0, 'resting'], ['Dropped', 0, 'dropped']]
  const fl = sts.map(([l, n, s, on]) => `<div class="fl ${on ? 'on' : ''}" style="${on ? '' : 'opacity:.55'}">${s ? dot(s) : ic('grid')}<span>${l}</span><span class="n">${n}</span></div>`).join('')
  const gh = Array.from({ length: 24 }, (_, i) => `<div class="gc ${i === 0 ? 'p' : ''}">${i === 0 ? ic('plus') : ''}</div>`).join('')
  const inner = `<div class="lib"><aside class="flt"><div><h4>Status</h4>${fl}</div><div><h4>This PC</h4><div class="fl" style="opacity:.55">${ic('pc')}<span>Installed on this PC</span><i class="tg"></i></div></div></aside><section class="libm" style="position:relative"><div class="libh"><span class="zero">0</span><span>games</span><div class="ctl"><button class="btn pri">${ic('plus')}Add game</button></div></div><div class="ghosts" style="-webkit-mask-image:linear-gradient(180deg,#000 0%,transparent 24%);mask-image:linear-gradient(180deg,#000 0%,transparent 24%)">${gh}</div>
    <div class="welc" style="left:50%;width:960px;top:200px"><h2>Your library starts here</h2><p>Afterplay keeps your games, sessions and notes in one place, and times your play on its own. Three steps fill it.</p>
    <div class="steps3"><div class="panel stp on"><span class="no">1</span><h3>Add your API keys</h3><p>To search games and fetch artwork, Afterplay needs your own IGDB and SteamGridDB keys. Everything else already works.</p><button class="btn pri">${I('key')}Open Integrations</button></div><div class="panel stp"><span class="no">2</span><h3>Point at your game folders</h3><p>Afterplay scans them to find each game's folder and executable, so you do not browse for them by hand.</p><button class="btn">${I('folder')}Add a folder</button></div><div class="panel stp"><span class="no">3</span><h3>Add your first game</h3><p>Search by name, or pick one the scan already found. Time played starts counting the next time you launch it.</p><button class="btn">${ic('plus')}Add game</button></div></div>
    <div class="join">Already use Afterplay on another PC?<a>Join with a code</a></div></div></section></div>`
  return page('Afterplay - Empty library', appShell({ active: 'Library', inner }))
}

function vacios() {
  const win = (label, desc, body, extra = '') => `<div class="qc2"><div class="lbl"><h3>${label}</h3><p>${desc}</p></div><div class="mw" style="margin-top:10px;height:372px"><div class="mtop"><i></i><i></i><i></i><span>${extra}</span></div>${body}</div></div>`
  const plan = `<div class="ce"><div class="no" style="font:700 84px/.8 var(--bs);color:var(--dust)">0</div><h3>Nothing queued yet</h3><p>Games you want to play next line up here in order, with their HowLongToBeat estimate. Start with one from your backlog.</p><div class="row"><button class="btn pri">${ic('plus')}Add to queue</button><button class="btn">From backlog <span class="dust">96</span></button></div><div style="display:flex;gap:10px;margin-top:10px">${['sea', 'well', 'lies', 'pent'].map((k) => `<div style="width:46px">${cv(k)}</div>`).join('')}<div style="width:46px;aspect-ratio:3/4;border:1.5px dashed var(--line2);border-radius:4px;display:grid;place-items:center;color:var(--dust)">${ic('plus')}</div></div></div>`
  const search = `<div class="pal"><div class="msr">${ic('search')}<span>Hollow Knigth<i class="caret"></i></span><kbd style="margin-left:auto">Esc</kbd></div><div class="rs"><p><b class="k">No games match "Hollow Knigth".</b></p><p class="dust" style="font-size:13.5px">Check the spelling, or look it up online to add it to your library.</p><div class="flt2">Active filters<span class="chip" style="display:inline-flex;gap:6px;align-items:center">${dot('playing')}Playing ${ic('x').replace('class="i "', 'class="i " style="width:13px;height:13px"')}</span><span class="chip" style="display:inline-flex;gap:6px;align-items:center">PC ${ic('x').replace('class="i "', 'class="i " style="width:13px;height:13px"')}</span><a class="lnk" style="margin-left:auto">Clear filters</a></div><div style="display:flex;gap:10px;margin-top:4px"><button class="btn">${ic('search')}Search IGDB for "Hollow Knigth"</button></div></div></div><div style="position:absolute;inset:40px 0 0;background:rgba(7,9,10,.45)"></div>`
  const search2 = search.replace('<div style="position:absolute;inset:40px 0 0;background:rgba(7,9,10,.45)"></div>', '')
  const err = `<div class="ce"><div class="big404">!</div><h3>This screen hit a problem</h3><p>Your library and your data are safe. Only this view failed to draw.</p><div class="errbox">TypeError: Cannot read properties of undefined (reading 'title')<br>at GameDetail (route /games/0b3f)</div><div class="row"><button class="btn pri">${I('refresh')}Reload screen</button><button class="btn">${ic('home')}Go to Home</button><button class="btn ghost">${I('download')}Export diagnostics</button></div></div>`
  const skel = `<div class="ldbar"></div><div style="padding:20px 24px"><div style="display:flex;align-items:flex-end;gap:14px;margin-bottom:18px"><div class="sk" style="width:130px;height:56px"></div><div class="sk" style="width:70px;height:24px"></div><div class="sk" style="width:130px;height:34px;margin-left:auto"></div></div><div class="grid8" style="grid-template-columns:repeat(6,1fr)">${Array.from({ length: 12 }, () => '<div><div class="sk" style="aspect-ratio:3/4"></div><div class="sk" style="height:11px;width:80%;margin-top:8px"></div></div>').join('')}</div></div><div style="position:absolute;left:50%;transform:translateX(-50%);bottom:16px;font-size:13.5px;color:var(--bone);background:var(--pan);border:1px solid var(--line2);border-radius:4px;padding:6px 14px">Loading your library…</div>`
  return page('Afterplay - Empty states and errors', `<div class="board2"><div class="bh"><h1>Empty states and errors</h1><span>Same rules: one phrase that says what is missing, one action that fixes it.</span></div><div class="quad" style="gap:12px 28px">
  ${win('Plan with no queue', 'Big dust zero, one primary action and a shortcut into the backlog.', plan, 'Plan')}
  ${win('Search with no results', 'Palette (Ctrl K). Active filters are named and removable; the online search is the way out.', search2, 'Library')}
  ${win('Router error', 'Replaces the screen, not the app: tabs and Now playing stay. Reload, Home, or export what support needs.', err, 'Afterplay')}
  ${win('Loading', 'Skeleton with the final layout, shown only after 150 ms. Phosphor hairline under the title bar.', skel, 'Library')}
  </div></div>`)
}

/* ---------- Ajustes ---------- */
const SNAV = [['General', 'sliders'], ['Library', 'lib'], ['Emulators', 'gamepad'], ['Saves', 'save'], ['Integrations', 'key'], ['Sync', 'sync'], ['Achievements', 'trophy'], ['Backups', 'archive'], ['About', 'info']]
const setPage = (title, sub, body, name) =>
  page(`Afterplay - Settings, ${title}`, appShell({ gearOn: true, inner: `<div class="set"><aside class="snav"><h1>Settings</h1>${SNAV.map(([l, i]) => `<a class="${l === name ? 'on' : ''}">${I(i)}${l}</a>`).join('')}<div class="ver">Afterplay 2.0.0<br>Desk PC · this PC</div></aside><section class="esc"><div class="ttl"><h2>${title}</h2><span class="dust">${sub}</span></div>${body}</section></div>` }))
const sec = (t, d, a, b, st = '') => `<section class="panel es" style="${st}"><header class="eh"><div><h3>${t}</h3>${d ? `<p>${d}</p>` : ''}</div>${a ? `<div class="ea">${a}</div>` : ''}</header>${b ? `<div class="eb">${b}</div>` : ''}</section>`
const tgl = (on) => `<i class="tg ${on ? 'on' : ''}" style="margin:0"></i>`
const sel = (v) => `<div class="sel"><span>${v}</span>${ic('down')}</div>`
const er = (t, d, ctl, c = '') => `<div class="er ${c}"><div class="tx"><b>${t}</b>${d ? `<span>${d}</span>` : ''}</div><div class="ctl">${ctl}</div></div>`
const stt = (c, t, h) => `<span class="stt ${h ? 'hollow' : ''}" style="--c:${c}"><i></i>${t}</span>`
const ubar = (parts) => `<div class="ubar">${parts.map(([w, c]) => `<i style="width:${w}%;background:${c}"></i>`).join('')}</div>`

function ajGeneral() {
  const body = `<div class="stk" style="max-width:1100px">
  ${sec('Startup and time', '', '', er('Start with Windows', 'Launch Afterplay minimised to the tray when you log in, so the watcher catches every session, even those that start before you open the app.', tgl(true), 'tall') + er('Time format', 'Applies to every time shown in the app.', `<div class="seg"><span style="width:auto;padding:0 14px" class="">12 h</span><span style="width:auto;padding:0 14px" class="on">24 h</span></div><span class="dust" style="font-size:13px">20:52</span>`, 'tall'))}
  ${sec('Ambient mode', 'When you leave the app alone, your library takes over the screen and drifts by. Move the mouse and it steps aside.', '', er('Start after', 'Never while a game is running or a dialog is open.', sel('After 5 minutes'), 'tall') + er('Show', 'Only artwork already on this PC; no network.', `<div class="seg"><span style="width:auto;padding:0 14px" class="on">Covers and facts</span><span style="width:auto;padding:0 14px">Covers only</span></div>`, 'tall'))}
  ${sec('In-game overlay', 'A layer over your game with the live timer, a quick note and your achievements. Summon it with the shortcut, or the Guide button on your controller.', '', er('Overlay', 'Only speaks about the session running on this PC.', tgl(true), 'tall') + er('Shortcut', 'Works only while a game is running. Click the combo and press a new one.', `<kbd style="font-size:14px;padding:6px 10px">Ctrl</kbd><span class="dust">+</span><kbd style="font-size:14px;padding:6px 10px">Shift</kbd><span class="dust">+</span><kbd style="font-size:14px;padding:6px 10px">A</kbd><button class="btn">Change</button>`, 'tall'))}
  </div>`
  return setPage('General', 'How the app behaves: startup, clock and the idle screen.', body, 'General')
}

function ajLibrary() {
  const folders = [['D:\\Games\\Steam\\steamapps\\common', 112], ['D:\\Games\\GOG Galaxy\\Games', 23], ['E:\\Epic Games', 17]].map(([p, n]) => `<div class="pathrow"><span class="ico">${I('folder')}</span><span class="p">${p}</span><span class="dust" style="font-size:13px">${n} games found</span><button class="btn ghost ic x" aria-label="Stop scanning this folder">${ic('x')}</button></div>`).join('')
  const cov = (n, w, t, c) => `<div style="margin-bottom:11px"><div style="display:flex;justify-content:space-between;font-size:13.5px;margin-bottom:5px"><span>${n}</span><span class="dust">${t}</span></div><div class="pbar" style="${c ? `--x:${c}` : ''}"><i style="width:${w}%"></i></div></div>`
  const ext = sec('External data', 'Ratings, summaries, release dates, Steam tags and reviews for every game, from IGDB and Steam in one pass. Your plan has its own refresh for just the games you are deciding between.', `<button class="btn">${I('refresh')}Refresh all</button>`, `<div style="padding:16px 20px 6px">${cov('IGDB ratings and summaries', 96, '318 of 331', 0)}${cov('Steam reviews and tags', 78, '241 of 309', 0)}${cov('HowLongToBeat times', 91, '300 of 331', 0)}<div class="dust" style="font-size:13px;margin:4px 0 8px">Last refreshed yesterday, 22:14. Done, everything is up to date.</div></div>`)
  const img = sec('Images', 'Covers, heroes, achievement icons and screenshots kept on your disk, so the app works offline and instantly.', `<button class="btn">${I('download')}Redownload</button><button class="btn">${I('trash')}Free 704 MB</button>`, `<div class="ubw"><div style="display:flex;align-items:baseline;margin-bottom:12px"><span class="big2">2.31<small>GB across 6,214 files</small></span></div>${ubar([[24, 'var(--beaten)'], [34, 'var(--tube)'], [14, 'var(--phos)'], [28, 'var(--dust)']])}<div class="leg"><span><i style="background:var(--beaten)"></i>Covers <b>556 MB</b></span><span><i style="background:var(--tube)"></i>Heroes <b>786 MB</b></span><span><i style="background:var(--phos)"></i>Achievements <b>324 MB</b></span><span><i style="background:var(--dust)"></i>Screenshots <b>648 MB</b> · can be freed</span></div></div>`)
  const body = `<div class="stk" style="max-width:1240px">${sec('Game folders', 'Where your games are installed. When you add a game, Afterplay scans these to find its folder and executable. Each subfolder inside is one game. The list belongs to this PC.', `<span class="bdgs">This PC</span><button class="btn">${I('folder')}Add folder</button>`, folders)}<div class="cols c2">${ext}${img}</div></div>`
  return setPage('Library', 'How games get into Afterplay, and the images and data they carry.', body, 'Library')
}

function ajEmulators() {
  const emu = (n, p, devs) => `<div class="emu"><div class="ico">${I('gamepad')}</div><div style="flex:1"><b>${n}</b><div class="pp">${p}</div><div class="dvs">${devs}</div></div><button class="btn ghost ic x" aria-label="Remove emulator">${ic('x')}</button></div>`
  const yes = (n, me) => `<span>${ic('pc')}${n}${me ? ' (this PC)' : ''}</span>`
  const no = (n) => `<span class="no">${ic('pc')}${n}: not set up</span>`
  const list = sec('Emulators', 'Add your emulators and Afterplay watches them like any other game. Time played lands in Sessions as pending, for you to assign to the right game. The path is this PC\'s; the chips say where else it is set up.', '', emu('RetroArch', 'C:\\Emulators\\RetroArch\\retroarch.exe', yes('Desk PC', 1) + yes('Living room PC')) + emu('Dolphin', 'C:\\Emulators\\Dolphin\\Dolphin.exe', yes('Desk PC', 1) + no('Living room PC')) + emu('Ryujinx', 'D:\\Switch\\Ryujinx\\Ryujinx.exe', yes('Desk PC', 1) + no('Living room PC')))
  const add = `<aside class="stk"><section class="panel es"><header class="eh"><div><h3>Add emulator</h3><p>Pick the program that launches your games.</p></div></header><div class="eb" style="padding:16px 20px 20px"><label class="fld"><span>Name</span><div class="inp ph0">e.g. PCSX2</div></label><label class="fld"><span>Executable</span><div class="inp ph0 mono">C:\\path\\to\\emulator.exe<button class="btn">Browse</button></div></label><button class="btn pri" style="margin-top:4px">${ic('plus')}Add emulator</button></div></section>
  <section class="panel es" style="border-color:rgba(255,179,71,.35)"><header class="eh"><div><h3>3 sessions waiting</h3><p>Emulator time with no game yet, from this PC and from Living room PC.</p></div><div class="ea"><button class="btn">Open Sessions</button></div></header></section></aside>`
  return setPage('Emulators', 'Programs Afterplay times as games of their own.', `<div class="cols c3" style="max-width:1300px">${list}${add}</div>`, 'Emulators')
}

function ajSaves() {
  const gm = (k, pth, size, on) => `<div class="gm2">${cv(k)}<div><b>${G[k].n}</b><span class="pth">${pth}</span></div><div class="sz">${size}</div><div style="text-align:right;font-size:13px;color:var(--dust)">${on ? 'Last copy 2 h ago' : 'Not copied'}</div><div class="tgw">${on ? stt('var(--tube)', 'Backing up') : stt('var(--dust)', 'Turn on', 1)}${tgl(on)}</div></div>`
  const scan = sec('Cloud saves', 'Scan your installed games to find those whose save files Afterplay can back up, then choose which to keep safe in the cloud. Nothing uploads until you turn a game on.', `<button class="btn">${I('refresh')}Scan my games</button>`, `<div style="padding:12px 20px;font-size:13.5px;color:var(--dust);display:flex;gap:18px"><span><b class="k" style="color:var(--bone)">148</b> scanned</span><span><b class="k" style="color:var(--bone)">63</b> with saves</span><span><b class="k" style="color:var(--tube)">41</b> backing up</span></div>${gm('silk', '%APPDATA%\\Team Cherry\\Silksong', '38 MB', 1)}${gm('hades2', 'Documents\\Saved Games\\Hades II', '12 MB', 1)}${gm('clair', '%LOCALAPPDATA%\\Sandfall\\Saved', '210 MB', 1)}${gm('tunic', 'AppData\\LocalLow\\Andrew Shouldice', '4 MB', 0)}${gm('celeste', 'Steam\\userdata\\Celeste', '1 MB', 1)}${gm('dredge', 'AppData\\LocalLow\\Black Salt', '6 MB', 0)}<div style="padding:12px 20px;font-size:12.5px;color:var(--dust);border-top:1px solid var(--line)">Powered by ludusavi (MIT). <a class="lnk">License</a> · <a class="lnk">Third-party notices</a></div>`)
  const ident = `<section class="panel es"><header class="eh"><div><h3>This PC's identity</h3><p>How the cloud tells your PCs apart. Shared with Sync.</p></div><div class="ea"><span class="bdgs tu">Registered</span></div></header><div class="eb"><div style="padding:14px 20px"><div class="notice lv2" style="flex-direction:column;gap:10px"><div style="display:flex;gap:11px">${I('warn')}<div><b class="k">Another installation uses this identity</b><div class="dust" style="font-size:13.5px;margin-top:3px">Desk PC and an installation last seen on Oct 2 share one cloud-save identity. Backups from either would mix.</div></div></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn">This PC is the original</button><button class="btn">This PC is a different one</button></div></div></div></div></section>`
  const mach = (n, me, d, sz2, extra2 = '') => `<div class="mach ${me ? 'me' : ''}"><div class="tl">${ic('pc')}</div><div><b>${n}${me ? ' <span class="pill">This PC</span>' : ''}</b><div class="dt">${d}</div></div><div class="ctl"><span style="font-size:13.5px;font-weight:600">${sz2}</span>${extra2}</div></div>`
  const inv = sec("What's in the cloud", 'Read the bucket itself instead of the local index. The way to spot backups this install does not know about, and get them back.', `<button class="btn">${I('cloud')}Read the bucket</button>`, `<div style="padding:12px 20px 4px;display:flex;gap:10px;align-items:center" class="notice am">${I('cloud')}<span><b>2 folders came from an installation this PC does not know.</b> Recover them to keep their history.</span><button class="btn pri" style="margin-left:auto">Recover them</button></div>${mach('Desk PC', 1, '41 games · 63 folders', '1.4 GB')}${mach('Living room PC', 0, '12 games · last upload yesterday', '320 MB', `<button class="btn ghost ic" aria-label="Delete this PC's backups">${I('trash')}</button>`)}${mach('Unregistered PC', 0, '2 folders · registered by nobody', '88 MB', `<button class="btn ghost ic" aria-label="Delete">${I('trash')}</button>`)}`)
  const loc = sec('Local copies', "The working copy of your cloud saves on this PC's disk. Restores always come from the cloud, so what is already uploaded can be cleaned up safely.", `<button class="btn">${I('trash')}Clean up 212 MB</button>`, `<div class="ubw"><div style="display:flex;align-items:baseline;margin-bottom:12px"><span class="big2">1.1<small>GB on this PC</small></span></div>${ubar([[81, 'var(--tube)'], [19, 'var(--dust)']])}<div class="leg"><span><i style="background:var(--tube)"></i>Still needed <b>890 MB</b></span><span><i style="background:var(--dust)"></i>Reclaimable <b>212 MB</b></span></div></div>`)
  const body = `<div class="cols c21" style="max-width:1440px"><div class="stk">${scan}${loc}</div><div class="stk">${ident}${inv}</div></div>`
  return setPage('Saves', 'Back up your save files to the cloud, and manage the local copies.', body, 'Saves')
}

function ajIntegrations() {
  const row = (tl, n, d, st, open, fields, wl) => `<div class="${open ? 'accfw' : ''}"><div class="acct"><div class="tl">${tl}</div><div><b>${n}${st}</b><div class="dt">${d}</div></div><div class="ctl">${open ? '' : '<button class="btn">Edit</button>'}</div></div>${fields || ''}</div>`
  const ok = `<span class="stt" style="--c:var(--tube);font-weight:500"><i></i>Connected</span>`
  const need = `<span class="bdgs am">Needed</span>`
  const opt = `<span class="bdgs">Optional</span>`
  const f = (l, v, mask) => `<label class="fld"><span>${l}</span><div class="inp ${v ? '' : 'ph0'}">${mask ? '<span class="mask">••••••••••••••••</span>' : v}</div></label>`
  const igdbFields = `<div class="accf"><div class="row2">${f('Twitch client ID', '', 0).replace('class="inp ph0"></div>', '')}${''}</div></div>`
  const igdbOpen = `<div class="accf"><div class="row2"><label class="fld"><span>Twitch client ID</span><div class="inp foc">k3f9…<span class="caret" style="display:inline-block;width:1px;height:16px;background:var(--phos)"></span></div></label><label class="fld"><span>Twitch client secret</span><div class="inp ph0">Paste the secret</div></label></div><div style="display:flex;gap:10px;align-items:center"><button class="btn pri">Save and test</button><a class="lnk" style="font-size:13.5px">Where do I get these keys?</a></div></div>`
  const list = `<section class="panel es">${row(I('db'), 'IGDB', 'Game search and metadata', need, true, igdbOpen)}${row(I('image'), 'SteamGridDB', 'Covers and heroes', need)}${row(I('pc'), 'Steam', 'Achievements · API key and SteamID64', ok)}${row(I('trophy'), 'RetroAchievements', 'Retro console achievements · lara_rr', ok)}${row(I('cloud'), 'Cloud saves', 'Cloudflare R2 · afterplay-saves', ok)}${row(I('info'), 'Anthropic', 'Game trivia and stories', opt)}</section>`
  const welcome = `<div class="notice am">${I('info')}<span><b>Welcome!</b> To search games and fetch artwork, Afterplay needs your own API keys. Add them below; everything else already works.</span></div>`
  const aside = `<aside class="stk"><section class="panel es"><header class="eh"><div><h3>What each key unlocks</h3></div></header><div class="eb">${[['IGDB', 'Search, summaries, ratings, release dates', 'am'], ['SteamGridDB', 'Covers and heroes', 'am'], ['Steam', 'Achievements and Steam reviews', ''], ['RetroAchievements', 'Achievements on retro games', ''], ['Cloud saves', 'Save backups in your own bucket', ''], ['Anthropic', 'Trivia and monthly stories', '']].map(([a, b, c]) => `<div class="er tall"><div class="tx"><b>${a}</b><span>${b}</span></div>${c ? '<span class="bdgs am">Needed to start</span>' : ''}</div>`).join('')}</div></section><section class="panel es"><header class="eh"><div><h3>Where keys live</h3><p>Stored encrypted on this PC. They never travel through Sync, so each PC needs its own. Sync has its own page.</p></div></header></section></aside>`
  const body = `<div class="stk" style="max-width:1300px">${welcome}<div class="cols c3">${list}${aside}</div></div>`
  return setPage('Integrations', 'Your API keys, and the services Afterplay talks to.', body, 'Integrations')
}

function ajBackups() {
  const bk = (d, typ, size, s) => `<div class="bk ${s ? 'sel2' : ''}"><span>${d}</span><span class="dust">${typ}</span><span class="dust">${size}</span><span>${s ? '<b class="k ph">Selected</b>' : ''}</span><div class="a"><button class="btn">Restore</button><button class="btn ghost ic" aria-label="Show in folder">${I('folder')}</button></div></div>`
  const tbl = `<div class="bk h"><span>Date</span><span>Kind</span><span>Size</span><span></span><span></span></div>${bk('Today, 03:00', 'Automatic', '4.2 MB')}${bk('Yesterday, 03:00', 'Automatic', '4.1 MB')}${bk('Nov 20, 03:00', 'Automatic', '4.0 MB', 1)}${bk('Nov 19, 22:41', 'Manual', '4.0 MB')}${bk('Nov 19, 03:00', 'Automatic', '3.9 MB')}${bk('Nov 18, 03:00', 'Automatic', '3.9 MB')}${bk('Nov 17, 03:00', 'Automatic', '3.8 MB')}`
  const main = sec('Data backups', 'Your library, sessions and stats live in one small database file. Afterplay keeps a rotating local copy automatically; Back up now saves an extra one wherever you want. Game save files are separate: see Saves.', `<button class="btn">${I('folder')}Restore from file…</button><button class="btn pri">${I('archive')}Back up now</button>`, `<div class="er tall" style="border-top:0"><div class="tx"><b>Automatic backups</b><span>Stored in D:\\Afterplay\\backups</span></div><div class="ctl">${sel('Every day')}${sel('Keep 10')}</div></div>${tbl}`)
  const rest = `<aside class="stk"><section class="panel rst"><h3>Restore the backup from Nov 20, 03:00?</h3><p>Afterplay will save a safety copy of today's library, replace the database with this one and restart.</p><ul><li>${I('check')}<span>Changes since then are not in it: <b class="k">2 sessions and 1 note</b>.</span></li><li>${I('check')}<span>The safety copy stays in the backups folder until you delete it.</span></li><li>${I('check')}<span>Other PCs keep their data. The next sync reconciles them.</span></li></ul><div style="display:flex;gap:10px;margin-top:16px"><button class="btn pri">Restore and restart</button><button class="btn">Cancel</button></div></section></aside>`
  return setPage('Backups', 'The safety copies of your data, and how to go back to one.', `<div class="cols c3" style="max-width:1340px">${main}${rest}</div>`, 'Backups')
}

function ajAchievements() {
  const ach = sec('Achievements', "Pulls each game's achievements from Steam and RetroAchievements and matches your unlocks to your play sessions, so a trophy becomes a moment in your history, not just a checkbox.", `<button class="btn" style="border-color:rgba(255,179,71,.5);color:var(--phos)">${I('refresh')}Retry 3</button><button class="btn pri">${I('refresh')}Sync now</button>`, `<div class="cvg"><div class="f"><b class="ph">312</b><span>games synced of 331</span></div><div class="f"><b>4,118</b><span>achievements unlocked</span></div><div class="f"><b>3</b><span>failed, will retry</span></div></div><div class="srcrow"><div class="tl">${ic('pc')}</div><div><b>Steam</b><span class="s">241 games · last run yesterday, 22:20</span></div>${stt('var(--tube)', 'Connected')}</div><div class="srcrow"><div class="tl">${I('trophy')}</div><div><b>RetroAchievements</b><span class="s">12 games · lara_rr</span></div>${stt('var(--tube)', 'Connected')}</div><div class="gl"><span>Games that failed</span><span class="why">Hades II · rate limit</span></div><div class="gl"><span>Dredge</span><span class="why">Profile is private on Steam</span></div><div class="gl"><span>Celeste</span><span class="why">No answer, retry later</span></div>`)
  const story = sec('Your story', 'Each month and year of your playing, told back in a few lines, written when the period closes and kept in your Journey.', `<button class="btn" disabled style="opacity:.5">Write</button>`, `<div class="er tall"><div class="tx"><b>Every closed month and year has its story</b><span>New ones write themselves. 14 months, 2 years.</span></div></div><div class="er tall" style="background:rgba(255,179,71,.05)"><div class="tx"><span style="color:var(--bone)">${I('info').replace('class="i "', 'class="i " style="width:15px;height:15px;vertical-align:-3px;margin-right:6px;color:var(--phos)"')}Stories need an Anthropic key. <a class="lnk">Add it in Integrations</a></span></div></div>`)
  const triv = sec('Game trivia', 'Real stories about your games, written once from each game\'s Wikipedia article and mixed into ambient mode next to your own memories.', `<button class="btn" disabled style="opacity:.5">Generate for 18 games</button>`, `<div class="er tall"><div class="tx"><b>18 games are missing their trivia</b><span>New games get theirs on arrival.</span></div><div class="ctl"><div class="pbar" style="width:160px"><i style="width:94%"></i></div></div></div>`)
  return setPage('Achievements', 'Your trophies, and the stories Afterplay writes about your playing.', `<div class="cols c21" style="max-width:1340px">${ach}<div class="stk">${story}${triv}</div></div>`, 'Achievements')
}

function ajAbout() {
  const about = `<section class="panel es"><div class="aboutc"><div class="lg">${logoSvg}</div><div><div class="vn">Afterplay<small>2.0.0</small></div><p>Your games, your time, on every PC. Built on your own sync service.</p></div><div style="margin-left:auto;display:flex;gap:8px;align-items:center"><span class="stt" style="--c:var(--tube)"><i></i>You are up to date</span><button class="btn">${I('refresh')}Check for updates</button></div></div><div class="ktl" style="border-top:1px solid var(--line)"><div>Version</div><div>2.0.0 (stable) · build 4f2a91c</div><div>This PC</div><div>Desk PC · Windows 11 24H2 · id 7c1e…b0a4</div><div>Database</div><div>Schema 41 · 4.2 MB</div><div>Data folder</div><div class="mono">%APPDATA%\\Afterplay <a class="lnk" style="margin-left:10px;font-family:Barlow,sans-serif">Open</a></div></div></section>`
  const diag = `<section class="panel es"><header class="eh"><div><h3>Diagnostics</h3><p>When something goes wrong, export one file with what we need to see. Nothing is sent automatically. You decide who gets it.</p></div><div class="ea"><button class="btn">${I('folder')}Open logs folder</button><button class="btn pri">${I('download')}Export diagnostics</button></div></header><div class="eb"><div class="chk"><div><h4>${I('check').replace('class="i "', 'class="i " style="color:var(--tube)"')}Included</h4><ul style="padding:0"><li>${I('check')}App log, last 7 days</li><li>${I('check')}Sync state and the last errors, with their cause</li><li>${I('check')}Versions of Afterplay and Windows</li><li>${I('check')}Device names and last-seen times</li></ul></div><div><h4>${I('x').replace('class="i "', 'class="i " style="color:var(--live-text)"')}Never included</h4><ul style="padding:0"><li>${I('x')}API keys, tokens and passwords</li><li>${I('x')}Your notes and session text</li><li>${I('x')}Save files and screenshots</li><li>${I('x')}Anything that names your games</li></ul></div></div><div class="er tall"><div class="tx"><b>Log detail</b><span>Normal keeps failures and key events. Verbose helps with a bug you can reproduce; turn it off afterwards.</span></div><div class="ctl">${sel('Normal')}</div></div></div></section>`
  return setPage('About', 'What this PC runs, and what to send when something breaks.', `<div class="stk" style="max-width:1100px">${about}${diag}</div>`, 'About')
}

/* ---------- Migracion ---------- */
const STEPS = ['Check your PCs', 'Copy and validate', 'Pair', 'Upload', 'Finish']
const stepper = (cur) => `<div class="stepper">${STEPS.map((s, i) => `<div class="sp1 ${i < cur ? 'done' : i === cur ? 'on' : ''}"><div class="dotn">${i < cur ? I('check') : i + 1}</div>${s}</div>`).join('')}</div>`
const mwin = (w, h, body, title = 'Afterplay', pt = 6) => `<div class="mwin" style="width:${w}px;height:${h}px"><div class="wt"><i></i><i></i><i></i><span>${title}</span></div><div class="mcol" style="max-width:${w - 40}px;padding-top:${pt}px"><div class="wm">${logoSvg}Afterplay</div>${body}</div></div>`
const mprog = (frac, big, small) => `<div class="mprog"><div class="mbar"><i style="width:${frac}%"></i></div><div class="tx"><span>${small}</span><b>${big}</b></div></div>`

function migracionPasos() {
  const w1 = mwin(744, 392, `${stepper(1)}<div class="mspin"></div><h1>Copying your library</h1><div class="bd">Moving your games, sessions and notes to Afterplay 2, then checking every row against the original. The app may pause for a few seconds.</div>${mprog(58, '58%', 'Checking the copy: 1,742 of 2,996 rows')}`)
  const w2 = mwin(744, 392, `${stepper(2)}<h1>Connect this PC to sync</h1><div class="bd" style="font-size:14px">Afterplay 2 keeps your PCs in step through a sync service. In the phone app, open Add device to get a one-time code.</div><div class="mfld" style="max-width:640px;display:grid;grid-template-columns:1.25fr 1fr;gap:12px"><label class="fld"><span>Sync service address</span><div class="inp">https://sync.example.org</div></label><label class="fld"><span>One-time code</span><div class="inp foc" style="font:700 22px/1 var(--bs);letter-spacing:.08em">7KQF 92MX<span style="display:inline-block;width:1px;height:20px;background:var(--phos)"></span></div></label></div><div class="mbtns"><button class="btn pri lg">Connect</button></div>`)
  const w3 = mwin(744, 392, `${stepper(3)}<div class="mspin"></div><h1>Uploading your library</h1><div class="bd">Your library is being sent to the sync service so your other PCs and your phone can use it.</div>${mprog(64, '64%', '412,000 of 641,000 rows uploaded')}<div class="mfine" style="margin-top:-6px">Connection dropped for a moment. The upload picks up again by itself.</div>`)
  const w4 = mwin(744, 392, `${stepper(5)}<div style="width:54px;height:54px;border-radius:50%;background:var(--phos);display:grid;place-items:center;color:#1a1100;box-shadow:0 0 34px rgba(255,179,71,.5)">${sz(I('check'), 28)}</div><h1>Your library is ready</h1><div class="bd">331 games, 1,248 sessions and 612 notes moved to Afterplay 2. Opening it now.</div>`)
  const lab = (t, d) => `<div class="lbl" style="margin-bottom:6px;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap"><h3>${t}</h3><span class="dust" style="font-size:13px">${d}</span></div>`
  return page('Afterplay - Migration steps', `<div class="board2"><div class="bh"><h1>Migration, normal path</h1><span>No questions on the happy path. Window veil, wordmark, five steps, one status at a time.</span></div><div class="migb" style="grid-template-columns:744px 744px;gap:12px 24px"><div>${lab('Step 2 · Copy and validate', 'Phosphor bar with the real percentage. The check runs before anything is replaced.')}${w1}</div><div>${lab('Step 3 · Pair', 'Only the first PC of a person (or an expired sign-in). Code in Big Shoulders.')}${w2}</div><div>${lab('Step 4 · Upload', 'Determinate bar, rows left. A transient problem is a calm line, not an alert.')}${w3}</div><div>${lab('Done', 'All five steps filled. Fades into the app by itself after 2 s.')}${w4}</div></div></div>`)
}

function migracionDecisiones() {
  const dv = (n, why, self) => `<div class="d ${self ? 'self' : ''}">${ic('pc')}<div><b>${n}${self ? ' (this PC)' : ''}</b><span>${why}</span></div></div>`
  const w1 = mwin(480, 700, `${stepper(0)}<h1 style="font-size:40px">Some PCs have not caught up</h1><div class="bd" style="font-size:14px">These PCs have changes that never reached the sync service. You can wait for them, or continue now.</div><div class="mdev">${dv('Living room PC', 'Changes never reached the sync service, 3 days ago.')}${dv('Laptop', 'Has not confirmed it is up to date yet. Open Afterplay on it.')}</div><div class="mfine">If you continue, their missing changes can be recovered later from their own copy. Nothing is lost.</div><div class="mbtns"><button class="btn pri lg">Wait for them</button><button class="btn lg">Continue anyway</button></div><div class="mfine">We check again by ourselves every 30 seconds.</div>`)
  const w2 = mwin(480, 700, `<div style="width:54px;height:54px;border-radius:50%;background:var(--live-soft);border:2px solid var(--live);display:grid;place-items:center;color:var(--live)">${sz(I('warn'), 26)}</div><h1 style="font-size:40px">Nothing was migrated</h1><div class="bd" style="font-size:14px">The copy did not pass validation, so your library was not changed. You are still on the previous version and can keep using it.</div><div class="vtab"><div><b class="k">Games</b><span>331 of 331</span>${sz(I('check').replace('class="i "', 'class="i " style="color:var(--tube)"'), 16)}</div><div class="bad"><b class="k">Sessions</b><span>1,247 of 1,248</span>${sz(I('x').replace('class="i "', 'class="i " style="color:var(--live)"'), 16)}</div><div><b class="k">Notes</b><span>612 of 612</span>${sz(I('check').replace('class="i "', 'class="i " style="color:var(--tube)"'), 16)}</div><div><b class="k">Save index</b><span>63 of 63</span>${sz(I('check').replace('class="i "', 'class="i " style="color:var(--tube)"'), 16)}</div></div><div class="mfine">Your Afterplay 1 library has not been changed.</div><div class="mbtns"><button class="btn pri lg">Try again</button><button class="btn lg">Open report</button></div>`)
  const w3 = mwin(480, 700, `${stepper(2)}<h1 style="font-size:40px">This PC already existed</h1><div class="bd" style="font-size:14px">Afterplay found a PC called Desk PC in your account that was last seen on Oct 2. Is this the same one, reinstalled?</div><div class="mdev"><div class="d">${ic('pc')}<div><b>Desk PC</b><span>Windows 11 · last seen Oct 2 · 41 games with cloud saves</span></div></div></div><div class="mfine">Taking over its identity keeps its save history and its place in the device list.</div><div class="mbtns"><button class="btn pri lg">Yes, recover it</button><button class="btn lg">No, this is a new PC</button></div>`)
  const lab = (t, d) => `<div class="lbl" style="margin-bottom:8px"><h3>${t}</h3><p>${d}</p></div>`
  return page('Afterplay - Migration decisions', `<div class="board2"><div class="bh"><h1>Migration, the questions and the failure</h1><span>The only screens with real choices.</span></div><div class="migb" style="grid-template-columns:repeat(3,480px);gap:0 36px"><div>${lab('Lagging PCs', 'One question. This PC in red if it is the one behind.')}${w1}</div><div>${lab('Validation failed', 'Nothing replaced. The failing row is named.')}${w2}</div><div>${lab('Reinstalled PC', 'Same pattern: one question, two answers.')}${w3}</div></div></div>`)
}

/* ---------- Overlay y ambiente ---------- */
function overlay() {
  const pts = [[120, 180], [410, 90], [700, 260], [980, 140], [1210, 330], [260, 410], [840, 470], [1100, 560], [640, 140], [90, 520]].map(([x, y]) => `<i class="pt" style="left:${x}px;top:${y}px"></i>`).join('')
  const pil = [80, 330, 780, 1050, 1250].map((x, i) => `<i class="pil" style="left:${x}px;height:${200 + (i % 3) * 60}px"></i>`).join('')
  const ach = (a, b, n, s, p, c) => `<div class="ach2 ${c || ''}"><div class="ai" style="--a:${a};--b:${b}"></div><div><b>${n}</b><span>${s}</span></div><span class="pc">${p}</span></div>`
  return page('Afterplay - In-game overlay', `<div class="scene"><div class="moon"></div><div class="far"></div><div class="mid"></div>${pil}<div class="gr"></div><div class="glow"></div><div class="hero"><i class="bd"></i><i class="bd2"></i><i class="hd" style="background:#e8dfe0"></i></div>${pts}<div class="vig"></div>
  <div class="gh"><i></i><i></i><i></i><i></i><i class="e"></i></div><div class="gcount">482</div>
  <div class="ovt"><div class="ai"></div><div><b>Achievement unlocked · Weaver's Tune</b><span>Only 2.3% of players have it</span></div></div>
  <aside class="ovl"><div class="oh">${logoSvg.replace('width="26" height="26"', 'width="18" height="18"')}Afterplay<kbd>Esc</kbd></div>
  <div class="og">${cv('silk')}<div><b>Hollow Knight: Silksong</b><span><i class="pulse"></i>Session on Desk PC · since 19:40</span></div></div>
  <div class="tm">1:12:04</div><div class="tf"><span><b>23h 15m</b> total</span><span><b>11</b> sessions</span><span>Last one <b>1h 25m</b></span></div>
  <div class="sc2"><h4>Quick note<span>saved to this session</span></h4><div class="nbox">Past the Bellhart gate. Find the silk spool before the next boss<span class="caret"></span></div><div class="nft"><span><kbd>Ctrl</kbd>+<kbd>Enter</kbd> saves</span><button class="btn pri">Save note</button></div></div>
  <div class="sc2" style="border-bottom:0"><h4>Achievements<span>14 of 54 · 3 tonight</span></h4><div class="pbar" style="margin:-2px 0 6px"><i style="width:26%"></i></div>${ach('#7a5cd0', '#2a1c5c', "Weaver's Tune", 'Unlocked 20:44', '2.3%', 'rare')}${ach('#4F9D5B', '#12261A', 'Pilgrim\'s Rest', 'Unlocked 20:12', '18%')}${ach('#C23A1E', '#1A0A07', 'Silk and Steel', 'Unlocked 19:58', '41%')}${ach('#5a6a70', '#222c30', 'Hidden: the last thread', 'Locked', '0.8%', 'lock')}</div></aside>
  <div class="ovhint">${I('lock').replace('class="i "', 'class="i " style="width:14px;height:14px"')}Transparent window over the game. The game keeps running; Esc hands focus back at once.</div></div>`)
}

function ambient() {
  const home = appShell({ active: 'Home', inner: `<div class="home"><div class="pgh"><h1>Tonight</h1></div><section class="row1"><article class="cont panel"><div class="bnw">${bn('silk')}</div><div class="ci"><h2>Hollow Knight</h2></div></article><article class="week panel"></article></section><div class="rail" style="grid-template-columns:repeat(8,1fr)">${['clair', 'balatro', 'hades2', 'split', 'outer', 'celeste', 'tunic', 'hades'].map((k) => cv(k, { st: 'beaten' })).join('')}</div></div>` })
  return page('Afterplay - Ambient mode', `<div class="ambw"><div class="bd">${home}</div><div class="vg"></div><div class="sl"></div>
  <div class="ambclock">20:52<small>Sunday, November 22</small></div>
  <div class="ambp"><div class="tint"></div><div class="cvw">${cv('clair')}</div><div class="tx"><h2>Clair Obscur:<br>Expedition 33</h2><div class="rl"></div><p>A year ago today, you unlocked <em>"Verso's Echo"</em> here. Only 4.1% of players have it.</p></div></div>
  <div class="ambprog"><span>Slide 3 of 24</span><div class="ln"><i></i></div><span>Move the mouse to go back <kbd>any key</kbd></span></div></div>`)
}

const out = {
  'estados-nowplaying': nowplaying(),
  'estados-sync': syncStates(),
  'estados-avisos': avisos(),
  'estados-pendientes': pendientes(),
  'estados-asignar': asignar(),
  'estados-vacio-biblioteca': vacioBiblioteca(),
  'estados-vacios': vacios(),
  'estados-ajustes-general': ajGeneral(),
  'estados-ajustes-library': ajLibrary(),
  'estados-ajustes-emulators': ajEmulators(),
  'estados-ajustes-saves': ajSaves(),
  'estados-ajustes-integrations': ajIntegrations(),
  'estados-ajustes-backups': ajBackups(),
  'estados-ajustes-achievements': ajAchievements(),
  'estados-ajustes-about': ajAbout(),
  'estados-migracion-pasos': migracionPasos(),
  'estados-migracion-decisiones': migracionDecisiones(),
  'estados-overlay': overlay(),
  'estados-ambient': ambient()
}
for (const [k, v] of Object.entries(out)) writeFileSync(join(dir, `${k}.html`), v)
console.log('HTML generado:', Object.keys(out).length)
