import { ic, cover, page, G } from './lib.mjs';

// ======================= TV =======================
export function tv() {
  const ex = G.ex;
  const glyph = (t, bg, fg = '#fff') => `<span style="width:34px;height:34px;border-radius:50%;background:${bg};color:${fg};display:grid;place-items:center;font:800 17px var(--ui)">${t}</span>`;
  const item = (k, focus, badge) => {
    const w = focus ? 216 : 164;
    return `<div style="position:relative;width:${w}px;flex:none;${focus ? 'z-index:3' : 'opacity:.78'}">
      <div style="border-radius:14px;${focus ? 'box-shadow:0 0 0 5px var(--ac),0 30px 70px rgba(0,0,0,.6),0 0 90px color-mix(in srgb,var(--ac) 40%,transparent)' : ''}">${cover(k, 'p', { w, style: 'border-radius:14px' })}</div>
      ${badge ? `<span class="abs row" style="left:10px;top:10px;gap:7px;height:30px;padding:0 12px;border-radius:999px;background:rgba(14,16,20,.7);backdrop-filter:blur(10px);font-size:14px;font-weight:600"><span class="pulse" style="--ac:#D2423B;width:8px;height:8px"></span>Running</span>` : ''}</div>`;
  };
  const body = `
<div class="abs" style="inset:0 0 auto 0;height:780px;overflow:hidden;background:#0b0e14">
  <div class="abs" style="left:300px;top:-300px;width:1920px;-webkit-mask-image:linear-gradient(to right,transparent,#000 36%);mask-image:linear-gradient(to right,transparent,#000 36%)">${cover('ex', 'b', { title: false, style: 'width:1920px;border-radius:0' })}</div>
  <div class="abs" style="inset:0;background:linear-gradient(to top,#15171c 0%,rgba(21,23,28,.82) 28%,rgba(21,23,28,0) 66%),linear-gradient(to right,rgba(14,16,20,.78),transparent 62%),linear-gradient(to bottom,rgba(14,16,20,.55),transparent 150px)"></div>
</div>
<div class="abs row" style="left:96px;right:96px;top:48px;justify-content:space-between;z-index:3">
  <div class="logo" style="font-size:26px;width:auto;gap:12px"><i style="width:34px;height:34px;border-radius:10px"></i>Afterplay</div>
  <div class="row" style="gap:26px;font-size:21px;color:#d5d6dc"><span class="row" style="gap:10px">${ic('ctrl', 28)}Player 1</span><span class="row" style="gap:10px"><span class="dot" style="--s:var(--s-beaten);width:11px;height:11px"></span>Up to date</span><span class="num" style="font-weight:600;color:#fff">21:04</span></div>
</div>
<div class="abs col" style="left:96px;top:176px;z-index:3;gap:20px;width:1200px">
  <div class="row" style="gap:16px;font-size:22px"><span class="st playing" style="font-size:22px">Playing</span><span style="color:#cfd0d6">RPG, Turn-based</span><span style="color:#cfd0d6">2025</span></div>
  <h1 class="disp" style="font-size:112px;line-height:.94;font-weight:700;letter-spacing:-.04em;font-variation-settings:'wdth' 86">Clair Obscur:<br>Expedition 33</h1>
  <div style="font-size:26px;color:#d9dae0"><span class="num" style="font-weight:700;color:#fff">38h 10m</span> played, last on Living room PC 2 days ago</div>
  <div class="row" style="gap:18px;margin-top:10px">
    <span class="row" style="height:72px;padding:0 34px 0 14px;gap:16px;border-radius:999px;background:var(--ac);color:var(--on-ac);font:700 26px var(--ui);box-shadow:0 12px 40px color-mix(in srgb,var(--ac) 45%,transparent)">${glyph('A', 'rgba(0,0,0,.2)', 'var(--on-ac)').replace('width:34px;height:34px', 'width:46px;height:46px')}Play</span>
    <span class="row" style="height:72px;padding:0 30px 0 14px;gap:14px;border-radius:999px;background:rgba(14,16,20,.5);backdrop-filter:blur(14px);border:1px solid var(--line);font:600 24px var(--ui)">${glyph('X', '#3b6bff').replace('width:34px;height:34px', 'width:46px;height:46px')}Details</span>
  </div>
</div>
<div class="abs" style="left:96px;top:640px;z-index:3;right:0">
  <div class="row" style="gap:14px;align-items:baseline;margin-bottom:18px"><h2 class="disp" style="font-size:30px;font-weight:700">Playing</h2><span style="font-size:20px;color:var(--muted)">5 games</span></div>
  <div class="row" style="gap:22px;align-items:center;height:300px;margin-left:0">
    ${item('sk', false, true)}${item('sf', false)}${item('ex', true)}${item('hd', false)}${item('ba', false)}${item('ow', false)}${item('cel', false)}
  </div>
</div>
<div class="abs row" style="left:96px;right:96px;bottom:26px;gap:34px;z-index:4;font-size:20px;color:#d5d6dc">
  <span class="row" style="gap:10px">${glyph('A', '#3bbf6a')}Select</span><span class="row" style="gap:10px">${glyph('B', '#e0483e')}Back</span><span class="row" style="gap:10px">${glyph('X', '#3b6bff')}Details</span><span class="row" style="gap:10px">${glyph('Y', '#e6b333', '#1b1304')}Search</span>
  <span class="row" style="gap:10px;margin-left:auto">${glyph('≡', 'rgba(255,255,255,.18)')}Menu</span></div>`;
  return page({ title: 'Afterplay - TV', w: 1920, h: 1080, ac: ex.ac, on: ex.on, body });
}

