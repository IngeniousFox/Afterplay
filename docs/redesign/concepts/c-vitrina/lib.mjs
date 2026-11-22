// Utilidades compartidas: iconos, portadas CSS, barra de navegacion, plantilla de pagina.
export const FONTS = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wdth,wght@12..96,75..100,200..800&family=Hanken+Grotesk:wght@300..800&family=Cinzel:wght@600..800&family=Cormorant+Garamond:ital,wght@1,600;1,700&family=Bowlby+One&family=Archivo+Black&display=swap';

const P = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.6M12 18.4V21M3 12h2.6M18.4 12H21M5.6 5.6l1.9 1.9M16.5 16.5l1.9 1.9M5.6 18.4l1.9-1.9M16.5 7.5l1.9-1.9"/>',
  play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="currentColor" stroke="none"/>',
  note: '<path d="M5 4h11l3 3v13H5z"/><path d="M8.5 10h7M8.5 14h7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chl: '<path d="M14.5 6l-6 6 6 6"/>',
  chr: '<path d="M9.5 6l6 6-6 6"/>',
  chd: '<path d="M6 9.5l6 6 6-6"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  list: '<path d="M8 6.5h12M8 12h12M8 17.5h12M4 6.5h.01M4 12h.01M4 17.5h.01"/>',
  pc: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 18h2"/>',
  tv: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 20h8"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  sync: '<path d="M4 12a8 8 0 0 1 13.5-5.8L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.5 5.8L4 15.5M4 20v-4.5h4.5"/>',
  home: '<path d="M4 11l8-6.5 8 6.5v8.5H4z"/><path d="M10 19.5v-5h4v5"/>',
  lib: '<rect x="4" y="4" width="4.5" height="16" rx="1.2"/><rect x="10" y="4" width="4.5" height="16" rx="1.2"/><path d="M16.5 6.2l3.8-1 3 0M16.8 6.5l3.2 13"/>',
  plan: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><path d="M3.8 6.5l1 1 2-2.2M3.8 12l1 1 2-2.2M3.8 17.5l1 1 2-2.2"/>',
  sess: '<path d="M4 12a8 8 0 1 0 2.5-5.8L4 8.5M4 4v4.5h4.5"/><path d="M12 8v4.5l3 1.5"/>',
  stats: '<path d="M5 20V11M12 20V5M19 20v-7"/>',
  dots: '<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  cal: '<rect x="4" y="5.5" width="16" height="14.5" rx="2.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  back: '<path d="M14.5 5l-7 7 7 7"/>',
  grip: '<path d="M9 7h.01M15 7h.01M9 12h.01M15 12h.01M9 17h.01M15 17h.01" stroke-width="2.6"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  key: '<circle cx="8" cy="14" r="3.5"/><path d="M10.5 11.5L19 3M16 6l2.5 2.5"/>',
  save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  pal: '<path d="M12 4a8 8 0 1 0 0 16c1.4 0 2-.9 1.6-2-.5-1.2.3-2.2 1.6-2.2H17a3 3 0 0 0 3-3C20 7.6 16.4 4 12 4z"/><path d="M8 11h.01M11 8h.01M15 9h.01" stroke-width="2.6"/>',
  radar: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><path d="M12 12l5.5-5.5"/>',
  sliders: '<path d="M5 8h8M17 8h2M5 16h2M11 16h8"/><circle cx="15" cy="8" r="2"/><circle cx="9" cy="16" r="2"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>',
  wifi: '<path d="M4 9.5a12 12 0 0 1 16 0M7 13a7.5 7.5 0 0 1 10 0M10 16.5a3 3 0 0 1 4 0"/>',
  bat: '<rect x="3" y="8" width="16" height="9" rx="2.5"/><path d="M21 11v3"/>',
  star: '<path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"/>',
  ctrl: '<path d="M7 8h10a4 4 0 0 1 4 4.5l-.5 3a2.5 2.5 0 0 1-4.2 1.3L14.5 15h-5l-1.8 1.8a2.5 2.5 0 0 1-4.2-1.3l-.5-3A4 4 0 0 1 7 8z"/><path d="M8 10.5v3M6.5 12h3"/>',
};
export const ic = (n, s = 18, sw = 1.7, extra = '') =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" ${extra}>${P[n]}</svg>`;

