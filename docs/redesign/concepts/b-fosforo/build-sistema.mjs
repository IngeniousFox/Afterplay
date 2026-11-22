// Genera las hojas del sistema de diseno Fosforo. Uso: node build-sistema.mjs
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { G, ST, STN, cv, bn, dot, ic, icf, FONTS, logoSvg } from './build.mjs'
import { sheetsControls } from './build-sistema-b.mjs'
import { sheetsSurfaces } from './build-sistema-c.mjs'
import { sheetsMotion } from './build-sistema-d.mjs'
import { fileURLToPath } from 'node:url'
const dir = dirname(fileURLToPath(import.meta.url))

/* ---------- utilidades ---------- */
const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16))
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
const lum = (c) => { const [r, g, b] = hex(c); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) }
export const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }

export const page = (title, no, sub, body) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${FONTS}<link rel="stylesheet" href="styles.css"><link rel="stylesheet" href="sistema.css"></head><body><div class="sx"><header><span class="no">${no}</span><h1>${title}</h1><p>${sub}</p></header>${body}</div></body></html>`

export const I = (d, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24">${d}</svg>`
export const IC = {
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>', chevR: '<path d="m9 6 6 6-6 6"/>', chevL: '<path d="m15 6-6 6 6 6"/>', chevD: '<path d="m6 9 6 6 6-6"/>',
  trash: '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13M10 11v5M14 11v5"/>', copy: '<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
  tri: '<path d="M12 4 21 19.5H3z"/><path d="M12 10v4.5M12 17h.01"/>', okc: '<circle cx="12" cy="12" r="8.5"/><path d="m8 12.2 2.9 2.9L16.2 9.6"/>', undo: '<path d="M9 8 4.5 12.5 9 17M5 12.5h9a5 5 0 0 1 0 10"/>',
  pad: '<path d="M7 8h10a4 4 0 0 1 3.9 4.9l-.7 3.2a2.4 2.4 0 0 1-4 1.2L14 15.5h-4L7.8 17.3a2.4 2.4 0 0 1-4-1.2l-.7-3.2A4 4 0 0 1 7 8z"/><path d="M8 10.5v3M6.5 12h3M15.5 11.5h.01M17.5 13h.01"/>',
  cal: '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M8 3.5v4M16 3.5v4M4 10h16"/>', pen: '<path d="M4 20h4l11-11-4-4L4 16z"/>', dl: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>', lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="1.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5h4"/>', arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>', more: '<circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/>', stat: '<path d="M5 20V10M12 20V4M19 20v-7"/>'
}
export const ico = (k) => I(IC[k])
export { G, ST, STN, cv, bn, dot, ic, icf, logoSvg }

/* ---------- 01 color ---------- */
const sw = (c, n, h, u, extra = '') => `<div class="sw"><i style="background:${c}${extra}"></i><div><b>${n}<span class="mono">${h}</span></b><p>${u}</p></div></div>`

