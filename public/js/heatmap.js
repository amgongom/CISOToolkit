/* KRI Heat Map — drill-down logic */
'use strict';

let allData = [];       // Full tree from /api/heatmap
let drillState = {      // Current drill-down position
  level: 'root',        // 'root' | 'function' | 'category'
  functionId: null,
  categoryId: null,
  functionName: '',
  categoryName: ''
};
let editingSubId = null;

// ── Boot ──────────────────────────────────────────────────────────────────────
(async () => {
  await initTopbar('heatmap');
  await loadData();
  bindModal();
})();

async function loadData() {
  try {
    const res = await fetch('/api/heatmap');
    if (!res.ok) throw new Error();
    allData = await res.json();
    updateStats();
    renderLevel();
  } catch {
    document.getElementById('heatmapGrid').innerHTML =
      '<p style="color:var(--color-critical);padding:1rem">Error al cargar datos.</p>';
  }
}

// ── Stats row ─────────────────────────────────────────────────────────────────
function updateStats() {
  let total = 0, withKri = 0, critical = 0;
  const vals = [];
  allData.forEach(fn => fn.categories.forEach(cat => cat.subcategories.forEach(s => {
    total++;
    if (s.kri_value !== null && s.kri_value !== undefined) {
      withKri++;
      vals.push(s.kri_value);
      if (s.kri_value > 7.5) critical++;
    }
  })));
  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-withkri').textContent = `${withKri} (${Math.round(withKri/total*100)||0}%)`;
  document.getElementById('stat-critical').textContent = critical;
  const avgEl = document.getElementById('stat-avg');
  if (vals.length) {
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    avgEl.textContent = avg.toFixed(2);
    avgEl.style.color = `var(--color-${kriClass(avg)})`;
  } else {
    avgEl.textContent = '—';
  }
}

// ── Render current level ──────────────────────────────────────────────────────
function renderLevel() {
  updateBreadcrumb();
  if (drillState.level === 'root')     renderFunctions();
  else if (drillState.level === 'function') renderCategories();
  else if (drillState.level === 'category') renderSubcategories();
}

function renderFunctions() {
  document.getElementById('levelTitle').textContent = 'FUNCIONES NIST CSF 2.0';
  const grid = document.getElementById('heatmapGrid');
  grid.innerHTML = '';
  allData.forEach(fn => {
    const cell = makeCell({
      code: fn.code,
      name: fn.name,
      avgKRI: fn.avgKRI,
      count: fn.totalSubcategories,
      kriCount: fn.kriCount,
      badge: fn.code,
      large: true
    });
    cell.addEventListener('click', () => drillIntoFunction(fn));
    grid.appendChild(cell);
  });
}

function renderCategories() {
  const fn = allData.find(f => f.id === drillState.functionId);
  if (!fn) return;
  document.getElementById('levelTitle').textContent = `CATEGORÍAS — ${fn.code}: ${fn.name}`;
  const grid = document.getElementById('heatmapGrid');
  grid.innerHTML = '';
  fn.categories.forEach(cat => {
    const cell = makeCell({
      code: cat.code,
      name: cat.name,
      avgKRI: cat.avgKRI,
      count: cat.totalSubcategories,
      kriCount: cat.kriCount,
      badge: cat.code.split('.')[1]
    });
    cell.addEventListener('click', () => drillIntoCategory(cat));
    grid.appendChild(cell);
  });
}

function renderSubcategories() {
  const fn  = allData.find(f => f.id === drillState.functionId);
  const cat = fn && fn.categories.find(c => c.id === drillState.categoryId);
  if (!cat) return;
  document.getElementById('levelTitle').textContent = `SUBCATEGORÍAS — ${cat.code}: ${cat.name}`;
  const grid = document.getElementById('heatmapGrid');
  grid.innerHTML = '';
  cat.subcategories.forEach(s => {
    const cell = makeSubcategoryCell(s);
    grid.appendChild(cell);
  });
}

// ── Cell builders ─────────────────────────────────────────────────────────────
function makeCell({ code, name, avgKRI, count, kriCount, badge, large }) {
  const cls = kriClass(avgKRI);
  const div = document.createElement('div');
  div.className = `heatmap-cell ${cls}`;
  div.title = `${code}: ${name}\nKRI promedio: ${formatValue(avgKRI)}\n${kriCount}/${count} subcategorías con KRI`;
  if (badge) div.innerHTML += `<div class="cell-badge">${badge}</div>`;
  div.innerHTML += `
    <div>
      <div class="cell-code">${code}</div>
      <div class="cell-name">${name}</div>
    </div>
    <div>
      <div class="cell-value">${formatValue(avgKRI)}</div>
      <div class="cell-meta">${kriCount}/${count} con KRI</div>
    </div>
  `;
  return div;
}

