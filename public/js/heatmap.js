/* heatmap.js — CISOToolkit Stunning Heatmap v4.0
   D3 treemap · SVG glow filters · drilldown · KRI panel · edit modal
   ─────────────────────────────────────────────────────────────────── */
'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────
const TRANSITION_MS  = 220;
const STAGGER_MS     = 14;
const STAGGER_MAX_MS = 320;
const PANEL_WIDTH    = 348;

const COLOR_STOPS = [
  { v:   0, r: 239, g:  68, b:  68 },  // #ef4444 N1
  { v:  20, r: 249, g: 115, b:  22 },  // #f97316
  { v:  40, r: 251, g: 191, b:  36 },  // #fbbf24 N3
  { v:  60, r: 163, g: 230, b:  53 },  // #a3e635 N4
  { v:  80, r:  22, g: 163, b:  74 },  // #16a34a N5
  { v: 100, r:  22, g: 163, b:  74 },
];

// Glow filter definitions (N1 gets double-layer for danger emphasis)
const GLOW_DEFS = [
  { id:'glow-n1', color:'#ef4444', std:5,  opacity:0.7,  extra: { color:'#ff6666', std:2, opacity:0.45 } },
  { id:'glow-n2', color:'#f97316', std:3.5,opacity:0.6  },
  { id:'glow-n3', color:'#fbbf24', std:3,  opacity:0.55 },
  { id:'glow-n4', color:'#a3e635', std:3,  opacity:0.55 },
  { id:'glow-n5', color:'#16a34a', std:3.5,opacity:0.6  },
];

// ── State ─────────────────────────────────────────────────────────────────────
const STATE = {
  root:        null,   // full d3.hierarchy root (never replaced)
  focus:       null,   // currently displayed node
  subById:     {},     // id → subcategory lookup (enriched with fn/cat info)
  rawData:     [],     // original API array
  resizeTimer: null,
  editSubId:   null,
  editKriId:   null,
};

// ── Boot ──────────────────────────────────────────────────────────────────────
(async () => {
  await initTopbar('heatmap');
  bindUI();
  if (window._heatmapName) showHeatmapName(window._heatmapName);
  if (window._scratchMode) {
    hideScenarioSelector();
    await loadData();
  } else {
    await loadData();
    const hasKris = STATE.rawData.some(fn =>
      fn.categories.some(cat => cat.subcategories.some(s => s.valoracion != null))
    );
    if (!hasKris) await applyScenario('empty');
  }
})();

// ── Data ──────────────────────────────────────────────────────────────────────
async function loadData() {
  try {
    const res    = await fetch('/api/heatmap');
    const api    = await res.json();
    STATE.rawData = api;

    // Build lookups
    STATE.subById = {};
    api.forEach(fn => fn.categories.forEach(cat => {
      cat.subcategories.forEach(s => {
        STATE.subById[s.id] = {
          ...s,
          subId: s.id,
          fnCode: fn.code, fnName: fn.name,
          catCode: cat.code, catName: cat.name,
        };
      });
    }));

    // Build D3 hierarchy
    STATE.root  = buildHierarchy(api);
    STATE.focus = STATE.root;

    updateHUD();
    render(true);
    updateBreadcrumb();
  } catch (e) {
    console.error('loadData failed:', e);
    toast('Error al cargar datos del heatmap', 'error');
  }
}

function buildHierarchy(api) {
  return d3.hierarchy({
    name: 'NIST CSF 2.0', code: 'ROOT', type: 'root',
    children: api.map(fn => ({
      name: fn.name, code: fn.code, type: 'function',
      valoracion: fn.avgValoracion,
      children: fn.categories.map(cat => ({
        name: cat.name, code: cat.code, type: 'category',
        valoracion: cat.avgValoracion,
        fnCode: fn.code, fnName: fn.name,
        children: cat.subcategories.map(s => ({
          name: s.code, code: s.code, type: 'subcategory',
          description: s.description, valoracion: s.valoracion,
          kri_name: s.kri_name, subId: s.id,
          fnCode: fn.code, fnName: fn.name,
          catCode: cat.code, catName: cat.name,
          value: 1,
        }))
      }))
    }))
  }).sum(d => d.value || 0).sort((a, b) => b.value - a.value);
}

// ── HUD ───────────────────────────────────────────────────────────────────────
function updateHUD() {
  let total = 0, withKri = 0, n1 = 0;
  const vals = [];

  STATE.rawData.forEach(fn => fn.categories.forEach(cat => {
    cat.subcategories.forEach(s => {
      total++;
      if (s.valoracion != null) {
        withKri++;
        vals.push(s.valoracion);
        if (s.valoracion <= 20) n1++;
      }
    });
  }));

  animateCounter('stat-total',   total);
  animateCounter('stat-withkri', withKri);
  animateCounter('stat-n1',      n1);

}

