// Hojas de superficies y medios del sistema Fosforo
export function sheetsSurfaces({ page, I, ico, ic, icf, cv, bn, dot, G, ST, STN, ratio }) {
  const fake = (extra = '') => `<div style="position:absolute;inset:0;display:grid;grid-template-columns:repeat(6,1fr);gap:12px;padding:16px;align-content:start;opacity:.9">${['silk', 'clair', 'balatro', 'hades2', 'split', 'meta', 'pent', 'well', 'lies', 'octo', 'outer', 'celeste'].map((k) => cv(k, { st: 'playing' })).join('')}</div><div class="scrim"></div>${extra}`
  const fieldL = (t) => `<div style="font-size:13px;font-weight:500;margin-bottom:5px">${t}</div>`

  /* ---------- 06 superficies ---------- */
  const rows = [
    ['hd', null], ['', ['hollow', 'beaten', '42h 10m', 'Oct 4']], ['h', ['clair', 'playing', '38h 10m', 'Today']], ['s', ['silk', 'playing', '23h 15m', 'Running now']], ['f', ['balatro', 'playing', '61h 30m', 'Yesterday']], ['', ['outer', 'beaten', '22h 40m', 'Nov 14']]
  ]
  const tbl = `<div style="background:var(--pan);border:1px solid var(--line);border-radius:8px;overflow:hidden">${rows.map(([c, d]) => (c === 'hd' ? `<div class="rowt hd" style="grid-template-columns:36px 1fr 120px 90px 100px"><span></span><span>Game</span><span>Status</span><span style="text-align:right">Played</span><span style="text-align:right">Last</span></div>` : `<div class="rowt ${c}" style="grid-template-columns:36px 1fr 120px 90px 100px"><span>${cv(d[0])}</span><span style="font-weight:500">${G[d[0]].n}</span><span class="chip">${dot(d[1])}${STN[d[1]]}</span><span class="bsx" style="text-align:right;font-size:20px;letter-spacing:.02em">${d[2].replace(/(\d+)([hm])/g, '$1<span style="font-size:.6em;color:var(--dust);margin:0 2px 0 1px">$2</span>')}</span><span style="text-align:right;color:${d[3] === 'Running now' ? 'var(--live)' : 'var(--dust)'};font-size:13px">${d[3]}</span></div>`)).join('')}</div>`
  const rowLabels = `<div class="g" style="grid-template-columns:repeat(4,1fr);gap:10px;margin-top:10px;font-size:13px;color:var(--dust);line-height:1.35">
    <div><b style="color:var(--bone)">Hover</b><br>Raised fill, 100 ms</div><div><b style="color:var(--bone)">Selected</b><br>Phosphor tint, 2 px edge with glow</div><div><b style="color:var(--bone)">Focus-visible</b><br>2 px outline inside the row</div><div><b style="color:var(--bone)">Header</b><br>34 px, Dust 13 px, sticky</div></div>`
  const panelCell = `<div><h2>Panels, lists and tables <em>Panel fill, Line border, radius 8, no shadow</em></h2>
    ${tbl}${rowLabels}
    <p class="note" style="margin-top:10px">Panel padding 16 to 24. Rows are 48 px (36 on dense Sessions), separated by Line, no zebra. Durations use Big Shoulders 20 with small units, right aligned. The running session row gets Live text, never a fill.</p>
  </div>`

  const dialogCell = `<div><h2>Dialog <em>modal-shell</em></h2><div class="fr" style="height:326px">${fake(`
    <div class="dlg" style="position:absolute;left:30px;right:30px;top:26px">
      <div class="dh"><h4>Add spend</h4><button class="b gh ico sm" style="margin-left:auto;margin-top:-2px">${ic('x')}</button></div>
      <div class="db" style="padding-bottom:4px;display:flex;flex-direction:column;gap:12px"><span>For Hollow Knight: Silksong.</span>
        <div class="g" style="grid-template-columns:1fr 1fr;gap:10px"><div>${fieldL('Amount')}<div class="in f"><span style="color:var(--bone)">19.99</span><i class="caret"></i><span style="margin-left:auto;color:var(--dust)">€</span></div></div><div>${fieldL('Date')}<div class="in"><span style="color:var(--bone)">Nov 18, 2026</span></div></div></div>
        <div>${fieldL('Store')}<div class="in sel"><span style="color:var(--bone)">Steam</span><span style="color:var(--dust);display:flex">${ico('chevD')}</span></div></div></div>
      <div class="df" style="margin-top:14px"><button class="b gh">Cancel</button><button class="b pri">Save spend</button></div>
    </div>`)}</div>
    <p class="note" style="margin-top:8px">Overlay fill, Line strong border, radius 8, max 480 px. Title Big Shoulders 26. Footer divided by Line. Esc and the X close; clicking the scrim closes unless the form is dirty. Focus lands on the first field.</p></div>`

  const alertCell = `<div><h2>Alert dialog <em>irreversible</em></h2><div class="fr" style="height:326px">${fake(`
    <div class="dlg" style="position:absolute;left:30px;right:30px;top:60px">
      <div class="dh" style="padding-bottom:0"><span style="width:34px;height:34px;border-radius:50%;background:rgba(255,94,87,.14);display:grid;place-items:center;color:var(--live);flex:none">${ico('tri')}</span><div><h4>Remove Silksong?</h4></div></div>
      <div class="db">Its 11 sessions, notes and spend will be deleted on every device. This can’t be undone.</div>
      <div class="df"><button class="b bsec f">Keep game</button><button class="b dan">${ico('trash').replace('class="i "', 'class="i" style="width:16px;height:16px"')}Remove game</button></div>
    </div>`)}</div>
    <p class="note" style="margin-top:8px">Same shell, narrower (400 px). Focus starts on the safe action (Keep game). The scrim and Esc do not dismiss silently: Esc = Keep. The destructive button is Live and names the consequence (“Remove game”, never “OK”).</p></div>`

  const sheetCell = `<div><h2>Side sheet <em>edit in place</em></h2><div class="fr" style="height:326px">${fake(`
    <div class="dlg" style="position:absolute;top:0;right:0;bottom:0;width:330px;border-radius:0;border-width:0 0 0 1px;display:flex;flex-direction:column">
      <div class="dh" style="padding-bottom:14px;border-bottom:1px solid var(--line);align-items:center"><div><h4>Edit session</h4><div class="note">Silksong · Nov 18</div></div><button class="b gh ico sm" style="margin-left:auto">${ic('x')}</button></div>
      <div style="padding:16px 20px;display:flex;flex-direction:column;gap:10px;flex:1">
        <div class="g" style="grid-template-columns:1fr 1fr;gap:10px"><div>${fieldL('Start')}<div class="in"><span>19:40</span></div></div><div>${fieldL('End')}<div class="in"><span>20:52</span></div></div></div>
        <div>${fieldL('Note')}<div class="in" style="height:56px;align-items:flex-start;padding-top:8px"><span class="ph2">What happened this session?</span></div></div>
      </div>
      <div class="df" style="margin-top:0;justify-content:space-between"><button class="b gh" style="color:var(--live)">Delete</button><span class="row" style="gap:8px"><button class="b gh">Cancel</button><button class="b pri">Save</button></span></div>
    </div>`)}</div>
    <p class="note" style="margin-top:8px">Anchored right, 330 to 420 px, full height, square leading edge. Delete sits left and apart from Save. On the PWA it becomes a bottom sheet with a drag handle.</p></div>`

  const toast = (tc, icon, t, s, extra = '', pr = 0) => `<div class="toast" style="--tc:${tc}"><span class="ti">${icon}</span><div class="tx">${t}${s ? `<span>${s}</span>` : ''}</div>${extra}${pr ? `<i class="prog" style="width:${pr}%"></i>` : ''}</div>`
  const toastCell = `<div><h2>Toasts <em>bottom right, above Now playing</em></h2>
    <div class="col" style="gap:10px">
      ${toast('var(--beaten)', ico('okc'), 'Session saved', '1h 12m on Hollow Knight: Silksong', '<span class="undo">Undo</span>', 62)}
      ${toast('var(--tube)', ic('sync'), 'Synced from Laptop', '3 changes merged', '', 30)}
      ${toast('var(--caution)', ico('tri'), 'Timer still running on Laptop', 'Stop it there or take over here.', '<span class="undo">Take over</span>', 0)}
      ${toast('var(--live)', ic('info'), 'Sync failed', 'Retrying in 30 s. Your changes are safe.', '<span class="undo">Retry</span>', 0)}
    </div>
    <p class="note" style="margin-top:10px">Overlay, 3 px status edge, 8 px radius, max 4 stacked, 5 s (8 s with an action; errors persist until dismissed). Time pauses on hover or tab blur. Swipe or Esc to dismiss.</p></div>`

  const skl = `<div style="background:var(--pan);border:1px solid var(--line);border-radius:8px;overflow:hidden">${[0, 1].map((i) => `<div class="rowt" style="grid-template-columns:36px 1fr 100px 70px;height:44px"><i class="skl" style="width:26px;height:35px"></i><i class="skl" style="width:${[70, 55, 62][i]}%;height:12px"></i><i class="skl" style="width:70px;height:12px"></i><i class="skl" style="width:44px;height:12px;justify-self:end"></i></div>`).join('')}</div>`
  const emptyCell = `<div><h2>Empty state and skeleton</h2>
    <div class="panel" style="position:relative;overflow:hidden"><div class="empty" style="padding:14px 22px 16px">
      <div style="width:60px;height:44px;border-radius:6px;border:1.5px solid var(--phos);position:relative;overflow:hidden;color:var(--phos);display:grid;place-items:center;box-shadow:0 0 22px rgba(255,179,71,.18)"><div style="position:absolute;inset:0;background:repeating-linear-gradient(0deg,rgba(255,179,71,.16) 0 1px,transparent 1px 3px)"></div><span style="position:relative">${icf('play')}</span></div>
      <h4 style="margin-top:8px;font-size:24px">No sessions yet</h4><p>Start a timer from any game and your first session lands here.</p>
      <button class="b pri" style="margin-top:10px">${icf('play')}Start a timer</button></div></div>
    <div style="margin-top:14px">${skl}</div>
    <div class="row" style="gap:12px;margin-top:12px;align-items:flex-start">${[0, 1, 2].map(() => cv('silk', { cls: 'xs ld' }).replace(/<span class="ct">.*?<\/span>/, '')).join('')}<div class="note" style="flex:1">Skeleton = Raised bars with a phosphor sweep: a 7 % amber band crossing in 1.6 s. Static under reduced motion.</div></div>
  </div>`

  const superficies = page('Surfaces and feedback', '06', 'Panels sit flat; only what floats (dialogs, sheets, toasts, menus) gets Overlay, a lit top edge and a petrol shadow. Dialogs are always shown over their dimmed screen.', `
  <div class="g" style="grid-template-columns:560px 1fr 1fr;gap:22px 34px;align-items:start;flex:1;min-height:0">
    ${panelCell}${dialogCell}${alertCell}
    ${toastCell}${sheetCell}${emptyCell}
  </div>`)

  /* ---------- 07 medios ---------- */
  const coverBlock = `<div><h2>Cover <em>3:4, radius 4, always has a game name on it</em></h2>
    <div class="row" style="gap:22px;align-items:flex-end">
      ${[['xs', 42, 'Now playing'], ['s', 64, 'Lists, plan'], ['m', 118, 'Home, shelves'], ['l', 120, 'Library, detail']].map(([s, w, u]) => `<div><div class="cv-w" style="width:${w}px">${cv('silk', { cls: s, st: s !== 'xs' ? 'playing' : undefined, h: s === 'l' || s === 'm' ? '23h 15m' : undefined })}</div><div style="font-size:13px;margin-top:6px;font-weight:600">${s} · ${w}</div><div class="hx">${u}</div></div>`).join('')}
      <div style="flex:1;margin-left:34px" class="note"><b>Anatomy.</b> LED 9 px at 7 px from the top-right corner, ringed in Cabinet so it reads on any art, glow 9 px. Hours strip 20 px, Cabinet at 80 %, Barlow 12 px, only on m and l. Queue number badge top-left, Big Shoulders 20 in Phosphor. TV uses 240 px wide.</div>
    </div>
    <h2 style="margin-top:18px">States <em>shown on m</em></h2>
    <div class="row" style="gap:16px;align-items:flex-start">
      ${[['Normal', ''], ['Hover', 'hov'], ['Focus-visible', 'foc'], ['Pressed', 'pre'], ['Selected', 'sel']].map(([n, c]) => `<div><div style="width:118px;position:relative">${cv('clair', { cls: `m ${c}`, st: 'playing', h: '38h 10m' }).replace('</div>', n === 'Selected' ? '<span class="chk"><svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></span></div>' : '</div>')}</div><div style="font-size:13px;margin-top:7px;font-weight:500">${n}</div></div>`).join('')}
      <div><div style="width:118px"><div class="art cv m fb"><div class="ft">${ico('pad')}<b>SF</b></div><i class="led" style="--st:${ST.backlog}"></i><b class="hr">4h 45m</b></div></div><div style="font-size:13px;margin-top:7px;font-weight:500">No artwork</div></div>
      <div><div style="width:118px">${cv('silk', { cls: 'm ld' }).replace(/<span class="ct">.*?<\/span>/, '')}</div><div style="font-size:13px;margin-top:7px;font-weight:500">Loading</div></div>
    </div>
    <div class="g" style="grid-template-columns:1fr 1fr 1fr;gap:18px;margin-top:10px">
      <div class="note"><b>Hover</b> 180 ms: art zooms to 1.04 inside its frame, lifts 2 px, Bone ring at 30 %, shadow-lift. No ring change on touch.</div>
      <div class="note"><b>Fallback</b> when there is no artwork: Raised plate, 10 px diagonal hatch at 4.5 %, game initials in Big Shoulders 34 and a controller glyph. Neutral on purpose; never a random hue.</div>
      <div class="note"><b>Selected</b> (bulk edit): Phosphor outline offset 3 px plus a 20 px check badge top-left; the LED stays.</div>
    </div>
  </div>`

  const wc = [['cyber', 'Worst case, no protection'], ['cyber', 'With protection']]
  const bnrIn = (k, prot, pos) => `<div class="bnr" style="height:128px">${bn(k, true, false)}${prot ? `<div class="prot" style="background:${prot}"></div>` : ''}<div style="position:absolute;z-index:4;${pos}"><div class="bsx" style="font-size:44px;line-height:.95;color:#fff;text-shadow:0 1px 14px rgba(0,0,0,.35)">Cyberpunk 2077</div><div style="font-size:13px;margin-top:6px;color:var(--bone)">${dot('playing')}</div></div></div>`
  const blend = (a) => { const c = [16, 20, 22], y = [0xf4, 0xe4, 0x1c]; return '#' + c.map((v, i) => Math.round(v * a + y[i] * (1 - a)).toString(16).padStart(2, '0')).join('') }
  const rNo = ratio('#FFFFFF', '#F4E41C'), rYes = ratio('#FFFFFF', blend(0.78))
  const bannerBlock = `<div><h2>Banner and protection gradient <em>stack: art, scanlines, amber glow, protection, text</em></h2>
    <div class="g" style="grid-template-columns:1fr 1fr;gap:18px">
      <div><div class="bnr" style="height:128px">${bn('cyber', true, false)}<div style="position:absolute;z-index:4;left:20px;bottom:16px"><div class="bsx" style="font-size:44px;line-height:.95;color:#fff">Cyberpunk 2077</div></div></div><div class="note" style="margin-top:6px"><b class="lv">Without:</b> white title on the brightest art is <b class="lv">${rNo.toFixed(2)}:1</b>.</div></div>
      <div><div class="bnr" style="height:128px">${bn('cyber', true, false)}<div class="prot" style="background:linear-gradient(0deg,#101416 0%,rgba(16,20,22,.78) 30%,rgba(16,20,22,0) 66%)"></div><div style="position:absolute;z-index:4;left:20px;bottom:16px"><div class="bsx" style="font-size:44px;line-height:.95;color:var(--bone)">Cyberpunk 2077</div></div></div><div class="note" style="margin-top:6px"><b class="ok">With bottom protection:</b> Bone on the worst blend is <b class="ok">${ratio('#E9E4D8', blend(0.78)).toFixed(1)}:1</b>.</div></div>
    </div>
    <div class="g" style="grid-template-columns:1fr 1fr;gap:18px;margin-top:10px">
      <div class="note mono" style="line-height:1.45"><b>protect-bottom</b> (title bottom-left)<br>linear-gradient(0deg, #101416 0%, rgb(16 20 22/.78) 30%, transparent 66%)</div>
      <div class="note mono" style="line-height:1.45"><b>protect-side</b> (text on one side)<br>linear-gradient(90deg, rgb(16 20 22/.85) 0%, rgb(16 20 22/.5) 38%, transparent 72%)</div>
    </div>
  </div>`

  const figBlock = `<div><h2>Big figure with small unit</h2>
    <div class="col" style="gap:8px">
      <div class="row" style="gap:22px;align-items:flex-end"><span class="big" style="font-size:76px">38<small>h</small>10<small>m</small></span><span class="note" style="padding-bottom:6px">stat 76 / unit 34<br>Bone, key figure in Phosphor</span></div>
      <div class="row" style="gap:22px;align-items:flex-end"><span class="big ph" style="font-size:44px;text-shadow:0 0 18px rgba(255,179,71,.35)">1:12:04</span><span class="big" style="font-size:44px">€1.31</span><span class="big" style="font-size:44px">14</span><span class="note" style="padding-bottom:4px">page 44 · timer, money, counts</span></div>
      <div class="row" style="gap:22px;align-items:flex-end"><span class="big" style="font-size:28px">23<small>h</small>15<small>m</small></span><span class="big" style="font-size:20px;letter-spacing:.02em">61<small>h</small>30<small>m</small></span><span class="note">title 28 · figure 20</span></div>
    </div></div>`

  const mseg = (n, fill, partial, over = 0) => `<div class="mtr">${Array.from({ length: n }, (_, i) => `<i class="${i < fill ? 'f' : i === fill && partial ? 'p' : ''}"></i>`).join('')}</div>`
  const meter = `<div><h2>Segmented meter <em>HLTB, 1 segment = 1 hour</em></h2>
    <div style="font-size:13px;font-weight:500;margin-bottom:6px;display:flex;justify-content:space-between"><span>In progress · 38h 24m of 62h</span><span class="hx">Main 30h · +Extra 45h · 100 % 62h</span></div>
    ${mseg(62, 38, true)}
    <div class="hk"><span style="left:48.4%"><b>30h</b>Main</span><span style="left:72.6%"><b>45h</b>+Extra</span><span style="left:calc(100% - 52px)"><b>62h</b>100 %</span></div>
    <div class="g" style="grid-template-columns:1fr 1fr;gap:16px;margin-top:6px">
      <div><div style="font-size:13px;font-weight:500;margin-bottom:6px">Beyond 100 % <span class="hx">+9h</span></div><div class="mtr" style="grid-template-columns:repeat(71,1fr)">${Array.from({ length: 71 }, (_, i) => `<i class="${i < 62 ? 'f' : 'x'}"></i>`).join('')}</div></div>
      <div><div style="font-size:13px;font-weight:500;margin-bottom:6px">Loading</div><div class="mtr sk">${Array.from({ length: 62 }, (_, i) => `<i class="skl" style="animation-delay:${(i * 12) % 800}ms;border-radius:1px"></i>`).join('')}</div></div>
    </div>
    <div style="margin-top:10px;border:1px dashed var(--edge);border-radius:4px;height:34px;display:flex;align-items:center;justify-content:space-between;padding:0 12px;font-size:13px;color:var(--dust)"><span>No HLTB data for this game yet</span><span class="tb">Look up</span></div>
    <p class="note" style="margin-top:8px">Segments 2 px gap, Raised with a faint Line edge; filled = Phosphor; the partial hour fills proportionally. Markers are 1 px Edge ticks with the figure in Big Shoulders 16. Compact (PWA): 18 px high.</p>
  </div>`

  const day = [['Mon', 93], ['Tue', 0], ['Wed', 150], ['Thu', 0], ['Fri', 175], ['Sat', 325], ['Sun', 117]]
  const wk = (h, hoverIdx, minutes = day) => `<div class="wkb" style="--h:${h}px">${minutes.map(([d, m], i) => `<div class="${i === 6 ? 't' : ''} ${i === hoverIdx ? 'h' : ''}">${i === hoverIdx ? `<div class="tt tip">${d} · ${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m</div>` : ''}<i style="height:${Math.max(3, (m / 325) * (h - 22))}px"></i><span>${d}</span></div>`).join('')}</div>`
  const weekBlock = `<div><h2>Week bars <em>14h 20m played</em></h2>
    <div class="g" style="grid-template-columns:1.5fr 1fr;gap:22px"><div style="padding-top:34px">${wk(120, 5)}</div><div style="padding-top:34px">${wk(74, -1)}</div></div>
    <div class="row" style="gap:14px;margin-top:6px;font-size:13px;color:var(--dust)"><span>Empty week</span><span class="wkb" style="--h:34px;width:200px;gap:8px">${day.map(([d]) => `<div><i style="height:3px"></i></div>`).join('')}</span><span>Nothing played yet</span></div>
    <p class="note" style="margin-top:8px">Scale = the week’s longest day. Idle days keep a 3 px stub so the week always reads as seven. Today is Phosphor with a soft glow; past days are Bone at 22 %, hover 42 % with a tooltip. Compact variant for the PWA; no data shows seven stubs and “Nothing played yet”.</p></div>`

  const medios = page('Media: covers, banners, figures, meters', '07', 'The art does the color; the UI around it stays neutral. Every figure is Big Shoulders with a small Dust unit, every progress bar is made of whole hours.', `
  <div class="g" style="grid-template-columns:900px 1fr;gap:38px;flex:1;min-height:0">
    <div class="col" style="gap:20px">${coverBlock}${bannerBlock}</div>
    <div class="col" style="gap:20px">${figBlock}${meter}${weekBlock}</div>
  </div>`)

  return { 'sistema-superficies': superficies, 'sistema-medios': medios }
}
