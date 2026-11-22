import { ic, cover, nav, ambient, page, G } from './lib.mjs';

// ======================= SESSIONS =======================
export function sessions() {
  // [dia]: [juego, horas]
  const H = { 1: ['ex', 2], 2: ['ba', .8], 3: ['ba', 1.2], 4: ['ex', 3.2], 5: ['ex', 2.5], 6: ['hd', 1.5], 7: ['hd', 2.8], 8: ['sf', 1.6], 10: ['ba', 1.1], 11: ['hd', 3.5], 12: ['hd', 1.6], 13: ['ex', 4], 14: ['ba', 2.2], 15: ['sf', 3], 16: ['ba', 1.5], 17: ['ex', 2.2], 19: ['hd', 3.1], 20: ['sf', 2.2], 21: ['ex', 3.4], 22: ['sk', 1.95] };
  const fmt = (h) => `${Math.floor(h)}h ${String(Math.round((h % 1) * 60)).padStart(2, '0')}m`;
  const cells = [];
  for (let i = 26; i <= 31; i++) cells.push({ d: i, out: true });
  for (let d = 1; d <= 30; d++) cells.push({ d });
  const cellHtml = cells.map((c) => {
    if (c.out) return `<div style="height:40px;border-radius:9px;padding:0 10px;display:flex;align-items:center;color:rgba(255,255,255,.22);font-size:13px">${c.d}</div>`;
    const e = H[c.d];
    const today = c.d === 22;
    if (!e) return `<div style="height:40px;border-radius:9px;padding:0 10px;display:flex;align-items:center;background:rgba(255,255,255,.035);color:${c.d > 22 ? 'rgba(255,255,255,.3)' : '#8c8e97'};font-size:13px;font-weight:600">${c.d}</div>`;
    const g = G[e[0]];
    const pct = Math.min(22 + e[1] * 8, 56);
    return `<div class="row" style="height:40px;border-radius:9px;padding:0 10px;gap:8px;background:color-mix(in srgb,${g.heat} ${pct}%,#15171c);${today ? 'box-shadow:0 0 0 2px #fff;' : ''}">
      <span style="font-size:13px;font-weight:700;width:20px">${c.d}</span>
      ${cover(e[0], 'b', { w: 34, title: false, style: 'border-radius:4px;margin-left:auto' })}
      <span class="num" style="font-size:13px;font-weight:600;width:56px;text-align:right">${fmt(e[1])}</span></div>`;
  }).join('');
  const wk = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<span class="lbl" style="padding-left:10px">${d}</span>`).join('');
  const legend = ['ex', 'hd', 'ba', 'sf', 'sk'].map((k) => `<span class="row sub" style="gap:7px;color:#d5d6dc"><span style="width:10px;height:10px;border-radius:3px;background:${G[k].heat}"></span>${G[k].t.replace('Clair Obscur: ', '').replace('Hollow Knight: ', '')}</span>`).join('');

  const rowS = (k, time, note, dev, dur, running, last) => `<div class="row" style="gap:18px;padding:0 16px 0 10px;height:68px;${last ? '' : 'border-bottom:1px solid var(--line)'}">
      ${cover(k, 'b', { w: 98, style: 'border-radius:8px' })}
      <div class="col" style="width:290px;gap:2px"><span style="font-size:15px;font-weight:600">${G[k].t}</span><span class="sub num">${time}</span></div>
      <div style="flex:1;font-size:14px;color:#d0d1d7;line-height:1.35">${note}</div>
      <span class="row sub" style="gap:7px;width:160px;color:#c9cad1">${ic(dev === 'Phone timer' ? 'phone' : dev === 'Living room PC' ? 'tv' : 'pc', 16)}${dev}</span>
      <span class="row disp num" style="width:100px;justify-content:flex-end;gap:8px;font-size:19px;font-weight:700">${running ? '<span class="pulse" style="width:8px;height:8px;--ac:#D2423B"></span>' : ''}${dur}</span></div>`;
  const dayHead = (t, sub, tot) => `<div class="row" style="justify-content:space-between;margin:0 0 10px"><div class="row" style="gap:12px;align-items:baseline"><h2 class="h2" style="font-size:20px">${t}</h2><span class="sub">${sub}</span></div><span class="sub num">${tot}</span></div>`;
  const body = `
<div class="amb dim" style="height:420px"><div class="abs" style="inset:0;background:radial-gradient(800px 300px at 80% 0%,rgba(143,211,255,.12),transparent 70%)"></div></div>
${nav('Sessions')}
<div class="abs" style="left:48px;right:48px;top:92px;z-index:2">
  <div class="row" style="justify-content:space-between;margin-bottom:16px">
    <div class="row" style="gap:18px;align-items:baseline"><h1 class="disp" style="font-size:42px;font-weight:700;letter-spacing:-.03em">Sessions</h1>
      <div class="row" style="gap:6px;align-self:center"><span class="ib bg">${ic('chl', 17)}</span><span style="font-size:17px;font-weight:600;padding:0 8px">November 2026</span><span class="ib bg">${ic('chr', 17)}</span></div></div>
    <div class="row" style="gap:10px"><span class="btn">${ic('cal', 17)}Month ${ic('chd', 15)}</span><span class="btn">${ic('plus', 17)}Add session</span></div>
  </div>
  <div class="panel glass" style="padding:16px 20px;height:366px">
    <div class="row" style="justify-content:space-between;margin-bottom:10px"><div class="row" style="gap:10px;align-items:baseline"><span class="disp num" style="font-size:22px;font-weight:700">45h 21m</span><span class="sub">in 31 sessions this month</span></div><div class="row" style="gap:18px">${legend}</div></div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-bottom:6px">${wk}</div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;grid-auto-rows:40px">${cellHtml}</div>
  </div>
  <div style="margin-top:22px">
    ${dayHead('Today', 'Sunday, Nov 22', '1h 57m')}
    <div class="panel" style="padding:0">
      ${rowS('sk', '19:40 to now', 'Reached the citadel gate. Bench is two rooms back, bring the spare silk.', 'Desk PC', '1h 12m', true)}
      ${rowS('ba', '13:05 to 13:50', 'Cartomancer run, clean win at ante 8.', 'Desk PC', '45m', false, true)}
    </div>
  </div>
  <div style="margin-top:20px">
    ${dayHead('Yesterday', 'Saturday, Nov 21', '3h 24m')}
    <div class="panel" style="padding:0">
      ${rowS('ex', '20:10 to 22:00', 'Finished the Flying Manor, picked up two new pictos.', 'Living room PC', '1h 50m')}
      ${rowS('ba', '15:30 to 16:10', 'Quick runs while waiting for dinner.', 'Phone timer', '40m')}
      ${rowS('ex', '10:05 to 10:59', 'Respec after the boss, tried a shield build.', 'Desk PC', '54m', false, true)}
    </div>
  </div>
</div>`;
  return page({ title: 'Afterplay - Sessions', body });
}

// ======================= PLAN =======================
export function plan() {
  const mt = G.mt;
  const hl = { mt: ['66h', '91h', '130h'], pen: ['17h', '21h', '28h'], aw: ['7h', '10h', '17h'], lop: ['30h', '40h', '55h'], oct: ['55h', '75h', '110h'] };
  const row = (n, k, why) => `<div class="panel row" style="gap:14px;padding:12px 16px 12px 14px;height:104px;margin-bottom:12px">
      <span class="disp num" style="font-size:26px;font-weight:700;width:26px;color:#d5d6dc">${n}</span>
      ${cover(k, 'p', { w: 62, title: false })}
      <div class="col" style="flex:1;gap:3px"><span style="font-size:16px;font-weight:600">${G[k].t}</span><span class="sub">${why}</span><span class="sub num" style="color:#d5d6dc">Main ${hl[k][0]}</span></div>
      <span style="color:var(--muted)">${ic('grip', 20)}</span></div>`;
  const some = ['coc', 'dre', 'alan', 'sos', 'bg3', 'cp', 'sdv', 'ori', 'ds'].map((k) => `<div class="col" style="gap:8px">${cover(k, 'p', { style: 'width:100%' })}<span style="font-size:13px;font-weight:600;line-height:1.25">${G[k].t}</span></div>`).join('');
  const colHead = (t, sub, n) => `<div class="row" style="justify-content:space-between;margin-bottom:14px;align-items:baseline"><div class="row" style="gap:12px;align-items:baseline"><h2 class="h2" style="font-size:24px">${t}</h2><span class="sub">${sub}</span></div><span class="chip" style="height:28px">${n}</span></div>`;
  const body = `
${ambient('mt')}
${nav('Plan')}
<div class="abs" style="left:48px;right:48px;top:92px;z-index:2">
  <div class="row" style="justify-content:space-between;margin-bottom:22px">
    <div class="row" style="gap:14px;align-items:baseline"><h1 class="disp" style="font-size:42px;font-weight:700;letter-spacing:-.03em">Plan</h1><span class="muted" style="font-size:16px">14 games queued, about 175h in total</span></div>
    <span class="btn pri" style="height:44px">${ic('plus', 17)}Add to plan</span>
  </div>
  <div style="display:grid;grid-template-columns:640px 1fr 1fr;gap:24px">
    <section>
      ${colHead('Next', 'Plays in this order', '3')}
      <div class="panel glass" style="padding:20px;display:flex;gap:24px;height:356px;margin-bottom:12px;position:relative;overflow:hidden">
        <div class="abs" style="inset:0;opacity:.5;filter:blur(30px) saturate(1.3);transform:scale(1.3)">${cover('mt', 'b', { title: false, style: 'width:100%;border-radius:0' })}</div>
        <div class="abs" style="inset:0;background:linear-gradient(90deg,rgba(14,16,20,.35),rgba(14,16,20,.78))"></div>
        <div class="abs" style="left:20px;top:20px;z-index:2;box-shadow:0 24px 44px rgba(0,0,0,.55);border-radius:10px">${cover('mt', 'p', { w: 220 })}</div>
        <div class="col" style="margin-left:244px;position:relative;z-index:2;flex:1;gap:10px;justify-content:center">
          <span class="row" style="gap:10px"><span class="disp num" style="font-size:48px;font-weight:800;line-height:1;color:var(--ac)">1</span><span class="sub" style="color:#d5d6dc">Up next</span></span>
          <h3 class="disp" style="font-size:34px;font-weight:700;line-height:1.05;letter-spacing:-.025em;margin:0">Metaphor: ReFantazio</h3>
          <span class="sub" style="color:#d5d6dc">RPG, Turn-based, 2024</span>
          <div class="row" style="gap:20px;margin:6px 0 4px">
            <div class="col"><span class="disp num" style="font-size:22px;font-weight:700">66h</span><span class="lbl">Main</span></div>
            <div class="col"><span class="disp num" style="font-size:22px;font-weight:700">91h</span><span class="lbl">+Extra</span></div>
            <div class="col"><span class="disp num" style="font-size:22px;font-weight:700">130h</span><span class="lbl">100%</span></div></div>
          <div class="row" style="gap:10px;margin-top:6px"><span class="btn pri">${ic('play', 17)}Start playing</span><span class="btn glass">Move</span></div>
        </div>
      </div>
      ${row(2, 'pen', 'Narrative adventure, short and focused')}
      ${row(3, 'aw', 'Weekend game, pairs well with a quiet night')}
    </section>
    <section>
      ${colHead('Soon', 'Keeps its order', '2')}
      ${row(4, 'lop', 'After the shorter ones')}
      ${row(5, 'oct', 'Long, save it for a free week')}
      <div class="col" style="height:104px;margin:0 0 12px;border:1.5px dashed rgba(255,255,255,.22);border-radius:16px;align-items:center;justify-content:center;gap:2px"><span style="font-size:14px;font-weight:600;color:#d5d6dc">Drop a game here</span><span class="sub">Anything dragged from Someday joins the queue</span></div>
      <div class="panel" style="margin-top:4px;padding:18px 20px">
        <h3 style="margin-bottom:8px">Queue time</h3>
        <div class="row" style="gap:14px;align-items:baseline"><span class="disp num" style="font-size:34px;font-weight:700;color:var(--ac)">175h</span><span class="sub">Main stories, about 12 weeks at your pace</span></div>
        <div class="row" style="height:8px;border-radius:5px;overflow:hidden;gap:2px;margin-top:14px">
          ${[66, 17, 7, 30, 55].map((v, i) => `<span style="flex:${v};background:var(--ac);opacity:${1 - i * .15}"></span>`).join('')}
        </div>
      </div>
    </section>
    <section>
      ${colHead('Someday', 'No order', '9')}
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px 12px">${some}</div>
    </section>
  </div>
</div>`;
  return page({ title: 'Afterplay - Plan', ac: mt.ac, on: mt.on, body });
}

// ======================= SETTINGS =======================
export function settings() {
  const items = [['sliders', 'General'], ['lib', 'Library'], ['sync', 'Sync'], ['radar', 'Game detection'], ['save', 'Saves'], ['pal', 'Appearance'], ['key', 'Keys and access'], ['info', 'About']];
  const side = items.map(([i, t]) => `<div class="row" style="gap:12px;height:40px;padding:0 14px;border-radius:12px;font-size:14px;font-weight:${t === 'Sync' ? 700 : 500};background:${t === 'Sync' ? 'rgba(255,255,255,.1)' : 'transparent'};color:${t === 'Sync' ? '#fff' : '#b9bbc3'}">${ic(i, 18)}${t}</div>`).join('');

  const pcArt = `<svg width="200" height="96" viewBox="0 0 200 96" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="46" y="8" width="108" height="62" rx="6" fill="#1d2027" stroke="currentColor" stroke-width="2"/><rect x="52" y="14" width="96" height="50" rx="3" fill="url(#g1)"/><path d="M100 70v12M82 84h36" stroke="currentColor" stroke-width="2"/><rect x="64" y="88" width="72" height="5" rx="2.5" fill="#2a2d35"/><rect x="164" y="30" width="16" height="50" rx="3" fill="#1d2027" stroke="currentColor" stroke-width="2"/><path d="M168 38h8M168 44h8" stroke="currentColor" stroke-width="2"/><defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#8fd3ff" stop-opacity=".55"/><stop offset="1" stop-color="#c9a7ff" stop-opacity=".25"/></linearGradient></defs></svg>`;
  const tvArt = `<svg width="200" height="96" viewBox="0 0 200 96" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="34" y="8" width="132" height="64" rx="6" fill="#1d2027" stroke="currentColor" stroke-width="2"/><rect x="40" y="14" width="120" height="52" rx="3" fill="url(#g2)"/><path d="M82 78h36" stroke="currentColor" stroke-width="2"/><rect x="62" y="82" width="76" height="10" rx="4" fill="#1d2027" stroke="currentColor" stroke-width="2"/><circle cx="74" cy="87" r="1.5" fill="currentColor"/><path d="M110 87h20" stroke="currentColor" stroke-width="2"/><defs><linearGradient id="g2" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ffb48a" stop-opacity=".5"/><stop offset="1" stop-color="#c9a7ff" stop-opacity=".25"/></linearGradient></defs></svg>`;
  const phoneArt = `<svg width="200" height="96" viewBox="0 0 200 96" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="78" y="4" width="44" height="88" rx="9" fill="#1d2027" stroke="currentColor" stroke-width="2"/><rect x="83" y="12" width="34" height="68" rx="4" fill="url(#g3)"/><path d="M94 86h12" stroke="currentColor" stroke-width="2"/><path d="M52 30c-6 8-6 28 0 36M148 30c6 8 6 28 0 36" stroke="currentColor" stroke-width="2" opacity=".35"/><defs><linearGradient id="g3" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#9ed98b" stop-opacity=".5"/><stop offset="1" stop-color="#8fd3ff" stop-opacity=".25"/></linearGradient></defs></svg>`;
  const dev = (name, art, seen, ver, extra, here) => `<div class="col" style="border-radius:16px;overflow:hidden;background:${here ? 'color-mix(in srgb,var(--ac) 9%,rgba(255,255,255,.05))' : 'var(--surface)'};border:1px solid ${here ? 'color-mix(in srgb,var(--ac) 70%,transparent)' : 'var(--line)'};${here ? 'box-shadow:0 0 0 1px color-mix(in srgb,var(--ac) 35%,transparent),0 14px 40px color-mix(in srgb,var(--ac) 18%,transparent)' : ''}">
      <div style="height:142px;display:grid;place-items:center;color:${here ? 'var(--ac)' : '#8c8f99'};background:radial-gradient(180px 90px at 50% 70%,rgba(255,255,255,.07),transparent)">${art}</div>
      <div class="col" style="padding:14px 18px 18px;gap:6px">
        <div class="row" style="gap:10px;justify-content:space-between"><span style="font-size:17px;font-weight:700;font-family:var(--display)">${name}</span>${here ? '<span class="chip" style="height:24px;padding:0 10px;font-size:12px;background:var(--ac);color:var(--on-ac);border:0;font-weight:700">This PC</span>' : ''}</div>
        <span class="row sub" style="gap:7px;color:#d5d6dc"><span class="dot" style="--s:${seen[1]}"></span>${seen[0]}</span>
        <span class="sub">${ver}</span><span class="sub">${extra}</span></div></div>`;
  const tog = (t, s, on) => `<div class="row" style="justify-content:space-between;padding:14px 0;border-top:1px solid var(--line)"><div class="col" style="gap:2px"><span style="font-size:15px;font-weight:600">${t}</span><span class="sub">${s}</span></div>
      <span style="width:44px;height:26px;border-radius:13px;background:${on ? 'var(--ac)' : 'rgba(255,255,255,.14)'};position:relative"><span style="position:absolute;top:3px;${on ? 'right:3px' : 'left:3px'};width:20px;height:20px;border-radius:50%;background:${on ? 'var(--on-ac)' : '#c9cad1'}"></span></span></div>`;
  const body = `
${ambient('sk', 'dim')}
${nav('')}
<div class="abs" style="inset:0;background:rgba(10,11,14,.5);z-index:25"></div>
<div class="abs col" style="z-index:30;left:200px;top:96px;width:1200px;height:830px;border-radius:26px;background:rgba(24,26,32,.84);backdrop-filter:blur(34px) saturate(1.3);border:1px solid rgba(255,255,255,.14);box-shadow:0 40px 100px rgba(0,0,0,.6)">
  <div class="row" style="flex:1;min-height:0;align-items:stretch">
    <div class="col" style="width:250px;padding:26px 16px;gap:4px;border-right:1px solid var(--line)">
      <span class="disp" style="font-size:24px;font-weight:700;padding:0 14px 16px">Settings</span>${side}</div>
    <div class="col" style="flex:1;padding:30px 40px 0;min-width:0">
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div class="col" style="gap:8px"><h1 class="disp" style="font-size:36px;font-weight:700;letter-spacing:-.03em">Sync</h1>
          <span class="row" style="gap:8px;font-size:14px;color:#d5d6dc"><span class="dot" style="--s:var(--s-beaten);box-shadow:0 0 8px var(--s-beaten)"></span>Up to date, last synced 2 minutes ago</span></div>
        <div class="row" style="gap:10px"><span class="btn">${ic('sync', 17)}Sync now</span></div>
      </div>
      <div class="row" style="justify-content:space-between;margin:26px 0 12px"><h3 style="font-size:16px;font-weight:700;margin:0">Devices <span class="muted" style="font-weight:500">3</span></h3></div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">
        ${dev('Desk PC', pcArt, ['Online now', 'var(--s-beaten)'], 'Afterplay 2.0.3, Windows 11', '331 games, 1,204 sessions', true)}
        ${dev('Living room PC', tvArt, ['Seen 2 hours ago', 'var(--s-backlog)'], 'Afterplay 2.0.3, Windows 11', '331 games, 212 sessions', false)}
        ${dev('Phone', phoneArt, ['Seen 5 minutes ago', 'var(--s-beaten)'], 'Afterplay web app, Android', 'Timer and plan', false)}
      </div>
      <div class="row" style="gap:16px;margin-top:16px;padding:18px 22px;border:1.5px dashed rgba(255,255,255,.22);border-radius:16px">
        <span class="ib bg" style="width:44px;height:44px;color:var(--text)">${ic('plus', 20)}</span>
        <div class="col" style="flex:1;gap:2px"><span style="font-size:15px;font-weight:600">Add device</span><span class="sub">Pair another PC or your phone with a short code. Only you can see your library.</span></div>
        <span class="btn pri" style="height:42px;font-size:14px">Add device</span></div>
      <div style="margin-top:20px">
        ${tog('Sync automatically', 'Send changes as soon as they happen', true)}
        ${tog('Include screenshots and save files', 'Uploads are encrypted and only your devices can read them', true)}
        ${tog('Sync on metered connections', 'Off keeps data use low on hotspots', false)}
      </div>
    </div>
  </div>
</div>`;
  return page({ title: 'Afterplay - Settings', body });
}
