// Genera los HTML de Stats (prefijo stats). Uso: node build-stats.mjs
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { G, ST, STN, cv, bn, dot, ic, icf, shell } from './build.mjs'
import * as C from './stats-charts.mjs'
const { AMB, TUBE, DUST, BONE, fh, fm, num } = C
const dir = dirname(fileURLToPath(import.meta.url))

const EX = {
  route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h6a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h6"/>',
  book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19M9 7h6"/>',
  cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  up: '<path d="M4 16l5-6 4 3 7-8M15 5h5v5"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
  star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9 6.8 19.7l1-5.9L3.5 9.7l5.9-.8z"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5h4"/>'
}
const ix = (k, size = 18) => `<svg class="i" viewBox="0 0 24 24" style="width:${size}px;height:${size}px">${EX[k]}</svg>`

const link = '<link rel="stylesheet" href="stats.css">'
const scroll = (id, off = 84) => `<script>(function(){var s=document.querySelector('.sc');${id ? `var e=document.getElementById('${id}');if(e)s.scrollTop=e.offsetTop-${off};` : ''}})()</script>`

const bar = (view, extra = '', right = '') => `<div class="sth"><h1>Stats</h1>${extra || `<div class="vs"><a class="${view === 'ov' ? 'on' : ''}">${ic('chart')}Overview</a><a class="${view === 'jr' ? 'on' : ''}">${ix('route')}Journey</a></div>`}
  ${view === 'ov' ? `<div class="rg"><a class="on">All time</a><a>2026</a><a>2025</a><a>2024</a><a>2023</a><a>2022</a><a>2021</a><a class="more">More years${ic('down')}</a></div>` : view === 'jr' ? `<div class="rg">${right}</div>` : ''}</div>`

const panel = (title, sub, body, cls = '', style = '') =>
  `<section class="stp ${cls}" style="${style}"><header><h3>${title}</h3>${sub ? `<span class="sub">${sub}</span>` : ''}</header>${body}</section>`
const chap = (id, title, desc) => `<div class="chap" id="${id}"><h2>${title}</h2><p>${desc}</p></div>`
const gr = (cols, ...items) => `<div class="gr" style="grid-template-columns:${cols}">${items.join('')}</div>`

/* ======================= STATS GLOBAL ======================= */
const BC = { stardew: '#8FD16B', hades: '#E8553F', slay: '#E86F3E', cyber: '#F4E41C', hollow: '#9FB6D6', disco: '#DB6E2C', celeste: '#67AEEA', balatro: '#4C8DFF' }

function hero() {
  const st = (n, l, em = '') => `<div><b>${n}</b><span>${l}</span>${em}</div>`
  return `<section class="hero0" id="top"><div class="gl"></div><div class="hart">${bn('stardew', false, false)}</div>
  <div class="hl"><div class="per">${dot('playing')}All time, every year you have logged</div>
    <div class="big0">4,386<small>h</small>20<small>m</small></div>
    <h2>Stardew Valley leads your archive.</h2>
    <p class="sup">Total playtime across 331 games. Stardew Valley accounts for 7% of the time.</p>
    <div class="sf">${st('331', 'Games tracked')}${st('€2,385.45', 'Total spent')}${st('€0.54', 'Average cost per hour')}</div></div>
  <div class="hr0">
    <div class="lead">${cv('stardew')}<div class="t"><small>Most played</small><b>Stardew Valley</b><span>312h 40m</span></div><div class="ring" style="background:conic-gradient(${AMB} ${0.071 * 360}deg,rgba(255,255,255,.08) 0)"><b>7%</b></div></div>
    <div class="recs">
      <div class="rc"><span>Longest session</span><b>9h 42m</b><em>Stardew Valley</em></div>
      <div class="rc"><span>Hottest day</span><b>14h 05m</b><em>Sat, Mar 9, 2024</em></div>
      <div class="rc"><span>Peak month</span><b>168h 20m</b><em>March 2024</em></div>
      <div class="rc"><span>Finish line</span><b>151</b><em>finishes, 142 games crossed it</em></div>
    </div></div></section>`
}