// ======================= PWA =======================
const sb = () => `<div class="abs row" style="left:0;right:0;top:0;height:44px;padding:6px 26px 0;justify-content:space-between;z-index:12;font-size:14px;font-weight:700"><span class="num">21:52</span><span class="row" style="gap:6px">${ic('wifi', 17, 2)}${ic('bat', 20, 1.8)}</span></div><div class="abs" style="left:50%;top:10px;width:92px;height:26px;border-radius:14px;background:#000;transform:translateX(-50%);z-index:13"></div>`;
const tabs = (on) => `<div class="abs" style="left:0;right:0;bottom:0;height:110px;background:linear-gradient(to top,#15171c 35%,transparent);z-index:9"></div><div class="tabs">${[['home', 'Home'], ['lib', 'Library'], ['plan', 'Plan'], ['sess', 'Sessions']].map(([i, t]) => `<a class="${t === on ? 'on' : ''}" style="font-size:13px">${ic(i, 23)}${t}</a>`).join('')}</div>`;

function phoneHome() {
  const wk = [1.5, 2.2, 0, 3.1, 2.2, 3.4, 1.95];
  return `<div class="abs" style="left:0;right:0;top:0;height:400px;overflow:hidden">
    ${cover('sk', 'b', { title: false, style: 'position:absolute;left:-250px;top:-70px;width:900px;border-radius:0;filter:saturate(1.1)', cls: 'noi' })}
    <div class="abs" style="inset:0;background:linear-gradient(to top,#15171c 0%,rgba(21,23,28,.7) 38%,rgba(21,23,28,.1) 78%),linear-gradient(to bottom,rgba(14,16,20,.55),transparent 120px)"></div></div>
  ${sb()}
  <div class="abs row" style="left:20px;right:20px;top:58px;justify-content:space-between;z-index:5"><span class="disp" style="font-size:20px;font-weight:700">Afterplay</span><span class="row" style="gap:8px;font-size:13px;color:#d5d6dc"><span class="dot" style="--s:var(--s-beaten)"></span>Up to date</span></div>
  <div class="abs col" style="left:0;right:0;top:170px;align-items:center;text-align:center;z-index:5;gap:6px">
    <span class="row" style="gap:8px;font-size:14px;font-weight:600"><span class="pulse" style="width:8px;height:8px"></span>Playing now</span>
    <span class="disp num" style="font-size:78px;font-weight:700;letter-spacing:-.04em;line-height:1">1:12:47</span>
    <span class="disp" style="font-size:22px;font-weight:700;margin-top:6px">Hollow Knight: Silksong</span>
    <span style="font-size:14px;color:#d6d7dc">Desk PC, since 19:40</span></div>
  <div class="abs row" style="left:20px;right:20px;top:372px;gap:10px;z-index:5">
    <span class="btn pri" style="flex:1;justify-content:center;height:54px;font-size:17px">${ic('stop', 18)}Stop</span>
    <span class="btn tint" style="flex:1;justify-content:center;height:54px;border-radius:999px;font-size:16px">${ic('note', 18)}Add note</span></div>
  <div class="abs panel" style="left:20px;right:20px;top:446px;padding:16px;z-index:5;height:146px">
    <div class="row" style="justify-content:space-between;align-items:baseline"><span style="font-size:15px;font-weight:600">This week</span><span class="disp num" style="font-size:24px;font-weight:700">14h 20m</span></div>
    <div class="row" style="align-items:flex-end;margin-top:12px">${wk.map((v, i) => `<div class="col" style="flex:1;align-items:center;gap:6px"><div style="height:56px;display:flex;align-items:flex-end"><div style="width:14px;border-radius:7px;height:${Math.max(v / 3.4 * 56, 4)}px;background:${v ? 'var(--ac)' : 'rgba(255,255,255,.12)'};opacity:${i === 6 ? 1 : .55}"></div></div><span style="font-size:13px;color:${i === 6 ? '#fff' : 'var(--muted)'};font-weight:${i === 6 ? 700 : 500}">${'MTWTFSS'[i]}</span></div>`).join('')}</div></div>
  <div class="abs col" style="left:20px;right:20px;top:606px;z-index:5;gap:8px">
    <span style="font-size:15px;font-weight:600">Earlier today</span>
    <div class="row" style="gap:12px;height:60px;padding:0 14px 0 8px;border-radius:14px;background:var(--surface);border:1px solid var(--line)">${cover('ba', 'b', { w: 74, title: false, style: 'border-radius:7px' })}<div class="col" style="flex:1"><span style="font-size:14px;font-weight:600">Balatro</span><span style="font-size:13px;color:var(--muted)">13:05 to 13:50</span></div><span class="disp num" style="font-size:16px;font-weight:700">45m</span></div></div>
  ${tabs('Home')}`;
}

