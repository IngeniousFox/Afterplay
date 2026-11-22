// Graficas SVG inline y datos de ejemplo para Stats (prefijo stats). Todo a 1:1 (sin escalar el SVG)
// para que el texto se vea al tamano real: minimo 12 px.
export const AMB = '#FFB347'
export const TUBE = '#5FD3E0'
export const DUST = '#8A9496'
export const BONE = '#E9E4D8'
export const GRID = 'rgba(233,228,216,.09)'
export const GRID2 = 'rgba(233,228,216,.17)'

export const fh = (h) => { // horas decimales -> "9h 24m"
  const m = Math.round(h * 60)
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}
export const fm = (m) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
export const num = (n) => n.toLocaleString('en-US')

const tx = (x, y, s, o = {}) =>
  `<text x="${x}" y="${y}"${o.a ? ` text-anchor="${o.a}"` : ''} fill="${o.f || DUST}" font-size="${o.s || 12.5}"${o.w ? ` font-weight="${o.w}"` : ''}${o.fam ? ` font-family="${o.fam}"` : ''}>${s}</text>`
export const bsTxt = (x, y, s, size, fill = BONE, a) => tx(x, y, s, { s: size, f: fill, w: 700, fam: "'Big Shoulders Display'", a })

/* ---------- PRNG ---------- */
function rng(seed) {
  let a = seed
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ---------- datos: ultimos 12 meses ---------- */
export const MONTHS = ['Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov']
export const MH = [58, 74, 61, 98.17, 66, 52, 71, 83, 49, 57, 91, 64] // horas por mes (Dec 2025 .. Nov 2026)
export const MS = [64.97, 29.99, 0, 119.98, 14.99, 0, 49.99, 25.98, 0, 79.97, 49.99, 39.99] // euros por mes

/* ---------- heatmap 52 semanas ---------- */
export function genHeat() {
  const R = rng(7)
  const start = new Date(2025, 10, 24) // lunes
  const days = []
  for (let i = 0; i < 364; i++) {
    const d = new Date(2025, 10, 24 + i)
    const wd = i % 7
    const p = [0.5, 0.48, 0.5, 0.52, 0.6, 0.86, 0.8][wd]
    let on = R() < p
    const dayOfYear = d
    if (d >= new Date(2026, 7, 3) && d <= new Date(2026, 7, 17)) on = false
    if (d >= new Date(2026, 9, 31)) on = true
    const raw = on ? 0.5 + -Math.log(1 - R()) * 1.35 * (wd >= 5 ? 1.5 : 1) : 0
    days.push({ i, d, wd, raw, h: 0 })
  }
  // escala cada mes a su total
  const byM = new Map()
  for (const x of days) {
    const k = x.d.getFullYear() * 12 + x.d.getMonth()
    if (!byM.has(k)) byM.set(k, [])
    byM.get(k).push(x)
  }
  for (const [k, arr] of byM) {
    const y = Math.floor(k / 12), m = k % 12
    const idx = (m + 1) % 12 // Dec=0
    const isWin = !(y === 2025 && m === 10)
    const target = isWin ? MH[idx] : 14
    const sum = arr.reduce((s, x) => s + x.raw, 0) || 1
    for (const x of arr) x.h = Math.min(8.2, (x.raw / sum) * target)
  }
  const peak = days.find((x) => x.d.getFullYear() === 2026 && x.d.getMonth() === 2 && x.d.getDate() === 14)
  peak.h = 9.4
  return days
}

const HC = ['#222B2F', '#4B3B22', '#80602B', '#C48B35', AMB]
export function heatmap(opts = {}) {
  const cell = 23, gap = 5, pitch = cell + gap, left = 40, top = 24
  const days = genHeat()
  const max = 9.4
  const lvl = (h) => (h <= 0 ? 0 : h < 0.12 * max ? 1 : h < 0.3 * max ? 2 : h < 0.6 * max ? 3 : 4)
  const W = left + 52 * pitch - gap, H = top + 7 * pitch - gap
  let cells = '', labs = ''
  let lastM = -1
  for (const x of days) {
    const col = Math.floor(x.i / 7), row = x.wd
    cells += `<rect x="${left + col * pitch}" y="${top + row * pitch}" width="${cell}" height="${cell}" rx="3" fill="${HC[lvl(x.h)]}"${x.h === 9.4 ? ` stroke="${BONE}" stroke-width="2"` : ''}/>`
    if (row === 0 && x.d.getDate() <= 7 && x.d.getMonth() !== lastM) {
      labs += tx(left + col * pitch, 15, x.d.toLocaleDateString('en-US', { month: 'short' }))
      lastM = x.d.getMonth()
    }
  }
  ;['Mon', 'Wed', 'Fri'].forEach((s, k) => (labs += tx(0, top + k * 2 * pitch + 16, s)))
  const active = days.filter((x) => x.h > 0).length
  const total = days.reduce((s, x) => s + x.h, 0)
  const tipX = left + 15 * pitch + cell / 2, tipY = top + 5 * pitch
  const tip = opts.tip
    ? `<div class="tip" style="left:${tipX}px;top:${tipY - 12}px;transform:translate(-50%,-100%)"><b>Sat, Mar 14, 2026</b><div class="tvl">9h 24m</div><div class="tr"><span>5 sessions</span></div>
      <div class="tg2"><i style="background:#F6D75F"></i>Stardew Valley<em>5h 40m</em></div><div class="tg2"><i style="background:#F4AC3E"></i>Hades<em>2h 50m</em></div><div class="tg2"><i style="background:#F3E8C8"></i>Balatro<em>0h 54m</em></div></div>`
    : ''
  return { active, total, html: `<div class="relw" style="width:${W}px"><svg class="ch" width="${W}" height="${H}">${labs}${cells}</svg>${tip}</div>` }
}

/* ---------- horas y gasto por mes: barras ambar + linea Tube ---------- */
export function monthCombo(opts = {}) {
  const W = opts.W || 956, H = opts.H || 318, L = 48, R = 58, T = 28, B = 34
  const pw = W - L - R, ph = H - T - B
  const hy = (v) => T + ph - (v / 100) * ph
  const sy = (v) => T + ph - (v / 120) * ph
  const slot = pw / 12, bw = Math.min(34, slot - 14)
  let g = ''
  for (let i = 0; i <= 4; i++) {
    const y = T + (ph / 4) * i
    g += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="${i === 4 ? GRID2 : GRID}"/>`
    g += tx(L - 10, y + 4, `${100 - i * 25}h`, { a: 'end' })
    g += tx(W - R + 10, y + 4, `€${120 - i * 30}`, { f: TUBE })
  }
  let bars = '', pts = [], xl = ''
  MH.forEach((h, i) => {
    const cx = L + slot * i + slot / 2
    const open = i === 11
    bars += `<rect x="${cx - bw / 2}" y="${hy(h)}" width="${bw}" height="${T + ph - hy(h)}" rx="3" fill="${AMB}" ${open ? 'opacity=".5"' : i === 3 ? '' : 'opacity=".78"'}/>`
    pts.push([cx, sy(MS[i])])
    xl += tx(cx, H - 10, MONTHS[i] + (open ? '*' : ''), { a: 'middle', f: i === 3 ? BONE : DUST })
  })
  const line = `<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${TUBE}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`
  const dots = pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4.5" fill="#171D20" stroke="${TUBE}" stroke-width="2.2"/>`).join('')
  const cx3 = L + slot * 3 + slot / 2
  const hl = `<line x1="${cx3}" x2="${cx3}" y1="${T}" y2="${T + ph}" stroke="${BONE}" stroke-opacity=".28" stroke-dasharray="3 4"/>`
  const lab = tx(cx3, hy(98.17) - 8, '98h 10m', { a: 'middle', f: BONE, w: 600, s: 13 })
  const tip = opts.tip
    ? `<div class="tip ln" style="left:${cx3 + 34}px;top:${hy(98.17) - 8}px"><b>March 2026</b><div class="tg2"><i style="background:${AMB}"></i>Played<em>98h 10m</em></div><div class="tg2"><i style="background:${TUBE}"></i>Spent<em>€119.98</em></div><div class="tr">3 games bought, 22 days active</div></div>`
    : ''
  return `<div class="relw" style="width:${W}px"><svg class="ch" width="${W}" height="${H}">${g}${hl}${bars}${line}${dots}${lab}${xl}</svg>${tip}</div>`
}

/* ---------- barras verticales genericas (semana, tramos de duracion) ---------- */
export function vbars({ W, H, labels, vals, fmtv, peak, color = AMB, bw = 40, top = 30, dimOpacity = 0.5 }) {
  const B = 30, T = top
  const ph = H - T - B
  const max = Math.max(...vals)
  const slot = W / vals.length
  let s = `<line x1="0" x2="${W}" y1="${T + ph}" y2="${T + ph}" stroke="${GRID2}"/>`
  vals.forEach((v, i) => {
    const h = (v / max) * ph
    const cx = slot * i + slot / 2
    const isPeak = i === peak
    s += `<rect x="${cx - bw / 2}" y="${T + ph - h}" width="${bw}" height="${Math.max(2, h)}" rx="3" fill="${color}" ${isPeak ? '' : `opacity="${dimOpacity}"`}/>`
    s += tx(cx, T + ph - h - 8, fmtv(v), { a: 'middle', f: isPeak ? BONE : DUST, w: isPeak ? 600 : 400, s: 13 })
    s += tx(cx, H - 8, labels[i], { a: 'middle', f: isPeak ? BONE : DUST })
  })
  return `<svg class="ch" width="${W}" height="${H}">${s}</svg>`
}

/* ---------- hora del dia: 24 barras + franjas ---------- */
export const HOURS24 = [96, 74, 41, 20, 9, 6, 12, 30, 58, 92, 128, 160, 188, 210, 232, 248, 262, 276, 298, 352, 398, 410, 372, 240]
export function hourBars({ W = 740, H = 250, vals = HOURS24, color = AMB, peak = 21, fmt = (v) => `${v}h` } = {}) {
  const L = 0, T = 24, B = 66, ph = H - T - B
  const max = Math.max(...vals), slot = W / 24, bw = slot - 8
  let s = ''
  ;[0, 0.5, 1].forEach((f) => (s += `<line x1="0" x2="${W}" y1="${T + ph * (1 - f)}" y2="${T + ph * (1 - f)}" stroke="${f === 0 ? GRID2 : GRID}"/>`))
  vals.forEach((v, i) => {
    const h = (v / max) * ph, x = slot * i + 4
    s += `<rect x="${x}" y="${T + ph - h}" width="${bw}" height="${Math.max(2, h)}" rx="2" fill="${color}" ${i === peak ? '' : 'opacity=".6"'}/>`
    if (i % 3 === 0) s += tx(x + bw / 2, T + ph + 17, String(i).padStart(2, '0'), { a: 'middle' })
  })
  s += tx(slot * peak + slot / 2, T + ph - (vals[peak] / max) * ph - 8, fmt(vals[peak]), { a: 'middle', f: BONE, w: 600, s: 13 })
  const total = vals.reduce((a, b) => a + b, 0)
  const parts = [['Night', 0, 6], ['Morning', 6, 12], ['Afternoon', 12, 18], ['Evening', 18, 24]]
  const out = []
  parts.forEach(([name, a, b]) => {
    const sh = vals.slice(a, b).reduce((x, y) => x + y, 0) / total
    const x1 = slot * a + 4, x2 = slot * b - 4, y = T + ph + 30
    s += `<path d="M${x1} ${y}v5h${x2 - x1}v-5" fill="none" stroke="${GRID2}"/>`
    s += tx((x1 + x2) / 2, y + 22, `${name} ${Math.round(sh * 100)}%`, { a: 'middle', f: sh > 0.34 ? BONE : DUST, w: sh > 0.34 ? 600 : 400 })
    out.push([name, sh])
  })
  return `<svg class="ch" width="${W}" height="${H}">${s}</svg>`
}

/* ---------- radar ---------- */
export function radar({ W = 520, H = 400, axes, vals }) {
  const cx = W / 2, cy = H / 2 + 4, R = (arguments[0].R) || 138, n = axes.length
  const max = Math.max(...vals)
  const pt = (i, f) => [cx + Math.sin((i / n) * 2 * Math.PI) * R * f, cy - Math.cos((i / n) * 2 * Math.PI) * R * f]
  let s = ''
  ;[0.25, 0.5, 0.75, 1].forEach((f) => {
    s += `<polygon points="${axes.map((_, i) => pt(i, f).join(',')).join(' ')}" fill="none" stroke="${f === 1 ? GRID2 : GRID}"/>`
  })
  axes.forEach((_, i) => (s += `<line x1="${cx}" y1="${cy}" x2="${pt(i, 1)[0]}" y2="${pt(i, 1)[1]}" stroke="${GRID}"/>`))
  const poly = vals.map((v, i) => pt(i, v / max).join(',')).join(' ')
  s += `<polygon points="${poly}" fill="${AMB}" fill-opacity=".2" stroke="${AMB}" stroke-width="2.4" stroke-linejoin="round"/>`
  vals.forEach((v, i) => (s += `<circle cx="${pt(i, v / max)[0]}" cy="${pt(i, v / max)[1]}" r="4.5" fill="${AMB}" stroke="#171D20" stroke-width="2"/>`))
  axes.forEach((a, i) => {
    const [x, y] = pt(i, 1.2)
    const anchor = Math.abs(x - cx) < 4 ? 'middle' : x > cx ? 'start' : 'end'
    const top = i === 0
    s += tx(x + (anchor === 'start' ? 6 : anchor === 'end' ? -6 : 0), y + (top ? -8 : y > cy ? 14 : 0), a, { a: anchor, f: BONE, w: 600, s: 14 })
    s += tx(x + (anchor === 'start' ? 6 : anchor === 'end' ? -6 : 0), y + (top ? 8 : y > cy ? 30 : 16), `${num(vals[i])}h`, { a: anchor, s: 13 })
  })
  return `<svg class="ch" width="${W}" height="${H}">${s}</svg>`
}

/* ---------- anillo ---------- */
export function donut({ size = 230, r = 92, w = 30, segs, center }) {
  const c = size / 2, tot = segs.reduce((a, b) => a + b.v, 0)
  let a0 = -Math.PI / 2, s = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${GRID}" stroke-width="${w}"/>`
  segs.forEach((g) => {
    const a1 = a0 + (g.v / tot) * 2 * Math.PI - 0.035
    const p = (a, rr) => [c + Math.cos(a) * rr, c + Math.sin(a) * rr]
    const [x0, y0] = p(a0 + 0.0175, r), [x1, y1] = p(a1, r)
    const large = a1 - a0 > Math.PI ? 1 : 0
    s += `<path d="M${x0} ${y0}A${r} ${r} 0 ${large} 1 ${x1} ${y1}" fill="none" stroke="${g.color}" stroke-width="${w}"/>`
    a0 += (g.v / tot) * 2 * Math.PI
  })
  s += center
  return `<svg class="ch" width="${size}" height="${size}">${s}</svg>`
}

/* ---------- lineas de flujo del backlog (3 series) ---------- */
export function flowLines({ W = 956, H = 262, series }) {
  const L = 40, R = 104, T = 20, B = 34, pw = W - L - R, ph = H - T - B
  const max = 20, step = pw / 11
  const y = (v) => T + ph - (v / max) * ph
  let s = ''
  for (let i = 0; i <= 4; i++) {
    const yy = T + (ph / 4) * i
    s += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" stroke="${i === 4 ? GRID2 : GRID}"/>` + tx(L - 10, yy + 4, String(20 - i * 5), { a: 'end' })
  }
  MONTHS.forEach((m, i) => (s += tx(L + step * i, H - 10, m, { a: 'middle' })))
  series.forEach((sr) => {
    const pts = sr.v.map((v, i) => [L + step * i, y(v)])
    s += `<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${sr.color}" stroke-width="${sr.main ? 2.8 : 2.2}" stroke-linejoin="round" stroke-linecap="round"${sr.dash ? ` stroke-dasharray="${sr.dash}"` : ''}/>`
    pts.forEach(([x, yy]) => (s += `<circle cx="${x}" cy="${yy}" r="${sr.main ? 4 : 3}" fill="#171D20" stroke="${sr.color}" stroke-width="2"/>`))
    const last = pts[pts.length - 1]
    s += tx(last[0] + 14, sr.ly ?? last[1] + 4, sr.label, { f: sr.color, w: 600, s: 13 })
  })
  return `<svg class="ch" width="${W}" height="${H}">${s}</svg>`
}

/* ---------- deuda: horas restantes hasta el horizonte ---------- */
export function debtCurve({ W = 900, H = 250 }) {
  const L = 56, R = 28, T = 24, B = 34, pw = W - L - R, ph = H - T - B
  const total = 1742, weeks = 140.5
  const x = (w) => L + (w / weeks) * pw
  const y = (v) => T + ph - (v / 2000) * ph
  let s = ''
  ;[0, 500, 1000, 1500, 2000].forEach((v) => {
    s += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 0 ? GRID2 : GRID}"/>` + tx(L - 10, y(v) + 4, `${num(v)}h`, { a: 'end' })
  })
  // marcas de ano: semanas desde 22 nov 2026
  const yrs = [['2027', 40.1], ['2028', 92.4], ['2029', 144.6]]
  const wk = (d) => (d - new Date(2026, 10, 22)) / (7 * 864e5)
  ;[2028].forEach((yr) => {
    const w = wk(new Date(yr, 0, 1))
    s += `<line x1="${x(w)}" x2="${x(w)}" y1="${T}" y2="${T + ph}" stroke="${GRID}"/>` + tx(x(w), H - 10, 'Jan ' + yr, { a: 'middle' })
  })
  s += tx(L, H - 10, 'Nov 2026', { a: 'start' }) + tx(W - R, H - 10, 'Aug 2029', { a: 'end' })
  s += `<path d="M${x(0)} ${y(total)}L${x(weeks)} ${y(0)}V${y(0)}H${x(0)}Z" fill="${AMB}" fill-opacity=".13"/>`
  s += `<line x1="${x(0)}" y1="${y(total)}" x2="${x(weeks)}" y2="${y(0)}" stroke="${AMB}" stroke-width="2.6" stroke-linecap="round"/>`
  const hw = weeks / 2
  s += `<circle cx="${x(hw)}" cy="${y(total / 2)}" r="5" fill="#171D20" stroke="${BONE}" stroke-width="2"/>` + tx(x(hw) + 12, y(total / 2) - 10, 'Halfway, Mar 2028', { f: BONE, s: 13, w: 600 })
  s += `<line x1="${x(weeks)}" x2="${x(weeks)}" y1="${y(0)}" y2="${y(0) - 52}" stroke="${AMB}" stroke-dasharray="3 4"/><circle cx="${x(weeks)}" cy="${y(0)}" r="5.5" fill="${AMB}"/>` + tx(x(weeks), y(0) - 60, 'Finish line, Aug 2029', { a: 'end', f: AMB, s: 13, w: 600 })
  s += `<circle cx="${x(0)}" cy="${y(total)}" r="5" fill="${AMB}"/>` + tx(x(0) + 12, y(total) - 10, '1,742h waiting today', { f: BONE, s: 13, w: 600 })
  return `<svg class="ch" width="${W}" height="${H}">${s}</svg>`
}

