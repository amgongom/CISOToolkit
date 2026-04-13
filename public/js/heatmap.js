/* KRI Heatmap — ECharts Treemap */
'use strict';

let allData      = [];
let subById      = {};
let catById      = {};   // catCode → category object (with id, name, fnName, fnCode)
let echartsInst  = null;
let editingSubId = null;
let editingKriId = null;

// ── Boot ──────────────────────────────────────────────────────────────────────
(async () => {
  await initTopbar('heatmap');
  await loadData();
  bindModal();
  document.getElementById('btnExport').addEventListener('click', exportHeatmap);
})();

// ── Load data & render ────────────────────────────────────────────────────────
async function loadData() {
  const res = await fetch('/api/heatmap');
  allData = await res.json();

  allData.forEach(fn => fn.categories.forEach(cat => {
    catById[cat.code] = { ...cat, fnName: fn.name, fnCode: fn.code };
    cat.subcategories.forEach(s => {
      subById[s.id] = { ...s, fnName: fn.name, fnCode: fn.code, catName: cat.name, catCode: cat.code };
    });
  }));

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
// Interpolación suave entre 5 anclajes de color (rojo→naranja→amarillo→lima→verde)
const COLOR_STOPS = [
  { v:   0, r: 239, g:  68, b:  68 },  // #ef4444  N1 rojo
  { v:  20, r: 249, g: 115, b:  22 },  // #f97316  N1→N2
  { v:  40, r: 251, g: 191, b:  36 },  // #fbbf24  N2→N3 amarillo
  { v:  60, r: 163, g: 230, b:  53 },  // #a3e635  N3→N4 lima
  { v:  80, r:  22, g: 163, b:  74 },  // #16a34a  N4→N5 verde oscuro
  { v: 100, r:  22, g: 163, b:  74 },  // #16a34a  N5 verde oscuro
];

function cmmiColor(val) {
  if (val == null) return '#475569';
  const v  = Math.max(0, Math.min(100, val));
  let lo = COLOR_STOPS[0], hi = COLOR_STOPS[COLOR_STOPS.length - 1];
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    if (v >= COLOR_STOPS[i].v && v <= COLOR_STOPS[i + 1].v) {
      lo = COLOR_STOPS[i]; hi = COLOR_STOPS[i + 1]; break;
    }
  }
  const t = lo.v === hi.v ? 0 : (v - lo.v) / (hi.v - lo.v);
  const r = Math.round(lo.r + t * (hi.r - lo.r));
  const g = Math.round(lo.g + t * (hi.g - lo.g));
  const b = Math.round(lo.b + t * (hi.b - lo.b));
  return `rgb(${r},${g},${b})`;
}