function makeSubcategoryCell(s) {
  const cls = kriClass(s.kri_value);
  const div = document.createElement('div');
  div.className = `heatmap-cell sub ${cls}`;
  const hasKri = s.kri_value !== null && s.kri_value !== undefined;
  div.title = `${s.code}\n${s.description}${hasKri ? `\nKRI: ${s.kri_text}\nValor: ${formatValue(s.kri_value)}\nFecha: ${s.measurement_date}` : '\nSin KRI asignado'}`;
  div.innerHTML = `
    <div>
      <div class="cell-code">${s.code}</div>
      <div class="cell-name" style="font-size:.72rem;font-weight:400;opacity:.85;line-height:1.3;margin-top:.2rem">${truncate(s.description, 80)}</div>
    </div>
    <div>
      <div class="cell-value">${formatValue(s.kri_value)}</div>
      ${hasKri ? `<div class="cell-meta">${s.measurement_date}</div>` : '<div class="cell-meta">sin datos</div>'}
    </div>
    <button class="cell-edit-btn" title="Editar KRI">✎ KRI</button>
  `;
  div.querySelector('.cell-edit-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    openModal(s);
  });
  div.addEventListener('click', () => openModal(s));
  return div;
}

function truncate(str, n) {
  return str.length > n ? str.slice(0, n) + '…' : str;
}

// ── Drill-down ────────────────────────────────────────────────────────────────
function drillIntoFunction(fn) {
  drillState = { level: 'function', functionId: fn.id, functionName: fn.name };
  renderLevel();
}

function drillIntoCategory(cat) {
  drillState.level = 'category';
  drillState.categoryId = cat.id;
  drillState.categoryName = cat.name;
  renderLevel();
}

function navigateTo(level) {
  if (level === 'root') {
    drillState = { level: 'root', functionId: null, categoryId: null, functionName: '', categoryName: '' };
  } else if (level === 'function') {
    drillState.level = 'function';
    drillState.categoryId = null;
    drillState.categoryName = '';
  }
  renderLevel();
}

// ── Breadcrumb ────────────────────────────────────────────────────────────────
function updateBreadcrumb() {
  const bc = document.getElementById('breadcrumb');
  bc.innerHTML = '';

  const addItem = (label, active, onClick) => {
    if (bc.children.length > 0) {
      const sep = document.createElement('span');
      sep.className = 'breadcrumb-sep';
      sep.textContent = '›';
      bc.appendChild(sep);
    }
    const span = document.createElement('span');
    span.className = `breadcrumb-item${active ? ' current' : ''}`;
    span.textContent = label;
    if (!active && onClick) span.addEventListener('click', onClick);
    bc.appendChild(span);
  };

  if (drillState.level === 'root') {
    addItem('Todas las funciones', true);
  } else if (drillState.level === 'function') {
    const fn = allData.find(f => f.id === drillState.functionId);
    addItem('Todas las funciones', false, () => navigateTo('root'));
    addItem(fn ? `${fn.code} — ${fn.name}` : '', true);
  } else if (drillState.level === 'category') {
    const fn  = allData.find(f => f.id === drillState.functionId);
    const cat = fn && fn.categories.find(c => c.id === drillState.categoryId);
    addItem('Todas las funciones', false, () => navigateTo('root'));
    addItem(fn ? `${fn.code} — ${fn.name}` : '', false, () => navigateTo('function'));
    addItem(cat ? `${cat.code} — ${cat.name}` : '', true);
  }
}

// ── KRI Modal ─────────────────────────────────────────────────────────────────
function bindModal() {
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('btnCancelKri').addEventListener('click', closeModal);
  document.getElementById('btnSaveKri').addEventListener('click', saveKri);
  document.getElementById('btnDeleteKri').addEventListener('click', deleteKri);
  document.getElementById('kriModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
}

function openModal(sub) {
  editingSubId = sub.id;
  document.getElementById('modalSubCode').textContent = sub.code;
  document.getElementById('modalSubDesc').textContent = sub.description;
  document.getElementById('kri_text').value  = sub.kri_text   || '';
  document.getElementById('kri_value').value = sub.kri_value  !== null && sub.kri_value !== undefined ? Number(sub.kri_value).toFixed(2) : '';
  document.getElementById('kri_date').value  = sub.measurement_date || new Date().toISOString().slice(0, 10);
  const hasDel = sub.kri_id !== null && sub.kri_id !== undefined;
  document.getElementById('btnDeleteKri').style.display = hasDel ? '' : 'none';
  document.getElementById('kriModal').classList.remove('hidden');
}

function closeModal() {
  editingSubId = null;
  document.getElementById('kriModal').classList.add('hidden');
}

async function saveKri() {
  const kri_text = document.getElementById('kri_text').value.trim();
  const value    = parseFloat(document.getElementById('kri_value').value);
  const measurement_date = document.getElementById('kri_date').value;

  if (!kri_text) { toast('El campo KRI es obligatorio', 'error'); return; }
  if (isNaN(value) || value < 0 || value > 10) { toast('El valor debe estar entre 0 y 10', 'error'); return; }
  if (!measurement_date) { toast('La fecha de medición es obligatoria', 'error'); return; }

  try {
    const res = await fetch(`/api/kris/${editingSubId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kri_text, value, measurement_date })
    });
    if (!res.ok) throw new Error((await res.json()).error);
    toast('KRI guardado correctamente');
    closeModal();
    await loadData();
  } catch (e) {
    toast(e.message || 'Error al guardar', 'error');
  }
}

async function deleteKri() {
  if (!confirm('¿Eliminar el KRI de esta subcategoría?')) return;
  try {
    await fetch(`/api/kris/${editingSubId}`, { method: 'DELETE' });
    toast('KRI eliminado');
    closeModal();
    await loadData();
  } catch {
    toast('Error al eliminar', 'error');
  }
}
