import { G, cv, ic, head, write } from './lib.mjs'

const art = (k, extra = '') => cv(k, { wide: true, style: extra }).replace(/<b>.*?<\/b>/, '')
const grip = '<span class="grip"><i></i><i></i><i></i><i></i><i></i><i></i></span>'

/* ================= TV ================= */
{
  const shelf = ['silksong', 'exp33', 'hades2', 'balatro', 'split', 'outer', 'celeste', 'disco']
  const items = shelf.map((k, i) => {
    const f = i === 1
    return `<div class="it ${f ? 'foc' : ''}">${cv(k, { w: f ? 232 : 196, live: k === 'silksong' })}</div>`
  }).join('')
  const hint = (l, t) => `<span class="h"><i>${l}</i>${t}</span>`
  const css = `
  body{width:1920px;height:1080px;position:relative;overflow:hidden}
  .bg{position:absolute;inset:0}
  .bg .cv{width:1920px;height:1080px;border-radius:0;box-shadow:none;aspect-ratio:auto}
  .bg::before{content:"";position:absolute;inset:0;z-index:5;background:linear-gradient(90deg,rgba(15,21,28,.94) 0,rgba(15,21,28,.8) 40%,rgba(15,21,28,.15) 80%),linear-gradient(0deg,#0F151C 0,rgba(15,21,28,.92) 26%,transparent 55%)}
  .top{position:absolute;z-index:10;left:88px;right:88px;top:50px;display:flex;align-items:center;gap:48px}
  .top .logo{padding:0;font-size:40px}
  .top .tabs{display:flex;gap:6px}
  .top .tabs span{height:46px;padding:0 24px;display:flex;align-items:center;font-size:22px;font-weight:500;color:var(--graphite);border-radius:23px}
  .top .tabs span.on{background:var(--sheet);color:var(--ink);box-shadow:0 0 0 1px var(--hair)}
  .top .clk{margin-left:auto;font-size:26px;font-weight:500;display:flex;gap:26px;align-items:center}
  .top .clk .ic{width:30px;height:30px}
  .hero{position:absolute;z-index:10;left:88px;top:130px;width:1150px}
  .hero .m{display:flex;align-items:center;gap:18px;font-size:26px;color:#C9D2DB;margin-bottom:12px}
  .hero .m i{width:5px;height:5px;border-radius:50%;background:currentColor;display:block;opacity:.7}
  .hero h1{font:400 156px/.92 var(--serif);letter-spacing:-.02em;color:#F2F4F6}
  .hero .btns{display:flex;gap:20px;margin-top:36px}
  .big{height:68px;padding:0 36px;border-radius:10px;font-size:28px;font-weight:600;display:inline-flex;align-items:center;gap:14px;border:1px solid var(--hair)}
  .big .ic{width:26px;height:26px}
  .big.signal{background:var(--signal);color:#0F151C;border-color:var(--signal)}
  .big.d{background:rgba(247,248,248,.08);color:var(--ink)}
  .shelf{position:absolute;z-index:10;left:88px;right:0;top:598px}
  .shelf .lb{font-size:26px;font-weight:600;margin-bottom:14px;display:flex;gap:16px;align-items:baseline}
  .shelf .lb span{font-size:22px;color:var(--graphite);font-weight:400}
  .row{display:flex;gap:30px;align-items:center;height:330px}
  .it{position:relative;flex:none}
  .it .cv{border-radius:6px;box-shadow:0 0 0 1px rgba(255,255,255,.1)}
  .it:not(.foc){opacity:.82}
  .it.foc .cv{outline:6px solid var(--signal);outline-offset:6px;border-radius:6px;box-shadow:0 0 0 1px #000,0 24px 60px rgba(228,87,46,.35)}
  .fl{position:absolute;left:0;top:100%;margin-top:22px;font-size:22px;font-weight:600;white-space:nowrap}
  .hints{position:absolute;z-index:10;left:88px;right:88px;bottom:34px;display:flex;gap:40px;font-size:22px;color:var(--graphite);align-items:center}
  .hints .h{display:flex;align-items:center;gap:12px}
  .hints i{width:34px;height:34px;border-radius:50%;border:2px solid var(--graphite);display:grid;place-items:center;font-style:normal;font-size:18px;font-weight:600;color:var(--ink)}
  `
  const html = head('Afterplay - TV', css) + `<body class="night">
  <div class="bg">${art('exp33')}</div>
  <div class="top"><div class="logo">Afterplay<i></i></div><div class="tabs"><span class="on">Home</span><span>Library</span><span>Plan</span><span>Sessions</span></div>
    <div class="clk"><span style="font-size:22px;color:#E6EAEE">Desk PC</span>${ic('pad')}<span>21:14</span></div></div>
  <div class="hero">
    <div class="m"><span>Playing</span><i></i><span>38h 10m played</span><i></i><span>Last played yesterday</span></div>
    <h1>Clair Obscur:<br>Expedition 33</h1>
    <div class="btns"><span class="big signal">${ic('play')}Play</span><span class="big d">Details</span></div>
  </div>
  <div class="shelf"><div class="lb">Continue playing<span>5 games</span></div><div class="row">${items}</div></div>
  <div class="hints">${hint('A', 'Play')}${hint('B', 'Back')}${hint('X', 'Add note')}${hint('Y', 'Plan')}<span style="margin-left:auto" class="h"><span class="dot"></span>Up to date</span></div>
  </body></html>`
  write('tv.html', html)
}