/* ---------- barras anuales pequenas ---------- */
export function miniBars({ W, H, labels, vals, peak, fmtv, color = AMB }) {
  return vbars({ W, H, labels, vals, peak, fmtv, color, bw: 30, top: 26 })
}

/* ---------- curva acumulada de un juego con hitos ---------- */
export function runCurve({ W = 1488, H = 330, pts, ms, mainH, color }) {
  const L = 52, R = 30, T = 30, B = 40, pw = W - L - R, ph = H - T - B
  const t0 = new Date(2026, 9, 3).getTime(), t1 = new Date(2026, 10, 22).getTime()
  const x = (d) => L + ((d - t0) / (t1 - t0)) * pw
  const y = (h) => T + ph - (h / 45) * ph
  let s = ''
  ;[0, 15, 30, 45].forEach((v) => (s += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 0 ? GRID2 : GRID}"/>` + tx(L - 10, y(v) + 4, `${v}h`, { a: 'end' })))
  const xt = [[new Date(2026, 9, 3), 'Oct 3'], [new Date(2026, 9, 17), 'Oct 17'], [new Date(2026, 10, 1), 'Nov 1'], [new Date(2026, 10, 15), 'Nov 15'], [new Date(2026, 10, 22), 'Today']]
  xt.forEach(([d, l]) => (s += tx(x(d), H - 12, l, { a: l === 'Today' ? 'end' : 'middle' })))
  // Main estimate (Tube, secundaria)
  s += `<line x1="${L}" x2="${W - R}" y1="${y(mainH)}" y2="${y(mainH)}" stroke="${TUBE}" stroke-width="1.8" stroke-dasharray="6 6"/>` + tx(L + 8, y(mainH) - 8, 'HowLongToBeat Main, 30h', { f: TUBE, w: 600, s: 13 })
  // escalonado: cada sesion sube la curva
  let d = `M${x(pts[0][0])} ${y(0)}`
  let prev = 0
  pts.forEach(([dt, cum]) => { d += `L${x(dt)} ${y(prev)}L${x(dt)} ${y(cum)}`; prev = cum })
  d += `L${x(t1)} ${y(prev)}`
  s += `<path d="${d}L${x(t1)} ${y(0)}L${x(pts[0][0])} ${y(0)}Z" fill="${color}" fill-opacity=".14"/>`
  s += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.8" stroke-linejoin="round"/>`
  ms.forEach(([dt, label, h, up]) => {
    s += `<circle cx="${x(dt)}" cy="${y(h)}" r="5.5" fill="#171D20" stroke="${BONE}" stroke-width="2"/>`
    s += tx(x(dt) + (up === 'l' ? -12 : 12), y(h) + (up === 'l' ? -10 : 20), label, { a: up === 'l' ? 'end' : 'start', f: BONE, w: 600, s: 13 })
  })
  s += tx(W - R, y(prev) - 12, '38h 10m', { a: 'end', f: BONE, w: 700, s: 15 })
  return `<svg class="ch" width="${W}" height="${H}">${s}</svg>`
}

/* ---------- iconos de insignias ---------- */
export const BI = {
  beaten: '<path d="M7 4h10v4a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7"/>',
  centurion: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3.2 2"/>',
  marathoner: '<path d="M12 3c1 3.5 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 .3 1.4 1 2 2 2.3C11.2 8.5 11 6 12 3z"/>',
  devoted: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4M8.5 15l2.2 2.2L15.5 13"/>',
  regular: '<path d="M4 18l5-6 4 3 7-9M15 6h5v5"/>',
  completionist: '<circle cx="12" cy="9" r="5.5"/><path d="m8.8 13.8-1.6 6.2 4.8-2.5 4.8 2.5-1.6-6.2M10 9l1.6 1.6L14.4 7.6"/>',
  night: '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/>',
  weekend: '<path d="M5 20V4M5 5h11l-2.5 3.5L16 12H5"/>',
  free: '<path d="M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10z"/>'
}
export const badgeIc = (k, size = 26) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${BI[k]}</svg>`
