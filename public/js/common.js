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

// ── KRI color helpers ────────────────────────────────────────────────────────
function kriClass(value) {
  if (value === null || value === undefined) return 'no-data';
  if (value <= 2.5)  return 'low';
  if (value <= 5.0)  return 'medium';
  if (value <= 7.5)  return 'high';
  return 'critical';
}

function kriLabel(value) {
  if (value === null || value === undefined) return 'Sin datos';
  if (value <= 2.5)  return 'Bajo';
  if (value <= 5.0)  return 'Medio';
  if (value <= 7.5)  return 'Alto';
  return 'Crítico';
}

function formatValue(v) {
  if (v === null || v === undefined) return '—';
  return Number(v).toFixed(2);
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

  // Mark active nav
  document.querySelectorAll('.topbar-nav a').forEach(a => {
    a.classList.toggle('active', a.dataset.page === activePage);
  });
}
