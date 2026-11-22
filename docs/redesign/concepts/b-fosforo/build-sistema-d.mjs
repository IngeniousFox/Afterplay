// Hojas de movimiento del sistema Fosforo
const bez = (x1, y1, x2, y2) => (x) => {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by
  let lo = 0, hi = 1, t = x
  for (let i = 0; i < 40; i++) { const v = ((ax * t + bx) * t + cx) * t; if (Math.abs(v - x) < 1e-5) break; if (v < x) lo = t; else hi = t; t = (lo + hi) / 2 }
  return ((ay * t + by) * t + cy) * t
}
const OUT = bez(0.23, 1, 0.32, 1)
const IO = bez(0.77, 0, 0.175, 1)
const DRAWER = bez(0.32, 0.72, 0, 1)
const clamp = (v) => Math.max(0, Math.min(1, v))
const prog = (t, delay, dur, fn = OUT) => fn(clamp((t - delay) / dur))
const f2 = (n) => n.toFixed(2)

export function sheetsMotion({ page, I, ico, ic, icf, cv, bn, dot, G, ST, STN, logoSvg }) {
  /* ---------- 08 especificacion ---------- */
  const curve = (name, v, fn, note) => {
    const W = 168, H = 112, px = 14, py = 14
    const pts = Array.from({ length: 41 }, (_, i) => { const x = i / 40; return `${(px + x * (W - 2 * px)).toFixed(1)},${(H - py - fn(x) * (H - 2 * py)).toFixed(1)}` }).join(' ')
    const half = fn(0.5)
    const [x1, y1, x2, y2] = v
    const X = (x) => px + x * (W - 2 * px), Y = (y) => H - py - y * (H - 2 * py)
    return `<div><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block;background:var(--pan);border:1px solid var(--line);border-radius:6px">
      <path d="M${X(0)},${Y(0)}H${X(1)}V${Y(1)}" fill="none" stroke="rgba(233,228,216,.1)"/><path d="M${X(0)},${Y(1)}H${X(1)}" stroke="rgba(233,228,216,.1)" stroke-dasharray="2 3"/>
      <path d="M${X(0)},${Y(0)}L${X(x1)},${Y(y1)}M${X(1)},${Y(1)}L${X(x2)},${Y(y2)}" stroke="rgba(95,211,224,.55)" stroke-width="1"/>
      <circle cx="${X(x1)}" cy="${Y(y1)}" r="3" fill="var(--tube)"/><circle cx="${X(x2)}" cy="${Y(y2)}" r="3" fill="var(--tube)"/>
      <polyline points="${pts}" fill="none" stroke="var(--phos)" stroke-width="2.2" stroke-linecap="round"/>
      <circle cx="${X(0.5)}" cy="${Y(half)}" r="3.5" fill="var(--bone)"/></svg>
      <div style="font-size:14px;font-weight:600;margin-top:6px">${name}</div><div class="mono" style="font-size:12.5px;color:var(--dust)">cubic-bezier(${v.join(', ')})</div><div class="note" style="line-height:1.3">${note} Halfway through the time, ${Math.round(half * 100)} % of the way.</div></div>`
  }
  const durBars = [['press', 120, 'press, switch'], ['tip', 125, 'tooltip'], ['hover', 150, 'menus, popovers, hover'], ['cover', 180, 'cover hover'], ['dialog', 220, 'dialog, alert'], ['screen', 240, 'screen enter'], ['sheet', 320, 'sheet, Now playing'], ['toast', 360, 'toast in']]
  const durs = `<div>${durBars.map(([n, ms, u]) => `<div class="spc" style="height:23px"><b style="width:84px;font-weight:600;color:var(--bone)">${n}</b><span class="mono" style="width:54px;color:var(--bone)">${ms} ms</span><i style="width:${ms * 0.8}px;height:9px;background:var(--phos);opacity:.85"></i><span style="margin-left:2px">${u}</span></div>`).join('')}<div class="note" style="margin-top:4px">Ceiling 360 ms for anything the user waits on. Exits are 60 % of the entrance. Loops (LED, skeleton) are decorative and always stoppable.</div></div>`

  const T = [
    ['Screen enter', 'Content blocks: opacity 0→1, translateY 8→0, stagger 40 ms (max 6 blocks)', '240 ms', 'ease-out', 'Opacity only, 120 ms'],
    ['Cover hover', 'Art scale 1→1.04, lift 2 px, Bone ring .3, shadow-lift', '180 in · 120 out', 'ease-out', 'Ring only, no scale or lift'],
    ['Press (buttons, chips, covers)', 'scale 0.97 (0.96 chips, 0.98 covers)', '120 in · 160 out', 'ease-out', 'Color change only'],
    ['Row and ghost hover', 'background-color only', '100 ms', 'ease', 'Same'],
    ['Now playing appears', 'Bar translateY 100%→0; content fades in 200 ms after 120 ms; ambient glow 0→1', '320 ms (glow 600)', 'ease-drawer', 'Opacity only, 200 ms'],
    ['LED Live', 'Dot opacity 1→.4→1 and a ring scale 1→2.4 fading .5→0', '1.8 s loop', 'ease-in-out', 'Static dot with its ring; label “Live” stays'],
    ['Timer', 'Digits swap instantly (tabular). Glow ignites on start; breathes .22↔.35 on a 3.6 s loop', '240 ignite', 'ease-out / in-out', 'Ignite instant, no breath'],
    ['Dialog, alert', 'Overlay scale .96→1 + opacity from center; scrim fades 200 ms', '220 in · 140 out', 'ease-out', 'Opacity only'],
    ['Side sheet', 'translateX 100%→0; scrim fades 240 ms', '320 in · 220 out', 'ease-drawer', 'Opacity only, 160 ms'],
    ['Toast', 'In: translateY 16→0 + opacity; older ones slide up 300 ms; out: translateX 24 + opacity', '360 in · 200 out', 'ease-out / in-out', 'Opacity only'],
    ['Menu, select, popover', 'scale .97→1 + opacity, origin at the trigger', '150 ms', 'ease-out', 'Opacity only'],
    ['Tooltip', 'opacity + scale .97→1; delay 400 ms, then 0 ms for neighbours', '125 ms', 'ease-out', 'Opacity only'],
    ['Switch, checkbox', 'Thumb translateX; fill color', '160 ms', 'ease-out', 'Instant'],
    ['Skeleton sweep', '7 % amber band crossing Raised', '1.6 s loop', 'ease-in-out', 'Static Raised, no sweep'],
    ['Spinner', 'rotate 360°', '700 ms loop', 'linear', 'Opacity pulse 1.4 s'],
    ['TV focus', 'Card scale 1→1.06, Phosphor ring, halo, title fades in 60 ms late', '200 in · 120 out', 'ease-out', 'Ring and halo only, no scale'],
    ['Never animated', 'Ctrl K open/close, keyboard list navigation, tab content swap, sort/filter results', '0 ms', '—', 'Same']
  ]
  const spec = page('Motion: specification', '08', 'Fast and quiet, like a good instrument: nothing over 360 ms, ease-out for everything that arrives, and no animation at all for what a keyboard repeats a hundred times a day.', `
  <div class="g" style="grid-template-columns:920px 1fr;gap:36px;flex:1;min-height:0">
    <div><h2>What animates <em>and what it does under prefers-reduced-motion</em></h2>
      <table class="mtb"><tr><th>Element</th><th>Animates</th><th>Duration</th><th>Curve</th><th>Reduced motion</th></tr>${T.map((r) => `<tr>${r.map((c, i) => `<td class="${i === 2 ? 'n' : ''}" style="${i === 1 ? 'color:var(--bone);font-weight:400' : i > 1 ? 'color:var(--dust)' : ''}">${c}</td>`).join('')}</tr>`).join('')}</table>
    </div>
    <div class="col" style="gap:16px">
      <div><h2>Curves</h2><div class="g" style="grid-template-columns:repeat(3,1fr);gap:12px">
        ${curve('ease-out', [0.23, 1, 0.32, 1], OUT, 'Everything that enters. Instant response.')}
        ${curve('ease-in-out', [0.77, 0, 0.175, 1], IO, 'Things that move on screen.')}
        ${curve('ease-drawer', [0.32, 0.72, 0, 1], DRAWER, 'Sheet, Now playing.')}
      </div><div class="note" style="margin-top:8px"><span class="mono">ease</span> (CSS default) for color and background only; <span class="mono">linear</span> for spinners. Never ease-in: it feels slow where users are looking.</div></div>
      <div><h2>Durations</h2>${durs}</div>
      <div><h2>prefers-reduced-motion</h2>
        <div class="note" style="line-height:1.45"><b>Fewer and gentler, not none.</b> Movement and scale go; opacity and color stay, because they explain state. Every travel distance is a CSS variable (<span class="mono">--move-y</span>, <span class="mono">--scale-hover</span>) that becomes 0 / 1, so keyframes keep working as pure fades. Loops stop: the LED keeps its ring, the timer keeps counting, the skeleton stays dim. Nothing important is conveyed by motion alone.</div>
      </div>
    </div>
  </div>`)

  /* ---------- 09 fotogramas ---------- */
  const fr = (label, inner) => `<div class="frm">${inner}<span class="tm">${label}</span></div>`
  const row = (name, spec, frames) => `<div class="fl2"><div class="nm"><b>${name}</b>${spec}</div>${frames.join('')}</div>`
  const bar = (w, h, extra = '') => `<i style="display:block;width:${w}px;height:${h}px;border-radius:2px;background:var(--rai);${extra}"></i>`

  const screenRow = row('Screen enter', '240 ms ease-out, blocks staggered 40 ms', [0, 80, 160, 240, 360].map((t) => {
    const b = (i) => { const p = prog(t, i * 40, 240); return `opacity:${f2(p)};transform:translateY(${f2((1 - p) * 8)}px)` }
    return fr(`${t} ms`, `<div style="padding:8px 12px;display:flex;flex-direction:column;gap:5px"><div style="${b(0)}"><span class="bsx" style="font-size:18px;line-height:1">Tonight</span></div><div style="${b(1)};height:12px;width:150px;border-radius:3px;background:var(--pan);border:1px solid var(--line)"></div><div class="row" style="gap:6px;${b(2)}">${['silk', 'clair', 'balatro', 'hades2', 'split'].map((k) => `<div style="width:24px">${cv(k)}</div>`).join('')}</div></div>`)
  }))

  const hoverRow = row('Cover hover', '180 ms ease-out in, 120 ms out', [0, 45, 90, 135, 180].map((t) => {
    const p = prog(t, 0, 180)
    return fr(`${t} ms`, `<div style="position:absolute;left:calc(50% - 22px);top:14px;width:44px;transform:translateY(${f2(-2 * p)}px) scale(${f2(1 + 0.04 * p)});box-shadow:0 0 0 1px rgba(233,228,216,${f2(0.3 * p)}),0 ${f2(10 * p)}px ${f2(20 * p)}px -8px rgba(3,6,7,${f2(0.8 * p)});border-radius:4px">${cv('clair', { st: 'playing' })}</div>`)
  }))

  const npRow = row('Now playing appears', '320 ms ease-drawer; glow 600 ms', [0, 100, 200, 320, 600].map((t) => {
    const p = prog(t, 0, 320, DRAWER), c = prog(t, 120, 200), g = prog(t, 0, 600)
    return fr(`${t} ms`, `<div style="position:absolute;left:10px;right:10px;top:10px;display:flex;flex-direction:column;gap:6px">${bar(80, 8)}${bar(150, 18, 'background:var(--pan)')}</div>
      <div style="position:absolute;left:0;right:0;bottom:0;height:30px;transform:translateY(${f2((1 - p) * 100)}%);background:linear-gradient(90deg,rgba(255,179,71,${f2(0.12 * g)}),rgba(255,179,71,0) 45%),var(--pan);border-top:1px solid var(--line2);display:flex;align-items:center;gap:8px;padding:0 8px;opacity:${p > 0 ? 1 : 0}">
      <div style="opacity:${f2(c)};display:flex;align-items:center;gap:8px;width:100%"><div style="width:14px">${cv('silk')}</div><i style="display:block;width:46px;height:5px;background:var(--dust);opacity:.5;border-radius:2px"></i><span class="bsx ph" style="font-size:15px;margin-left:auto;text-shadow:0 0 12px rgba(255,179,71,${f2(0.35 * g)})">1:12:04</span></div></div>`)
  }))

  const ledRow = row('LED Live', '1.8 s loop, ease-in-out; ring expands', [0, 450, 900, 1350, 1800].map((t) => {
    const ph = (t % 1800) / 1800, half = ph <= 0.5 ? IO(ph / 0.5) : 1 - IO((ph - 0.5) / 0.5)
    const op = 1 - 0.6 * half, rp = ph === 0 && t > 0 ? 0 : OUT(ph)
    return fr(`${t} ms`, `<div style="position:absolute;left:0;right:0;top:0;bottom:16px;display:flex;align-items:center;justify-content:center;gap:10px"><span style="position:relative;width:14px;height:14px;display:block"><i style="position:absolute;inset:0;border-radius:50%;border:2px solid var(--live);opacity:${f2(0.5 * (1 - rp))};transform:scale(${f2(1 + 1.4 * rp)})"></i><i style="position:absolute;inset:0;border-radius:50%;background:var(--live);opacity:${f2(op)};box-shadow:0 0 10px var(--live)"></i></span><span style="font-size:13px;color:var(--dust)">Live · <span class="bsx" style="font-size:15px;color:var(--bone)">1:12:04</span></span></div>`)
  }))

  const timerRow = row('Timer', 'ignite 240 ms ease-out; digits never tween', [[0, '0:00:00'], [80, '0:00:00'], [160, '0:00:00'], [240, '0:00:00'], [1000, '0:00:01']].map(([t, d]) => {
    const p = prog(t, 0, 240)
    const col = `color-mix(in srgb,var(--phos) ${Math.round(p * 100)}%,var(--dust))`
    return fr(`${t} ms`, `<div style="position:absolute;inset:0 0 16px;display:flex;align-items:center;justify-content:center"><span class="bsx" style="font-size:38px;color:${col};text-shadow:0 0 18px rgba(255,179,71,${f2(0.35 * p)})">${d}</span></div>`)
  }))

  const modalRow = row('Dialog open', '220 ms ease-out, from scale .96, center origin', [0, 60, 120, 180, 220].map((t) => {
    const p = prog(t, 0, 220), s = prog(t, 0, 200)
    return fr(`${t} ms`, `<div style="position:absolute;inset:0;padding:8px;display:grid;grid-template-columns:repeat(8,1fr);gap:4px;align-content:start;opacity:.8">${['silk', 'clair', 'balatro', 'hades2', 'split', 'meta', 'pent', 'well', 'lies', 'octo', 'outer', 'celeste', 'tunic', 'hades', 'obra', 'cocoon'].map((k) => cv(k)).join('')}</div><div style="position:absolute;inset:0;background:rgba(8,11,12,${f2(0.72 * s)})"></div>
      <div class="dlg" style="position:absolute;left:34px;right:34px;top:12px;height:50px;opacity:${f2(p)};transform:scale(${f2(0.96 + 0.04 * p)});padding:8px 10px"><span class="bsx" style="font-size:15px">Add spend</span><div class="row" style="gap:6px;margin-top:6px">${bar(50, 8)}${bar(34, 8, 'background:var(--phos)')}</div></div>`)
  }))

  const sheetRow = row('Side sheet open', '320 ms ease-drawer from the right', [0, 80, 160, 240, 320].map((t) => {
    const p = prog(t, 0, 320, DRAWER), s = prog(t, 0, 240)
    return fr(`${t} ms`, `<div style="position:absolute;inset:0;padding:8px;display:grid;grid-template-columns:repeat(8,1fr);gap:4px;align-content:start;opacity:.8">${['silk', 'clair', 'balatro', 'hades2', 'split', 'meta', 'pent', 'well', 'lies', 'octo', 'outer', 'celeste', 'tunic', 'hades', 'obra', 'cocoon'].map((k) => cv(k)).join('')}</div><div style="position:absolute;inset:0;background:rgba(8,11,12,${f2(0.72 * s)})"></div>
      <div class="dlg" style="position:absolute;top:0;bottom:0;right:0;width:76px;border-radius:0;transform:translateX(${f2((1 - p) * 100)}%);padding:8px"><span class="bsx" style="font-size:13px">Edit</span><div class="col" style="gap:4px;margin-top:6px">${bar(56, 7)}${bar(56, 7)}${bar(40, 7, 'background:var(--phos)')}</div></div>`)
  }))

  const toastRow = row('Toast', '360 ms ease-out in; older ones shift 300 ms', [0, 90, 180, 270, 360].map((t) => {
    const p = prog(t, 0, 360), sh = prog(t, 0, 300, IO)
    return fr(`${t} ms`, `<div class="toast" style="--tc:var(--tube);position:absolute;left:14px;right:14px;bottom:${f2(10 + 30 * sh)}px;min-height:24px;padding:4px 8px;font-size:11px;border-radius:4px"><span style="color:var(--dust)">Synced from Laptop</span></div>
      <div class="toast" style="--tc:var(--beaten);position:absolute;left:14px;right:14px;bottom:10px;min-height:24px;padding:4px 8px;font-size:11px;border-radius:4px;opacity:${f2(p)};transform:translateY(${f2((1 - p) * 16)}px)"><span>Session saved</span><span class="undo" style="margin-left:auto;font-size:11px;height:16px;padding:0">Undo</span></div>`)
  }))

  const tvRow = row('TV focus', '200 ms ease-out; title 160 ms after 60 ms', [0, 50, 100, 150, 200].map((t) => {
    const p = prog(t, 0, 200), tt = prog(t, 60, 160)
    const card = (k, focus) => `<div style="position:relative;width:34px;${focus ? `transform:scale(${f2(1 + 0.06 * p)});z-index:2;border-radius:4px;box-shadow:0 0 0 ${f2(2 * p)}px var(--phos),0 0 ${f2(32 * p)}px rgba(255,179,71,${f2(0.45 * p)})` : ''}">${cv(k)}${focus ? `<div class="bsx" style="position:absolute;left:0;right:0;top:100%;margin-top:6px;font-size:12px;text-align:center;white-space:nowrap;opacity:${f2(tt)}">${G[k].n.split(':')[0]}</div>` : ''}</div>`
    return fr(`${t} ms`, `<div style="position:absolute;inset:0 0 16px;display:flex;align-items:center;justify-content:center;gap:12px;padding-bottom:6px">${card('silk', false)}${card('clair', true)}${card('balatro', false)}</div>`)
  }))

  const frames = page('Motion: keyframes', '09', 'Frames are computed from the real curves, not drawn by hand: each frame shows the exact opacity, offset and scale at that millisecond.', `
  <div style="flex:1;min-height:0">${screenRow}${hoverRow}${npRow}${ledRow}${timerRow}${modalRow}${sheetRow}${toastRow}${tvRow}</div>`)

  return { 'sistema-movimiento': spec, 'sistema-movimiento-fotogramas': frames }
}