function phoneLibrary() {
  const gs = ['sk', 'ex', 'hd', 'ba', 'sf', 'ow', 'cel', 'dis', 'hk', 'h1', 'tun', 'obra'];
  const hrs = ['19h 48m', '38h 10m', '22h 05m', '61h 30m', '4h 45m', '24h', '9h 10m', '31h', '27h', '58h', '14h', '16h'];
  return `<div class="amb" style="height:420px;--ac:#3FBF8F">${cover('hd', 'b', { title: false })}</div>
  ${sb()}
  <div class="abs col" style="left:16px;right:16px;top:58px;z-index:5;gap:14px">
    <div class="row" style="justify-content:space-between;align-items:baseline"><span class="disp" style="font-size:34px;font-weight:700;letter-spacing:-.03em">Library</span><span style="font-size:14px;color:var(--muted)">331 games</span></div>
    <div class="row" style="gap:8px;height:44px;padding:0 14px;border-radius:14px;background:var(--surface-2);border:1px solid var(--line);color:#c9cad1;font-size:15px">${ic('search', 18)}Search your games</div>
    <div class="row" style="gap:8px;overflow:hidden;margin-right:-16px"><span class="chip on" style="font-size:14px;height:36px">All</span><span class="chip" style="font-size:14px;height:36px"><span class="dot" style="--s:var(--s-playing)"></span>Playing</span><span class="chip" style="font-size:14px;height:36px"><span class="dot" style="--s:var(--s-backlog)"></span>Backlog</span><span class="chip" style="font-size:14px;height:36px"><span class="dot" style="--s:var(--s-beaten)"></span>Beaten</span><span class="chip" style="font-size:14px;height:36px">Resting</span></div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px 10px;margin-top:2px">${gs.map((k, i) => `<div class="col" style="gap:6px">${cover(k, 'p', { style: 'width:100%;border-radius:9px' })}<span style="font-size:13px;font-weight:600;line-height:1.2">${G[k].t}</span><span style="font-size:13px;color:var(--muted);margin-top:-3px">${hrs[i]}</span></div>`).join('')}</div>
  </div>
  ${tabs('Library')}`;
}

