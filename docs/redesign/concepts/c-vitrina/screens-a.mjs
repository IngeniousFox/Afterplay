import { ic, cover, nav, ambient, page, G } from './lib.mjs';

// ======================= HOME =======================
export function home() {
  const sk = G.sk;
  const cont = [
    ['ba', '61h 30m', 'Today'], ['sf', '4h 45m', 'Yesterday'], ['ex', '38h 10m', '2 days ago'], ['hd', '22h 05m', '4 days ago'],
  ].map(([k, h, d]) => `<div class="col" style="width:263px;gap:10px">
      ${cover(k, 'b', { style: 'width:263px;border-radius:10px' })}
      <div class="row" style="justify-content:space-between;font-size:14px"><span style="font-weight:600">${h}</span><span class="muted">${d}</span></div></div>`).join('');
  const plan = [['mt', 'Metaphor: ReFantazio', 'Main 66h'], ['pen', 'Pentiment', 'Main 17h'], ['aw', 'Animal Well', 'Main 7h'], ['lop', 'Lies of P', 'Main 30h'], ['oct', 'Octopath Traveler II', 'Main 55h']]
    .map(([k, t, h], i) => `<div class="row" style="gap:12px;width:207px;align-items:flex-start">
      ${cover(k, 'p', { w: 66, title: false })}
      <div class="col" style="gap:3px;padding-top:2px"><span class="lbl" style="color:var(--text);font-weight:700">${i + 1}</span><span style="font-size:14px;font-weight:600;line-height:1.25">${t}</span><span class="lbl">${h}</span></div></div>`).join('');
  const days = [['Mon', 1.5], ['Tue', 2.2], ['Wed', 0], ['Thu', 3.1], ['Fri', 2.2], ['Sat', 3.4], ['Sun', 1.95]];
  const bars = days.map(([d, v], i) => `<div class="col" style="align-items:center;gap:8px;flex:1">
      <div style="height:88px;display:flex;align-items:flex-end"><div style="width:16px;height:${Math.max(v / 3.4 * 88, 4)}px;border-radius:8px;background:${v === 0 ? 'rgba(255,255,255,.12)' : 'var(--ac)'};opacity:${i === 6 ? 1 : v === 0 ? 1 : .55};${i === 6 ? 'box-shadow:0 0 18px color-mix(in srgb,var(--ac) 60%,transparent)' : ''}"></div></div>
      <span class="lbl" style="${i === 6 ? 'color:var(--text);font-weight:700' : ''}">${d}</span></div>`).join('');
  const top = [['ba', 'Balatro', '5h 40m', 100], ['ex', 'Clair Obscur: Expedition 33', '4h 05m', 72], ['sk', 'Hollow Knight: Silksong', '2h 30m', 44]]
    .map(([k, t, h, p]) => `<div class="row" style="gap:12px">${cover(k, 'p', { w: 30, title: false, style: 'border-radius:5px' })}
      <div class="col" style="flex:1;gap:6px"><div class="row" style="justify-content:space-between;font-size:13px"><span style="font-weight:600">${t}</span><span class="muted">${h}</span></div>
      <div class="bar"><span style="width:${p}%"></span></div></div></div>`).join('');

  const body = `
${ambient('sk')}
<div class="abs" style="left:0;right:0;top:0;height:530px;overflow:hidden;z-index:1;-webkit-mask-image:linear-gradient(#000 80%,transparent);mask-image:linear-gradient(#000 80%,transparent)">
  ${cover('sk', 'b', { title: false, style: 'position:absolute;left:0;top:-110px;width:1600px;border-radius:0' })}
  <div class="abs" style="inset:0;background:linear-gradient(to right,rgba(14,16,20,.85) 0%,rgba(14,16,20,.4) 46%,transparent 72%),linear-gradient(to top,rgba(14,16,20,.55),transparent 45%),linear-gradient(to bottom,rgba(14,16,20,.6),transparent 150px)"></div>
</div>
<div class="abs" style="left:0;right:0;top:0;height:504px;z-index:2">
  <div class="abs col" style="left:48px;bottom:40px;gap:14px">
    <div class="row" style="gap:10px"><span class="pulse"></span><span style="font-size:15px;font-weight:600">Playing now</span></div>
    <h1 class="disp" style="font-size:96px;line-height:.92;font-weight:700;font-stretch:88%;letter-spacing:-.02em;font-variation-settings:'wdth' 90">Hollow Knight:<br>Silksong</h1>
    <div class="row" style="gap:28px;margin-top:6px">
      <div class="row" style="gap:12px;align-items:baseline"><span class="disp num" style="font-size:34px;font-weight:700">1h 12m</span><span style="font-size:17px;color:#d6d7dc">on Desk PC, since 19:40</span></div>
      <div class="row" style="gap:10px">
        <span class="btn pri" style="height:46px">${ic('stop', 18)}Stop</span>
        <span class="btn tint lg" style="height:46px;border-radius:999px;font-size:15px">${ic('note', 18)}Add note</span>
      </div>
    </div>
  </div>
</div>
${nav('Home')}

<section class="abs" style="left:48px;top:532px;width:1100px;z-index:2">
  <div class="row" style="justify-content:space-between;margin-bottom:14px"><h2 class="h2" style="font-size:22px">Continue</h2>
    <div class="row" style="gap:8px"><span class="ib bg">${ic('chl', 18)}</span><span class="ib bg">${ic('chr', 18)}</span></div></div>
  <div class="row" style="gap:16px">${cont}</div>

  <div class="row" style="justify-content:space-between;margin:30px 0 14px"><h2 class="h2" style="font-size:22px">From your plan</h2><span class="row sub" style="gap:4px;color:#d5d6dc">Open plan ${ic('chr', 16)}</span></div>
  <div class="row" style="gap:16px;align-items:flex-start">${plan}</div>
</section>

<aside class="abs panel glass" style="left:1172px;top:532px;width:380px;height:452px;z-index:2;padding:22px;border-radius:16px">
  <div class="row" style="justify-content:space-between"><h3 style="margin:0">This week</h3><span class="sub">Nov 16 to 22</span></div>
  <div class="row" style="gap:14px;align-items:baseline;margin-top:8px"><span class="disp num" style="font-size:46px;font-weight:700;letter-spacing:-.03em;line-height:1">14h 20m</span></div>
  <div class="sub" style="margin-top:6px">9 sessions, 1h 35m more than last week</div>
  <div class="row" style="margin-top:14px;align-items:flex-end">${bars}</div>
  <div style="height:1px;background:var(--line);margin:14px 0 12px"></div>
  <div class="col" style="gap:12px">${top}</div>
</aside>`;
  return page({ title: 'Afterplay - Home', ac: sk.ac, on: sk.on, body });
}

