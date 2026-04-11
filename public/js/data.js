/* KRI Data Table page */
'use strict';

let allRows = [];
let functions = [];
let categories = [];
let editingSubId = null;

// ── Boot ──────────────────────────────────────────────────────────────────────
(async () => {
  await initTopbar('data');
  await Promise.all([loadLookups(), loadRows()]);
  bindFilters();
  bindModal();
  bindExamplesModal();
})();

// ── Data loading ──────────────────────────────────────────────────────────────
async function loadLookups() {
  const [fRes, cRes] = await Promise.all([
    fetch('/api/functions'),
    fetch('/api/categories')
  ]);
  functions  = await fRes.json();
  categories = await cRes.json();

  const fSel = document.getElementById('filterFunction');
  functions.forEach(f => {
    const o = new Option(`${f.code} — ${f.name}`, f.id);
    fSel.appendChild(o);
  });
}

async function loadRows() {
  const res = await fetch('/api/kris');
  allRows = await res.json();
  applyFilters();
}

// ── Filters ───────────────────────────────────────────────────────────────────
function bindFilters() {
  document.getElementById('filterFunction').addEventListener('change', onFunctionChange);
  document.getElementById('filterCategory').addEventListener('change', applyFilters);
  document.getElementById('filterKri').addEventListener('change', applyFilters);
  document.getElementById('filterSearch').addEventListener('input', applyFilters);
  document.getElementById('btnReset').addEventListener('click', resetFilters);
}

function onFunctionChange() {
  const fnId = document.getElementById('filterFunction').value;
  const cSel = document.getElementById('filterCategory');
  cSel.innerHTML = '<option value="">Todas</option>';
  if (fnId) {
    categories
      .filter(c => String(c.function_id) === String(fnId))
      .forEach(c => {
        const o = new Option(`${c.code} — ${c.name}`, c.id);
        cSel.appendChild(o);
      });
  }
  applyFilters();
}