// ---------- juegos ----------
export const G = {
  sk: { t: 'Hollow Knight: Silksong', ct: 'HOLLOW KNIGHT<br>SILKSONG', cls: 'g-silk', ac: '#D2423B', on: '#ffffff', heat: '#D2423B' },
  ex: { t: 'Clair Obscur: Expedition 33', ct: 'Clair Obscur<br>Expedition 33', cls: 'g-exp', ac: '#D9A441', on: '#1b1304', heat: '#D9A441' },
  hd: { t: 'Hades II', ct: 'HADES II', cls: 'g-hades', ac: '#3FBF8F', on: '#04150f', heat: '#3FBF8F' },
  ba: { t: 'Balatro', ct: 'BALATRO', cls: 'g-bal', ac: '#E0483E', on: '#ffffff', heat: '#5B7CFF' },
  sf: { t: 'Split Fiction', ct: 'SPLIT<br>FICTION', cls: 'g-split', ac: '#FF8C2E', on: '#201000', heat: '#FF8C2E' },
  mt: { t: 'Metaphor: ReFantazio', ct: 'METAPHOR<br>ReFantazio', cls: 'g-meta', ac: '#B48AF0', on: '#150a2a', heat: '#B48AF0' },
};
const gen = (id, t, c1, c2, c3, pt, ct) => { G[id] = { t, ct: ct || t, cls: 'pt-' + pt, c: [c1, c2, c3] }; };
gen('pen', 'Pentiment', '#d9b47a', '#5e3417', '#f6e6c4', 'stripes');
gen('aw', 'Animal Well', '#4a2296', '#0b0820', '#ff4fd0', 'dots');
gen('lop', 'Lies of P', '#4b5c66', '#0b0f12', '#e6c36f', 'arch');
gen('oct', 'Octopath Traveler II', '#2f5aa8', '#d58a4a', '#ffe7a8', 'sun');
gen('ow', 'Outer Wilds', '#1e3a8a', '#ef7d3a', '#ffd9a0', 'rings');
gen('cel', 'Celeste', '#4a2f86', '#ee6a98', '#ffe0ec', 'tri');
gen('dis', 'Disco Elysium', '#4a4630', '#b8602a', '#f6d98a', 'stripes');
gen('hk', 'Hollow Knight', '#0d1424', '#5675b8', '#eef2ff', 'wave');
gen('h1', 'Hades', '#6e1313', '#150404', '#ffb35e', 'tri');
gen('tun', 'Tunic', '#2f7a3f', '#0f2616', '#f6e87c', 'grid');
gen('obra', 'Return of the Obra Dinn', '#d3ccb2', '#23252a', '#111', 'grid', 'Return of the<br>Obra Dinn');
gen('sos', 'Sea of Stars', '#2b4a9a', '#f0a05a', '#fff1c4', 'sun');
gen('coc', 'Cocoon', '#d98f3e', '#2a1840', '#ffe3b0', 'rings');
gen('dre', 'Dredge', '#1a4249', '#06171a', '#8ee6d4', 'wave');
gen('alan', 'Alan Wake 2', '#2a3a28', '#050805', '#e8f26e', 'stripes', 'Alan Wake 2');
gen('bg3', "Baldur's Gate 3", '#5a2020', '#0f0809', '#e9bd70', 'sun', "Baldur's<br>Gate 3");
gen('cp', 'Cyberpunk 2077', '#f2e24a', '#0d0d12', '#ff2d6f', 'stripes', 'Cyberpunk<br>2077');
gen('sdv', 'Stardew Valley', '#4f9e3d', '#1d4f70', '#fff0a8', 'dots');
gen('sts', 'Slay the Spire', '#7a2c2c', '#12141a', '#f0b27a', 'tri');
gen('ori', 'Ori and the Will of the Wisps', '#2f7a9a', '#0c1630', '#c4ffff', 'sun', 'Ori and the<br>Will of the Wisps');
gen('ds', 'Death Stranding', '#6f8590', '#101419', '#dfe8ec', 'wave');
gen('er', 'Elden Ring', '#7a6430', '#0b0a07', '#f2dc9a', 'arch');

export function cover(k, kind = 'p', { w, style = '', cls = '', title = true } = {}) {
  const g = G[k];
  const vars = g.c ? `--c1:${g.c[0]};--c2:${g.c[1]};--c3:${g.c[2]};` : '';
  const sz = w ? `width:${w}px;` : '';
  return `<div class="cv ${kind} ring ${g.cls} ${title ? '' : 'nt'} ${cls}" style="${vars}${sz}${style}"><i></i><b>${g.ct}</b></div>`;
}

export function nav(active = 'Home') {
  const items = ['Home', 'Library', 'Plan', 'Sessions', 'Stats'];
  return `<header class="nav">
  <div class="logo"><i></i>Afterplay</div>
  <nav class="seg">${items.map((n) => `<a class="${n === active ? 'on' : ''}">${n}</a>`).join('')}</nav>
  <div class="navr">
    <div class="search">${ic('search', 16)}<span>Search</span><kbd>Ctrl K</kbd></div>
    <div class="ib sync" title="Up to date">${ic('sync', 19)}</div>
    <div class="ib">${ic('gear', 20)}</div>
  </div>
</header>`;
}

export const ambient = (k, cls = '') => `<div class="amb ${cls}">${cover(k, 'b', { title: false })}</div>`;

export function page({ title, w = 1600, h = 1000, ac = '#8fd3ff', on = '#0c1a22', body, bodyStyle = '', winCls = '' }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${FONTS}" rel="stylesheet"><link rel="stylesheet" href="styles.css">
<style>html,body{width:${w}px;height:${h}px;overflow:hidden}${bodyStyle}</style></head>
<body><div class="win ${winCls}" style="width:${w}px;height:${h}px;--ac:${ac};--on-ac:${on}">
${body}
</div></body></html>`;
}
