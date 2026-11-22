// Stats de un juego y Journey (prefijo stats). Lo importa build-stats.mjs
import { G, ST, STN, cv, bn, dot, chip, ic, icf, shell } from './build.mjs'
import * as C from './stats-charts.mjs'
const { AMB, TUBE, DUST, BONE, fh, fm } = C
const GOLD = '#D8AE5A'

/* sesiones de Clair Obscur: Expedition 33 (38h 10m, 14 sesiones) */
const S = [
  [new Date(2026, 9, 3), 14 * 60, 150], [new Date(2026, 9, 4), 15 * 60 + 30, 195], [new Date(2026, 9, 8), 19 * 60 + 30, 100],
  [new Date(2026, 9, 10), 18 * 60, 290], [new Date(2026, 9, 11), 14 * 60 + 15, 140], [new Date(2026, 9, 15), 21 * 60, 90],
  [new Date(2026, 9, 17), 19 * 60, 230], [new Date(2026, 9, 24), 15 * 60, 165], [new Date(2026, 9, 25), 10 * 60, 190],
  [new Date(2026, 10, 1), 14 * 60, 155], [new Date(2026, 10, 7), 19 * 60 + 15, 215], [new Date(2026, 10, 20), 20 * 60, 130],
  [new Date(2026, 10, 21), 10 * 60 + 30, 110], [new Date(2026, 10, 21), 21 * 60, 130]
]

function hod() {
  const v = Array(24).fill(0)
  for (const [, st, dur] of S) for (let m = 0; m < dur; m++) v[Math.floor(((st + m) % 1440) / 60)]++
  return v
}
function wdays() {
  const v = Array(7).fill(0)
  for (const [d, , dur] of S) v[(d.getDay() + 6) % 7] += dur
  return v
}

function gameHeat() {
  const cell = 22, gap = 5, pitch = 27, left = 40, top = 24
  const byDay = new Map()
  for (const [d, , dur] of S) { const k = d.getTime(); byDay.set(k, (byDay.get(k) || 0) + dur) }
  const ramp = ['#1B2326', '#3E3626', '#6E5A31', '#A98746', GOLD]
  const lvl = (m) => (m <= 0 ? 0 : m < 90 ? 1 : m < 150 ? 2 : m < 240 ? 3 : 4)
  const start = new Date(2025, 11, 29)
  let cells = '', labs = '', lastM = -1
  for (let i = 0; i < 53 * 7; i++) {
    const d = new Date(2025, 11, 29 + i)
    if (d.getFullYear() !== 2026) continue
    const col = Math.floor(i / 7), row = i % 7
    const future = d > new Date(2026, 10, 22)
    const m = byDay.get(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) || 0
    cells += `<rect x="${left + col * pitch}" y="${top + row * pitch}" width="${cell}" height="${cell}" rx="3" fill="${future ? 'none' : ramp[lvl(m)]}"${future ? ` stroke="rgba(233,228,216,.08)"` : ''}/>`
    if (row === 0 && d.getDate() <= 7 && d.getMonth() !== lastM) { labs += `<text x="${left + col * pitch}" y="15" fill="${DUST}" font-size="12.5">${d.toLocaleDateString('en-US', { month: 'short' })}</text>`; lastM = d.getMonth() }
  }
  ;['Mon', 'Wed', 'Fri'].forEach((s, k) => (labs += `<text x="0" y="${top + k * 2 * pitch + 16}" fill="${DUST}" font-size="12.5">${s}</text>`))
  const W = left + 53 * pitch - gap, H = top + 7 * pitch - gap
  return { ramp, html: `<svg class="ch" width="${W}" height="${H}">${labs}${cells}</svg>` }
}