// ======================= LIBRARY =======================
export function library() {
  const chip = (t, n, on, s) => `<span class="chip ${on ? 'on' : ''}">${s ? `<span class="dot" style="--s:var(--s-${s})"></span>` : ''}${t} <span class="n">${n}</span></span>`;
  const label = (t, sub, bold) => `<div class="col" style="gap:2px;margin-top:10px"><span style="font-size:14px;font-weight:${bold ? 700 : 600};line-height:1.25">${t}</span><span class="lbl">${sub}</span></div>`;
  const W = 201;
  const lifted = (k, t, sub) => `<div style="width:${W}px;position:relative;z-index:5">
      <div style="transform:translateY(-12px) scale(1.05);transform-origin:50% 100%;border-radius:10px;box-shadow:0 26px 44px rgba(0,0,0,.55),0 0 46px color-mix(in srgb,#3FBF8F 45%,transparent);position:relative">
        ${cover(k, 'p', { w: W })}
        <div class="abs" style="right:10px;top:10px;width:42px;height:42px;border-radius:50%;background:#3FBF8F;color:#04150f;display:grid;place-items:center;z-index:6;box-shadow:0 6px 18px rgba(0,0,0,.4)">${ic('play', 18)}</div>
      </div>
      <div style="margin-top:2px">${label(t, sub, true)}</div></div>`;
  const cell = (k, sub) => `<div style="width:${W}px">${cover(k, 'p', { w: W })}${label(G[k].t, sub)}</div>`;
  const shelf = (name, st, count, cells, tail = '') => `<section style="margin-bottom:26px">
      <div class="row" style="justify-content:space-between;margin-bottom:14px"><div class="row" style="gap:12px"><span class="dot" style="--s:var(--s-${st});width:10px;height:10px"></span><h2 class="h2" style="font-size:22px">${name}</h2><span class="muted" style="font-size:15px">${count}</span></div>
      <span class="row sub" style="gap:4px;color:#d5d6dc">See all ${ic('chr', 16)}</span></div>
      <div class="row" style="gap:16px;align-items:flex-start">${cells}${tail}</div></section>`;
  const playing = [cell('sk', '19h 48m'), cell('ex', '38h 10m'), lifted('hd', 'Hades II', '22h 05m'), cell('ba', '61h 30m'), cell('sf', '4h 45m')].join('');
  const addTile = `<div class="col" style="width:${W * 2 + 16}px;height:${W * 4 / 3}px;border:1.5px dashed rgba(255,255,255,.2);border-radius:10px;align-items:center;justify-content:center;gap:12px;color:var(--muted)">
      <span class="ib bg" style="width:48px;height:48px;color:var(--text)">${ic('plus', 22)}</span><span style="font-size:15px;font-weight:600;color:var(--text)">Add a game</span><span class="sub">Scan a folder or search by name</span></div>`;
  const backlog = ['pen', 'aw', 'lop', 'oct', 'mt', 'coc', 'dre'].map((k) => cell(k, { mt: '66h to beat', pen: '17h to beat', aw: '7h to beat', lop: '30h to beat', oct: '55h to beat', coc: '6h to beat', dre: '10h to beat' }[k])).join('');
  const beaten = ['ow', 'cel', 'dis', 'hk', 'h1', 'tun', 'obra'].map((k) => cell(k, 'Beaten')).join('');
  const body = `
${ambient('hd')}
${nav('Library')}
<div class="abs" style="left:48px;right:48px;top:92px;z-index:2">
  <div class="row" style="justify-content:space-between">
    <div class="row" style="gap:14px;align-items:baseline"><h1 class="disp" style="font-size:42px;font-weight:700;letter-spacing:-.03em">Library</h1><span class="muted" style="font-size:16px">331 games</span></div>
    <div class="row" style="gap:10px">
      <span class="btn">${ic('filter', 17)}Recently played ${ic('chd', 16)}</span>
      <div class="row" style="padding:3px;border-radius:12px;background:var(--surface);border:1px solid var(--line)"><span class="ib" style="width:34px;height:32px;border-radius:9px;background:rgba(255,255,255,.14);color:var(--text)">${ic('grid', 17)}</span><span class="ib" style="width:34px;height:32px">${ic('list', 17)}</span></div>
      <span class="btn pri" style="height:42px">${ic('plus', 17)}Add game</span>
    </div>
  </div>
  <div class="row" style="gap:8px;margin:18px 0 26px">
    ${chip('All', 331, true)}${chip('Playing', 5, false, 'playing')}${chip('Backlog', 96, false, 'backlog')}${chip('Beaten', 142, false, 'beaten')}${chip('Resting', 61, false, 'resting')}${chip('Dropped', 27, false, 'dropped')}
    <span style="width:1px;height:22px;background:var(--line);margin:0 6px"></span>
    <span class="chip">Genre ${ic('chd', 14)}</span><span class="chip">Platform ${ic('chd', 14)}</span><span class="chip">Device ${ic('chd', 14)}</span>
  </div>
  ${shelf('Playing', 'playing', 5, playing, addTile)}
  ${shelf('Backlog', 'backlog', 96, backlog)}
  ${shelf('Beaten', 'beaten', 142, beaten)}
</div>`;
  return page({ title: 'Afterplay - Library', ac: '#3FBF8F', on: '#04150f', body });
}

