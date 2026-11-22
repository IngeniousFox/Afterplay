import { G, cv, ic, shell, write } from './lib.mjs'

/* ================= HOME ================= */
{
  const days = [['M', 95, '1h 35m'], ['T', 125, '2h 05m'], ['W', 0, '–'], ['T', 110, '1h 50m'], ['F', 140, '2h 20m'], ['S', 273, '4h 33m'], ['S', 117, '1h 57m']]
  const max = 273
  const bars = days.map(([d, m, l], i) => {
    const today = i === 6
    const h = Math.max(3, Math.round((m / max) * 150))
    return `<div class="wd"><div class="wb"><span class="wl ${today ? 'tod' : ''}">${l}</span><i style="height:${h}px;${m === 0 ? 'opacity:.35' : ''}" class="${today ? 'tod' : ''}"></i></div><span class="wn ${today ? 'tod' : ''}">${d}</span></div>`
  }).join('')
  const pick = [['hades2', '2 days ago', G.hades2.h, 'hades2'], ['exp33', 'Yesterday', G.exp33.h, 'exp33'], ['split', '3 days ago', G.split.h, 'split'], ['balatro', 'Today, 13:05', G.balatro.h, 'balatro']]
  const pickH = pick.map(([k, w, h]) => `<div class="game">${cv(k)}<div><div class="t">${G[k].t}</div><div class="s">Last played ${w.toLowerCase().replace('today, 13:05', 'today')} · ${h}</div></div></div>`).join('')
  const next = [['metaphor', '60h'], ['pentiment', '17h'], ['animal', '6h']].map(([k, h], i) => `<div class="nx"><span class="num serif">${i + 1}</span>${cv(k, { w: 44 })}<div class="nxt"><div class="t">${G[k].t}</div><div class="s g">How long to beat: ${h}</div></div></div>`).join('')
  const css = `
  .head{display:flex;align-items:baseline;justify-content:space-between;margin:2px 0 26px}
  .head h1{font:400 64px/1 var(--serif);letter-spacing:-.015em}
  .top{display:grid;grid-template-columns:1fr 380px;gap:20px}
  .np{padding:28px;display:flex;gap:30px}
  .np .info{display:flex;flex-direction:column;min-width:0;flex:1}
  .np .lab{display:flex;align-items:center;gap:10px;font-size:13px;font-weight:500;color:var(--graphite)}
  .np h2{font:400 40px/1.05 var(--serif);margin:12px 0 4px;letter-spacing:-.01em}
  .np .time{font:600 64px/1 var(--sans);color:var(--signal);letter-spacing:-.03em;margin:18px 0 20px}
  .np .row{display:flex;align-items:center;gap:14px}
  .note{margin-top:auto;padding-top:18px;border-top:1px solid var(--hair);font-size:14px;line-height:1.5;max-width:520px}
  .note span{color:var(--graphite);font-size:12px;display:block;margin-bottom:3px}
  .wk{padding:24px 26px;display:flex;flex-direction:column}
  .wk .tot{display:flex;align-items:baseline;gap:10px;margin:8px 0 22px}
  .wk .tot b{font:400 40px/1 var(--serif)}
  .wc{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;flex:1;align-items:end}
  .wd{display:flex;flex-direction:column;align-items:center;gap:7px}
  .wl{font-size:12px;color:var(--graphite);white-space:nowrap;margin-bottom:6px} .wl.tod,.wn.tod{color:var(--ink);font-weight:600}
  .wb{height:180px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end}
  .wb i{display:block;width:8px;border-radius:4px;background:var(--graphite);opacity:.55}
  .wb i.tod{background:var(--signal);opacity:1}
  .wn{font-size:12px;color:var(--graphite)}
  .low{display:grid;grid-template-columns:1fr 380px;gap:20px;margin-top:44px}
  .sh{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:16px}
  .pick{display:grid;grid-template-columns:repeat(4,1fr);gap:20px}
  .nx{display:flex;align-items:center;gap:14px;padding:12px 0;border-top:1px solid var(--hair)}
  .nx:last-child{border-bottom:1px solid var(--hair)}
  .nx .num{font-size:28px;width:24px;color:var(--graphite);line-height:1}
  .nx .t{font-size:15px;font-weight:600}.nx .s{font-size:13px;margin-top:2px}
  `
  const inner = `
  <div class="head"><h1>Sunday, 22 November</h1><span class="g t13">Week 47</span></div>
  <div class="top">
    <div class="panel np">
      ${cv('silksong', { w: 220, live: false })}
      <div class="info">
        <div class="lab"><span class="live"></span>Now playing · Desk PC · since 19:40</div>
        <h2>Hollow Knight: Silksong</h2>
        <div class="time">1:12:04</div>
        <div class="row"><button class="btn ink lg">${ic('stop')}Stop session</button><span class="g t13">24h 05m in total</span></div>
        <div class="note"><span>Last note · Friday</span>Skarrsinger Karmelita is a wall. Try the silk-skill build before the next attempt, and rest at the bench first.</div>
      </div>
    </div>
    <div class="panel wk">
      <div class="h18">This week</div>
      <div class="tot"><b>14h 20m</b><span class="g t13">9 sessions</span></div>
      <div class="wc">${bars}</div>
    </div>
  </div>
  <div class="low">
    <div><div class="sh"><span class="h18">Pick up where you left off</span><span class="link">See library</span></div><div class="pick">${pickH}</div></div>
    <div><div class="sh"><span class="h18">Up next</span><span class="link">Open plan</span></div>${next}</div>
  </div>`
  write('home.html', shell('today', inner, 'Afterplay - Today', css))
}