const SURF = { Inset: '#0C1012', Cabinet: '#101416', Panel: '#171D20', Raised: '#1F272B', Overlay: '#242C31' }
const matrix = () => {
  const fgs = [['Bone', '#E9E4D8'], ['Dust', '#8A9496'], ['Phosphor', '#FFB347'], ['Tube', '#5FD3E0'], ['Live', '#FF5E57'], ['Beaten', '#9BD67A'], ['Resting', '#B9A6FF'], ['Caution', '#E8C468']]
  return `<table class="ct-t"><tr><th>Text on</th>${Object.keys(SURF).map((s) => `<th class="r" style="text-align:right">${s}</th>`).join('')}</tr>${fgs
    .map(([n, f]) => `<tr><td><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${f};margin-right:8px"></i>${n}</td>${Object.values(SURF).map((b) => { const r = ratio(f, b); return `<td class="r ${r >= 4.5 ? 'ok' : 'lv'}">${r.toFixed(2)}</td>` }).join('')}</tr>`).join('')}</table>`
}
const pairs = () => {
  const P = [['Ink on Phosphor', '#1A1100', '#FFB347', 4.5], ['Ink on Phosphor active (lowest)', '#1A1100', '#E39A2E', 4.5], ['Ink Live on Live', '#1C0605', '#FF5E57', 4.5], ['Ink Live on Live active (lowest)', '#1C0605', '#E5463F', 4.5],
    ['Bone on Raised selected tint', '#E9E4D8', '#2A2923', 4.5], ['Edge (control border) on Panel', '#707370', '#171D20', 3], ['Edge on Raised', '#707370', '#1F272B', 3], ['Focus ring Phosphor on Raised (lowest)', '#FFB347', '#1F272B', 3]]
  return `<table class="ct-t"><tr><th>Pair</th><th style="text-align:right">Ratio</th><th style="text-align:right">Min.</th></tr>${P.map(([n, a, b, m]) => { const r = ratio(a, b); return `<tr><td>${n}</td><td class="r ${r >= m ? 'ok' : 'lv'}">${r.toFixed(2)}</td><td class="r" style="font-weight:400;color:var(--dust)">${m}:1</td></tr>` }).join('')}</table>`
}
const ladderRow = (n, cells) => `<div style="font-size:13px;font-weight:500;color:var(--bone)">${n}</div>${cells.map(([bg, fg, t, bd]) => `<div class="lb" style="background:${bg};color:${fg};${bd ? `box-shadow:inset 0 0 0 1px ${bd}` : ''}">${t}</div>`).join('')}`

