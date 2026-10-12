// Map viewer: draws an exported map (local-assets/maps/<n>/) served by `pnpm -F extract cli view`.
// Holds no game content itself; everything shown is read from /maps/ at run time.

const SVG_NS = 'http://www.w3.org/2000/svg';
const SECTIONS = ['section1', 'section2', 'section3', 'section4'];

const $ = (id) => document.getElementById(id);
const mapSelect = $('map-select');
const zoomSelect = $('zoom');
const stage = $('stage');
const viewport = $('viewport');
const background = $('background');
const overlay = $('overlay');
const details = $('details');
const status = $('status');

let pinned = null;

function el(name, attrs, parent) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  parent.append(node);
  return node;
}

function describe(kind, index, record) {
  return `${kind} #${index}\n${JSON.stringify(record, null, 2)}`;
}

function attachDetails(node, text) {
  node.addEventListener('mouseenter', () => {
    if (!pinned) details.textContent = text;
  });
  node.addEventListener('click', (e) => {
    e.stopPropagation();
    pinned?.classList.remove('selected');
    pinned = pinned === node ? null : node;
    pinned?.classList.add('selected');
    details.textContent = text;
  });
}

function draw(data) {
  overlay.replaceChildren();
  const { width, height } = data.background;
  overlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
  overlay.setAttribute('width', width);
  overlay.setAttribute('height', height);
  stage.style.width = `${width}px`;
  stage.style.height = `${height}px`;

  const layer = (name) => el('g', { 'data-layer': name }, overlay);
  const links = layer('links');
  const refs = layer('refs');
  const secLayers = SECTIONS.map((_, k) => layer(`sec${k + 1}`));
  const squares = layer('squares');
  const names = layer('names');

  // Links are undirected: draw each pair once.
  data.squares.forEach((sq, i) => {
    for (const j of sq.links) {
      if (j === null || j < i) continue;
      const other = data.squares[j];
      el('line', { class: 'link', x1: sq.x, y1: sq.y, x2: other.x, y2: other.y }, links);
    }
    if (sq.ref) {
      const target = data[SECTIONS[sq.ref.section - 1]][sq.ref.index];
      el('line', { class: 'ref', x1: sq.x, y1: sq.y, x2: target.x, y2: target.y }, refs);
    }
  });

  SECTIONS.forEach((key, k) => {
    data[key].forEach((r, i) => {
      const node = el(
        'rect',
        { class: `hit sec${k + 1}`, x: r.x - 12, y: r.y - 12, width: 24, height: 24 },
        secLayers[k],
      );
      attachDetails(node, describe(`區段 ${k + 1}`, i, r));
    });
  });

  data.squares.forEach((sq, i) => {
    const node = el('circle', { class: 'hit square', cx: sq.x, cy: sq.y, r: 14 }, squares);
    attachDetails(node, describe('格子', i, sq));
    if (sq.name) {
      const label = el('text', { class: 'label', x: sq.x + 18, y: sq.y + 8 }, names);
      label.textContent = sq.name;
    }
  });

  applyLayers();
  const counts = [data.squares.length, ...SECTIONS.map((k) => data[k].length)];
  status.textContent = `${width}×${height}，格子 ${counts[0]}，區段 1–4：${counts.slice(1).join(' / ')}`;
}

function applyLayers() {
  for (const box of document.querySelectorAll('#layers input')) {
    overlay
      .querySelector(`g[data-layer="${box.dataset.layer}"]`)
      ?.classList.toggle('hidden', !box.checked);
  }
}

function applyZoom() {
  const z = Number(zoomSelect.value);
  stage.style.transform = `scale(${z})`;
  // transform does not affect layout; adjust margins so the scroll area matches the scaled size.
  stage.style.marginRight = `${stage.offsetWidth * (z - 1)}px`;
  stage.style.marginBottom = `${stage.offsetHeight * (z - 1)}px`;
}

async function loadMap(n) {
  status.textContent = '載入中…';
  pinned = null;
  details.textContent = '將滑鼠移到點上查看欄位；點一下可固定。';
  const res = await fetch(`maps/${n}/map.json`);
  if (!res.ok) throw new Error(`maps/${n}/map.json: HTTP ${res.status}`);
  const data = await res.json();
  background.src = `maps/${n}/${data.background.file}`;
  draw(data);
  applyZoom();
  history.replaceState(null, '', `?map=${n}`);
}

async function main() {
  const res = await fetch('maps/index.json');
  if (!res.ok) {
    status.textContent = '找不到 maps/index.json，請先執行 pnpm -F extract cli map';
    return;
  }
  const { maps } = await res.json();
  for (const n of maps) mapSelect.append(new Option(`地圖 ${n}`, n));
  const wanted = new URLSearchParams(location.search).get('map');
  if (wanted !== null && maps.includes(Number(wanted))) mapSelect.value = wanted;

  mapSelect.addEventListener('change', () => loadMap(mapSelect.value).catch(showError));
  zoomSelect.addEventListener('change', applyZoom);
  document.querySelector('#layers').addEventListener('change', applyLayers);
  overlay.addEventListener('click', () => {
    pinned?.classList.remove('selected');
    pinned = null;
  });
  enableDragScroll();
  if (maps.length > 0) await loadMap(mapSelect.value);
  else status.textContent = '尚未匯出任何地圖';
}

function enableDragScroll() {
  let start = null;
  viewport.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.hit')) return;
    start = { x: e.clientX, y: e.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.classList.add('dragging');
  });
  window.addEventListener('pointermove', (e) => {
    if (!start) return;
    viewport.scrollLeft = start.left - (e.clientX - start.x);
    viewport.scrollTop = start.top - (e.clientY - start.y);
  });
  window.addEventListener('pointerup', () => {
    start = null;
    viewport.classList.remove('dragging');
  });
}

function showError(e) {
  status.textContent = `錯誤：${e.message}`;
}

main().catch(showError);