/* ================= LIBRARY ================= */
{
  const order = ['silksong', 'balatro', 'exp33', 'hades2', 'split', 'outer', 'celeste', 'disco', 'hk', 'hades', 'tunic', 'obra', 'sos', 'cocoon', 'inscr', 'dredge', 'lies', 'alan', 'bg3', 'cyber', 'stardew', 'sts', 'ori', 'ds', 'elden']
  const cells = order.map(k => `<div class="game">${cv(k, { live: k === 'silksong' })}<div><div class="t">${G[k].t}</div><div class="s">${G[k].h}</div></div></div>`).join('')
  const css = `
  .hd{display:flex;align-items:baseline;gap:14px;margin:2px 0 18px}
  .bar{display:flex;align-items:center;gap:12px;margin-bottom:26px}
  .grid8{display:grid;grid-template-columns:repeat(8,1fr);gap:26px 18px}
  `
  const inner = `
  <div class="hd"><h1 class="pt">Library</h1><span class="g">331 games</span></div>
  <div class="bar">
    <div class="field" style="width:260px">${ic('search')}Search your library</div>
    <div class="seg"><span class="on">All <em>331</em></span><span>Playing <em>5</em></span><span>Beaten <em>142</em></span><span>Backlog <em>96</em></span><span>Resting <em>61</em></span><span>Dropped <em>27</em></span></div>
    <div style="flex:1"></div>
    <div class="btn">Sort: Recently played${ic('chev')}</div>
    <div class="seg"><span class="on" style="padding:0 8px">${ic('grid')}</span><span style="padding:0 8px">${ic('list')}</span></div>
    <div class="btn">${ic('plus')}Add game</div>
  </div>
  <div class="grid8">${cells}</div>`
  write('library.html', shell('library', inner, 'Afterplay - Library', css))
}