export function extra({ bar, panel, chap, gr, link, scroll, ix }) {
  const out = {}

  /* ---------------- GAME STATS ---------------- */
  const gameTop = `<div class="sth"><h1>Stats</h1><div class="crumb"><a>Overview</a>${ix('chev', 16)}<b>Clair Obscur: Expedition 33</b></div>
    <div style="margin-left:auto;display:flex;gap:10px"><button class="btn">All games</button><button class="btn pri">${icf('play')}Open game</button></div></div>`

  const hero = `<section class="gh"><div class="hart">${bn('clair', true, false)}</div><div style="position:absolute;inset:0;z-index:1;background:radial-gradient(45% 100% at 80% 35%,rgba(216,174,90,.3),transparent 70%)"></div><div class="shade"></div>
    <div class="in"><div><h1>Clair Obscur: Expedition 33</h1><div class="fa">${chip('playing')}<span class="sep"></span><span>RPG, Turn-based</span><span class="sep"></span><span>PC</span><span class="sep"></span><span>1 playthrough</span><span class="sep"></span><span>14 sessions</span></div></div>
    <div class="rankb"><b>#19</b><span>of 331 games by playtime</span><br><span>0.9% of all your hours</span></div></div></section>`

  const figs = `<div class="gfig"><div><div class="k">38<small>h</small>10<small>m</small></div><div>Total hours on playthrough #1</div></div>
    <div class="gdl"><div><b>14</b><span>Sessions, 2h 44m average</span></div><div><b>€1.31</b><span>Cost per hour</span></div><div><b>€49.99</b><span>Spent</span></div></div></div>`

  const pts = []
  let cum = 0
  for (const [d, , dur] of S) { cum += dur / 60; pts.push([d, cum]) }
  const curve = C.runCurve({ W: 1448, H: 214, pts, mainH: 30, color: GOLD, ms: [[new Date(2026, 9, 10), '10 hours', 12.25], [new Date(2026, 9, 25), '25 hours', 25.83], [new Date(2026, 10, 7), 'Passed the Main estimate', 32.0, 'l']] })
  const journey = panel('Your journey', 'From first intent to the last session', `<div class="steps"><span>${dot('backlog')}Added to Plan, Jul 14</span><span>${dot('backlog')}Added to Afterplay, Sep 28</span><span>${dot('playing')}Started, Oct 3</span><span class="dust">Waited 5 days in the backlog</span><span class="dust">Last played yesterday</span></div>
    <div style="margin-top:6px">${curve}</div>
    <div class="hb" style="grid-template-columns:150px 1fr 240px;height:46px;border-top:1px solid var(--line);border-bottom:0;margin-top:2px"><span style="font-size:15px;font-weight:600">Every run<br><span class="dust" style="font-weight:400;font-size:13px">1 playthrough</span></span><div style="height:12px;background:var(--rai);border-radius:2px;position:relative"><i style="position:absolute;inset:0 0 0 0;background:${GOLD};border-radius:2px"></i></div><span style="text-align:right;font-size:14px"><b style="font-weight:600">Playthrough #1</b> · 38h 10m · €49.99<br><span class="dust" style="font-size:13px">Oct 3 to ongoing</span></span></div>`)

  /* firma */
  const shareRing = `<div class="shr"><div class="ring" style="background:conic-gradient(${AMB} ${0.009 * 360 * 10}deg,rgba(255,255,255,.08) 0)"><b>0.9%</b></div><div><h5>#19</h5><span>out of 331 games, by hours</span></div></div>`
  const vsLib = panel('Versus your library', 'The weight this game carries', `${shareRing}<div class="cmp"><div>Sessions here run <b>87m longer</b> than your library average</div><div>Mostly played on <b>Saturdays</b>, just like the rest of your library</div><div><b>1 in every 246</b> of your sessions is this game</div></div>`)
  const rec = (l, v, e) => `<div><span>${l}</span><b>${v}</b><em>${e}</em></div>`
  const records = panel('Session records', 'The peaks hidden in your playtime', `<div class="rt">${rec('Average length', '2h 44m', 'across 14 sessions')}${rec('Longest session', '4h 50m', 'Sat, Oct 10')}${rec('Biggest day', '4h 50m', 'Sat, Oct 10')}${rec('Longest streak', '2 days', 'Nov 20 to Nov 21')}${rec('Days played', '13 days', 'out of 51 since Oct 3')}${rec('Busiest month', '25h 50m', 'October 2026')}</div>`)

  const cab = (() => {
    const b = [['beaten', 'Beaten', '—', 'Complete the game at least once.', null, 0], ['centurion', 'Centurion', '38h', 'Reach 100 hours of total playtime.', 38, 0], ['marathoner', 'Marathoner', '4h 50m', 'Play a single session of 4 hours or more.', 100, 1], ['devoted', 'Devoted', '2 days', 'Play 7 days in a row.', 29, 0], ['regular', 'Regular', '14', 'Log 50 tracked sessions.', 28, 0], ['completionist', 'Completionist', '38h', 'Reach the 100% estimate, 62h.', 62, 0], ['night', 'Night Owl', '0%', '35% or more of your time starting between 22:00 and 06:00.', 0, 0], ['weekend', 'Weekend Warrior', '86%', '60% or more of your time on weekends.', 100, 1], ['free', 'Free Ride', '€49.99', '20+ hours without spending a cent.', null, 0]]
    return panel('Trophy cabinet', '<b>2 of 9</b> earned. Locked ones show how far you are', `<div class="bshelf slim">${b.map(([k, l, v, c, p, on]) => `<div class="bd ${on ? 'on' : 'off'}" style="color:${on ? AMB : '#56605F'}"><div class="bt1"><span class="mdl">${C.badgeIc(k, 22)}</span><b>${v}</b></div><span class="l" style="color:${on ? BONE : DUST}">${l}</span><span class="c">${c}</span>${p !== null ? `<div class="pbar"><i style="width:${p}%"></i></div>` : ''}</div>`).join('')}</div>`)
  })()

  /* ritmo */
  const hv = hod()
  const tod = panel('Time of day', 'Evening is your slot for this game', C.hourBars({ W: 716, H: 212, vals: hv, color: GOLD, peak: hv.indexOf(Math.max(...hv)), fmt: (m) => fm(m) }))
  const wd = wdays()
  const when = panel('When do you play it?', 'Saturdays, mostly', C.vbars({ W: 716, H: 212, labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], vals: wd.map((m) => m / 60), fmtv: (v) => (v === 0 ? '0h' : fh(v)), peak: 5, color: GOLD, bw: 54 }))

  const segs = Array.from({ length: 62 }, (_, i) => `<i class="${i < 38 ? 'f' : ''}" ${i === 38 ? `style="background:linear-gradient(90deg,var(--phos) 16%,var(--rai) 16%)"` : ''}></i>`).join('')
  const pos = (h) => `${((h / 62) * 100).toFixed(2)}%`
  const hltb = panel('How long to beat', '<b>8h 10m</b> past the Main estimate, <b>6h 50m</b> to +Extra, <b>23h 50m</b> to 100%. HowLongToBeat', `<div style="position:relative;height:30px"><span style="position:absolute;left:${pos(38.17)};bottom:0;transform:translateX(-50%);text-align:center;font-size:13px;color:var(--phos);white-space:nowrap;font-weight:600">You, 38h 10m <svg width="11" height="7" viewBox="0 0 12 8" style="vertical-align:middle"><path d="M0 0h12L6 8z" fill="${AMB}"/></svg></span></div>
    <div class="mt3" style="height:28px">${segs}</div>
    <div class="mk3" style="height:46px"><span class="t" style="left:${pos(30)}"><b>30h</b>Main</span><span style="left:${pos(45)}"><b>45h</b>+Extra</span><span class="r"><b>62h</b>100%</span></div>`)

  const gh = gameHeat()
  const heat = panel('Activity, this game', `<span class="yp">2026${ic('down')}</span>`, `${gh.html}<div class="hmleg" style="justify-content:flex-end;margin-top:10px">Less${gh.ramp.map((c) => `<i style="background:${c}"></i>`).join('')}More</div>`)

  const gameBody = `${link}<div class="sc">${gameTop}${hero}${figs}
    <div class="gr" style="margin-top:20px">${journey}</div>
    <div id="sig" style="scroll-margin-top:84px"></div>
    ${gr('600px 1fr', vsLib, records)}
    <div class="gr">${cab}</div>
    <div class="gr">${hltb}</div>
    ${chap('rhyc', 'Play rhythm', 'When, how often and for how long you return.')}
    ${gr('1fr 1fr', tod, when)}
    <div class="gr">${heat}</div><div style="height:70px"></div>
    </div>`
  out['stats-game'] = shell('Afterplay - Clair Obscur: Expedition 33 stats', 'Stats', gameBody + scroll(null))
  out['stats-game-signature'] = shell('Afterplay - Clair Obscur: Expedition 33 stats', 'Stats', gameBody + scroll('sig', 68))
  out['stats-game-rhythm'] = shell('Afterplay - Clair Obscur: Expedition 33 stats', 'Stats', gameBody + scroll('rhyc'))

  /* ---------------- JOURNEY ---------------- */
  const storyYear = `<div class="story"><div class="lab">${ix('book', 16)}The story of 2026</div><h3>The year you went deep</h3>
    <p>You spent 2026 settling into long runs. Hades pulled you back in March with a 98-hour month, Stardew Valley gave you a quiet autumn, and Clair Obscur: Expedition 33 has owned the last seven weeks. You finished 23 games, ten more than in 2025.</p>
    <ul><li>98h 10m in March, your busiest month</li><li>23 games finished</li><li>A 23-day streak that is still running</li></ul></div>`

  const covers = [['silk', '1h 12m', 'playing', ''], ['hades2', '22h 05m', 'playing', ''], ['balatro', '61h 30m', 'playing', '2'], ['split', '4h 45m', 'playing', ''], ['outer', '19h 10m', 'beaten', '2'], ['cocoon', '8h 20m', 'beaten', ''], ['well', '6h 40m', 'beaten', ''], ['celeste', '3h 05m', 'resting', ''], ['tunic', '2h 30m', 'dropped', '']]
  const hover = `<div class="hv"><div class="bn-w">${bn('celeste', false, false)}</div><div class="hb2"><div class="tt">Celeste</div><div class="dt">Nov 8, 2026 to Nov 15, 2026</div>
    <div class="fg"><div><b>3h 05m</b><span>played</span></div><div><b>3</b><span>sessions</span></div></div>
    <div class="trail"><i style="left:0"></i><i style="left:6%"></i><i style="left:44%"></i><i style="left:calc(100% - 10px)"></i></div>
    <div class="nt">Stopped at the summit of chapter 7. Back for the farewell levels soon.</div></div></div>`
  const covRow = `<div class="covs">${covers.map(([k, h, s, r], i) => `<div class="ci">${cv(k, { st: s })}${r ? `<b class="rep">${r}</b>` : ''}<div class="cap">${G[k].n}</div><div class="meta">${h}</div>${i === 7 ? hover : ''}</div>`).join('')}</div>`

  const nov = `<div class="jm" style="--st:${ST.playing}"><i class="nd" style="--st:${ST.playing}"></i>
    <div class="mh"><h3>November</h3><span><b>64h 10m</b> so far, 9 games, 31 sessions</span></div>
    <div class="cnt">${ix('bell', 22)}<div><b>Your month is counted.</b> November is still open, and its story is written on Dec 1.</div></div>
    <div class="feat"><div class="hart">${bn('clair', true, false)}</div><div class="shade"></div><div class="fi"><h4>Clair Obscur: Expedition 33</h4>
      <div class="m">${chip('playing')}<span>Playthrough 1, Oct 3 to ongoing</span></div></div>
      <div class="fr"><div><b>38h 10m</b><span>played</span></div><div><b>14</b><span>sessions</span></div></div></div>
    ${covRow}</div>`

  const oct = `<div class="jm" style="--st:${ST.resting}"><i class="nd" style="--st:${ST.resting}"></i>
    <div class="mh"><h3>October</h3><span><b>91h 00m</b>, 11 games, 58 sessions</span></div>
    <div class="story" style="margin-top:0"><div class="lab">${ix('book', 16)}The story of October</div><h3 style="font-size:30px">A farm, a fisherman and a lighthouse</h3><p>Stardew Valley took most of the month with its third playthrough, while Tunic and Dredge each got their ending.</p></div></div>`

  const idx = `<nav class="jidx"><a class="y on">2026</a>${['Nov', 'Oct', 'Sep', 'Aug', 'Jul', 'Jun', 'May', 'Apr', 'Mar', 'Feb', 'Jan'].map((m, i) => `<a class="${i === 0 ? 'on' : ''}">${m}</a>`).join('')}<a class="y" style="color:${DUST};border-color:var(--line)">2025</a><a class="y" style="color:${DUST};border-color:var(--line)">2024</a><a class="y" style="color:${DUST};border-color:var(--line)">2023</a><a class="y" style="color:${DUST};border-color:var(--line)">2022</a></nav>`

  const sums = `<div class="jsum"><div class="k"><b>47</b>games played</div><div><b>824h 10m</b>played</div><div><b>291</b>sessions</div></div>`
  const journeyBody = `${link}<div class="sc">${bar('jr', '', sums)}<div class="jw"><div style="position:relative">
    <div class="jyr"><h2>2026</h2><span><b>47 games</b>, 824h 10m</span><i></i></div>
    ${storyYear}${nov}${oct}</div>${idx}</div></div>
    <div class="toast"><span class="ti">${ix('book', 20)}</span><div><b>Your October story is ready</b><span>Open it in Journey</span></div>${ix('chev', 18)}</div>${scroll(null)}`
  out['stats-journey'] = shell('Afterplay - Stats, Journey', 'Stats', journeyBody)
  return out
}
