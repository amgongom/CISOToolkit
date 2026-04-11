/* KRI Heatmap — ECharts Treemap */
'use strict';

let allData      = [];
let subById      = {};
let echartsInst  = null;
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
    avgEl.textContent = avg.toFixed(1);
    avgEl.style.color = `var(--color-${kriClass(avg)})`;
  }
}

// ── Color helper ──────────────────────────────────────────────────────────────
function cmmiColor(val) {
  if (val == null) return '#64748b';
  if (val <= 20)   return '#dc2626';
  if (val <= 40)   return '#f97316';
  if (val <= 60)   return '#eab308';
  if (val <= 80)   return '#84cc16';
  return '#16a34a';
}

// ── Build ECharts tree data ───────────────────────────────────────────────────
function buildTreeData() {
  return allData.map(fn => ({
    name:       `${fn.name}  ·  ${fn.code}`,
    label_full: fn.name,
    value:      fn.totalSubcategories,
    valoracion: fn.avgValoracion,
    itemStyle:  { color: cmmiColor(fn.avgValoracion) },
    children: fn.categories.map(cat => ({
      name:       cat.code,
      label_full: cat.name,
      value:      cat.totalSubcategories,
      valoracion: cat.avgValoracion,
      itemStyle:  { color: cmmiColor(cat.avgValoracion) },
      children: cat.subcategories.map(s => ({
        name:       s.code,
        label_full: s.kri_name || '',
        value:      1,
        valoracion: s.valoracion,
        subId:      s.id,
        itemStyle:  { color: cmmiColor(s.valoracion) },
      }))
    }))
  }));
}

// ── ECharts Treemap ───────────────────────────────────────────────────────────
function renderTreemap() {
  const el = document.getElementById('treemapChart');

  if (echartsInst) { echartsInst.dispose(); }
  echartsInst = echarts.init(el, null, { renderer: 'canvas' });

  const option = {
    backgroundColor: '#1e293b',
    tooltip: {
      show: true,
      backgroundColor: '#0f172a',
      borderColor: '#334155',
      textStyle: { color: '#f1f5f9', fontFamily: 'Segoe UI, system-ui, sans-serif' },
      formatter: (params) => {
        const d = params.data;
        if (!d) return '';
        const val = d.valoracion != null ? Number(d.valoracion).toFixed(1) : '—';
        const lvl = d.valoracion != null ? cmmiLevelName(d.valoracion) : 'Sin datos';
        const kri = d.label_full ? `<br><span style="color:#94a3b8">${d.label_full}</span>` : '';
        return `<b>${d.name}</b>${kri}<br>Valoración: <b style="color:${cmmiColor(d.valoracion)}">${val}</b> · ${lvl}`;
      }
    },
    series: [{
      type:       'treemap',
      data:       buildTreeData(),
      width:      '100%',
      height:     '100%',
      roam:       false,
      nodeClick:  false,
      breadcrumb: { show: false },
      visibleMin: 200,
      levels: [
        // ── Raíz implícita (nivel 0) — ocultar ───────────────────────────────
        {
          itemStyle: { borderColor: '#1e293b', borderWidth: 0, gapWidth: 0 },
          label:      { show: false },
          upperLabel: { show: false },
        },
        // ── Funciones (nivel 1) ───────────────────────────────────────────────
        {
          itemStyle: { borderColor: '#0f172a', borderWidth: 6, gapWidth: 6 },
          upperLabel: {
            show:            true,
            height:          52,
            fontSize:        20,
            fontWeight:      'bold',
            color:           '#fff',
            backgroundColor: 'rgba(0,0,0,0.30)',
            padding:         [8, 14],
            overflow:        'truncate',
          },
          label: { show: false },
        },
        // ── Categorías (nivel 2) ──────────────────────────────────────────────
        {
          itemStyle: { borderColor: '#1e293b', borderWidth: 3, gapWidth: 3 },
          upperLabel: {
            show:            true,
            height:          30,
            fontSize:        12,
            fontWeight:      '600',
            color:           '#fff',
            backgroundColor: 'rgba(0,0,0,0.22)',
            padding:         [5, 8],
            overflow:        'truncate',
          },
          label: { show: false },
        },
        // ── Subcategorías (nivel 3, hojas) ────────────────────────────────────
        {
          itemStyle: { borderColor: '#1e293b', borderWidth: 1, gapWidth: 1 },
          label: {
            show:     true,
            fontSize: 9,
            color:    '#fff',
            overflow: 'truncate',
          },
          upperLabel: { show: false },
        },
      ],
    }]
  };

  echartsInst.setOption(option);

  // Click en hoja (subcategoría) → abrir modal KRI
  echartsInst.on('click', (params) => {
    if (params.data && params.data.subId) {
      const sub = subById[params.data.subId];
      if (sub) openModal(sub);
    }
  });

  window.addEventListener('resize', () => echartsInst.resize());
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
  hint.textContent = cmmiLevelName(v);
  hint.style.color = `var(--color-${kriClass(v)})`;
}

function openModal(sub) {
  editingSubId = sub.id;
  document.getElementById('modalSubCode').textContent     = sub.code;
  document.getElementById('modalSubDesc').textContent     = sub.description;
  document.getElementById('kri_name').value               = sub.kri_name        || '';
  document.getElementById('kri_description').value        = sub.kri_description || '';
  document.getElementById('kri_formula').value            = sub.kri_formula     || '';
  document.getElementById('kri_valoracion').value         = sub.valoracion != null ? Number(sub.valoracion).toFixed(1) : '';
  document.getElementById('kri_cmmi_flag').value          = sub.cmmi_flag       || '';
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
  const kri_name   = document.getElementById('kri_name').value.trim();
  const valoracion = parseFloat(document.getElementById('kri_valoracion').value);
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
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body)
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