/* ================= DETAIL ================= */
{
  const sessions = [['Sun 15 Nov', '21:10 – 23:25', '2h 15m', 'Desk PC'], ['Fri 13 Nov', '20:30 – 22:40', '2h 10m', 'Living room PC'], ['Wed 11 Nov', '22:05 – 23:15', '1h 10m', 'Desk PC']]
  const sessH = sessions.map(([d, t, l, dv]) => `<div class="sr"><span style="width:110px">${d}</span><span class="g" style="width:150px">${t}</span><span style="width:80px;font-weight:600">${l}</span><span class="g">${dv}</span></div>`).join('')
  const log = [['Oct 3', 'Started', 'Playthrough #1 begins. First expedition leaves Lumière.', 'done'], ['Oct 17', 'Act I cleared', '9h 40m in. Verso joins the party for good.', 'done'], ['Nov 2', 'Act II cleared', '27h 30m in. Sciel and Maelle are at full strength.', 'done'], ['Now', 'Act III in progress', '38h 10m so far. Expected to end near 45h.', 'cur']]
  const logH = log.map(([d, h, tx, s]) => `<div class="ms ${s}"><span class="md">${d}</span><span class="mk"></span><div><div style="font-weight:600;font-size:15px">${h}</div><div class="g" style="font-size:14px">${tx}</div></div></div>`).join('')
  const css = `
  .art{display:flex;gap:40px;padding:0 0 26px;border-bottom:1px solid var(--hair)}
  .art .meta{display:flex;flex-direction:column;justify-content:flex-end;padding-bottom:2px}
  .crumb{font-size:13px;color:var(--graphite);display:flex;align-items:center;gap:4px;margin-bottom:auto}
  .art h1{font:400 56px/1.02 var(--serif);letter-spacing:-.015em;max-width:860px}
  .ml{display:flex;align-items:center;gap:12px;margin:14px 0 24px;font-size:15px;color:var(--graphite)}
  .ml i{width:3px;height:3px;border-radius:50%;background:var(--graphite);display:block}
  .acts{display:flex;gap:10px}
  .cols{display:grid;grid-template-columns:1fr 340px;gap:56px;padding-top:22px}
  .sec{margin-bottom:20px}
  .sec .h18{margin-bottom:12px}
  .notes{font-size:15px;line-height:1.6;max-width:780px}
  .ms{display:grid;grid-template-columns:60px 22px 1fr;gap:0 10px;position:relative;padding-bottom:9px}
  .ms .md{font-size:13px;color:var(--graphite);padding-top:2px}
  .ms .mk{width:11px;height:11px;border-radius:50%;border:2px solid var(--graphite);background:var(--fog);margin:5px 0 0 3px;position:relative;z-index:1}
  .ms.done .mk{background:var(--moss);border-color:var(--moss)}
  .ms.cur .mk{background:var(--signal);border-color:var(--signal);box-shadow:0 0 0 4px color-mix(in srgb,var(--signal) 22%,transparent)}
  .ms:not(:last-child)::before{content:"";position:absolute;left:73px;top:18px;bottom:-4px;width:1px;background:var(--hair)}
  .sr{display:flex;gap:16px;padding:10px 0;border-top:1px solid var(--hair);font-size:14px}
  .dl{display:grid;grid-template-columns:130px 1fr;font-size:15px}
  .dl dt,.dl dd{padding:11px 0;border-top:1px solid var(--hair)}
  .dl dt{color:var(--graphite);font-size:14px}.dl dd{font-weight:500}
  .dl dd:last-of-type,.dl dt:last-of-type{border-bottom:1px solid var(--hair)}
  .rule{position:relative;height:64px;margin:14px 6px 0}
  .rule .ln{position:absolute;left:0;right:0;top:26px;height:2px;background:var(--hair);border-radius:1px}
  .rule .fill{position:absolute;left:0;top:26px;height:2px;background:var(--ink);border-radius:1px}
  .rule .tk{position:absolute;top:19px;width:1px;height:16px;background:var(--ink)}
  .rule .tl{position:absolute;top:40px;font-size:12px;color:var(--graphite);transform:translateX(-50%);white-space:nowrap;text-align:center;line-height:1.25}
  .rule .tl b{display:block;color:var(--ink);font-weight:600;font-size:13px}
  .rule .me{position:absolute;top:19px;width:14px;height:14px;margin-left:-7px;border-radius:50%;background:var(--signal);box-shadow:0 0 0 4px color-mix(in srgb,var(--signal) 22%,transparent)}
  .rule .ml2{position:absolute;top:-2px;transform:translateX(-50%);font-size:12px;font-weight:600;color:var(--signal);white-space:nowrap}
  `
  const pos = h => (h / 62) * 100
  const inner = `
  <div class="art">
    ${cv('exp33', { w: 216 })}
    <div class="meta">
      <div class="crumb">${ic('back')}Library</div>
      <h1>Clair Obscur: Expedition 33</h1>
      <div class="ml"><span class="pill moss" style="color:var(--slate);border-color:color-mix(in srgb,var(--slate) 40%,transparent)">Playing</span><span>RPG, Turn-based</span><i></i><span>PC</span><i></i><span>Released 2025</span></div>
      <div class="acts"><button class="btn signal lg">${ic('play')}Play</button><button class="btn lg">${ic('edit')}Edit</button><button class="btn lg">${ic('euro')}Add spend</button><button class="btn lg">More${ic('chev')}</button></div>
    </div>
  </div>
  <div class="cols">
    <div>
      <div class="sec"><div class="h18">Notes</div><p class="notes">Parry timing matters more than gear. Save the heavy skills for the second phase of every boss, and check each camp for new dialogue before heading out again. Music is carrying the whole run.</p></div>
      <div class="sec"><div class="h18" style="margin-bottom:16px">Playthrough #1</div>${logH}</div>
      <div class="sec"><div class="h18">Latest sessions</div>${sessH}</div>
    </div>
    <div>
      <div class="sec"><div class="h18">Facts</div>
        <dl class="dl"><dt>Hours</dt><dd>38h 10m</dd><dt>Sessions</dt><dd>14</dd><dt>Spent</dt><dd>€49.99</dd><dt>Cost per hour</dt><dd>€1.31</dd><dt>Installed on</dt><dd>Desk PC, Living room PC</dd></dl>
      </div>
      <div class="sec"><div class="h18">How long to beat</div>
        <div class="rule"><div class="ln"></div><div class="fill" style="width:${pos(38.17)}%"></div>
          <div class="tk" style="left:${pos(30)}%"></div><div class="tk" style="left:${pos(45)}%"></div><div class="tk" style="left:100%"></div>
          <div class="tl" style="left:${pos(30)}%"><b>30h</b>Main</div><div class="tl" style="left:${pos(45)}%"><b>45h</b>+ Extra</div><div class="tl" style="left:100%;transform:translateX(-85%);text-align:right"><b>62h</b>100%</div>
          <div class="me" style="left:${pos(38.17)}%"></div><div class="ml2" style="left:${pos(38.17)}%">You: 38h</div>
        </div>
      </div>
    </div>
  </div>`
  write('detail.html', shell('library', inner, 'Afterplay - Game', css))
}