/* ================= PWA ================= */
{
  const tabs = (on) => `<div class="tabs">${[['today', 'Today'], ['library', 'Library'], ['plan', 'Plan'], ['sessions', 'Sessions']].map(([k, l]) => `<span class="${on === k ? 'on' : ''}">${ic(k)}${l}</span>`).join('')}</div>`
  const phone = (on, body, label) => `<div class="col"><div class="ph"><div class="scr"><div class="sb"><span>9:41</span><span class="g">${ic('sync')}</span></div><div class="ct">${body}</div>${tabs(on)}</div></div><div class="cap">${label}</div></div>`

  const wk = [95, 125, 0, 110, 140, 273, 117].map((m, i) => `<div class="mb"><i style="height:${Math.max(3, Math.round(m / 273 * 44))}px" class="${i === 6 ? 'tod' : ''}"></i><span>${'MTWTFSS'[i]}</span></div>`).join('')
  const s1 = `
   <h1 class="d" style="font-size:32px;white-space:nowrap">Sunday, 22 November</h1>
   <div class="panel run"><div class="lab"><span class="live"></span>Now playing · Desk PC</div>
     <div class="rr">${cv('silksong', { w: 64 })}<div><div class="serif" style="font-size:25px;line-height:1.05">Hollow Knight: Silksong</div></div></div>
     <div class="tmr">1:12:04</div><button class="btn ink" style="width:100%;height:46px;justify-content:center;font-size:15px">${ic('stop')}Stop session</button></div>
   <div class="panel wk2"><div><div class="h18" style="font-size:15px">This week</div><div class="serif" style="font-size:30px;line-height:1.1">14h 20m</div><div class="g">9 sessions</div></div><div class="mini">${wk}</div></div>
   <div class="h18 sec">Up next</div>
   ${[['metaphor', '60h'], ['pentiment', '17h']].map(([k, h], i) => `<div class="lr"><span class="serif nn">${i + 1}</span>${cv(k, { w: 38 })}<div><div class="t">${G[k].t}</div><div class="s">${h} to beat</div></div></div>`).join('')}`

  const lib = [['silksong', 'Playing'], ['balatro', 'Playing'], ['exp33', 'Playing'], ['hades2', 'Playing'], ['split', 'Playing'], ['outer', 'Beaten'], ['celeste', 'Beaten'], ['disco', 'Beaten'], ['hk', 'Beaten']]
  const s2 = `<h1 class="d" style="font-size:36px">Library</h1>
   <div class="field" style="height:42px;margin-bottom:12px">${ic('search')}Search 331 games</div>
   <div class="chips"><span class="on">All 331</span><span>Playing 5</span><span>Beaten 142</span><span>Backlog 96</span></div>
   ${lib.map(([k, st]) => `<div class="lr big2">${cv(k, { w: 46, live: k === 'silksong' })}<div style="flex:1"><div class="t">${G[k].t}</div><div class="s">${G[k].h} · ${st}</div></div></div>`).join('')}`

  const s3 = `<div class="g" style="display:flex;align-items:center;gap:4px;font-size:14px;margin-bottom:14px">${ic('back')}Library</div>
   <div style="display:flex;gap:16px">${cv('exp33', { w: 118 })}<div style="display:flex;flex-direction:column;justify-content:flex-end"><h1 class="serif" style="font-size:31px;line-height:1.02;margin-bottom:10px;font-weight:400">Clair Obscur: Expedition 33</h1><div><span class="pill slate">Playing</span></div></div></div>
   <div class="g" style="font-size:14px;margin:12px 0 14px">RPG, Turn-based · PC · 2025</div>
   <button class="btn signal" style="width:100%;height:48px;justify-content:center;font-size:16px">${ic('play')}Play</button>
   <dl class="fx"><div><dt>Hours</dt><dd>38h 10m</dd></div><div><dt>Sessions</dt><dd>14</dd></div><div><dt>Spent</dt><dd>€49.99</dd></div><div><dt>Per hour</dt><dd>€1.31</dd></div></dl>
   <div class="h18 sec" style="font-size:15px">How long to beat</div>
   <div class="rule"><div class="ln"></div><div class="fill" style="width:61.5%"></div><div class="tk" style="left:48.4%"></div><div class="tk" style="left:72.6%"></div><div class="tk" style="left:100%"></div><div class="me" style="left:61.5%"></div>
     <div class="tl" style="left:48.4%"><b>30h</b>Main</div><div class="tl" style="left:72.6%"><b>45h</b>+ Extra</div><div class="tl" style="left:97%"><b>62h</b>100%</div></div>
   <div class="g" style="font-size:14px;margin-top:30px;line-height:1.5"><b style="color:var(--ink);font-weight:600">Installed on</b><br>Desk PC, Living room PC</div>`

  const s4 = `<h1 class="d" style="font-size:36px">Plan</h1><div class="g" style="margin:-4px 0 14px;font-size:14px">5 games, in order</div>
   <div class="panel upn">${cv('metaphor', { w: 84 })}<div style="flex:1"><div style="display:flex;gap:8px;align-items:baseline"><span class="serif" style="font-size:30px;line-height:1;color:var(--signal)">1</span><span class="g" style="font-size:13px">Up next</span></div><div class="serif" style="font-size:24px;line-height:1.05;margin:4px 0 4px">Metaphor: ReFantazio</div><div class="g" style="font-size:13px">60h to beat</div></div></div>
   <button class="btn signal" style="width:100%;height:46px;justify-content:center;font-size:15px;margin:12px 0 8px">${ic('play')}Start playing</button>
   ${[['pentiment', '17h'], ['animal', '6h'], ['lies', '32h'], ['octo', '40h']].map(([k, h], i) => `<div class="lr">${grip}<span class="serif nn">${i + 2}</span>${cv(k, { w: 38 })}<div><div class="t">${G[k].t}</div><div class="s">${h} to beat</div></div></div>`).join('')}
   <div class="g" style="margin-top:14px;font-size:14px;display:flex;justify-content:space-between"><span>Someday · 6 games</span>${ic('chev')}</div>`

  const css = `
  body{width:1920px;height:1100px;display:flex;justify-content:center;align-items:center;gap:96px;background:var(--fog)}
  .col{display:flex;flex-direction:column;align-items:center;gap:22px}
  .cap{font-size:16px;font-weight:500;color:var(--graphite)}
  .ph{width:384px;height:800px;border-radius:50px;background:#05080C;padding:12px;box-shadow:0 0 0 1px rgba(230,234,238,.22)}
  .scr{width:360px;height:776px;border-radius:40px;background:var(--fog);overflow:hidden;display:flex;flex-direction:column;position:relative}
  .sb{height:44px;flex:none;display:flex;justify-content:space-between;align-items:flex-end;padding:0 28px 6px;font-size:14px;font-weight:600}
  .sb .ic{width:15px;height:15px}
  .ct{flex:1;min-height:0;overflow:hidden;padding:10px 20px 0}
  .tabs{height:78px;flex:none;border-top:1px solid var(--hair);background:var(--sheet);display:grid;grid-template-columns:repeat(4,1fr);padding:8px 6px 0}
  .tabs span{display:flex;flex-direction:column;align-items:center;gap:4px;font-size:13px;font-weight:500;color:var(--graphite)}
  .tabs span.on{color:var(--ink)} .tabs span.on .ic{color:var(--signal)}
  h1.d{font:400 38px/1 var(--serif);letter-spacing:-.015em;margin:4px 0 16px}
  .run{padding:16px;margin-bottom:12px}
  .lab{display:flex;align-items:center;gap:9px;font-size:13px;color:var(--graphite);font-weight:500}
  .rr{display:flex;gap:14px;align-items:center;margin:12px 0 4px}
  .tmr{font:600 52px/1 var(--sans);color:var(--signal);letter-spacing:-.03em;margin:10px 0 16px}
  .wk2{padding:14px 16px;display:flex;justify-content:space-between;align-items:flex-end}
  .mini{display:flex;gap:7px;align-items:flex-end;height:70px}
  .mb{display:flex;flex-direction:column;align-items:center;gap:5px;justify-content:flex-end;height:70px;font-size:12px;color:var(--graphite)}
  .mb i{display:block;width:7px;border-radius:3.5px;background:var(--graphite);opacity:.55}.mb i.tod{background:var(--signal);opacity:1}
  .sec{margin:18px 0 6px}
  .lr{display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--hair)}
  .lr .t{font-size:15px;font-weight:600;line-height:1.25}.lr .s{font-size:13px;color:var(--graphite)}
  .lr .nn{font-size:26px;width:22px;color:var(--graphite);line-height:1}
  .lr.big2{padding:9px 0}
  .chips{display:flex;gap:8px;margin-bottom:6px;overflow:hidden}
  .chips span{height:34px;padding:0 14px;display:flex;align-items:center;border-radius:17px;border:1px solid var(--hair);font-size:13px;font-weight:500;color:var(--graphite);white-space:nowrap;background:var(--sheet)}
  .chips span.on{background:var(--ink);color:var(--fog);border-color:var(--ink)}
  .fx{display:grid;grid-template-columns:1fr 1fr;margin:16px 0 0;border-top:1px solid var(--hair)}
  .fx div{padding:9px 0;border-bottom:1px solid var(--hair)}.fx div:nth-child(odd){padding-right:12px}
  .fx dt{font-size:13px;color:var(--graphite)}.fx dd{font-size:20px;font-weight:600;letter-spacing:-.01em}
  .upn{padding:14px;display:flex;gap:14px;border-color:var(--graphite)}
  .rule{position:relative;height:60px;margin:14px 6px 0}
  .rule .ln{position:absolute;left:0;right:0;top:22px;height:2px;background:var(--hair)}
  .rule .fill{position:absolute;left:0;top:22px;height:2px;background:var(--ink)}
  .rule .tk{position:absolute;top:16px;width:1px;height:14px;background:var(--ink)}
  .rule .tl{position:absolute;top:34px;font-size:13px;color:var(--graphite);transform:translateX(-50%);text-align:center;white-space:nowrap;line-height:1.2}
  .rule .tl b{display:block;color:var(--ink);font-size:13px}
  .rule .me{position:absolute;top:15px;width:14px;height:14px;margin-left:-7px;border-radius:50%;background:var(--signal);box-shadow:0 0 0 4px color-mix(in srgb,var(--signal) 22%,transparent)}
  `
  write('pwa.html', head('Afterplay - Mobile', css) + `<body>${phone('today', s1, 'Today')}${phone('library', s2, 'Library')}${phone('library', s3, 'Game')}${phone('plan', s4, 'Plan')}</body></html>`)
}
console.log('built2')