// ======================= DETAIL =======================
export function detail() {
  const ex = G.ex;
  const stat = (v, l) => `<div class="col" style="gap:4px"><span class="disp num" style="font-size:25px;font-weight:700;letter-spacing:-.02em">${v}</span><span class="lbl">${l}</span></div>`;
  const shot = (ml, mt, hue) => `<div style="width:168px;height:94px;overflow:hidden;border-radius:8px;flex:none;position:relative"><div class="cv b nt g-exp" style="position:absolute;width:420px;left:${ml}px;top:${mt}px;border-radius:0;filter:hue-rotate(${hue}deg) saturate(1.1)"><i></i></div></div>`;
  const hl = (x, label, v) => `<div class="abs col" style="left:${x}%;top:34px;transform:translateX(-50%);align-items:center;gap:1px"><span style="width:1px;height:8px;background:var(--muted)"></span><span class="lbl" style="color:var(--text);font-weight:600;white-space:nowrap">${v}</span><span class="lbl" style="white-space:nowrap">${label}</span></div>`;
  const body = `
<div class="abs" style="left:0;right:0;top:0;height:560px;overflow:hidden;background:#0b0e14">
  <div class="abs" style="left:180px;top:-240px;width:1600px;-webkit-mask-image:linear-gradient(to right,transparent,#000 30%);mask-image:linear-gradient(to right,transparent,#000 30%)">${cover('ex', 'b', { title: false, style: 'width:1600px;border-radius:0' })}</div>
  <div class="abs" style="inset:0;background:linear-gradient(to top,#15171c 0%,rgba(21,23,28,.8) 22%,rgba(21,23,28,0) 62%),linear-gradient(to right,rgba(14,16,20,.65),transparent 55%),linear-gradient(to bottom,rgba(14,16,20,.6),transparent 140px)"></div>
</div>
${nav('Library')}
<div class="abs" style="left:64px;top:324px;z-index:3">
  <div style="border-radius:12px;box-shadow:0 30px 60px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.14),0 0 80px color-mix(in srgb,var(--ac) 25%,transparent)">${cover('ex', 'p', { w: 232, style: 'border-radius:12px' })}</div>
</div>
<div class="abs col" style="left:332px;top:394px;z-index:3;gap:12px;width:1200px">
  <div class="row" style="gap:12px;font-size:14px"><span class="st playing">Playing</span><span class="muted">RPG, Turn-based</span><span class="muted">PC</span><span class="muted">2025</span></div>
  <h1 class="disp" style="font-size:62px;font-weight:700;line-height:1;letter-spacing:-.03em;font-variation-settings:'wdth' 90">Clair Obscur: Expedition 33</h1>
  <div class="row" style="gap:10px;margin-top:10px">
    <span class="btn pri lg" style="height:52px;font-size:16px">${ic('play', 18)}Play on Desk PC</span>
    <span class="btn glass lg" style="height:52px;border-radius:14px">${ic('note', 18)}Add note</span>
    <span class="btn glass lg" style="height:52px;border-radius:14px"><span class="dot" style="--s:var(--s-playing)"></span>Playing ${ic('chd', 15)}</span>
    <span class="ib bg" style="width:52px;height:52px;border-radius:14px;background:rgba(14,16,20,.45)">${ic('dots', 20)}</span>
  </div>
</div>

<div class="abs" style="left:64px;right:64px;top:660px;display:grid;grid-template-columns:repeat(3,1fr);gap:16px;z-index:3">
  <div class="panel" style="height:150px"><h3>Key figures</h3>
    <div class="row" style="justify-content:space-between">${stat('38h 10m', 'Played')}${stat('14', 'Sessions')}${stat('€49.99', 'Spent')}${stat('€1.31', 'Per hour')}</div></div>
  <div class="panel" style="height:150px"><h3>How long to beat</h3>
    <div style="position:relative;margin:0 6px;height:74px">
      <span class="abs num" style="left:54.5%;top:0;transform:translateX(-50%);font-size:13px;font-weight:700;white-space:nowrap">38h 10m</span>
      <div style="position:absolute;left:0;right:0;top:26px;height:10px;border-radius:6px;background:rgba(255,255,255,.1)">
        <span style="position:absolute;left:0;top:0;bottom:0;width:54.5%;border-radius:6px;background:var(--ac)"></span>
        <span style="position:absolute;left:54.5%;top:-4px;width:4px;height:18px;margin-left:-2px;border-radius:2px;background:#fff;box-shadow:0 0 12px var(--ac)"></span></div>
      ${[[42.9, 'Main', '30h'], [64.3, '+Extra', '45h'], [88.6, '100%', '62h']].map(([x, l, v]) => `<span class="abs" style="left:${x}%;top:46px;transform:translateX(-50%);font-size:13px;white-space:nowrap"><b style="font-weight:600">${l}</b> <span class="muted">${v}</span></span><span class="abs" style="left:${x}%;top:38px;width:1px;height:6px;background:var(--muted)"></span>`).join('')}
    </div>
  </div>
  <div class="panel" style="height:150px"><h3>Playthrough</h3>
    <div class="row" style="justify-content:space-between;align-items:flex-end">
      <div class="col" style="gap:4px"><span class="disp" style="font-size:25px;font-weight:700">#1 in progress</span><span class="sub">Started Oct 3, 2026, 50 days ago</span></div>
      <div class="row" style="gap:5px;align-items:flex-end;height:56px">${[.4, .7, .5, .9, 1, .6, .8, .35].map((v) => `<span style="width:10px;height:${v * 56}px;border-radius:5px;background:var(--ac);opacity:${.35 + v * .5}"></span>`).join('')}</div>
    </div>
  </div>
</div>
<div class="abs" style="left:64px;right:64px;top:826px;display:grid;grid-template-columns:repeat(3,1fr);gap:16px;z-index:3">
  <div class="panel" style="height:156px"><h3>Installed on</h3>
    <div class="col" style="gap:12px">
      <div class="row" style="gap:12px"><span class="ib bg" style="width:34px;height:34px;border-radius:10px;color:var(--text)">${ic('pc', 18)}</span><div class="col" style="flex:1"><span style="font-weight:600;font-size:14px">Desk PC <span class="muted" style="font-weight:500">this PC</span></span><span class="lbl">112 GB, up to date</span></div></div>
      <div class="row" style="gap:12px"><span class="ib bg" style="width:34px;height:34px;border-radius:10px;color:var(--text)">${ic('tv', 18)}</span><div class="col" style="flex:1"><span style="font-weight:600;font-size:14px">Living room PC</span><span class="lbl">Last played 2 days ago</span></div></div>
    </div></div>
  <div class="panel" style="height:156px"><h3>Notes</h3>
    <p style="font-size:14px;line-height:1.5;color:#d9dae0">Act 2: counter with Verso before swapping to Maelle. Upgrade picto slots before the Flying Manor, the optional boss is easier with a shield build.</p>
    <span class="lbl" style="display:block;margin-top:8px">Edited Nov 20</span></div>
  <div class="panel" style="height:156px;padding-right:0;overflow:hidden"><div class="row" style="justify-content:space-between;padding-right:20px"><h3>Screenshots</h3><span class="sub" style="margin-top:-14px">12</span></div>
    <div class="row" style="gap:10px">${shot(-40, -40, -8)}${shot(-190, -90, 10)}${shot(-100, -140, 24)}${shot(-10, -60, -20)}</div></div>
</div>`;
  return page({ title: 'Afterplay - Expedition 33', ac: ex.ac, on: ex.on, body });
}