function phoneDetail() {
  const st = (v, l) => `<div class="panel col" style="padding:12px 14px;gap:2px;border-radius:14px"><span class="disp num" style="font-size:22px;font-weight:700">${v}</span><span style="font-size:13px;color:var(--muted)">${l}</span></div>`;
  return `<div class="abs" style="left:0;right:0;top:0;height:330px;overflow:hidden;background:#0b0e14">
    <div class="abs" style="left:-330px;top:-110px;width:760px;-webkit-mask-image:linear-gradient(to right,transparent,#000 30%);mask-image:linear-gradient(to right,transparent,#000 30%)">${cover('ex', 'b', { title: false, style: 'width:760px;border-radius:0' })}</div>
    <div class="abs" style="inset:0;background:linear-gradient(to top,#15171c 0%,rgba(21,23,28,.7) 30%,transparent 70%),linear-gradient(to bottom,rgba(14,16,20,.6),transparent 110px)"></div></div>
  ${sb()}
  <div class="abs row" style="left:16px;right:16px;top:56px;justify-content:space-between;z-index:6"><span class="ib bg" style="background:rgba(14,16,20,.5);backdrop-filter:blur(12px);color:#fff">${ic('back', 20)}</span><span class="ib bg" style="background:rgba(14,16,20,.5);backdrop-filter:blur(12px);color:#fff">${ic('dots', 20)}</span></div>
  <div class="abs" style="left:18px;top:200px;z-index:6;border-radius:11px;box-shadow:0 20px 40px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.14)">${cover('ex', 'p', { w: 112, style: 'border-radius:11px' })}</div>
  <div class="abs col" style="left:144px;right:16px;top:222px;z-index:6;gap:6px"><span class="st playing" style="font-size:14px">Playing</span>
    <span class="disp" style="font-size:25px;font-weight:700;line-height:1.05;letter-spacing:-.02em">Clair Obscur: Expedition 33</span><span style="font-size:13px;color:var(--muted)">RPG, Turn-based, 2025</span></div>
  <div class="abs" style="left:16px;right:16px;top:362px;z-index:6"><span class="btn pri" style="width:100%;justify-content:center;height:54px;font-size:17px">${ic('play', 18)}Start timer on Phone</span></div>
  <div class="abs" style="left:16px;right:16px;top:432px;z-index:6;display:grid;grid-template-columns:1fr 1fr;gap:8px">${st('38h 10m', 'Played')}${st('14', 'Sessions')}${st('€49.99', 'Spent')}${st('€1.31', 'Per hour')}</div>
  <div class="abs panel" style="left:16px;right:16px;top:600px;z-index:6;padding:14px 16px;height:112px;border-radius:14px">
    <div class="row" style="justify-content:space-between;margin-bottom:12px"><span style="font-size:15px;font-weight:600">How long to beat</span><span style="font-size:13px;color:var(--muted)">Main 30h</span></div>
    <div style="position:relative;height:10px;border-radius:6px;background:rgba(255,255,255,.1)"><span style="position:absolute;left:0;top:0;bottom:0;width:54.5%;border-radius:6px;background:var(--ac)"></span><span style="position:absolute;left:54.5%;top:-4px;width:4px;height:18px;margin-left:-2px;border-radius:2px;background:#fff"></span></div>
    <div class="row" style="justify-content:space-between;margin-top:10px;font-size:13px;color:var(--muted)"><span>0h</span><span>+Extra 45h</span><span>100% 62h</span></div></div>
  ${tabs('Library')}`;
}