// ── Build ECharts tree data ───────────────────────────────────────────────────
function buildTreeData() {
  return allData.map(fn => ({
    id:         fn.code,
    name:       `${fn.name}  ·  ${fn.code}`,
    label_full: fn.name,
    type:       'function',
    value:      fn.totalSubcategories,
    valoracion: fn.avgValoracion,
    itemStyle:  { color: cmmiColor(fn.avgValoracion) },
    children: fn.categories.map(cat => ({
      id:         cat.code,
      name:       `${cat.name}  ·  ${cat.code}`,
      label_full: cat.name,
      type:       'category',
      catCode:    cat.code,
      value:      cat.totalSubcategories,
      valoracion: cat.avgValoracion,
      itemStyle:  { color: cmmiColor(cat.avgValoracion) },
      children: cat.subcategories.map(s => ({
        id:         `sub_${s.id}`,
        name:       s.code,
        label_full: s.kri_name || '',
        type:       'subcategory',
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
      breadcrumb: {
        show:      true,
        bottom:    4,
        height:    28,
        itemStyle: { color: '#1e293b', borderColor: '#475569', borderWidth: 1 },
        textStyle: { color: '#f1f5f9', fontSize: 13 },
        emphasis:  { itemStyle: { color: '#334155' } },
      },
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

  // Click routing by node type
  echartsInst.on('click', (params) => {
    if (!params.data) return;
    const d = params.data;
    if (d.type === 'subcategory') {
      const sub = subById[d.subId];
      if (sub) openSubcategoryDrilldown(sub);
    } else {
      // function or category → zoom into treemap
      echartsInst.dispatchAction({
        type:         'treemapZoomToNode',
        seriesIndex:  0,
        targetNodeId: d.id,
      });
    }
  });

  const ro = new ResizeObserver(() => echartsInst.resize());
  ro.observe(el);
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

  // Drilldown modal
  const closeDd = () => document.getElementById('drilldownModal').classList.add('hidden');
  document.getElementById('ddClose').addEventListener('click', closeDd);
  document.getElementById('ddCancel').addEventListener('click', closeDd);
  document.getElementById('drilldownModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeDd();
  });
}

function updateCmmiHint() {
  const input = document.getElementById('kri_valoracion');
  let v = parseFloat(input.value);
  if (!isNaN(v)) {
    if (v > 100) { v = 100; input.value = '100'; }
    if (v < 0)   { v = 0;   input.value = '0'; }
  }
  const hint = document.getElementById('cmmiLevelHint');
  if (isNaN(v)) { hint.textContent = ''; return; }
  hint.textContent = cmmiLevelName(v);
  hint.style.color = `var(--color-${kriClass(v)})`;
}

function openModal(sub) {
  editingSubId = sub.id;
  editingKriId = sub.kri_id || null;
  document.getElementById('fieldFuncion').textContent      = `${sub.fnName} (${sub.fnCode})`;
  document.getElementById('fieldCategoria').textContent   = `${sub.catName} (${sub.catCode})`;
  document.getElementById('fieldSubcategoria').textContent = sub.code;
  document.getElementById('fieldDescripcion').textContent = sub.description;
  document.getElementById('kri_name').value               = sub.kri_name        || '';
  document.getElementById('kri_description').value        = sub.kri_description || '';
  document.getElementById('kri_formula').value            = sub.kri_formula     || '';
  document.getElementById('kri_valoracion').value         = sub.valoracion != null ? Number(sub.valoracion).toFixed(1) : '';
  document.getElementById('kri_cmmi_flag').value          = sub.cmmi_flag       || '';
  updateCmmiHint();
  document.getElementById('btnDeleteKri').style.display = sub.kri_id ? '' : 'none';
  if (sub.kri_id) loadHeatmapHistory(sub.kri_id);
  else document.getElementById('kriHistoryBox').style.display = 'none';
  document.getElementById('kriModal').classList.remove('hidden');
}

async function loadHeatmapHistory(kriId) {
  const box  = document.getElementById('kriHistoryBox');
  const list = document.getElementById('kriHistoryList');
  try {
    const res  = await fetch(`/api/kris/${kriId}/history`);
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
  editingKriId = null;
  document.getElementById('kriModal').classList.add('hidden');
}

async function saveKri() {
  const kri_name   = document.getElementById('kri_name').value.trim();
  const valoracion = parseFloat(document.getElementById('kri_valoracion').value);
  if (!kri_name) { toast('El nombre del KRI es obligatorio', 'error'); return; }
  if (isNaN(valoracion) || valoracion < 0 || valoracion > 100) { toast('La valoración debe estar entre 0 y 100', 'error'); return; }

  const body = {
    kri_id:          editingKriId || undefined,
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
    if (!res.ok) {
      const text = await res.text();
      let msg = `Error ${res.status}`;
      try { msg = JSON.parse(text).error || msg; } catch {}
      throw new Error(msg);
    }
    toast('KRI guardado');
    closeModal();
    await loadData();
  } catch (e) {
    toast(e.message || 'Error al guardar', 'error');
  } finally { btn.disabled = false; }
}

async function deleteKri() {
  if (!confirm('¿Eliminar este KRI?')) return;
  try {
    const res = await fetch(`/api/kris/${editingKriId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json()).error);
    toast('KRI eliminado');
    closeModal();
    await loadData();
  } catch {
    toast('Error al eliminar', 'error');
  }
}

// ── Export ────────────────────────────────────────────────────────────────────
async function exportHeatmap() {
  const format = document.getElementById('exportFormat').value;
  // Fetch all KRI rows (no filters — heatmap shows full dataset)
  let rows;
  try {
    const res = await fetch('/api/kris');
    rows = await res.json();
  } catch (e) {
    toast('Error al obtener datos', 'error');
    return;
  }
  if (format === 'json')      exportJSON(rows);
  else if (format === 'csv')  exportCSV(rows);
  else if (format === 'xml')  exportXML(rows);
  else if (format === 'xlsx') await exportExcelFile(new URLSearchParams(), 'btnExport');
}

// ── Subcategory Drilldown ─────────────────────────────────────────────────────
async function openSubcategoryDrilldown(sub) {
  const modal   = document.getElementById('drilldownModal');
  const content = document.getElementById('ddContent');
  document.getElementById('ddTitle').textContent    = 'KRIs de Subcategoría';
  document.getElementById('ddSubtitle').textContent = '';

  // Context fields (función / categoría / subcategoría)
  const contextBox = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem .75rem;padding:.75rem 1rem;background:var(--surface);border-bottom:1px solid var(--border)">
      <div class="form-group" style="margin:0">
        <label style="font-size:.72rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em">Función</label>
        <div class="field-readonly">${sub.fnCode} · ${sub.fnName}</div>
      </div>
      <div class="form-group" style="margin:0">
        <label style="font-size:.72rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em">Categoría</label>
        <div class="field-readonly">${sub.catCode} · ${sub.catName}</div>
      </div>
      <div class="form-group" style="margin:0;grid-column:1/-1">
        <label style="font-size:.72rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em">Subcategoría</label>
        <div class="field-readonly" style="display:flex;gap:.75rem;align-items:baseline">
          <span style="font-weight:700;white-space:nowrap">${sub.code}</span>
          <span style="font-size:.82rem;color:var(--text-muted)">${sub.description}</span>
        </div>
      </div>
    </div>`;

  // Add KRI button
  const addBtn = `
    <div style="padding:.6rem 1rem;border-bottom:1px solid var(--border);display:flex;justify-content:flex-end">
      <button class="btn-icon btn-icon-add" onclick="ddAddKri(${sub.id})" title="Agregar KRI">＋</button>
    </div>`;

  content.innerHTML = contextBox + '<div style="padding:1.5rem;text-align:center;color:var(--text-muted)">Cargando...</div>';
  modal.classList.remove('hidden');

  try {
    const res  = await fetch(`/api/kris?subcategoryId=${sub.id}`);
    const rows = await res.json();
    const kris = rows.filter(r => r.kri_id);

    if (!kris.length) {
      content.innerHTML = contextBox + addBtn + `
        <div style="padding:1.5rem;text-align:center;color:var(--text-muted);font-style:italic">
          Sin KRIs asignados
        </div>`;
      return;
    }

    const rowsHtml = kris.map(k => {
      const val = k.valoracion != null ? Number(k.valoracion).toFixed(1) : '—';
      const cls = k.valoracion != null ? kriClass(k.valoracion) : 'nodata';
      const lvl = k.valoracion != null ? cmmiLevel(k.valoracion) : '—';
      const desc = k.kri_description
        ? `<div style="font-size:.78rem;color:var(--text-muted);margin-top:.2rem">${k.kri_description}</div>` : '';
      const formula = k.kri_formula
        ? `<div style="font-size:.75rem;color:var(--text-muted);margin-top:.15rem;font-style:italic">Fórmula: ${k.kri_formula}</div>` : '';
      return `
        <tr>
          <td style="padding:.6rem .75rem;border-bottom:1px solid var(--border)">
            <div style="font-weight:600;font-size:.88rem">${k.kri_name}</div>
            ${desc}${formula}
          </td>
          <td style="padding:.6rem .75rem;border-bottom:1px solid var(--border);text-align:center;font-weight:700;font-size:1rem;color:var(--color-${cls});white-space:nowrap">
            ${val}
          </td>
          <td style="padding:.6rem .75rem;border-bottom:1px solid var(--border);text-align:center;font-size:.8rem;white-space:nowrap">
            ${lvl}
          </td>
          <td style="padding:.6rem .75rem;border-bottom:1px solid var(--border);text-align:center">
            <button class="btn-icon" onclick="ddEditKri(${sub.id}, ${k.kri_id})" title="Editar">✎</button>
          </td>
        </tr>`;
    }).join('');

    content.innerHTML = contextBox + addBtn + `
      <table style="width:100%;border-collapse:collapse;font-size:.88rem">
        <thead>
          <tr style="background:var(--surface);border-bottom:2px solid var(--border)">
            <th style="padding:.5rem .75rem;text-align:left">KRI</th>
            <th style="padding:.5rem .75rem;text-align:center">Valor</th>
            <th style="padding:.5rem .75rem;text-align:center">CMMI</th>
            <th style="padding:.5rem .75rem;text-align:center">Acc.</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;

  } catch (e) {
    content.innerHTML = `<div style="padding:1.5rem;color:var(--color-n1)">Error: ${e.message}</div>`;
  }
}

function ddAddKri(subcategoryId) {
  document.getElementById('drilldownModal').classList.add('hidden');
  const sub = subById[subcategoryId];
  if (sub) openModal({ ...sub, kri_id: null, kri_name: '', kri_description: '', kri_formula: '', cmmi_flag: '', valoracion: null });
}

async function ddEditKri(subcategoryId, kriId) {
  document.getElementById('drilldownModal').classList.add('hidden');
  const base = subById[subcategoryId];
  if (!base) return;
  try {
    const res  = await fetch(`/api/kris?subcategoryId=${subcategoryId}`);
    const rows = await res.json();
    const kri  = rows.find(r => r.kri_id === kriId);
    openModal(kri ? {
      ...base,
      kri_id:          kri.kri_id,
      kri_name:        kri.kri_name,
      kri_description: kri.kri_description,
      kri_formula:     kri.kri_formula,
      cmmi_flag:       kri.cmmi_flag,
      valoracion:      kri.valoracion,
    } : { ...base, kri_id: kriId });
  } catch {
    openModal({ ...base, kri_id: kriId });
  }
}
