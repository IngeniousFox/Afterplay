// Hojas de controles del sistema Fosforo
const STS = [['Normal', ''], ['Hover', 'h'], ['Focus-visible', 'f'], ['Active', 'a'], ['Disabled', 'd'], ['Loading', 'l']]

export function sheetsControls({ page, I, ico, ic, icf, cv, dot, G, ST, STN }) {
  const table = (rows) => `<div class="ctl"><div class="h"></div>${STS.map(([n]) => `<div class="h">${n}</div>`).join('')}${rows
    .map(([name, sub, fn]) => `<div class="l"><div>${name}${sub ? `<small>${sub}</small>` : ''}</div></div>${STS.map(([, c]) => `<div class="c">${fn(c)}</div>`).join('')}`)
    .join('')}</div>`
  const spin = '<i class="spin"></i>'
  const btn = (v, c, label, icon = '') => `<button class="b ${v} ${c}">${c === 'l' ? spin : ''}${icon}<span class="lbl" style="${c === 'l' ? 'opacity:0' : ''}">${label}</span></button>`
  const btnI = (v, c, icon) => `<button class="b ${v} ico ${c}">${c === 'l' ? spin : icon}</button>`

  /* ---------- A: botones, inputs, menus ---------- */
  const dropdown = `<div class="menu" style="width:232px">
    <div class="mhd">Status</div>
    <div class="mi">${dot('playing')}Playing</div>
    <div class="mi sel2 h" style="background:rgba(233,228,216,.08)">${dot('backlog')}Backlog<span style="margin-left:auto;color:var(--phos)">${ico('check')}</span></div>
    <div class="mi f">${dot('beaten')}Beaten</div>
    <div class="mi">${dot('resting')}Resting</div>
    <div class="mi d">${dot('dropped')}Dropped<span class="hx" style="margin-left:auto">Soon</span></div>
  </div>`
  const ctx = `<div class="menu" style="width:260px">
    <div class="mi">${ic('play')}Open game<kbd>Enter</kbd></div>
    <div class="mi h">${ic('clock')}Start timer<kbd>T</kbd></div>
    <div class="mi d">${ic('plan')}Add to plan<kbd>P</kbd></div>
    <div class="mi">${ic('note')}Add note<kbd>N</kbd></div>
    <div class="msep"></div>
    <div class="mi f">${ic('sliders')}Change status<span style="margin-left:auto;color:var(--dust)">${ico('chevR')}</span></div>
    <div class="mi">${ico('copy')}Copy title</div>
    <div class="msep"></div>
    <div class="mi dg">${ico('trash')}Remove from library<kbd style="color:var(--live)">Del</kbd></div>
  </div>`
  const palRow = (k, st, meta, cls = '') => `<div class="mi ${cls}" style="height:46px;gap:12px;padding:0 12px">${cv(k)}<div style="width:26px;margin-left:-38px"></div><div><div style="font-weight:500">${G[k].n}</div><div class="hx" style="display:flex;gap:6px;align-items:center">${dot(st)}${STN[st]}</div></div><span class="hx" style="margin-left:auto">${meta}</span></div>`
  const palette = `<div class="pal" style="width:520px">
    <div class="q">${ic('search')}<span>hollow</span><span class="in caret" style="width:1px;height:18px;background:var(--phos);border:0;padding:0;margin-left:-6px"></span><kbd style="margin-left:auto">Esc</kbd></div>
    <div class="mhd" style="padding-top:8px">Games</div>
    <div class="mi h sel2" style="height:46px;gap:12px;padding:0 12px"><div style="width:26px;flex:none">${cv('hollow')}</div><div><div style="font-weight:500">Hollow Knight</div><div class="hx" style="display:flex;gap:6px;align-items:center">${dot('beaten')}Beaten</div></div><span class="hx" style="margin-left:auto">42h 10m</span></div>
    <div class="mi" style="height:46px;gap:12px;padding:0 12px"><div style="width:26px;flex:none">${cv('silk')}</div><div><div style="font-weight:500">Hollow Knight: Silksong</div><div class="hx" style="display:flex;gap:6px;align-items:center">${dot('playing')}Playing</div></div><span class="hx" style="margin-left:auto">23h 15m</span></div>
    <div class="mhd">Actions</div>
    <div class="mi">${ic('plan')}Add “hollow” to plan<kbd>Ctrl Enter</kbd></div>
    <div class="row" style="gap:16px;padding:9px 14px;border-top:1px solid var(--line);margin-top:4px;font-size:12px;color:var(--dust)"><span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Ctrl Enter</kbd> add</span><span style="margin-left:auto">No animation: opens instantly</span></div>
  </div>`

  const botones = page('Controls: buttons and inputs', '04', 'Every control in six states. Focus is a 2 px Phosphor outline offset by 2 px; press scales to 0.97; disabled is 40 % opacity; loading keeps the width and swaps the label for a spinner.', `
  ${table([
    ['Primary', 'amber, one per view', (c) => btn('pri', c, 'Start timer', icf('play'))],
    ['Secondary', 'Raised + Line strong', (c) => btn('bsec', c, 'Add note', ic('note'))],
    ['Ghost', 'toolbars, cancel', (c) => btn('gh', c, 'Cancel')],
    ['Danger Live', 'Stop, delete', (c) => btn('dan', c, 'Stop', icf('stop'))],
    ['Icon only', 'ghost, secondary, primary', (c) => `<span class="row" style="gap:8px">${btnI('gh', c, ic('gear'))}${btnI('bsec', c, ic('plus'))}${btnI('pri', c, ic('plus'))}</span>`],
    ['Text input', 'Inset fill, Edge border', (c) => `<div class="in ${c}">${c === 'f' ? '<span>Hollow</span><i class="caret"></i>' : c === 'a' ? '<span>Hollow Kn</span><i class="caret"></i>' : c === 'd' ? '<span class="ph2">Game title</span>' : c === 'l' ? '<span class="ph2">Checking…</span><i class="spin"></i>' : '<span class="ph2">Game title</span>'}</div>`],
    ['Search', 'opens with Ctrl K', (c) => `<div class="in ${c}">${ic('search')}${c === 'f' ? '<span>hollow</span><i class="caret"></i>' : '<span class="ph2">Search</span>'}${c === 'l' ? '<i class="spin"></i>' : '<kbd>Ctrl K</kbd>'}</div>`],
    ['Select', 'opens a menu', (c) => `<div class="in sel ${c === 'a' ? 'f' : c}"><span style="display:inline-flex;gap:8px;align-items:center">${dot('playing')}Playing</span>${c === 'l' ? '<i class="spin"></i>' : `<span style="color:var(--dust);display:flex">${c === 'a' ? ico('chevD').replace('chevD', '') : ico('chevD')}</span>`}</div>`]
  ])}
  <div class="g" style="grid-template-columns:300px 232px 260px 520px;gap:28px;margin-top:20px;align-items:start">
    <div class="col" style="gap:12px">
      <h2 style="margin:0">Sizes and validation</h2>
      <div class="row" style="gap:10px;align-items:flex-end"><button class="b pri sm">Small 28</button><button class="b pri">Medium 34</button><button class="b pri lg">Large 44</button></div>
      <div><div class="in err"><span>-5</span></div><div style="font-size:13px;color:var(--live);display:flex;gap:6px;align-items:center;margin-top:5px">${ico('tri').replace('class="i "', 'class="i" style="width:15px;height:15px"')}Hours can’t be negative.</div></div>
      <div><div class="in"><span class="ph2">Platform</span></div><div class="hx" style="margin-top:5px">Helper text sits 4 px below, Dust 13 px.</div></div>
    </div>
    <div class="col"><h2>Select, open <em>origin: trigger</em></h2>${dropdown}</div>
    <div class="col"><h2>Context menu <em>right click, ⋯</em></h2>${ctx}</div>
    <div class="col"><h2>Ctrl K <em>command palette</em></h2>${palette}</div>
  </div>`)

  /* ---------- B: seleccion y navegacion ---------- */
  const lab = (inner, t) => `<span class="lab2">${inner}${t ? `<span>${t}</span>` : ''}</span>`
  const cbx = (c, on, mix) => `<span class="cb ${on ? 'on' : ''} ${mix ? 'mix' : ''} ${c}">${on && !mix ? '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>' : ''}</span>`
  const sg = (c, items) => `<span class="seg2">${items.map(([t, on, st]) => `<span class="${on ? 'on' : ''} ${st ? c : ''}">${t}${on && c === 'l' ? '<i class="spin" style="width:11px;height:11px;border-radius:50%;border:2px solid currentColor;border-right-color:transparent;display:inline-block;animation:spin 700ms linear infinite"></i>' : ''}</span>`).join('')}</span>`
  const chp = (k, c, on, label) => `<span class="chp ${on ? 'on' : ''} ${c === 'l' ? 'skel' : c}" style="--st:${ST[k]}">${c === 'l' ? '' : `${dot(k)}${label}`}</span>`

  const tooltipBlock = `<div>
    <h2>Tooltip <em>Overlay, 13 px, 28 px high</em></h2>
    <div class="col" style="gap:14px;align-items:flex-start">
      <div class="col" style="gap:6px;align-items:center"><div class="tip">Add note<kbd>N</kbd></div><button class="b bsec ico h">${ic('note')}</button></div>
      <div class="note" style="max-width:380px"><b>Delay 400 ms</b> the first time, then <b>0 ms</b> while another tooltip was open less than 300 ms ago (toolbar sweeps feel instant). Fade 125 ms, scale from 0.97, origin = trigger edge. Only on <span class="mono">hover: hover</span> and keyboard focus. Never holds essential info: it repeats the aria-label.</div>
      <div class="row" style="gap:6px;align-items:center">
        <div style="border-left:2px solid var(--phos);padding-left:8px;font-size:12px;color:var(--dust);line-height:1.3">hover<br><b style="color:var(--bone)">400 ms</b></div>${ico('arrow').replace('class="i "', 'class="i" style="color:var(--dust)"')}
        <div class="tip">Add note</div>${ico('arrow').replace('class="i "', 'class="i" style="color:var(--dust)"')}
        <div style="border-left:2px solid var(--tube);padding-left:8px;font-size:12px;color:var(--dust);line-height:1.3">neighbour<br><b style="color:var(--bone)">0 ms</b></div>
      </div>
    </div>
  </div>`

  const sliderBlock = `<div>
    <h2>Slider <em>minimum hours in filters</em></h2>
    <div class="col" style="gap:30px;padding-top:22px">
      ${[['Normal', 24, ''], ['Hover', 40, 'h'], ['Focus-visible', 56, 'f'], ['Active, dragging', 72, 'a']].map(([n, p, c]) => `<div class="row" style="gap:14px"><span style="width:112px;font-size:13px;color:var(--dust)">${n}</span><div class="slider"><div class="trk"><div class="rng" style="width:${p}%"></div></div>${c === 'a' ? `<span class="val" style="left:${p}%">${Math.round(p * 2)}h</span>` : ''}<div class="th ${c}" style="left:${p}%"></div></div></div>`).join('')}
      <div class="row" style="gap:14px"><span style="width:112px;font-size:13px;color:var(--dust)">Disabled</span><div class="slider d"><div class="trk"><div class="rng" style="width:36%"></div></div><div class="th" style="left:36%"></div></div></div>
      <div class="row" style="gap:14px"><span style="width:112px;font-size:13px;color:var(--dust)">Range</span><div class="slider"><div class="trk"><div class="rng" style="left:20%;width:46%"></div></div><div class="th" style="left:20%"></div><div class="th h" style="left:66%"></div></div></div>
      <div class="note">Track 4 px, thumb 16 px with a 40 px invisible hit area. Arrow keys ±1, Shift ±10. Value bubble only while dragging. Loading: the track becomes a skeleton.</div>
    </div>
  </div>`

  const cell = (n, c) => `<div class="cal-d"></div>`
  const days = []
  const mk = (n, cls = '') => `<div class="dy ${cls}">${n}</div>`
  for (const d of [26, 27, 28, 29, 30, 31]) days.push(mk(d, 'o'))
  for (let d = 1; d <= 30; d++) {
    let cls = ''
    if (d === 22) cls = 't'
    if (d === 14) cls = 'h'
    if (d === 18) cls = 's hasses'
    if (d === 9 || d === 20 || d === 21) cls = 'hasses'
    if (d === 11) cls = 'f'
    if (d > 22) cls = 'd'
    days.push(mk(d, cls))
  }
  for (const d of [1, 2, 3, 4, 5]) days.push(mk(d, 'o'))
  const calendar = `<div class="cal"><div class="ch"><button class="b gh ico sm">${ico('chevL')}</button><span>November 2026</span><button class="b gh ico sm">${ico('chevR')}</button></div><div class="gd">${['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((w) => `<div class="wd">${w}</div>`).join('')}${days.slice(0, 35).join('')}</div></div>`
  const dateBlock = `<div>
    <h2>Date picker <em>popover from the field</em></h2>
    <div class="row" style="gap:22px;align-items:flex-start">
      <div class="col" style="gap:10px;width:200px;flex:none">
        <div class="in"><span>Nov 18, 2026</span><span style="margin-left:auto;display:flex;color:var(--dust)">${ico('cal')}</span></div>
        <div class="in f"><span>Nov 18, 2026</span><span style="margin-left:auto;display:flex;color:var(--phos)">${ico('cal')}</span></div>
        <div class="in d"><span>Nov 18, 2026</span><span style="margin-left:auto;display:flex;color:var(--dust)">${ico('cal')}</span></div>
        <div class="note">Typeable (Nov 18, 2026 or 2026-11-18); the calendar is a shortcut. Future days disabled for sessions.</div>
      </div>
      <div>${calendar}
        <div class="row" style="gap:14px;margin-top:8px;font-size:12px;color:var(--dust);flex-wrap:wrap;width:292px"><span class="row" style="gap:5px"><i style="width:12px;height:12px;border:1px solid var(--phos);border-radius:3px"></i>today</span><span class="row" style="gap:5px"><i style="width:12px;height:12px;background:var(--phos);border-radius:3px"></i>selected</span><span class="row" style="gap:5px"><i style="width:5px;height:5px;background:var(--tube);border-radius:50%"></i>has sessions</span></div>
      </div>
    </div>
  </div>`

  const seleccion = page('Controls: selection and navigation', '05', 'Selected = Phosphor fill or underline. Unselected controls rest on Edge (3:1). Where a state does not apply the cell says so instead of inventing one.', `
  ${table([
    ['Checkbox', 'off · on · mixed', (c) => (c === 'l' ? '<span class="na">n/a, instant</span>' : `<span class="row" style="gap:14px">${cbx(c, false)}${cbx(c, true)}${cbx(c, true, true)}</span>`)],
    ['Radio', 'off · on', (c) => (c === 'l' ? '<span class="na">n/a, instant</span>' : `<span class="row" style="gap:14px"><span class="rd ${c}"></span><span class="rd on ${c}"></span></span>`)],
    ['Switch', 'off · on', (c) => `<span class="row" style="gap:14px"><span class="sw2 ${c}"></span><span class="sw2 on ${c}"></span></span>`],
    ['Segmented', 'view and range', (c) => (c === 'l' ? sg('l', [['Grid', true, true], ['List', false]]) : sg(c, [['Grid', true], ['List', false, true]]))],
    ['Tabs', 'detail page', (c) => (c === 'l' ? `<span class="tabs2"><span class="on">Overview</span><span>Notes <i class="skl" style="width:14px;height:12px;margin-left:6px;display:inline-block"></i></span></span>` : `<span class="tabs2"><span class="on">Overview</span><span class="${c}">Notes<i class="n">12</i></span></span>`)],
    ['Chip with LED', 'status filter', (c) => `<span class="row" style="gap:8px">${chp('playing', '', true, 'Playing')}${chp('beaten', c, false, 'Beaten')}</span>`]
  ])}
  <p class="note" style="margin:6px 0 14px;max-width:1300px">Checkbox and radio are 18 px with a 34 px label row as hit area. Switch 38×22 slides 160 ms; on pointer-down the thumb stretches to 19 px. Checkbox/radio “loading” does not exist: they are instant; a switch that waits for sync shows a spinner thumb. In segmented and tabs the focus outline sits inside the item so neighbours don’t clip it.</p>
  <div class="g" style="grid-template-columns:400px 460px 1fr;gap:36px;align-items:start">${tooltipBlock}${sliderBlock}${dateBlock}</div>`)

  return { 'sistema-controles-botones': botones, 'sistema-controles-seleccion': seleccion }
}