const colors = () => page('Color tokens', '01', 'Dark only. Teal-tinted petrol surfaces climb in five lightness steps; one amber accent for what is hot right now. Every pair below is measured (WCAG 2.x).', `
<div class="g" style="grid-template-columns:455px 455px 1fr;gap:34px;flex:1;min-height:0">
<div>
  <h2>Surfaces <em>one step of lightness per layer</em></h2>
  ${sw('#0C1012', 'Inset', '#0C1012', 'Wells: inputs, kbd, skeleton base. Below the page.')}
  ${sw('#101416', 'Cabinet', '#101416', 'App background (layer 0).')}
  ${sw('#171D20', 'Panel', '#171D20', 'Panels, tables, Now playing bar (layer 1).')}
  ${sw('#1F272B', 'Raised', '#1F272B', 'Hover rows, selection, secondary buttons (layer 2).')}
  ${sw('#242C31', 'Overlay', '#242C31', 'Menus, dialogs, sheets, toasts (layer 3). Floats.')}
  <h2 style="margin-top:14px">Borders</h2>
  ${sw('rgba(233,228,216,.09)', 'Line', '.09 Bone', 'Dividers, panel outlines, row separators.', ';background-color:#171D20;background-image:linear-gradient(rgba(233,228,216,.09),rgba(233,228,216,.09))')}
  ${sw('rgba(233,228,216,.17)', 'Line strong', '.17 Bone', 'Secondary buttons, floating layers, chips.', ';background-color:#171D20;background-image:linear-gradient(rgba(233,228,216,.17),rgba(233,228,216,.17))')}
  ${sw('#707370', 'Edge', '#707370', 'Boundary of form controls (3.2:1, WCAG 1.4.11).')}
  <h2 style="margin-top:14px">Text</h2>
  ${sw('#E9E4D8', 'Bone', '#E9E4D8', 'Primary text, figures.')}
  ${sw('#8A9496', 'Dust', '#8A9496', 'Secondary text, units, icons at rest. 4.57:1 on Overlay.')}
</div>
<div>
  <h2>Accent and signal</h2>
  ${sw('#FFB347', 'Phosphor', '#FFB347', 'Focus, selection, Play, key figures. The only accent.')}
  ${sw('#FFC266', 'Phosphor hi', '#FFC266', 'Hover on amber surfaces.')}
  ${sw('#E39A2E', 'Phosphor lo', '#E39A2E', 'Active (pressed) on amber surfaces.')}
  ${sw('rgba(255,179,71,.11)', 'Phosphor tint', '.11 / .22 / .35', 'Selected row, focus ring halo, text glow.', ';background-color:#171D20;background-image:linear-gradient(rgba(255,179,71,.11),rgba(255,179,71,.11))')}
  ${sw('#5FD3E0', 'Tube', '#5FD3E0', 'Sync, info, links. Hover #8CE4EE.')}
  ${sw('#FF5E57', 'Live', '#FF5E57', 'Running session, Stop, destructive. Hover #FF756F, active #E5463F.')}
  ${sw('#9BD67A', 'Success', '#9BD67A', 'Beaten, saved, done. Alias of the Beaten LED.')}
  ${sw('#E8C468', 'Caution', '#E8C468', 'Warnings only, always with a triangle icon.')}
  <h2 style="margin-top:14px">Status LEDs <em>9 px dot + 8 px glow</em></h2>
  <div class="row" style="gap:6px">${Object.entries(ST).map(([k, c]) => `<div style="flex:1;padding:8px 0 0"><div class="row" style="gap:7px;font-size:13.5px;font-weight:500">${dot(k)}${STN[k]}</div><div class="hx mono" style="margin-top:3px">${c}</div></div>`).join('')}</div>
  <p class="note" style="margin-top:8px">The LED is the only place where five hues coexist. A color never carries meaning alone: it always sits next to its word.</p>
  <h2 style="margin-top:14px">Contrast, on-accent and non-text <em>AA: 4.5:1 text, 3:1 non-text</em></h2>
  ${pairs()}
</div>
<div>
  <h2>Interactive states <em>fill by state</em></h2>
  <div class="ladder">
    <span></span><span>Rest</span><span>Hover</span><span>Active</span><span>Disabled</span>
    ${ladderRow('Primary', [['#FFB347', '#1A1100', '#FFB347'], ['#FFC266', '#1A1100', '#FFC266'], ['#E39A2E', '#1A1100', '#E39A2E'], ['#FFB347', '#1A1100', '40 % opacity']])}
    ${ladderRow('Live', [['#FF5E57', '#1C0605', '#FF5E57'], ['#FF756F', '#1C0605', '#FF756F'], ['#E5463F', '#1C0605', '#E5463F'], ['#FF5E57', '#1C0605', '40 % opacity']])}
    ${ladderRow('Secondary', [['#1F272B', '#E9E4D8', '#1F272B', 'rgba(233,228,216,.17)'], ['#2A343A', '#E9E4D8', '#2A343A', 'rgba(233,228,216,.3)'], ['#1A2226', '#E9E4D8', '#1A2226', 'rgba(233,228,216,.17)'], ['#1F272B', '#E9E4D8', '40 % opacity']])}
    ${ladderRow('Ghost', [['transparent', '#8A9496', 'transparent'], ['rgba(233,228,216,.06)', '#E9E4D8', '.06 Bone'], ['rgba(233,228,216,.11)', '#E9E4D8', '.11 Bone'], ['transparent', '#8A9496', '40 % opacity']])}
    ${ladderRow('List row', [['#171D20', '#E9E4D8', 'Panel'], ['#1F272B', '#E9E4D8', 'Raised'], ['#2A2923', '#E9E4D8', 'Selected'], ['#171D20', '#E9E4D8', '40 % opacity']])}
  </div>
  <p class="note" style="margin:8px 0 14px">Disabled is the same control at 40 % opacity with no glow and <b>not-allowed</b> cursor (exempt from contrast by WCAG 1.4.3). Focus is a separate 2 px Phosphor outline, offset 2 px, never a fill.</p>
  <h2>Contrast, text <em>AA needs 4.5:1</em></h2>
  ${matrix()}
</div></div>`)