/* ================= SESSIONS ================= */
{
  const D = [
    ['22', 'Sunday', [['19:40', 'now', 'silksong', 72, 'Desk PC', 'Reached the bell beast. Two tries left before bed.', true], ['13:05', '13:50', 'balatro', 45, 'Desk PC', '', false]]],
    ['21', 'Saturday', [['20:10', '22:45', 'exp33', 155, 'Desk PC', 'Finished the Act III boss in one go, finally.', false], ['15:30', '16:25', 'hades2', 55, 'Living room PC', '', false], ['11:00', '12:03', 'split', 63, 'Living room PC', 'Co-op chapter. Great set pieces.', false]]],
    ['20', 'Friday', [['21:00', '23:20', 'exp33', 140, 'Living room PC', 'Camp dialogue unlocked after the lighthouse.', false]]],
    ['19', 'Thursday', [['19:30', '21:20', 'balatro', 110, 'Phone timer', '', false]]],
    ['17', 'Tuesday', [['20:00', '22:05', 'split', 125, 'Living room PC', 'Started the second world.', false]]],
    ['16', 'Monday', [['21:15', '22:50', 'silksong', 95, 'Desk PC', '', false]]]
  ]
  const fmt = m => (m >= 60 ? Math.floor(m / 60) + 'h ' : '') + (m % 60 ? (m % 60) + 'm' : '').trim()
  const groups = D.map(([n, w, rows]) => `<div class="day"><div class="dd"><span class="serif">${n}</span><em>${w}</em></div><div class="rows">${rows.map(([a, b, k, m, dv, note, live]) => `
    <div class="sr2">
      <span class="tm">${a} – ${b === 'now' ? '<b style="color:var(--signal)">now</b>' : b}</span>
      ${cv(k, { w: 34 })}
      <span class="gn">${G[k].t}</span>
      <div class="dur"><div class="trk"><i style="width:${Math.round((m / 180) * 100)}%;${live ? 'background:var(--signal)' : ''}"></i></div><span>${fmt(m)}</span></div>
      <span class="dv g">${dv}</span>
      <span class="nt ${note ? '' : 'add'}">${note || '+ Add note'}</span>
    </div>`).join('')}</div></div>`).join('')
  const css = `
  .hd{display:flex;align-items:baseline;gap:18px;margin:2px 0 8px}
  .sum{font-size:15px;color:var(--graphite);margin-bottom:22px;padding-bottom:18px;border-bottom:1px solid var(--ink)}
  .sum b{color:var(--ink);font-weight:600}
  .day{display:grid;grid-template-columns:120px 1fr;border-bottom:1px solid var(--hair);padding:12px 0}
  .dd{display:flex;flex-direction:column;padding-top:2px}
  .dd span{font-size:46px;line-height:1}.dd em{font-style:normal;font-size:13px;color:var(--graphite);margin-top:4px}
  .sr2{display:grid;grid-template-columns:150px 34px 225px 1fr 130px 340px;align-items:center;gap:16px;min-height:58px;padding:3px 0}
  .sr2+.sr2{border-top:1px solid var(--hair2)}
  .sr2 .tm{font-size:14px;font-weight:500}
  .sr2 .gn{font-size:14px;font-weight:600;line-height:1.25}
  .dur{display:flex;align-items:center;gap:12px}
  .trk{flex:1;height:6px;border-radius:3px;background:var(--hair2);position:relative}
  .trk i{position:absolute;left:0;top:0;bottom:0;border-radius:3px;background:var(--ink)}
  .dur span{width:58px;font-size:14px;font-weight:600;text-align:right}
  .sr2 .dv{font-size:13px}
  .sr2 .nt{font-size:13px;line-height:1.35}
  .sr2 .nt.add{color:var(--graphite)}
  `
  const inner = `
  <div class="hd"><h1 class="pt">Sessions</h1></div>
  <div class="sum"><b>This week</b> · <b>14h 20m</b> across 9 sessions · 5 games · longest session 2h 35m</div>
  ${groups}`
  write('sessions.html', shell('sessions', inner, 'Afterplay - Sessions', css))
}