function heatPanel() {
  const h = C.heatmap({ tip: true })
  const ramp = ['#1B2326', '#4B3B22', '#80602B', '#C48B35', AMB].map((c) => `<i style="background:${c}"></i>`).join('')
  return panel('Activity', `<span class="hmleg" style="display:inline-flex;margin-right:28px;vertical-align:middle">Less${ramp}More</span><b>${h.active} active days</b> in the last 52 weeks`, h.html, '', 'padding-bottom:20px')
}

function band3() {
  const combo = panel('Hours and spend per month', '<b>824h</b> played, <b>€475.85</b> spent, last 12 months', `<div class="lg" style="margin:-4px 0 6px"><span><i style="background:${AMB}"></i>Hours played</span><span><i class="ln" style="background:${TUBE}"></i>Spent</span><span style="margin-left:auto">* Nov is still open</span></div>${C.monthCombo({ tip: true, W: 656, H: 252 })}`)
  const stk = Array.from({ length: 61 }, (_, i) => `<i class="${i < 23 ? 'f' : ''}"></i>`).join('')
  const streak = panel('Daily streak', 'Rhythm you carry now', `<div class="streak"><div class="sn">23<small>days</small></div><div class="dust" style="font-size:14px;margin-top:6px">Current streak. Your next played day extends it.</div>
    <div class="stk">${stk}</div><div class="dust" style="font-size:13px;margin:6px 0 10px;display:flex;justify-content:space-between"><span>23 days now</span><span>61 days, record</span></div>
    <div style="margin-top:auto"><div class="kv" style="align-items:baseline"><span>Longest ever</span><b>61 days<em style="display:block;font-style:normal;font-weight:400;font-size:12.5px;color:var(--dust)">Mar 2 to May 1, 2024</em></b></div></div></div>`)
  const wd = panel('When do you play?', 'Saturday is your day', C.vbars({ W: 436, H: 266, labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], vals: [482, 421, 468, 497, 603, 1002, 913], fmtv: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`), peak: 5, bw: 32 }))
  return gr('700px 340px 1fr', combo, streak, wd)
}

function band4() {
  const hr = panel('Hour of day', 'Counted in the hour a session starts. Peak <b>21:00</b>', C.hourBars({ W: 956, H: 256 }))
  const sl = panel('Session length', '3,444 measured sessions', C.vbars({ W: 460, H: 188, labels: ['<30m', '30m–1h', '1–2h', '2–4h', '4h+'], vals: [612, 864, 1103, 702, 163], fmtv: num, peak: 2, bw: 40, top: 22 }) + `<div style="display:flex;gap:30px;margin-top:6px;font-size:13.5px;color:var(--dust)"><span>Median <b style="color:var(--bone)">1h 22m</b></span><span>Under an hour <b style="color:var(--bone)">43%</b></span><span>Longest <b style="color:var(--bone)">9h 42m</b></span></div>`)
  return gr('1000px 520px', hr, sl)
}

function mostPlayed() {
  const rows = [['stardew', 312.67], ['hades', 241.08], ['slay', 198.5], ['cyber', 164.25], ['hollow', 128.83], ['disco', 96.33], ['celeste', 88.75]]
  const max = rows[0][1]
  const body = rows.map(([k, h], i) => `<div class="mp" style="--g:${BC[k]}"><span class="rk">${i + 1}</span>${cv(k)}<span class="nm">${G[k].n}</span><div class="tr"><i style="width:${(h / max) * 100}%"></i></div><span class="hh">${num(Math.floor(h))}<small>h</small> ${String(Math.round((h % 1) * 60)).padStart(2, '0')}<small>m</small></span></div>`).join('')
  return panel('Most played', 'Top 7 of 331, by hours. <span class="lnk">Show 10</span>', body)
}

function statusPanel() {
  const rows = [['beaten', 142], ['backlog', 96], ['resting', 61], ['dropped', 27], ['playing', 5]]
  const stack = rows.map(([s, n]) => `<i style="width:${(n / 331) * 100}%;--st:${ST[s]}"></i>`).join('')
  const body = `<div class="stack">${stack}</div>` + rows.map(([s, n]) => `<div class="srow">${dot(s)}<span>${STN[s]}</span><span class="n">${n}</span><span class="p">${Math.round((n / 331) * 100)}%</span></div>`).join('') + `<p class="note" style="margin-top:12px">Pick a year and this counts transitions instead: started, completed, dropped, put on hold.</p>`
  return panel('Status breakdown', 'Today', body)
}

function radarPanel() {
  const axes = ['RPG', 'Action', 'Adventure', 'Strategy', 'Sim', 'Puzzle']
  const vals = [1420, 980, 620, 470, 640, 256]
  return panel('Genre spread', 'Hours by main genre', C.radar({ W: 356, H: 336, axes, vals, R: 100 }))
}

function agePanel() {
  const segs = [['New releases', 640, '#FFB347'], ['1 to 5 years', 1980, '#C98A35'], ['5 to 10 years', 1150, '#8F6428'], ['10+ years', 616, '#5B4120']]
  const center = C.bsTxt(90, 96, '3 yrs', 36, BONE, 'middle') + `<text x="90" y="116" text-anchor="middle" fill="${DUST}" font-size="12.5" font-family="Barlow">median age</text>`
  const d = C.donut({ size: 180, r: 70, w: 26, segs: segs.map((x) => ({ v: x[1], color: x[2] })), center })
  const list = segs.map((x) => `<div class="dl" style="height:42px"><i style="background:${x[2]}"></i><div>${x[0]}</div><b>${num(x[1])}h</b><em>${Math.round((x[1] / 4386) * 100)}%</em></div>`).join('')
  return panel('Playtime by game age', 'Age when you played it', `<div style="display:flex;gap:20px;align-items:center">${d}<div style="flex:1">${list}</div></div>`)
}

function gallery() {
  const g = [['outer', 'Nov 19'], ['cocoon', 'Nov 12'], ['well', 'Nov 3'], ['tunic', 'Oct 27'], ['dredge', 'Oct 14'], ['obra', 'Oct 2'], ['sea', 'Sep 21'], ['lies', 'Sep 9']]
  return panel('Completed', '<b>142 games</b> beaten, newest first. <span class="lnk">Show all</span>', `<div class="gal">${g.map(([k, d]) => `<div>${cv(k, { st: 'beaten' })}<div class="d"><b>${G[k].n}</b>${d}</div></div>`).join('')}</div>`)
}

function hltb() {
  const rows = [['disco', 41, 24], ['celeste', 14.33, 8.5], ['outer', 19.17, 17], ['tunic', 11.67, 13], ['dredge', 9.83, 12]]
  const body = rows.map(([k, y, m]) => {
    const r = y / m, p = Math.round(Math.abs(r - 1) * 100)
    return `<div class="hb">${cv(k)}<span class="nm">${G[k].n}</span><div class="trk"><i style="width:${Math.min(r * 50, 99)}%"></i><s></s></div><div class="tx"><b>${fh(y)}</b> vs ${fh(m)}<span>${p}% ${r > 1 ? 'beyond' : 'under'} Main Story</span></div></div>`
  }).join('')
  const head = `<div class="hax" style="margin-top:-4px"><span></span><span></span><div class="a"><span style="left:50%;color:${TUBE}">Main Story estimate</span><span style="left:100%;transform:translateX(-100%)">2x</span></div><span></span></div>`
  return panel('You vs HowLongToBeat', `<span class="lg"><span><i style="background:${AMB}"></i>Your time</span><span><i style="width:3px;height:13px;background:${TUBE}"></i>Main Story</span></span>`, head + body)
}

function paceSummary() {
  return panel('Your pace', 'A reference, not a target', `<div class="med" style="flex-direction:column;gap:4px;align-items:flex-start"><b style="font-size:80px;color:${AMB}">10%</b><span>under the Main Story estimate, median of 138 finished games</span></div>
    <div style="margin-top:14px"><div class="kv"><span>Faster than the estimate</span><b>74 games</b></div><div class="kv"><span>Right on it, within 5%</span><b>12 games</b></div><div class="kv"><span>Beyond it</span><b>52 games</b></div></div>
    `)
}

function backlog() {
  const flow = panel('Backlog flow', 'Games entering and leaving, per month', `<div class="lg" style="margin:-4px 0 4px"><span><i class="ln" style="background:${AMB}"></i>Added to library</span><span><i class="ln" style="background:${TUBE}"></i>Plan to play</span><span><i class="ln" style="background:${ST.beaten}"></i>Completed</span></div>` + C.flowLines({
    H: 190,
    series: [
      { v: [9, 14, 6, 18, 7, 11, 8, 12, 5, 10, 15, 8], color: AMB, label: 'Added 123', main: true, ly: 106 },
      { v: [3, 4, 2, 5, 2, 3, 4, 3, 2, 3, 4, 2], color: TUBE, label: 'Plan 37', ly: 148 },
      { v: [4, 6, 3, 5, 5, 4, 7, 3, 6, 5, 4, 3], color: ST.beaten, label: 'Done 55', ly: 132 }
    ]
  }))
  const mov = panel('Backlog movement', '2026 so far, in HowLongToBeat hours', `<div class="mov" style="gap:12px">
    <div class="mvr"><span>Entered the backlog</span><b>1,420h</b><div class="bar"><i style="width:100%;background:${AMB}"></i></div><span>123 games added, 5 now queued in Plan</span></div>
    <div class="mvr"><span>Left it (started, completed or dropped)</span><b>612h</b><div class="bar"><i style="width:43%;background:${TUBE}"></i></div><span>55 games cleared</span></div>
    <div class="kv" style="padding:8px 0 0"><span>Balance today</span><b>+808h</b></div></div>`)
  return gr('1000px 520px', flow, mov)
}

function debt() {
  const left = `<div style="width:400px;flex:none"><div class="dnum" style="gap:34px"><div><b style="font-size:48px">96</b><span>games waiting</span></div><div><b style="font-size:48px">1,742<small>h</small></b><span>estimated, 91 of 96 have one</span></div></div>
    <div class="kv" style="margin-top:14px"><span>Recent pace</span><b>12.4h a week</b></div><div class="kv"><span>Projected horizon</span><b style="color:${AMB}">August 2029</b></div></div>`
  return panel('Backlog debt', 'Hours left at the pace of the last 12 weeks, if no new games arrive', `<div style="display:flex;gap:40px;align-items:center">${left}<div style="flex:1">${C.debtCurve({ W: 1000, H: 146 })}</div></div>`)
}

function cabinet() {
  const a = `<div><h4>Unlocked<span>61 games</span></h4><div class="abig" style="font-size:76px">1,184<small>achievements</small></div>
    <div class="rar" style="margin:16px 0 10px"><i style="width:${(902 / 1184) * 100}%;background:#6E797B"></i><i style="width:${(241 / 1184) * 100}%;background:${TUBE}"></i><i style="width:${(41 / 1184) * 100}%;background:${AMB}"></i></div>
    <div class="rarq"><div><i style="background:#6E797B"></i><b>902</b><span>Common</span></div><div><i style="background:${TUBE}"></i><b>241</b><span>Rare</span></div><div><i style="background:${AMB}"></i><b>41</b><span>Ultra rare</span></div></div></div>`
  const hof = [['hades', 'Total Hellfire', 'Hades', '0.7'], ['hollow', 'Embrace the Void', 'Hollow Knight', '1.1'], ['tunic', 'Golden Trophy', 'Tunic', '1.3'], ['celeste', 'Farewell, collected', 'Celeste', '2.0']]
  const b = `<div><h4>Hall of fame<span>Rarest unlocks</span></h4>${hof.map(([k, n, g, p]) => `<div class="hof" style="height:47px">${cv(k)}<div><div class="a">${n}</div><div class="g">${g}</div></div><div class="pc">${p}%<small>of players</small></div></div>`).join('')}</div>`
  const c = `<div><h4>Perfect games<span>11 at 100%</span></h4><div class="perf" style="gap:8px">${['hollow', 'celeste', 'hades', 'tunic'].map((k) => `<div>${cv(k)}</div>`).join('')}</div>
    <h4 style="margin-top:16px">Almost there<span>Closest to 100%</span></h4><div class="alm">${[['Outer Wilds', 29, 30], ['Cocoon', 12, 14]].map(([n, a2, t]) => `<div class="g" style="margin-top:6px">${n}</div><span style="margin-top:6px">${a2} of ${t}</span><div class="bar"><i style="width:${(a2 / t) * 100}%"></i></div>`).join('')}</div></div>`
  const d = `<div><h4>Harvest by year<span>Unlocks</span></h4>${C.miniBars({ W: 316, H: 160, labels: ['21', '22', '23', '24', '25', '26'], vals: [96, 188, 241, 312, 267, 80], peak: 3, fmtv: num })}</div>`
  return panel('Achievements', '', `<div class="ach">${a}${b}${c}${d}</div>`)
}

function badges() {
  const b = [['beaten', 'Beaten', 142, 'Complete a game at least once.'], ['centurion', 'Centurion', 6, 'Reach 100 hours in one game.'], ['marathoner', 'Marathoner', 87, 'A single session of 4 hours or more.'], ['devoted', 'Devoted', 34, 'Play 7 days in a row.'], ['regular', 'Regular', 71, 'Log 50 tracked sessions.'], ['completionist', 'Completionist', 11, 'Reach the 100% mark.'], ['night', 'Night Owl', 52, '35% of your time after 22:00.'], ['weekend', 'Weekend Warrior', 64, '60% of your time on weekends.'], ['free', 'Free Ride', 18, '20+ hours without spending.']]
  return panel('Badges', 'Personal badges, counted by the games that earned them', `<div class="bshelf slim">${b.map(([k, l, n, c]) => `<div class="bd on" title="${c}" style="color:${AMB}"><div class="bt1"><span class="mdl">${C.badgeIc(k, 22)}</span><b>${n}</b></div><span class="l" style="color:${BONE}">${l}</span></div>`).join('')}</div>`)
}

export function globalPage(id) {
  const body = `${link}<div class="sc">${bar('ov')}
  ${hero()}
  ${chap('pulse', 'How the time moved', 'Days, months and habits: the rhythm underneath the totals.')}
  <div class="gr" style="margin-top:0">${heatPanel()}</div>
  <div id="rhythm" style="scroll-margin-top:84px">${band3()}${band4()}</div>
  ${chap('cast', 'The games that defined it', 'Leaders, finishes and the shape of the library behind the hours.')}
  ${gr('740px 400px 1fr', mostPlayed(), radarPanel(), statusPanel())}
  ${gr('1000px 520px', gallery(), agePanel())}
  ${chap('pace', 'How you actually play', 'Your sessions against estimates, without turning either into a target.')}
  ${gr('1000px 520px', hltb(), paceSummary())}
  ${chap('long', 'What entered, what left, what waits', 'Backlog as history and balance: information, never a guilt counter.')}
  ${backlog()}
  <div class="gr" id="debt">${debt()}</div>
  ${chap('cab', 'The cabinet', 'Rare unlocks, perfect games and the moments that stood out.')}
  <div class="gr" style="margin-top:0">${cabinet()}</div>
  <div class="gr">${badges()}</div>
  </div>${scroll(id)}`
  return shell('Afterplay - Stats', 'Stats', body)
}

const outputs = {}
const caps = { 'stats-overview': null, 'stats-rhythm': 'rhythm', 'stats-library': 'cast', 'stats-pace': 'pace', 'stats-cabinet': 'debt' }
for (const [n, id] of Object.entries(caps)) outputs[n] = globalPage(id)

import('./build-stats-2.mjs').then(({ extra }) => {
  Object.assign(outputs, extra({ bar, panel, chap, gr, link, scroll, ix }))
  for (const [n, html] of Object.entries(outputs)) writeFileSync(join(dir, `${n}.html`), html)
  console.log('stats html:', Object.keys(outputs).join(', '))
}).catch((e) => { console.log('no build-stats-2:', e.message); for (const [n, html] of Object.entries(outputs)) writeFileSync(join(dir, `${n}.html`), html) })
