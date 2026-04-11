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

// ── Init topbar ─────────────────────────────────────────────────────────────
async function initTopbar(activePage) {
  const user = await checkAuth();
  if (!user) return;

  const el = document.getElementById('topbarUser');
  if (el) el.textContent = user.username;

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', logout);

  document.querySelectorAll('.topbar-nav a').forEach(a => {
    a.classList.toggle('active', a.dataset.page === activePage);
  });
}
