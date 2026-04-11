/* KRI Heatmap — Plotly Treemap */
'use strict';

// Colorscale CMMI 0-100 (cmin=-1 para "sin datos" → gris)
// Normalized positions: (value+1)/101
const COLORSCALE = [
  [0,       '#64748b'],  // -1  → sin datos (gris)
  [0.0098,  '#64748b'],  // ~0  → todavía gris
  [0.0099,  '#dc2626'],  // 0   → N1 rojo
  [0.208,   '#f97316'],  // 20  → N1/N2
  [0.406,   '#eab308'],  // 40  → N2/N3
  [0.604,   '#84cc16'],  // 60  → N3/N4
  [0.802,   '#22c55e'],  // 80  → N4/N5
  [1.0,     '#16a34a'],  // 100 → N5 verde
];

let allData   = [];
let subById   = {};   // subcategory id → data
let editingSubId = null;

// ── Boot ──────────────────────────────────────────────────────────────────────
(async () => {
  await initTopbar('heatmap');
  await loadData();
  bindModal();
})();

// ── Load data & render ────────────────────────────────────────────────────────
async function loadData() {
  const res = await fetch('/api/heatmap');
  allData = await res.json();

  // Build sub lookup
  allData.forEach(fn => fn.categories.forEach(cat => cat.subcategories.forEach(s => {
    subById[s.id] = s;
  })));

  updateStats();
  renderTreemap();
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function updateStats() {
  let total = 0, withKri = 0, n1 = 0;
  const vals = [];
  allData.forEach(fn => fn.categories.forEach(cat => cat.subcategories.forEach(s => {
    total++;
    if (s.valoracion != null) { withKri++; vals.push(s.valoracion); if (s.valoracion <= 20) n1++; }
  })));
  document.getElementById('stat-total').textContent   = total;
  document.getElementById('stat-withkri').textContent = `${withKri}/${total}`;
  document.getElementById('stat-n1').textContent      = n1;
  const avgEl = document.getElementById('stat-avg');
  if (vals.length) {
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    avgEl.textContent  = avg.toFixed(1);
    avgEl.style.color  = `var(--color-${kriClass(avg)})`;
  }
}

// ── Plotly Treemap ────────────────────────────────────────────────────────────
function renderTreemap() {
  const ids        = [];
  const labels     = [];
  const parents    = [];
  const values     = [];
  const colors     = [];
  const customdata = [];  // [valoracion, kri_name, cmmi_flag, code, sub_id]

  allData.forEach(fn => {
    ids.push(fn.code);
    labels.push(`<b>${fn.name}</b><br>${fn.code}`);
    parents.push('');
    values.push(0);
    colors.push(fn.avgValoracion != null ? fn.avgValoracion : -1);
    customdata.push([fn.avgValoracion, fn.name, '', fn.code, '']);

    fn.categories.forEach(cat => {
      ids.push(cat.code);
      labels.push(`${cat.name}<br><b>${cat.code}</b>`);
      parents.push(fn.code);
      values.push(0);
      colors.push(cat.avgValoracion != null ? cat.avgValoracion : -1);
      customdata.push([cat.avgValoracion, cat.name, '', cat.code, '']);

      cat.subcategories.forEach(s => {
        ids.push(s.code);
        labels.push(`<b>${s.code}</b>`);
        parents.push(cat.code);
        values.push(1);
        colors.push(s.valoracion != null ? s.valoracion : -1);
        customdata.push([s.valoracion, s.kri_name || '', s.cmmi_flag || '', s.code, s.id]);
      });
    });
  });

  const trace = {
    type: 'treemap',
    ids, labels, parents, values,
    branchvalues: 'remainder',
    marker: {
      colors,
      colorscale: COLORSCALE,
      cmin: -1,
      cmax: 100,
      showscale: true,
      colorbar: {
        title: { text: 'Valoración', side: 'right', font: { color: '#f1f5f9', size: 11 } },
        tickvals: [0, 20, 40, 60, 80, 100],
        ticktext: ['0 N1', '20', '40 N3', '60', '80', '100 N5'],
        tickfont: { color: '#f1f5f9', size: 10 },
        bgcolor: '#1e293b',
        bordercolor: '#475569',
        thickness: 16,
        len: 0.7,
      }
    },
    customdata,
    hovertemplate:
      '<b>%{label}</b><br>' +
      'Valoración: <b>%{customdata[0]:.1f}</b><br>' +
      '%{customdata[1]}<br>' +
      '<i>%{customdata[2]}</i>' +
      '<extra></extra>',
    pathbar: { visible: true, side: 'top', thickness: 28 },
    tiling: { packing: 'squarify' },
    textfont: { size: 11, color: 'white' },
    insidetextfont: { size: 11, color: 'white' },
  };

  const layout = {
    paper_bgcolor: '#1e293b',
    plot_bgcolor:  '#1e293b',
    margin: { t: 10, l: 5, r: 5, b: 5 },
    font: { family: 'Segoe UI, system-ui, sans-serif', color: '#f1f5f9' },
  };

  const config = {
    displayModeBar: true,
    modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d'],
    displaylogo: false,
    responsive: true,
  };

  Plotly.newPlot('treemapChart', [trace], layout, config);

  // Click on leaf (subcategory) → open KRI modal
  document.getElementById('treemapChart').on('plotly_click', (data) => {
    const pt    = data.points[0];
    const subId = pt.customdata[4];
    if (!subId) return;  // not a leaf
    const sub = subById[subId];
    if (sub) openModal(sub);
  });
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function bindModal() {
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('btnCancelKri').addEventListener('click', closeModal);
  document.getElementById('btnSaveKri').addEventListener('click', saveKri);
  document.getElementById('btnDeleteKri').addEventListener('click', deleteKri);
  document.getElementById('kriModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.getElementById('kri_valoracion').addEventListener('input', updateCmmiHint);
}

function updateCmmiHint() {
  const v = parseFloat(document.getElementById('kri_valoracion').value);
  const hint = document.getElementById('cmmiLevelHint');
  if (isNaN(v)) { hint.textContent = ''; return; }
  hint.textContent  = cmmiLevelName(v);
  hint.style.color  = `var(--color-${kriClass(v)})`;
}

function openModal(sub) {
  editingSubId = sub.id;
  document.getElementById('modalSubCode').textContent      = sub.code;
  document.getElementById('modalSubDesc').textContent      = sub.description;
  document.getElementById('kri_name').value                = sub.kri_name         || '';
  document.getElementById('kri_description').value         = sub.kri_description  || '';
  document.getElementById('kri_formula').value             = sub.kri_formula      || '';
  document.getElementById('kri_valoracion').value          = sub.valoracion  != null ? Number(sub.valoracion).toFixed(1)  : '';
  document.getElementById('kri_cmmi_flag').value           = sub.cmmi_flag        || '';
  updateCmmiHint();
  document.getElementById('btnDeleteKri').style.display = sub.kri_id ? '' : 'none';
  loadHeatmapHistory(sub.id);
  document.getElementById('kriModal').classList.remove('hidden');
}

async function loadHeatmapHistory(subId) {
  const box  = document.getElementById('kriHistoryBox');
  const list = document.getElementById('kriHistoryList');
  try {
    const res  = await fetch(`/api/kris/${subId}/history`);
    const rows = await res.json();
    if (!rows.length) { box.style.display = 'none'; return; }
    box.style.display = '';
    list.innerHTML = rows.map(h => `
      <div style="display:flex;justify-content:space-between;align-items:center;
                  padding:.35rem .5rem;border-bottom:1px solid var(--border)">
        <span style="color:var(--color-${kriClass(h.valoracion)});font-weight:700;min-width:3.5rem">
          ${Number(h.valoracion).toFixed(1)}
          <span style="font-size:.72rem;font-weight:400;color:var(--text-muted)"> ${cmmiLevel(h.valoracion)}</span>
        </span>
        <span style="color:var(--text-muted)">${h.saved_by}</span>
        <span style="color:var(--text-muted)">${formatHeatmapDateTime(h.saved_at)}</span>
      </div>
    `).join('');
  } catch { box.style.display = 'none'; }
}

function formatHeatmapDateTime(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr.replace(' ', 'T') + 'Z');
  return d.toLocaleString('es-ES', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function closeModal() {
  editingSubId = null;
  document.getElementById('kriModal').classList.add('hidden');
}

async function saveKri() {
  const kri_name    = document.getElementById('kri_name').value.trim();
  const valoracion  = parseFloat(document.getElementById('kri_valoracion').value);
  if (!kri_name) { toast('El nombre del KRI es obligatorio', 'error'); return; }
  if (isNaN(valoracion) || valoracion < 0 || valoracion > 100) { toast('La valoración debe estar entre 0 y 100', 'error'); return; }

  const body = {
    kri_name,
    kri_description: document.getElementById('kri_description').value.trim(),
    kri_formula:     document.getElementById('kri_formula').value.trim(),
    cmmi_flag:       document.getElementById('kri_cmmi_flag').value || null,
    valoracion,
  };

  const btn = document.getElementById('btnSaveKri');
  btn.disabled = true;
  try {
    const res = await fetch(`/api/kris/${editingSubId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error((await res.json()).error);
    toast('KRI guardado');
    closeModal();
    await loadData();
  } catch (e) {
    toast(e.message || 'Error al guardar', 'error');
  } finally { btn.disabled = false; }
}

async function deleteKri() {
  if (!confirm('¿Eliminar el KRI de esta subcategoría?')) return;
  await fetch(`/api/kris/${editingSubId}`, { method: 'DELETE' });
  toast('KRI eliminado');
  closeModal();
  await loadData();
}