/* ---------- 02 tipografia ---------- */
const TY = [
  ['hero', 'Big Shoulders 700', 96, 88, '.005em', 'Page hero figure (Stats, year recap).', '<span class="big" style="font-size:96px;line-height:.9">14<small>h</small>20<small>m</small></span>', 'text-hero'],
  ['stat', 'Big Shoulders 700', 76, 72, '.005em', 'Week figures, playtime on game page.', '<span class="big" style="font-size:76px;line-height:.95">38<small>h</small>10<small>m</small></span>', 'text-stat'],
  ['page', 'Big Shoulders 700', 44, 44, '.005em', 'Screen titles, running timer, library count.', '<span class="bsx" style="font-size:44px;line-height:1">Tonight &nbsp;<span style="color:var(--phos)">1:12:04</span></span>', 'text-page'],
  ['title', 'Big Shoulders 700', 28, 30, '.01em', 'Game names in cards, dialog titles, empty states, facts.', '<span class="bsx" style="font-size:28px;line-height:1.05;letter-spacing:.01em">Clair Obscur: Expedition 33</span>', 'text-title'],
  ['figure', 'Big Shoulders 700', 20, 20, '.02em', 'Queue numbers, small counters.', '<span class="bsx" style="font-size:20px;letter-spacing:.02em">1 &nbsp;2 &nbsp;3 &nbsp;61h 30m &nbsp;€1.31</span>', 'text-figure'],
  ['lead', 'Barlow 600', 16, 22, '0', 'Now playing name, sheet and panel titles.', '<span style="font-size:16px;font-weight:600">Hollow Knight: Silksong</span>', 'text-lead'],
  ['body', 'Barlow 400 / 500', 14, 20, '0', 'Default UI: labels, table cells, notes, buttons (500).', '<span style="font-size:14px">Act 2 is where the combat really opens up. Keep Maelle’s gear ahead.</span>', 'text-body'],
  ['small', 'Barlow 400 / 500', 13, 18, '0', 'Metadata, captions under covers, tabs counters, helper text.', '<span style="font-size:13px;color:var(--dust)">Playing on Desk PC · since 19:40</span>', 'text-small'],
  ['micro', 'Barlow 500', 12, 16, '0', 'Hours strip, kbd, ticks. The floor: nothing below 12 px.', '<span style="font-size:12px;color:var(--dust)">Ctrl K &nbsp;·&nbsp; 23h 15m &nbsp;·&nbsp; Nov 14</span>', 'text-micro']
]
const typo = () => page('Type, spacing and radii', '02', 'Big Shoulders for display and every figure; Barlow for all UI. Numbers are tabular everywhere. Playfair appears only inside generated covers.', `
<div class="g" style="grid-template-columns:1050px 1fr;gap:40px;flex:1;min-height:0">
<div>
  <h2>Type scale <em>size / line-height px · tracking · Tailwind name</em></h2>
  ${TY.map(([n, f, s, lh, tr, u, sample, tw]) => `<div class="ty" style="grid-template-columns:110px 1fr 360px"><div class="nm"><b>${n}</b>${tw}</div><div style="overflow:hidden;white-space:nowrap">${sample}</div><div class="sp">${f}<br>${s}/${lh} · tracking ${tr}<br>${u}</div></div>`).join('')}
</div>
<div class="col" style="gap:20px">
  <div>
    <h2>Spacing <em>4 px base</em></h2>
    ${[[1, 4, 'icon gap, LED to label'], [2, 8, 'gap inside controls, between buttons'], [3, 12, 'row gap, cover to caption (6 + 6)'], [4, 16, 'card gap, panel inner gap'], [5, 20, 'window side padding, panel padding'], [6, 24, 'panel padding large, library body'], [8, 32, 'section to section'], [10, 40, 'between big blocks']].map(([k, px, u]) => `<div class="spc"><b>space-${k} · ${px}</b><i style="width:${px * 3}px"></i><span>${u}</span></div>`).join('')}
    <p class="note" style="margin-top:6px">Fixed frame: top bar <b>56</b>, Now playing <b>72</b>, window gutter <b>28</b>, control heights <b>28 / 34 / 44</b>, list row <b>48</b>. In Tailwind the base is <b>--spacing: 4px</b>, so <b>p-5</b> = 20.</p>
  </div>
  <div>
    <h2>Radii</h2>
    <div class="row" style="gap:18px;align-items:flex-end">
      ${[['xs · 2', '2px', 'meter segments, bars'], ['sm · 4', '4px', 'controls, covers, kbd'], ['md · 8', '8px', 'panels, menus, dialogs, toasts, sheet'], ['full', '999px', 'LED, chips, switch']].map(([n, r, u]) => `<div style="flex:1"><div style="height:64px;border-radius:${r};background:var(--rai);border:1px solid var(--line2)"></div><div style="font-size:13.5px;font-weight:600;margin-top:6px">${n}</div><div class="note" style="line-height:1.3">${u}</div></div>`).join('')}
    </div>
    <p class="note" style="margin-top:8px">Nested radii: a 4 px control inside an 8 px panel keeps 12 px of padding, so the curves never fight.</p>
  </div>
  <div>
    <h2>Icons</h2>
    <div class="row" style="gap:14px;color:var(--bone)">${['search', 'gear', 'play', 'note', 'sync', 'clock', 'grid', 'list', 'pc', 'phone'].map((k) => ic(k)).join('')}</div>
    <p class="note" style="margin-top:6px">Lucide, 18 px, stroke 1.6, round caps; 16 px in menus and inputs; filled only for Play and Stop.</p>
  </div>
  <div class="col" style="gap:8px">
    <div class="note"><b>Units shrink, digits don’t.</b> In a figure the unit is 0.45em, weight 600, Dust, with 2 px / 6 px of air. Zero-pad minutes (10m, 05m).</div>
    <div class="note"><b>Tracking.</b> Big Shoulders below 24 px gets +0.02em, above that +0.005em. Barlow never gets tracking. No uppercase labels, no eyebrows.</div>
    <div class="note"><b>TV.</b> Same families at ×1.5: body 21, small 20 (floor), title 42, page 66. Figures never below 28.</div>
  </div>
</div></div>`)