function applyFilters() {
  const fnId      = document.getElementById('filterFunction').value;
  const catId     = document.getElementById('filterCategory').value;
  const kriFilter = document.getElementById('filterKri').value;
  const search    = document.getElementById('filterSearch').value.toLowerCase().trim();

  const filtered = allRows.filter(r => {
    if (fnId  && String(r.function_id) !== String(fnId))   return false;
    if (catId && String(r.category_id) !== String(catId))  return false;
    if (kriFilter === 'with'    && r.kri_id === null)       return false;
    if (kriFilter === 'without' && r.kri_id !== null)       return false;
    if (search) {
      const hay = `${r.code} ${r.description} ${r.kri_name || ''} ${r.kri_description || ''} ${r.category_code} ${r.function_code}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  renderTable(filtered);
  document.getElementById('resultCount').textContent =
    `Mostrando ${filtered.length} de ${allRows.length} subcategorías`;
}

function resetFilters() {
  document.getElementById('filterFunction').value = '';
  document.getElementById('filterCategory').innerHTML = '<option value="">Todas</option>';
  document.getElementById('filterKri').value = '';
  document.getElementById('filterSearch').value = '';
  applyFilters();
}

// ── Table render ──────────────────────────────────────────────────────────────
function renderTable(rows) {
  const tbody = document.getElementById('tableBody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="12" class="table-empty">No se encontraron resultados</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  rows.forEach(r => {
    const hasKri = r.kri_id !== null;
    const cls    = kriClass(r.valoracion);
    const level  = cmmiLevel(r.valoracion);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span style="font-size:.82rem">${r.function_name} <span style="font-family:monospace;font-weight:700;color:var(--accent)">(${r.function_code})</span></span></td>
      <td><span style="font-size:.82rem">${r.category_name} <span class="td-code">(${r.category_code})</span></span></td>
      <td><span class="td-code">${r.code}</span></td>
      <td style="text-align:center">
        <button class="btn-ex-link" data-sub-id="${r.subcategory_id}" title="Ver ejemplos de implementación">
          Cargando…
        </button>
      </td>
      <td class="td-kri">${hasKri ? truncate(r.kri_name, 80) : '<span class="no-data-text">Sin KRI</span>'}</td>
      <td style="text-align:center">
        ${hasKri
          ? `<span class="kri-badge ${cls}">${Number(r.valoracion).toFixed(1)}</span>`
          : '<span class="no-data-text">—</span>'}
      </td>
      <td style="text-align:center;font-size:.82rem">
        ${level ? `<span style="color:var(--color-${cls});font-weight:600">${level}</span>` : '<span class="no-data-text">—</span>'}
      </td>
      <td style="text-align:center;font-size:.78rem;white-space:nowrap">
        ${r.last_saved_at
          ? `<span style="color:var(--text)">${formatDateTime(r.last_saved_at)}</span><br><span style="color:var(--text-muted)">${r.last_saved_by}</span>`
          : '<span class="no-data-text">—</span>'}
      </td>
      <td class="td-actions">
        <button class="btn-icon" title="Editar KRI" data-id="${r.subcategory_id}">✎</button>
      </td>
    `;

    // Resolve examples count and update button label
    const exBtn = tr.querySelector('.btn-ex-link');
    fetchExamples(r.subcategory_id).then(exs => {
      exBtn.textContent = exs.length ? `${exs.length} ejemplo${exs.length > 1 ? 's' : ''}` : 'Sin ejemplos';
      exBtn.disabled = exs.length === 0;
    });
    exBtn.addEventListener('click', () => openExamplesModal(
      r.subcategory_id, r.code, r.description
    ));

    tr.querySelector('.btn-icon[data-id]').addEventListener('click', () => openModal(r));
    tbody.appendChild(tr);
  });
}

// Cache examples to avoid repeated requests
const examplesCache = {};
async function fetchExamples(subId) {
  if (examplesCache[subId] !== undefined) return examplesCache[subId];
  try {
    const r = await fetch(`/api/examples?subcategoryId=${subId}`);
    examplesCache[subId] = await r.json();
    return examplesCache[subId];
  } catch { return []; }
}

function formatDateTime(isoStr) {
  if (!isoStr) return '—';
  // SQLite datetime() returns "YYYY-MM-DD HH:MM:SS" (UTC)
  const d = new Date(isoStr.replace(' ', 'T') + 'Z');
  return d.toLocaleString('es-ES', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function truncate(str, n) {
  if (!str) return '';
  return str.length > n ? str.slice(0, n) + '…' : str;
}

// ── Examples Modal ───────────────────────────────────────────────────────────
function bindExamplesModal() {
  document.getElementById('exModalClose').addEventListener('click', () =>
    document.getElementById('examplesModal').classList.add('hidden'));
  document.getElementById('exModalCancel').addEventListener('click', () =>
    document.getElementById('examplesModal').classList.add('hidden'));
  document.getElementById('examplesModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
  });
}

async function openExamplesModal(subId, code, desc) {
  document.getElementById('exModalCode').textContent = code;
  document.getElementById('exModalDesc').textContent = desc;
  const listEl = document.getElementById('exModalList');
  listEl.innerHTML = '<p style="color:var(--text-muted);padding:.5rem">Cargando…</p>';
  document.getElementById('examplesModal').classList.remove('hidden');

  const exs = await fetchExamples(subId);
  if (!exs.length) {
    listEl.innerHTML = '<p style="color:var(--text-muted);padding:.5rem">Esta subcategoría no tiene ejemplos de implementación.</p>';
    return;
  }
  const row = allRows.find(r => r.subcategory_id === subId);
  const descHtml = row ? `
    <div style="background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.25);border-radius:6px;
                padding:.75rem 1rem;margin-bottom:1rem;font-size:.85rem;color:var(--text);line-height:1.5">
      ${row.description}
    </div>` : '';

  listEl.innerHTML = descHtml + exs.map(e => `
    <div style="display:flex;gap:.75rem;padding:.75rem 0;border-bottom:1px solid var(--border)">
      <span style="flex-shrink:0;background:var(--accent);color:#fff;border-radius:5px;
                   padding:.15rem .5rem;font-size:.72rem;font-weight:700;height:fit-content;margin-top:.1rem">
        Ex${e.number}
      </span>
      <span style="color:var(--text);font-size:.88rem;line-height:1.55">${e.text}</span>
    </div>
  `).join('');
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function bindModal() {
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('btnCancelKri').addEventListener('click', closeModal);
  document.getElementById('btnSaveKri').addEventListener('click', saveKri);
  document.getElementById('btnDeleteKri').addEventListener('click', deleteKri);
  document.getElementById('kriModal').addEventListener('click', (e) => {
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

async function openModal(row) {
  editingSubId = row.subcategory_id;
  document.getElementById('modalSubCode').textContent      = row.code;
  document.getElementById('modalSubDesc').textContent      = row.description;
  document.getElementById('kri_name').value                = row.kri_name        || '';
  document.getElementById('kri_description').value         = row.kri_description || '';
  document.getElementById('kri_formula').value             = row.kri_formula     || '';
  document.getElementById('kri_valoracion').value          = row.valoracion  != null ? Number(row.valoracion).toFixed(1)  : '';
  document.getElementById('kri_cmmi_flag').value           = row.cmmi_flag       || '';
  updateCmmiHint();

  document.getElementById('btnDeleteKri').style.display = row.kri_id ? '' : 'none';

  // Load and show examples
  const exBox = document.getElementById('modalExamplesBox');
  const exEl  = document.getElementById('modalExamples');
  try {
    const exs = await fetchExamples(row.subcategory_id);
    if (exs.length) {
      exEl.innerHTML = exs.map(e => `<div style="margin-bottom:.4rem"><strong>Ex${e.number}:</strong> ${e.text}</div>`).join('');
      exBox.style.display = '';
    } else {
      exBox.style.display = 'none';
    }
  } catch { exBox.style.display = 'none'; }

  // Load history
  loadHistory(row.subcategory_id);

  document.getElementById('kriModal').classList.remove('hidden');
}

async function loadHistory(subId) {
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
        <span style="color:var(--text-muted)">${formatDateTime(h.saved_at)}</span>
      </div>
    `).join('');
  } catch { box.style.display = 'none'; }
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
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error((await res.json()).error);
    toast('KRI guardado');
    closeModal();
    await loadRows();
  } catch (e) {
    toast(e.message || 'Error al guardar', 'error');
  } finally { btn.disabled = false; }
}

async function deleteKri() {
  if (!confirm('¿Eliminar el KRI de esta subcategoría?')) return;
  try {
    await fetch(`/api/kris/${editingSubId}`, { method: 'DELETE' });
    toast('KRI eliminado');
    closeModal();
    await loadRows();
  } catch {
    toast('Error al eliminar', 'error');
  }
}
