/* Shared utilities for KRI Dashboard */

// ── Auth check ───────────────────────────────────────────────────────────────
async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) { window.location.href = '/login.html'; return null; }
    return await res.json();
  } catch {
    window.location.href = '/login.html';
    return null;
  }
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
}

// ── CMMI / KRI helpers (escala 0-100) ───────────────────────────────────────
// N1: 0-20 (rojo), N2: 21-40 (naranja), N3: 41-60 (amarillo),
// N4: 61-80 (verde claro), N5: 81-100 (verde)

function cmmiLevel(value) {
  if (value == null) return null;
  if (value <= 20) return 'N1';
  if (value <= 40) return 'N2';
  if (value <= 60) return 'N3';
  if (value <= 80) return 'N4';
  return 'N5';
}

function cmmiLevelName(value) {
  if (value == null) return 'Sin datos';
  if (value <= 20) return 'N1 — Inicial';
  if (value <= 40) return 'N2 — Gestionado';
  if (value <= 60) return 'N3 — Definido';
  if (value <= 80) return 'N4 — Cuantitativamente Gestionado';
  return 'N5 — En Optimización';
}

// CSS class for coloring elements
function kriClass(value) {
  if (value == null) return 'no-data';
  if (value <= 20) return 'n1';
  if (value <= 40) return 'n2';
  if (value <= 60) return 'n3';
  if (value <= 80) return 'n4';
  return 'n5';
}

function formatValue(v) {
  if (v == null) return '—';
  return Number(v).toFixed(1);
}

// ── Toast notifications ─────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${type === 'success' ? '✓' : '✕'}</span> ${msg}`;
  container.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// ── Export utilities (shared by data.html and heatmap.html) ─────────────────

function exportToday() {
  return new Date().toISOString().slice(0, 10);
}

function rowToExportObj(r) {
  return {
    function_code:             r.function_code,
    function_name:             r.function_name,
    category_code:             r.category_code,
    category_name:             r.category_name,
    subcategory_id:            r.subcategory_id,
    subcategory_code:          r.code,
    subcategory_description:   r.description,
    kri_id:                    r.kri_id          ?? '',
    kri_name:                  r.kri_name        ?? '',
    kri_description:           r.kri_description ?? '',
    kri_formula:               r.kri_formula     ?? '',
    valoracion:                r.valoracion      ?? '',
    cmmi_level:                r.valoracion != null ? cmmiLevel(r.valoracion)     : '',
    cmmi_level_name:           r.valoracion != null ? cmmiLevelName(r.valoracion) : '',
    cmmi_flag:                 r.cmmi_flag       ?? '',
    last_saved_by:             r.last_saved_by   ?? '',
    last_saved_at:             r.last_saved_at   ?? '',
  };
}

function triggerDownload(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

function exportJSON(rows) {
  triggerDownload(
    JSON.stringify(rows.map(rowToExportObj), null, 2),
    `kri-dashboard-${exportToday()}.json`,
    'application/json'
  );
}

function exportCSV(rows) {
  const headers = Object.keys(rowToExportObj(rows[0] || {}));
  const esc = v => {
    const s = String(v ?? '');
    return (s.includes(',') || s.includes('"') || s.includes('\n'))
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    headers.join(','),
    ...rows.map(r => headers.map(h => esc(rowToExportObj(r)[h])).join(','))
  ];
  triggerDownload(
    '\uFEFF' + lines.join('\r\n'),
    `kri-dashboard-${exportToday()}.csv`,
    'text/csv;charset=utf-8'
  );
}

function exportXML(rows) {
  const esc = s => String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const tree = {};
  rows.forEach(r => {
    const fk = r.function_code, ck = r.category_code, sk = r.subcategory_id;
    if (!tree[fk]) tree[fk] = { name: r.function_name, cats: {} };
    const fn = tree[fk];
    if (!fn.cats[ck]) fn.cats[ck] = { name: r.category_name, subs: {} };
    const cat = fn.cats[ck];
    if (!cat.subs[sk]) cat.subs[sk] = { code: r.code, desc: r.description, kris: [] };
    if (r.kri_id != null) cat.subs[sk].kris.push(r);
  });

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml    += `<dashboard exportDate="${new Date().toISOString()}" totalRows="${rows.length}">\n`;
  for (const [fc, fn] of Object.entries(tree)) {
    xml += `  <function code="${esc(fc)}" name="${esc(fn.name)}">\n`;
    for (const [cc, cat] of Object.entries(fn.cats)) {
      xml += `    <category code="${esc(cc)}" name="${esc(cat.name)}">\n`;
      for (const [, sub] of Object.entries(cat.subs)) {
        xml += `      <subcategory code="${esc(sub.code)}">\n`;
        xml += `        <description>${esc(sub.desc)}</description>\n`;
        xml += `        <kris count="${sub.kris.length}">\n`;
        sub.kris.forEach(k => {
          xml += `          <kri id="${esc(k.kri_id)}" valoracion="${esc(k.valoracion)}"`;
          xml += ` cmmiLevel="${esc(cmmiLevel(k.valoracion))}" cmmiFlag="${esc(k.cmmi_flag)}">\n`;
          xml += `            <name>${esc(k.kri_name)}</name>\n`;
          xml += `            <description>${esc(k.kri_description)}</description>\n`;
          xml += `            <formula>${esc(k.kri_formula)}</formula>\n`;
          xml += `            <lastSavedBy>${esc(k.last_saved_by)}</lastSavedBy>\n`;
          xml += `            <lastSavedAt>${esc(k.last_saved_at)}</lastSavedAt>\n`;
          xml += `          </kri>\n`;
        });
        xml += `        </kris>\n`;
        xml += `      </subcategory>\n`;
      }
      xml += `    </category>\n`;
    }
    xml += `  </function>\n`;
  }
  xml += `</dashboard>`;
  triggerDownload(xml, `kri-dashboard-${exportToday()}.xml`, 'application/xml');
}

async function exportExcelFile(params, btnId) {
  const btn = btnId ? document.getElementById(btnId) : null;
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(`/api/export/excel?${params}`);
    if (!res.ok) throw new Error('Error al generar Excel');
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), {
      href: url, download: `kri-dashboard-${exportToday()}.xlsx`
    });
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Init topbar ─────────────────────────────────────────────────────────────
async function initTopbar(activePage) {
  const user = await checkAuth();
  if (!user) return;

  window._userRole    = user.role;
  window._scratchMode = user.scratch_mode === 1;

  const el = document.getElementById('topbarUser');
  if (el) el.textContent = user.username.includes('@') ? user.username.split('@')[0] : user.username;

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', logout);

  document.querySelectorAll('.topbar-nav a').forEach(a => {
    a.classList.toggle('active', a.dataset.page === activePage);
  });

  const adminLink = document.getElementById('adminLink');
  if (adminLink && user.role === 'ADMIN') adminLink.style.display = '';
}