/* ---------- 03 capas ---------- */
const layers = () => page('Elevation, scanlines and glow', '03', 'Layers are told apart by a step of lightness plus a line, not by grey shadow. Texture and light appear only where the screen is a hero.', `
<div class="g" style="grid-template-columns:1fr 1fr;gap:40px;flex:1;min-height:0">
<div>
  <h2>Elevation <em>five layers</em></h2>
  <div class="g" style="grid-template-columns:repeat(5,1fr);gap:10px">
    <div class="lay" style="background:var(--ins);box-shadow:inset 0 0 0 1px var(--line)"><b>L-1 Inset</b>#0C1012<br>no border, sunk</div>
    <div class="lay" style="background:var(--cab);box-shadow:inset 0 0 0 1px var(--line)"><b>L0 Cabinet</b>#101416<br>page</div>
    <div class="lay" style="background:var(--pan);box-shadow:inset 0 0 0 1px var(--line)"><b>L1 Panel</b>#171D20<br>line .09</div>
    <div class="lay" style="background:var(--rai);box-shadow:inset 0 0 0 1px var(--line2)"><b>L2 Raised</b>#1F272B<br>line .17</div>
    <div class="lay" style="background:var(--ov);box-shadow:inset 0 0 0 1px var(--line2),inset 0 1px 0 rgba(233,228,216,.07),0 14px 30px -10px rgba(3,6,7,.85)"><b>L3 Overlay</b>#242C31<br>line .17 + float</div>
  </div>
  <div class="row" style="gap:22px;margin-top:16px;align-items:stretch">
    <div style="flex:1;border-radius:8px;background:var(--cab);padding:22px 20px;position:relative;border:1px solid var(--line);height:250px">
      <div style="position:absolute;inset:22px 20px auto 20px;height:150px;background:#2b2b2b;border-radius:8px;box-shadow:0 12px 24px rgba(0,0,0,.55);padding:14px;font-size:13px;color:#ccc">Generic grey shadow<br><span style="color:#888">pure black, wide, ignores the tint of the surface</span></div>
      <div style="position:absolute;left:20px;right:20px;bottom:14px;font-size:13px;color:#f2998f;display:flex;gap:6px;align-items:center">${ico('x')} Not this</div>
    </div>
    <div style="flex:1;border-radius:8px;background:var(--cab);padding:22px 20px;position:relative;border:1px solid var(--line);height:250px">
      <div style="position:absolute;inset:22px 20px auto 20px;height:150px;background:var(--ov);border:1px solid var(--line2);border-radius:8px;box-shadow:inset 0 1px 0 rgba(233,228,216,.07),0 18px 40px -10px rgba(3,6,7,.8);padding:14px;font-size:13px;color:var(--bone)">Petrol-black shadow<br><span style="color:var(--dust)">lighter surface + line + top highlight</span></div>
      <div style="position:absolute;left:20px;right:20px;bottom:14px;font-size:13px;color:var(--beaten);display:flex;gap:6px;align-items:center">${ico('check')} Fósforo</div>
    </div>
  </div>
  <table class="ct-t" style="margin-top:14px"><tr><th>Token</th><th>Value</th><th>Used by</th></tr>
    <tr><td class="mono">shadow-float</td><td class="mono">inset 0 1px 0 rgb(233 228 216/.06), 0 18px 40px -10px rgb(3 6 7/.8)</td><td>Menus, popovers, tooltips</td></tr>
    <tr><td class="mono">shadow-modal</td><td class="mono">inset 0 1px 0 rgb(233 228 216/.06), 0 28px 70px -14px rgb(3 6 7/.9)</td><td>Dialogs, sheet, Ctrl K</td></tr>
    <tr><td class="mono">shadow-lift</td><td class="mono">0 10px 20px -8px rgb(3 6 7/.8)</td><td>Cover on hover</td></tr>
    <tr><td class="mono">scrim</td><td class="mono">rgb(8 11 12 / .72)</td><td>Behind dialogs and sheets</td></tr>
  </table>
  <p class="note" style="margin-top:8px">Rules: panels and rows never cast shadows (they sit on a lighter step); only layers that float above the page do. The top highlight simulates the lit edge of glass. The shadow is always tinted petrol, never grey or pure black.</p>
</div>
<div>
  <h2>Scanlines <em>only on hero zones</em></h2>
  <div class="g" style="grid-template-columns:repeat(4,1fr);gap:10px">
    ${[[0, '0 % · none'], [0.02, '2 % · subtle'], [0.035, '3.5 % · standard'], [0.07, '7 % · too much']].map(([a, l]) => `<div class="scanbox" style="--sa:${a};background:linear-gradient(160deg,#9A1530,#1B0509);${a > 0.05 ? 'outline:1px dashed var(--live);outline-offset:-1px' : ''}"><span>${l}</span></div>`).join('')}
  </div>
  <div class="note" style="margin-top:8px;font-family:inherit"><b>1 px line every 3 px, horizontal, white at 3.5 %.</b> <span class="mono">repeating-linear-gradient(0deg, rgb(255 255 255/.035) 0 1px, transparent 1px 3px)</span>. It sits above artwork and below text.</div>
  <div class="g" style="grid-template-columns:1fr 1fr;gap:20px;margin-top:10px">
    <div class="note"><b class="ok">Yes:</b> banners, Now playing bar, empty-state art, TV hero, loading cover.</div>
    <div class="note"><b class="lv">Never:</b> panels, tables, form controls, dialogs, any block of body text.</div>
  </div>
  <h2 style="margin-top:20px">Amber glow <em>one hot focal point per view</em></h2>
  <div class="g" style="grid-template-columns:repeat(5,1fr);gap:10px">
    <div class="lay" style="height:150px;align-items:flex-start;justify-content:space-between;background:var(--pan)"><span class="bsx ph" style="font-size:40px;text-shadow:0 0 18px rgba(255,179,71,.35)">1:12:04</span><span>glow-text</span></div>
    <div class="lay" style="height:150px;align-items:flex-start;justify-content:space-between;background:var(--pan)"><span style="width:22px;height:22px;border-radius:50%;background:var(--live);box-shadow:0 0 0 3px rgba(255,94,87,.22),0 0 12px var(--live);display:block;margin:6px 0 0 4px"></span><span>glow-led</span></div>
    <div class="lay" style="height:150px;align-items:flex-start;justify-content:space-between;background:var(--pan)"><div style="width:100%;height:30px;position:relative;margin-top:8px"><div style="position:absolute;left:0;right:0;bottom:0;height:2px;background:var(--phos);box-shadow:0 0 12px rgba(255,179,71,.6)"></div></div><span>glow-bar</span></div>
    <div class="lay" style="height:150px;align-items:flex-start;justify-content:space-between;background:var(--pan)"><div style="width:44px;height:40px;border-radius:4px;background:#2a1c30;box-shadow:0 0 0 2px var(--phos),0 0 28px rgba(255,179,71,.45);margin:6px 0 0 4px"></div><span>glow-halo (TV)</span></div>
    <div class="lay" style="height:150px;position:relative;overflow:hidden;background:var(--pan)"><div style="position:absolute;inset:0;background:radial-gradient(70% 90% at 15% 110%,rgba(255,179,71,.2),transparent 70%)"></div><span style="position:relative">glow-ambient</span></div>
  </div>
  <table class="ct-t" style="margin-top:12px"><tr><th>Token</th><th>Value</th></tr>
    <tr><td class="mono">glow-text</td><td class="mono">0 0 18px rgb(255 179 71 / .35)</td></tr>
    <tr><td class="mono">glow-led</td><td class="mono">0 0 0 3px rgb(color/.22), 0 0 10px color (live) · 0 0 8px color (status)</td></tr>
    <tr><td class="mono">glow-bar</td><td class="mono">0 0 12px rgb(255 179 71 / .6)  (active tab, selected row edge, today bar .4)</td></tr>
    <tr><td class="mono">glow-halo</td><td class="mono">0 0 0 2px phosphor, 0 0 32px rgb(255 179 71 / .45)  (TV focus only)</td></tr>
    <tr><td class="mono">glow-ambient</td><td class="mono">radial-gradient(70% 90% at 15% 110%, rgb(255 179 71 / .2), transparent 70%)</td></tr>
  </table>
  <p class="note" style="margin-top:8px">Glow means “this is live or chosen”. Max one hot element per region: the timer, or the selected row, not both competing. Glow is never used for hover.</p>
</div></div>`)

const out = {
  'sistema-tokens-color': colors(),
  'sistema-tokens-tipo': typo(),
  'sistema-tokens-capas': layers(),
  ...sheetsControls({ page, I, ico, ic, icf, cv, bn, dot, G, ST, STN, ratio }),
  ...sheetsSurfaces({ page, I, ico, ic, icf, cv, bn, dot, G, ST, STN, ratio }),
  ...sheetsMotion({ page, I, ico, ic, icf, cv, bn, dot, G, ST, STN, ratio, logoSvg })
}
for (const [k, v] of Object.entries(out)) writeFileSync(join(dir, `${k}.html`), v)
console.log('HTML:', Object.keys(out).join(', '))