function animateCounter(elId, target, duration = 900, decimals = 0) {
  const el = document.getElementById(elId);
  if (!el) return;
  const from  = parseFloat(el.textContent) || 0;
  const start = performance.now();
  function step(now) {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    const val   = from + (target - from) * eased;
    el.textContent = decimals ? val.toFixed(decimals) : Math.round(val);
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ── Render ────────────────────────────────────────────────────────────────────
function render(animateIn = false) {
  const el = document.getElementById('chart');
  if (!el || !STATE.root) return;

  const W = el.clientWidth;
  const H = el.clientHeight || (window.innerHeight - 160);

  // Build subtree from focus node
  const subtreeH = d3.hierarchy(STATE.focus.data)
    .sum(d => d.value || 0)
    .sort((a, b) => b.value - a.value);

  const isRoot = STATE.focus === STATE.root;

  d3.treemap()
    .size([W, H])
    .paddingOuter(isRoot ? 7 : 4)
    .paddingTop(d => {
      if (d.depth === 1) return isRoot ? 30 : 26;
      return 2;
    })
    .paddingInner(2)
    .tile(d3.treemapResquarify)
    (subtreeH);

  // Remove old SVG
  d3.select('#chart').selectAll('svg').remove();

  const svg = d3.select('#chart').append('svg')
    .attr('width', W)
    .attr('height', H)
    .style('display', 'block')
    .style('background', 'transparent');

  // ── Glow filters ──
  const defs = svg.append('defs');
  appendGlowFilters(defs);

  // Clip paths for leaves
  const leaves = subtreeH.leaves();
  leaves.forEach((d, i) => {
    defs.append('clipPath').attr('id', `hm-nc-${i}`)
      .append('rect')
        .attr('width',  Math.max(0, d.x1 - d.x0))
        .attr('height', Math.max(0, d.y1 - d.y0));
  });

  // ── Parent group backgrounds ──
  const parents = subtreeH.descendants().filter(d => d.depth === 1 && d.children);
  renderParentBands(svg, parents, isRoot);

  // ── Leaf nodes ──
  renderLeaves(svg, leaves, animateIn);

  const hint = document.getElementById('hint');
  if (hint) hint.textContent = '';
}

// ── SVG Glow Filters ──────────────────────────────────────────────────────────
function appendGlowFilters(defs) {
  GLOW_DEFS.forEach(g => {
    const f = defs.append('filter')
      .attr('id', g.id)
      .attr('x', '-30%').attr('y', '-30%')
      .attr('width', '160%').attr('height', '160%');

    f.append('feGaussianBlur').attr('in','SourceAlpha').attr('stdDeviation', g.std).attr('result','blur1');
    f.append('feFlood').attr('flood-color', g.color).attr('flood-opacity', g.opacity).attr('result','color1');
    f.append('feComposite').attr('in','color1').attr('in2','blur1').attr('operator','in').attr('result','glow1');

    const merge = f.append('feMerge');

    if (g.extra) {
      // N1 double-layer
      f.append('feGaussianBlur').attr('in','SourceAlpha').attr('stdDeviation', g.extra.std).attr('result','blur2');
      f.append('feFlood').attr('flood-color', g.extra.color).attr('flood-opacity', g.extra.opacity).attr('result','color2');
      f.append('feComposite').attr('in','color2').attr('in2','blur2').attr('operator','in').attr('result','glow2');
      merge.append('feMergeNode').attr('in','glow1');
      merge.append('feMergeNode').attr('in','glow2');
    } else {
      merge.append('feMergeNode').attr('in','glow1');
    }
    merge.append('feMergeNode').attr('in','SourceGraphic');
  });
}

// ── Parent bands (function/category header rows) ───────────────────────────────
function renderParentBands(svg, parents, isRoot) {
  // Subtle tinted background rect
  svg.selectAll('.band-bg')
    .data(parents).join('rect').attr('class','band-bg')
    .attr('x', d => d.x0).attr('y', d => d.y0)
    .attr('width',  d => d.x1 - d.x0)
    .attr('height', d => d.y1 - d.y0)
    .attr('fill', 'none')
    .attr('stroke', d => {
      const c = cmmiColor(d.data.valoracion);
      return c === '#21262d' ? '#1e2d3d' : hexToRgba(cmmiColorRaw(d.data.valoracion), 0.3);
    })
    .attr('stroke-width', 1)
    .attr('rx', 5);

  // Left accent bar (3px)
  svg.selectAll('.band-accent')
    .data(parents).join('rect').attr('class','band-accent')
    .attr('x', d => d.x0)
    .attr('y', d => d.y0)
    .attr('width', 3)
    .attr('height', isRoot ? 28 : 24)
    .attr('fill', d => cmmiColor(d.data.valoracion))
    .attr('rx', 2);

  // Header label
  svg.selectAll('.band-lbl')
    .data(parents).join('text').attr('class','band-lbl')
    .attr('x', d => d.x0 + 9)
    .attr('y', d => d.y0 + (isRoot ? 19 : 16))
    .attr('font-size', isRoot ? 13 : 11)
    .attr('font-weight', 700)
    .attr('font-family', "'JetBrains Mono', monospace")
    .attr('fill', d => isRoot ? '#ccdcee' : '#6a869e')
    .attr('letter-spacing', isRoot ? '.05em' : '.02em')
    .attr('pointer-events', 'none')
    .each(function(d) {
      const t = d3.select(this);
      const maxW = d.x1 - d.x0 - 16;
      const label = isRoot
        ? `${d.data.code}  ·  ${d.data.name}`
        : `${d.data.code}  ·  ${d.data.name}`;
      t.text(label);
      // Truncate if needed
      const node = this;
      while (node.getComputedTextLength && node.getComputedTextLength() > maxW && t.text().length > 2) {
        t.text(t.text().slice(0, -2) + '…');
      }
    });

  // Clickable overlay on header band
  svg.selectAll('.band-click')
    .data(parents).join('rect').attr('class','band-click')
    .attr('x', d => d.x0).attr('y', d => d.y0)
    .attr('width',  d => d.x1 - d.x0)
    .attr('height', isRoot ? 28 : 24)
    .attr('fill', 'transparent')
    .attr('cursor', 'zoom-in')
    .on('click', (event, d) => drillDown(d.data.code, d.data.type));
}

// ── Leaf nodes ────────────────────────────────────────────────────────────────
function renderLeaves(svg, leaves, animateIn) {
  const useGlow = STATE.focus !== STATE.root;

  const nodeG = svg.selectAll('.hm-node')
    .data(leaves).join('g')
    .attr('class', d => {
      const isN1 = d.data.valoracion != null && d.data.valoracion <= 20;
      return `hm-node${isN1 ? ' node--n1' : ''}`;
    })
    .attr('transform', d => `translate(${d.x0},${d.y0})`)
    .attr('clip-path', (d, i) => `url(#hm-nc-${i})`);

  // Cell fill rect
  nodeG.append('rect')
    .attr('class', 'cell-fill')
    .attr('width',  d => Math.max(0, d.x1 - d.x0))
    .attr('height', d => Math.max(0, d.y1 - d.y0))
    .attr('fill',   d => cmmiColor(d.data.valoracion))
    .attr('rx', 3)
    .attr('filter', d => useGlow ? cmmiGlowFilter(d.data.valoracion) : null);

  // Cell content (text labels)
  nodeG.each(function(d) {
    const g   = d3.select(this);
    const nw  = d.x1 - d.x0;
    const nh  = d.y1 - d.y0;
    if (nw < 12 || nh < 12) return;

    const pad  = 5;
    const maxW = nw - pad * 2;
    let curY   = pad;

    const dark    = d.data.valoracion != null && d.data.valoracion > 35 && d.data.valoracion <= 80;
    const noData  = d.data.valoracion == null;
    const txtCol  = dark ? 'rgba(0,0,0,.80)' : noData ? 'rgba(255,255,255,.40)' : 'rgba(255,255,255,.88)';
    const monoCol = dark ? 'rgba(0,0,0,.88)' : noData ? 'rgba(255,255,255,.35)' : '#fff';

    // Category name (only if enough space)
    const catFs  = Math.min(12, Math.max(7, nw / 8));
    const showCat = nh > 34 && catFs >= 7 && d.data.catName;

    if (showCat) {
      const t = g.append('text')
        .attr('font-size', catFs)
        .attr('font-weight', 500)
        .attr('font-family', "'Inter', system-ui, sans-serif")
        .attr('fill', txtCol);

      const words = (d.data.catName || '').split(/\s+/);
      let line = [], lineCount = 1;
      let tspan = t.append('tspan').attr('x', pad).attr('y', curY + catFs);

      for (const word of words) {
        const candidate = [...line, word].join(' ');
        tspan.text(candidate);
        const len = tspan.node()?.getComputedTextLength?.() ?? 9999;
        if (line.length > 0 && len > maxW) {
          tspan.text(line.join(' '));
          line = [word];
          lineCount++;
          if (lineCount > 2) break;
          tspan = t.append('tspan').attr('x', pad).attr('dy', catFs * 1.2).text(word);
        } else {
          line = [...line, word];
        }
      }
      curY += catFs + (lineCount - 1) * catFs * 1.2 + catFs * 1.1;
    }

    // Subcategory code — monospace bold
    const codeFs = Math.min(13, Math.max(7, nw / 4));
    if (codeFs >= 7) {
      const t = g.append('text')
        .attr('x', pad).attr('y', curY + codeFs)
        .attr('font-size', codeFs)
        .attr('font-weight', 700)
        .attr('font-family', "'JetBrains Mono', monospace")
        .attr('fill', monoCol)
        .text(d.data.code);

      const node = t.node();
      while (node?.getComputedTextLength?.() > maxW && t.text().length > 2) {
        t.text(t.text().slice(0, -2) + '…');
      }
      curY += codeFs + 4;
    }

    // Score badge (bottom-right corner if enough room)
    if (d.data.valoracion != null && nw > 38 && nh > 30) {
      const scoreFs = Math.min(11, Math.max(8, nw / 6));
      const scoreStr = Number(d.data.valoracion).toFixed(0);
      const badgeW   = scoreStr.length * scoreFs * 0.65 + 8;
      const badgeH   = scoreFs + 6;
      const bx = nw - badgeW - 3;
      const by = nh - badgeH - 3;

      if (bx > pad && by > curY - 4) {
        g.append('rect')
          .attr('x', bx).attr('y', by)
          .attr('width', badgeW).attr('height', badgeH)
          .attr('fill', 'rgba(0,0,0,.30)')
          .attr('rx', 3);
        g.append('text')
          .attr('x', bx + badgeW / 2).attr('y', by + badgeH / 2 + scoreFs * 0.35)
          .attr('text-anchor', 'middle')
          .attr('font-size', scoreFs)
          .attr('font-weight', 700)
          .attr('font-family', "'JetBrains Mono', monospace")
          .attr('fill', '#fff')
          .attr('pointer-events', 'none')
          .text(scoreStr);
      }
    }
  });

  // ── Interactions ──
  const tip = document.getElementById('hm-tooltip');

  nodeG
    .attr('cursor', d => d.data.type === 'subcategory' ? 'pointer' : 'zoom-in')
    .on('click', (event, d) => {
      if (tip) tip.style.display = 'none';
      if (d.data.type === 'subcategory') {
        openKriPanel(d.data);
      } else {
        drillDown(d.data.code, d.data.type);
      }
    })
    .on('mouseover', (event, d) => {
      if (!tip) return;
      const v = d.data.valoracion;
      const isSubcat = d.data.type === 'subcategory';
      const col      = cmmiColor(v);
      const bright   = v != null && v > 35 && v <= 80;
      tip.innerHTML = `
        <div style="font-size:.64rem;color:#4d7090;margin-bottom:.28rem;font-weight:500;letter-spacing:.05em;text-transform:uppercase;font-family:'JetBrains Mono',monospace">
          ${d.data.fnName || ''}${d.data.catName ? ` <span style="color:#2a3f56">›</span> ${d.data.catName}` : ''}
        </div>
        <div style="font-family:'JetBrains Mono',monospace;font-weight:700;font-size:.88rem;color:#e2eaf4;margin-bottom:.2rem;letter-spacing:.04em">${d.data.code}</div>
        ${d.data.description ? `<div style="color:#7a90a8;font-size:.7rem;margin-bottom:.32rem;line-height:1.45">${d.data.description.substring(0,110)}</div>` : ''}
        <div style="display:flex;align-items:center;gap:.45rem;margin-bottom:.16rem">
          <span style="background:${col};color:${bright?'#000':'#fff'};font-weight:700;font-size:.76rem;padding:.1rem .45rem;border-radius:20px;font-family:'JetBrains Mono',monospace">${v!=null?Number(v).toFixed(1):'—'}</span>
          <span style="color:#8ba8c0;font-size:.7rem;font-weight:500">${cmmiLabel(v)}</span>
        </div>
        <div style="color:#2e4a68;font-size:.63rem;margin-top:.2rem;font-style:italic">${isSubcat?'Click → ver KRIs':'Click → drilldown'}</div>`;
      tip.style.display = 'block';
    })
    .on('mousemove', event => {
      if (!tip) return;
      tip.style.left = `${Math.min(event.clientX + 16, window.innerWidth  - 300)}px`;
      tip.style.top  = `${Math.min(event.clientY + 16, window.innerHeight - 130)}px`;
    })
    .on('mouseout', () => { if (tip) tip.style.display = 'none'; });

  // ── Stagger fade-in ──
  if (animateIn) {
    nodeG.style('opacity', 0)
      .transition()
      .delay((d, i) => Math.min(i * STAGGER_MS, STAGGER_MAX_MS))
      .duration(TRANSITION_MS + 60)
      .ease(d3.easeCubicOut)
      .style('opacity', 1);
  }
}

// ── Drilldown ─────────────────────────────────────────────────────────────────
function drillDown(code, type) {
  closeKriPanel();
  const oldSvg = d3.select('#chart svg');

  // Find node in full hierarchy
  let found = null;
  STATE.root.each(n => {
    if (n.data.code === code && n.data.type === type) found = n;
  });
  if (!found) return;

  oldSvg.transition().duration(TRANSITION_MS).style('opacity', 0)
    .on('end', () => {
      STATE.focus = found;
      render(true);
      updateBreadcrumb();
    });
}

function drillToNode(node) {
  closeKriPanel();
  const oldSvg = d3.select('#chart svg');
  oldSvg.transition().duration(TRANSITION_MS).style('opacity', 0)
    .on('end', () => {
      STATE.focus = node;
      render(true);
      updateBreadcrumb();
    });
}

// ── Breadcrumb ────────────────────────────────────────────────────────────────
function updateBreadcrumb(subData) {
  const bc = document.getElementById('breadcrumb');
  if (!bc) return;

  let items;
  if (subData) {
    items = [
      { label: 'NIST CSF 2.0', node: STATE.root },
      { label: subData.fnName.toUpperCase(),  code: subData.fnCode,  type: 'function'  },
      { label: subData.catName.toUpperCase(), code: subData.catCode, type: 'category'  },
      { label: (subData.description || subData.code).substring(0, 48).toUpperCase(), isCurrent: true },
    ];
  } else {
    const path = STATE.focus.ancestors().reverse()
      .filter(n => n.data.code !== 'ROOT');  // ocultar nodo raíz
    items = path.map((node, i) => ({
      label: (node.data.code + (node.data.name ? '  ' + node.data.name.toUpperCase() : '')).substring(0, 38),
      node,
      isCurrent: i === path.length - 1,
    }));
  }

  bc.innerHTML = items.map((item, i) =>
    `${i > 0 ? '<span class="bc-sep"> › </span>' : ''}
     <span class="bc-item ${item.isCurrent ? 'current' : ''}"
           data-code="${item.code || ''}"
           data-type="${item.type || ''}"
           data-node="${item.isCurrent ? '' : i}">${item.label}</span>`
  ).join('');

  // Bind clicks on non-current items
  bc.querySelectorAll('.bc-item:not(.current)').forEach((el, idx) => {
    el.addEventListener('click', () => {
      const code = el.dataset.code, type = el.dataset.type;
      if (code && type) {
        drillDown(code, type);
      } else {
        // Navigate by path index
        const nodeIdx = parseInt(el.dataset.node);
        const path = STATE.focus.ancestors().reverse();
        const target = !isNaN(nodeIdx) ? (path[nodeIdx] || STATE.root) : STATE.root;
        drillToNode(target);
      }
    });
  });
}

// ── KRI Panel ─────────────────────────────────────────────────────────────────
async function openKriPanel(sub) {
  updateBreadcrumb(sub);

  // Badge color
  const badgeEl = document.getElementById('kp-badge');
  if (badgeEl) {
    const col    = cmmiColor(sub.valoracion);
    const bright = sub.valoracion != null && sub.valoracion > 35 && sub.valoracion <= 80;
    badgeEl.textContent = sub.valoracion != null ? cmmiLabel(sub.valoracion).split(' ')[0] : 'ND';
    badgeEl.style.background  = sub.valoracion != null ? col : '#2e4055';
    badgeEl.style.color       = bright ? '#000' : '#fff';
    badgeEl.style.boxShadow   = sub.valoracion != null ? `0 0 10px ${col}60` : 'none';
  }

  const titleEl = document.getElementById('kp-title');
  const descEl  = document.getElementById('kp-desc');
  const listEl  = document.getElementById('kp-list');

  if (titleEl) titleEl.textContent = `${sub.fnName}  ·  ${sub.catName}`;
  if (descEl)  descEl.textContent  = `${sub.code} — ${sub.description || ''}`;
  if (listEl)  listEl.innerHTML    = '<div class="kp-empty">Cargando KRIs…</div>';

  // Open panel
  const wrap = document.getElementById('kri-panel-wrap');
  if (wrap) {
    wrap.classList.add('open');
    // Re-render chart after transition ends
    clearTimeout(STATE.resizeTimer);
    STATE.resizeTimer = setTimeout(() => render(false), 340);
  }

  try {
    const rows = await (await fetch(`/api/kris?subcategoryId=${sub.subId}`)).json();
    const kris = rows.filter(r => r.kri_id);

    if (!listEl) return;

    if (!kris.length) {
      listEl.innerHTML = `
        <div class="kp-empty">Sin KRIs asignados.</div>
        <button class="kp-add-btn" onclick="addKriForSub(${sub.subId})">＋ Agregar KRI</button>`;
      return;
    }

    listEl.innerHTML = kris.map(k => {
      const v      = k.valoracion != null ? Number(k.valoracion).toFixed(1) : null;
      const col    = cmmiColor(k.valoracion);
      const bright = k.valoracion != null && k.valoracion > 35 && k.valoracion <= 80;
      const txtCol = bright ? '#000' : '#fff';
      const border = k.valoracion != null ? col : '#2e4055';
      const barPct = k.valoracion != null ? k.valoracion : 0;
      return `
        <div class="kp-card" style="border-left-color:${border}">
          <button class="kp-edit-btn" onclick="openEditModal(${sub.subId},${k.kri_id})" title="Editar">✎</button>
          <div class="kp-card-name">${k.kri_name}</div>
          ${k.kri_description ? `<div class="kp-card-desc">${k.kri_description}</div>` : ''}
          ${k.kri_formula     ? `<div class="kp-card-formula">${k.kri_formula}</div>`     : ''}
          <div class="kp-card-footer">
            ${v != null ? `<span class="kp-score-badge" style="background:${col};color:${txtCol};box-shadow:0 0 7px ${col}60">${v}</span>` : ''}
            <span class="kp-cmmi-label">${cmmiLabel(k.valoracion)}</span>
            ${k.last_saved_by ? `<span class="kp-saved-by">${k.last_saved_by}</span>` : ''}
          </div>
          ${v != null ? `
          <div class="kp-score-bar">
            <div class="kp-score-bar-fill" style="width:${barPct}%;background:${col}"></div>
          </div>` : ''}
        </div>`;
    }).join('') + `<button class="kp-add-btn" onclick="addKriForSub(${sub.subId})">＋ Agregar KRI</button>`;

  } catch {
    if (listEl) listEl.innerHTML = '<div class="kp-empty" style="color:#f85149">Error al cargar.</div>';
  }
}

function closeKriPanel() {
  const wrap = document.getElementById('kri-panel-wrap');
  if (!wrap || !wrap.classList.contains('open')) return;
  wrap.classList.remove('open');
  clearTimeout(STATE.resizeTimer);
  STATE.resizeTimer = setTimeout(() => render(false), 340);
  updateBreadcrumb();
}

// ── KRI Edit Modal ────────────────────────────────────────────────────────────
function addKriForSub(subcategoryId) {
  const sub = STATE.subById[subcategoryId];
  if (!sub) return;
  openEditModal(subcategoryId, null, sub);
}

async function openEditModal(subcategoryId, kriId, subOverride) {
  STATE.editSubId = subcategoryId;
  STATE.editKriId = kriId || null;

  const sub = subOverride || STATE.subById[subcategoryId];
  if (!sub) return;

  // Fill context
  const ctxFn  = document.getElementById('hm-ctx-fn');
  const ctxCat = document.getElementById('hm-ctx-cat');
  const ctxSub = document.getElementById('hm-ctx-sub');
  if (ctxFn)  ctxFn.textContent  = `${sub.fnCode} · ${sub.fnName}`;
  if (ctxCat) ctxCat.textContent = `${sub.catCode} · ${sub.catName}`;
  if (ctxSub) ctxSub.textContent = `${sub.code} — ${sub.description || ''}`;

  const titleEl = document.getElementById('hm-modal-title');
  if (titleEl) titleEl.textContent = kriId ? 'Editar KRI' : 'Nuevo KRI';

  // Pre-fill fields
  document.getElementById('hm-kri-name').value    = '';
  document.getElementById('hm-kri-desc').value    = '';
  document.getElementById('hm-kri-formula').value = '';
  document.getElementById('hm-kri-val').value     = '';
  document.getElementById('hm-kri-flag').value    = '';
  updateCmmiHint();

  document.getElementById('hm-btn-del').style.display = kriId ? '' : 'none';
  document.getElementById('hm-history-box').style.display = 'none';

  if (kriId) {
    try {
      const res  = await fetch(`/api/kris?subcategoryId=${subcategoryId}`);
      const rows = await res.json();
      const kri  = rows.find(r => r.kri_id === kriId);
      if (kri) {
        document.getElementById('hm-kri-name').value    = kri.kri_name        || '';
        document.getElementById('hm-kri-desc').value    = kri.kri_description || '';
        document.getElementById('hm-kri-formula').value = kri.kri_formula     || '';
        document.getElementById('hm-kri-val').value     = kri.valoracion != null ? Number(kri.valoracion).toFixed(1) : '';
        document.getElementById('hm-kri-flag').value    = kri.cmmi_flag       || '';
        updateCmmiHint();
        loadKriHistory(kriId);
      }
    } catch { /* ignore */ }
  }

  document.getElementById('hm-kri-modal').classList.remove('hidden');
}

function closeEditModal() {
  STATE.editSubId = null;
  STATE.editKriId = null;
  document.getElementById('hm-kri-modal').classList.add('hidden');
}

function updateCmmiHint() {
  const val   = parseFloat(document.getElementById('hm-kri-val').value);
  const hint  = document.getElementById('hm-cmmi-hint');
  if (!hint) return;
  if (isNaN(val)) { hint.textContent = ''; return; }
  const clamped = Math.max(0, Math.min(100, val));
  hint.textContent  = cmmiLabel(clamped);
  hint.style.color  = `var(--color-${kriClass(clamped)})`;
}

async function saveKri() {
  const name = document.getElementById('hm-kri-name').value.trim();
  const val  = parseFloat(document.getElementById('hm-kri-val').value);
  if (!name) { toast('El nombre del KRI es obligatorio', 'error'); return; }
  if (isNaN(val) || val < 0 || val > 100) { toast('Valoración debe estar entre 0 y 100', 'error'); return; }

  const subId = STATE.editSubId;
  const body = {
    kri_id:          STATE.editKriId || undefined,
    kri_name:        name,
    kri_description: document.getElementById('hm-kri-desc').value.trim(),
    kri_formula:     document.getElementById('hm-kri-formula').value.trim(),
    cmmi_flag:       document.getElementById('hm-kri-flag').value || null,
    valoracion:      val,
  };

  const btn = document.getElementById('hm-btn-save');
  btn.disabled = true;
  try {
    const res = await fetch(`/api/kris/${subId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      let msg = `Error ${res.status}`;
      try { msg = JSON.parse(text).error || msg; } catch {}
      throw new Error(msg);
    }
    toast('KRI guardado');
    closeEditModal();
    await loadData();
    const sub = STATE.subById[subId];
    if (sub) await openKriPanel(sub);
  } catch (e) {
    toast(e.message || 'Error al guardar', 'error');
  } finally { btn.disabled = false; }
}

async function deleteKri() {
  if (!confirm('¿Eliminar este KRI?')) return;
  const subId = STATE.editSubId;
  try {
    const res = await fetch(`/api/kris/${STATE.editKriId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json()).error);
    toast('KRI eliminado');
    closeEditModal();
    await loadData();
    const sub = STATE.subById[subId];
    if (sub) await openKriPanel(sub);
  } catch {
    toast('Error al eliminar', 'error');
  }
}

async function loadKriHistory(kriId) {
  const box  = document.getElementById('hm-history-box');
  const list = document.getElementById('hm-history-list');
  if (!box || !list) return;
  try {
    const res  = await fetch(`/api/kris/${kriId}/history`);
    const rows = await res.json();
    if (!rows.length) { box.style.display = 'none'; return; }
    box.style.display = '';
    list.innerHTML = rows.map(h => `
      <div class="hm-history-row">
        <span style="color:var(--color-${kriClass(h.valoracion)});font-weight:700;font-family:'JetBrains Mono',monospace">
          ${Number(h.valoracion).toFixed(1)}
          <span style="font-size:.68rem;font-weight:400;color:var(--text-muted)"> ${cmmiLevel(h.valoracion)}</span>
        </span>
        <span style="color:var(--text-muted);font-size:.72rem">${h.saved_by}</span>
        <span style="color:var(--text-muted);font-size:.7rem">${formatDT(h.saved_at)}</span>
      </div>`).join('');
  } catch { box.style.display = 'none'; }
}

function formatDT(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr.replace(' ', 'T') + 'Z');
  return d.toLocaleString('es-ES', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

// ── Export ────────────────────────────────────────────────────────────────────
async function exportHeatmap() {
  const format = document.getElementById('exportFormat').value;
  let rows;
  try {
    const res = await fetch('/api/kris');
    rows = await res.json();
  } catch {
    toast('Error al obtener datos', 'error');
    return;
  }
  if      (format === 'json') exportJSON(rows);
  else if (format === 'csv')  exportCSV(rows);
  else if (format === 'xml')  exportXML(rows);
  else if (format === 'xlsx') await exportExcelFile(new URLSearchParams(), 'btnExport');
}

// ── UI bindings ───────────────────────────────────────────────────────────────
function hideScenarioSelector() {
  const wrap = document.querySelector('.hud-scenario');
  if (wrap) wrap.style.display = 'none';
}

function showHeatmapName(name) {
  const el  = document.getElementById('hm-heatmap-name');
  const div = document.getElementById('hm-heatmap-name-divider');
  if (!el) return;
  el.textContent = name;
  el.style.display = '';
  if (div) div.style.display = '';
}

function showNameModal() {
  return new Promise(resolve => {
    const modal   = document.getElementById('hm-name-modal');
    const input   = document.getElementById('hm-name-input');
    const btnOk   = document.getElementById('hm-name-confirm');
    const btnCancel = document.getElementById('hm-name-cancel');
    if (!modal) { resolve(null); return; }
    input.value = '';
    modal.classList.remove('hidden');
    input.focus();

    function cleanup(result) {
      modal.classList.add('hidden');
      btnOk.removeEventListener('click', onConfirm);
      btnCancel.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKey);
      resolve(result);
    }
    function onConfirm() {
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      cleanup(name);
    }
    function onCancel() { cleanup(null); }
    function onKey(e) {
      if (e.key === 'Enter') onConfirm();
      if (e.key === 'Escape') onCancel();
    }
    btnOk.addEventListener('click', onConfirm);
    btnCancel.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKey);
  });
}

async function applyScenario(autoScenario) {
  const select = document.getElementById('scenarioSelect');
  const scenario = typeof autoScenario === 'string' ? autoScenario : select?.value;
  if (!scenario) return;

  if (scenario === 'scratch') {
    const name = await showNameModal();
    if (name === null) return;
    const btn = document.getElementById('applyScenarioBtn');
    if (btn) btn.disabled = true;
    try {
      const res = await fetch('/api/scenarios/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario: 'scratch', heatmap_name: name }),
      });
      const data = await res.json();
      if (!res.ok) { toast(data.error || 'Error', 'error'); return; }
      showHeatmapName(name);
      hideScenarioSelector();
      await loadData();
    } catch { toast('Error de conexión', 'error'); }
    finally { const btn = document.getElementById('applyScenarioBtn'); if (btn) btn.disabled = false; }
    return;
  }

  const labels = { empty: 'Simulación random', positive: 'Simulación positiva', neutral: 'Simulación neutral', negative: 'Simulación negativa' };
  const btn = document.getElementById('applyScenarioBtn');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch('/api/scenarios/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario })
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Error al aplicar escenario', 'error'); return; }
    if (!autoScenario) toast(`Escenario "${labels[scenario]}" aplicado (${data.created ?? 0} KRIs)`);
    if (select && !autoScenario) select.value = '';
    await loadData();
  } catch (e) {
    toast('Error de conexión', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function bindUI() {
  // KRI panel close
  document.getElementById('kp-close')?.addEventListener('click', closeKriPanel);

  // Scenario selector
  document.getElementById('applyScenarioBtn')?.addEventListener('click', applyScenario);

  // Export button
  document.getElementById('btnExport')?.addEventListener('click', exportHeatmap);

  // Edit modal
  document.getElementById('hm-modal-close')?.addEventListener('click', closeEditModal);
  document.getElementById('hm-btn-cancel')?.addEventListener('click', closeEditModal);
  document.getElementById('hm-btn-save')?.addEventListener('click', saveKri);
  document.getElementById('hm-btn-del')?.addEventListener('click', deleteKri);
  document.getElementById('hm-kri-modal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeEditModal();
  });
  document.getElementById('hm-kri-val')?.addEventListener('input', updateCmmiHint);

  // Keyboard: Escape → close panel or go up
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!document.getElementById('hm-kri-modal')?.classList.contains('hidden')) {
        closeEditModal();
      } else if (document.getElementById('kri-panel-wrap')?.classList.contains('open')) {
        closeKriPanel();
      } else if (STATE.focus && STATE.focus !== STATE.root) {
        const parent = STATE.focus.parent;
        if (parent) drillToNode(parent);
      }
    }
  });

  // ResizeObserver
  const chartEl = document.getElementById('chart');
  if (chartEl) {
    const ro = new ResizeObserver(() => {
      clearTimeout(STATE.resizeTimer);
      STATE.resizeTimer = setTimeout(() => render(false), 60);
    });
    ro.observe(chartEl);
  }
}

// ── Color helpers ─────────────────────────────────────────────────────────────
function cmmiColor(val) {
  if (val == null) return '#21262d';
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

// Returns raw hex for alpha mixing
function cmmiColorRaw(val) {
  const c = cmmiColor(val);
  if (c === '#21262d') return '#21262d';
  // parse rgb(r,g,b) → hex
  const m = c.match(/rgb\((\d+),(\d+),(\d+)\)/);
  if (!m) return c;
  return '#' + [m[1],m[2],m[3]].map(n => parseInt(n).toString(16).padStart(2,'0')).join('');
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function cmmiGlowFilter(val) {
  if (val == null) return null;
  if (val <= 20) return 'url(#glow-n1)';
  if (val <= 40) return 'url(#glow-n2)';
  if (val <= 60) return 'url(#glow-n3)';
  if (val <= 80) return 'url(#glow-n4)';
  return 'url(#glow-n5)';
}

function cmmiLabel(val) {
  if (val == null) return 'Sin datos';
  if (val <= 20)  return 'N1 Inicial';
  if (val <= 40)  return 'N2 Gestionado';
  if (val <= 60)  return 'N3 Definido';
  if (val <= 80)  return 'N4 Cuant. Gestionado';
  return 'N5 Optimizado';
}