function phonePlan() {
  const hl = { pen: 'Main 17h', aw: 'Main 7h', lop: 'Main 30h', oct: 'Main 55h' };
  const r = (n, k) => `<div class="row" style="gap:12px;height:76px;padding:0 14px 0 12px;border-bottom:1px solid var(--line)"><span class="disp num" style="font-size:22px;font-weight:700;width:20px;color:#d5d6dc">${n}</span>${cover(k, 'p', { w: 44, title: false, style: 'border-radius:6px' })}<div class="col" style="flex:1"><span style="font-size:15px;font-weight:600">${G[k].t}</span><span style="font-size:13px;color:var(--muted)">${hl[k]}</span></div><span style="color:var(--muted)">${ic('grip', 20)}</span></div>`;
  return `<div class="amb" style="height:420px;--ac:#B48AF0">${cover('mt', 'b', { title: false })}</div>
  ${sb()}
  <div class="abs col" style="left:16px;right:16px;top:58px;z-index:5;gap:14px">
    <div class="row" style="justify-content:space-between;align-items:baseline"><span class="disp" style="font-size:34px;font-weight:700;letter-spacing:-.03em">Plan</span><span style="font-size:14px;color:var(--muted)">5 in queue</span></div>
    <div class="panel glass row" style="gap:16px;padding:16px;align-items:flex-start;border-radius:16px;position:relative;overflow:hidden">
      <div class="abs" style="inset:0;opacity:.45;filter:blur(24px) saturate(1.3);transform:scale(1.4)">${cover('mt', 'b', { title: false, style: 'width:100%;border-radius:0' })}</div>
      <div class="abs" style="inset:0;background:rgba(14,16,20,.6)"></div>
      <div style="position:relative;box-shadow:0 18px 36px rgba(0,0,0,.5);border-radius:10px">${cover('mt', 'p', { w: 118 })}</div>
      <div class="col" style="position:relative;gap:6px;flex:1"><span class="disp num" style="font-size:40px;font-weight:800;line-height:1;color:var(--ac)">1</span>
        <span class="disp" style="font-size:22px;font-weight:700;line-height:1.1">Metaphor: ReFantazio</span>
        <span style="font-size:13px;color:#d0d1d7">Main 66h, +Extra 91h</span></div></div>
    <span class="btn pri" style="width:100%;justify-content:center;height:52px;font-size:16px;margin-top:-2px">${ic('play', 18)}Start playing</span>
    <div class="panel" style="padding:0;border-radius:16px">${r(2, 'pen')}${r(3, 'aw')}${r(4, 'lop')}${r(5, 'oct').replace('border-bottom:1px solid var(--line)', '')}</div>
  </div>
  ${tabs('Plan')}`;
}

export function pwa() {
  const phone = (inner, cap, ac, on) => `<div class="col" style="align-items:center;gap:22px"><div style="width:391px;height:828px;border-radius:58px;padding:8px;background:linear-gradient(160deg,#2a2d35,#0c0d10);box-shadow:0 40px 90px rgba(0,0,0,.6),inset 0 0 0 1px rgba(255,255,255,.1)"><div style="position:relative;width:375px;height:812px;border-radius:50px;overflow:hidden;background:var(--slate);--ac:${ac};--on-ac:${on}">${inner}</div></div><span style="font-size:17px;font-weight:600;color:#d5d6dc">${cap}</span></div>`;
  const body = `<div class="abs" style="inset:0;background:radial-gradient(900px 500px at 50% 0%,rgba(143,211,255,.07),transparent 70%)"></div>
<div class="row" style="position:absolute;inset:0;justify-content:space-evenly;padding-top:96px;align-items:flex-start">
  ${phone(phoneHome(), 'Home, tinted by the game running', G.sk.ac, G.sk.on)}
  ${phone(phoneLibrary(), 'Library', '#3FBF8F', '#04150f')}
  ${phone(phoneDetail(), 'Game page', G.ex.ac, G.ex.on)}
  ${phone(phonePlan(), 'Plan', G.mt.ac, G.mt.on)}
</div>`;
  return page({ title: 'Afterplay - PWA', w: 1920, h: 1100, body });
}