/* ================= PLAN ================= */
{
  const rows = [['pentiment', '17h'], ['animal', '6h'], ['lies', '32h'], ['octo', '40h']].map(([k, h], i) => `
   <div class="pr"><span class="grip"><i></i><i></i><i></i><i></i><i></i><i></i></span><span class="serif n">${i + 2}</span>${cv(k, { w: 40 })}<div class="pt2"><div class="t">${G[k].t}</div><div class="s g">How long to beat: ${h} main</div></div><span class="btn ghost" style="padding:0 8px;border-color:transparent">${ic('more')}</span></div>`).join('')
  const some = ['tunic', 'cocoon', 'dredge', 'inscr', 'sos', 'alan'].map(k => `<div class="sm">${cv(k, { w: 36 })}<div class="nm"><div class="t">${G[k].t}</div></div><span class="grip"><i></i><i></i><i></i><i></i><i></i><i></i></span></div>`).join('')
  const css = `
  .hd{display:flex;align-items:baseline;gap:14px;margin:2px 0 26px}
  .lay{display:grid;grid-template-columns:1fr 340px;gap:48px}
  .up{padding:28px;display:flex;gap:30px;align-items:stretch;border-color:var(--graphite)}
  .up .lab{display:flex;align-items:center;gap:10px}
  .up h2{font:400 40px/1.05 var(--serif);margin:10px 0 8px}
  .up .info{display:flex;flex-direction:column;flex:1}
  .up .cx{display:flex;gap:30px;margin:14px 0 22px}
  .up .cx div{font-size:13px;color:var(--graphite)}.up .cx b{display:block;font-size:24px;color:var(--ink);font-weight:500;letter-spacing:-.01em}
  .pr{display:flex;align-items:center;gap:16px;padding:12px 4px;border-bottom:1px solid var(--hair)}
  .pr .n{font-size:28px;width:26px;color:var(--graphite);line-height:1}
  .pr .pt2{flex:1}.pr .t{font-size:15px;font-weight:600}.pr .s{font-size:13px;margin-top:2px}
  .grip{grid-template-columns:repeat(2,3px);display:grid}
  .sm{display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid var(--hair);font-size:14px}
  .sm>.nm{flex:1}.sm .t{font-weight:600;font-size:14px}
  .som{padding:22px;background:transparent;border-style:dashed}
  `
  const inner = `
  <div class="hd"><h1 class="pt">Plan</h1><span class="g">5 games, in order</span></div>
  <div class="lay">
    <div>
      <div class="panel up">
        <span class="grip" style="align-self:flex-start;margin-top:4px"><i></i><i></i><i></i><i></i><i></i><i></i></span>
        ${cv('metaphor', { w: 200 })}
        <div class="info">
          <div class="lab"><span class="serif" style="font-size:44px;line-height:1;color:var(--signal)">1</span><span class="g" style="font-size:13px;font-weight:500">Up next</span></div>
          <h2>Metaphor: ReFantazio</h2>
          <div class="g" style="font-size:15px">RPG · PC · Released 2024</div>
          <div class="cx"><div><b>60h</b>How long to beat, Main</div><div><b>Backlog</b>Added 3 weeks ago</div></div>
          <div style="margin-top:auto;display:flex;gap:10px"><button class="btn signal lg">${ic('play')}Start playing</button><button class="btn lg">Move to someday</button></div>
        </div>
      </div>
      <div style="margin-top:8px">${rows}</div>
    </div>
    <div class="panel som">
      <div class="h18">Someday</div>
      <div class="g t13" style="margin:4px 0 12px;line-height:1.4">An unordered pile. Drag a game into the plan when you are ready to commit.</div>
      ${some}
    </div>
  </div>`
  write('plan.html', shell('plan', inner, 'Afterplay - Plan', css))
}

/* ================= SETTINGS ================= */
{
  const secs = [['Sync', 'sync'], ['Library', 'library'], ['Saves', 'save'], ['Emulators', 'pad'], ['Integrations', 'plug'], ['Backups', 'archive'], ['About', 'info']]
  const list = secs.map(([l, i]) => `<a class="${l === 'Sync' ? 'on' : ''}">${ic(i)}${l}</a>`).join('')
  const dev = [['Desk PC', 'pc', 'Windows 11 · Afterplay 2.0.0', 'Just now', true], ['Living room PC', 'pc', 'Windows 11 · Afterplay 2.0.0', '12 minutes ago', false], ['Phone', 'phone', 'Web app · version 2.0.0', '3 hours ago', false]]
  const devH = dev.map(([n, i, v, s, me]) => `<div class="dvr ${me ? 'me' : ''}"><span class="ico">${ic(i)}</span><div style="flex:1"><div style="font-weight:600;font-size:15px;display:flex;gap:10px;align-items:center">${n}${me ? '<span class="pill signal">This PC</span>' : ''}</div><div class="g t13">${v}</div></div><div class="g t13" style="text-align:right">Last signal<br><span style="color:var(--ink);font-weight:500">${s}</span></div><span class="btn ghost" style="padding:0 8px;border-color:transparent">${ic('more')}</span></div>`).join('')
  const css = `
  .hd{margin:2px 0 26px}
  .lay{display:grid;grid-template-columns:200px 1fr;gap:56px}
  .sl{display:flex;flex-direction:column;gap:2px}
  .sl a{display:flex;align-items:center;gap:11px;height:38px;padding:0 10px;border-radius:6px;font-size:15px;font-weight:500;color:var(--graphite);border:1px solid transparent}
  .sl a.on{background:var(--raised);border-color:var(--hair);color:var(--ink)}
  .box{max-width:1010px}
  .box h2{font:400 32px/1.1 var(--serif);margin-bottom:6px}
  .st{display:flex;align-items:center;gap:16px;padding:18px 20px;margin:18px 0 34px}
  .st .big{font-size:18px;font-weight:600}
  .dvr{display:flex;align-items:center;gap:16px;padding:16px 18px;border-top:1px solid var(--hair)}
  .dvr:first-of-type{border-top:0}
  .dvr .ico{width:38px;height:38px;border-radius:8px;border:1px solid var(--hair);display:grid;place-items:center;color:var(--graphite)}
  .dvr.me{background:color-mix(in srgb,var(--signal) 8%,var(--sheet));border-radius:10px 10px 0 0}
  .dvr.me .ico{color:var(--signal);border-color:color-mix(in srgb,var(--signal) 45%,transparent)}
  .add{display:flex;gap:28px;align-items:center;padding:22px 24px;margin-top:34px}
  .code{font:600 40px/1 var(--sans);letter-spacing:.06em;padding:12px 20px;border:1px dashed var(--ink);border-radius:8px}
  `
  const inner = `
  <div class="hd"><h1 class="pt">Settings</h1></div>
  <div class="lay">
    <nav class="sl">${list}</nav>
    <div class="box">
      <h2>Sync</h2>
      <div class="g" style="font-size:15px">Keep your library, sessions and plan the same on every device.</div>
      <div class="panel st"><span class="dot" style="width:10px;height:10px"></span><div style="flex:1"><div class="big">Up to date</div><div class="g t13">Hub reachable · last sync 2 minutes ago · nothing waiting to send</div></div><button class="btn">${ic('sync')}Sync now</button></div>
      <div class="h18" style="margin-bottom:12px">Devices <span class="g" style="font-weight:400;font-size:14px">· 3</span></div>
      <div class="panel" style="overflow:hidden">${devH}</div>
      <div class="panel add">
        <div style="flex:1"><div class="h18">Add a device</div><div class="g" style="font-size:14px;margin-top:4px;line-height:1.45;max-width:340px">Open Afterplay on the new device, choose Join and type this code. It works once.</div><div class="g t13" style="margin-top:10px">Expires in 09:42</div></div>
        <div class="code">K7QX-4MD2</div>
      </div>
    </div>
  </div>`
  write('settings.html', shell('settings', inner, 'Afterplay - Settings', css))
}
console.log('built')
