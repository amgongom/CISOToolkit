---
name: CISOToolkit Design Conventions
description: Visual design decisions, CSS tokens, and component patterns established in pilot-dark.html across sessions
type: project
---

## Established design tokens (canonical set — propagated to styles.css session 3)

Core palette:
- `--bg-base: #0a0e14` — deepest background
- `--bg-surface: #111820` — topbar, panel backgrounds
- `--bg-elevated: #1a2230` — cards, panel headers
- `--bg-overlay: #222d3a` — tooltip, formula blocks
- `--border-faint: rgba(48,64,80,.55)` — subheader borders
- `--border-soft: #1e2d3d` — primary border (default)
- `--border-mid: #2e4055` — hover/active borders
- `--accent: #4d9fff` — primary blue accent
- `--accent-dim: rgba(77,159,255,.13)` — accent bg tint
- `--green: #2ea84a`, `--red: #f04f45`
- `--text-primary: #e2eaf4`, `--text-secondary: #7a90a8`, `--text-muted: #3d5068`

Fonts: `--font-ui: 'Inter'`, `--font-mono: 'JetBrains Mono'`. Both via Google Fonts @import in styles.css.
login.html also has `<link>` preconnect tags for Inter + JetBrains Mono.

## Deprecated tokens (kept as aliases in :root for backward compat — do NOT use in new markup)
`--bg`, `--surface`, `--surface2`, `--border`, `--text`, `--text-muted` (old value), `--accent-hover`

## Key component patterns

**Topbar (56px):**
- Background: `linear-gradient(180deg, #131c27 0%, var(--bg-surface) 100%)`
- 2px gradient top-border via `::before` (transparent→navy→accent→bright→navy→transparent)
- `::after` bottom glow line: `rgba(77,159,255,.18)` gradient
- Active nav item: `::after` underline bar + box-shadow inset ring
- Brand: `.brand` + `.brand-mark` (30px gradient shield, glow box-shadow). NOT `.topbar-brand`
- Topbar divider: `.topbar-divider` (1px, border-soft)
- Right side: `.topbar-right` → `.live-badge` + `.topbar-user`
- `.live-badge` / `.live-dot` with `@keyframes pulse` (2.5s)
- `.avatar` circular 28px, border-mid, gradient bg
- `.btn-logout` hover → red tint rgba(239,68,68,.07)

**Navigation links:**
- Heatmap → `/pilot-dark.html` (reference D3 treemap, the primary page)
- Data → `/data.html`
- Brand → `/pilot-dark.html`
- `heatmap.html` is old ECharts grid page (secondary/legacy)

**Page header (.page-header):**
- flex row, `::before` as 3px vertical accent bar
- `.page-header-text` inner flex column (pilot-dark specific)

**Legend (.legend in pilot-dark):**
- Container: `background: rgba(17,24,32,.7)`, border-faint, radius-md, backdrop-filter blur(4px)
- Swatches 12×12px, radius 3px, font .74rem

**KRI Cards (.kri-card):**
- Gradient bg + 3px left border tinted with CMMI score color (set inline via JS)
- Hover: translateY(-1px) lift + box-shadow

**KRI Panel (#kri-panel):**
- `border-top: 2px solid rgba(77,159,255,.25)` — blue accent top

**Tooltip (#tooltip):**
- Gradient bg, backdrop-filter blur(4px), accent-tinted top border

**Ambient SOC atmosphere (pilot-dark only):**
- `body::before` top-left radial blue glow rgba(77,159,255,.04)
- `body::after` bottom-right radial green glow rgba(22,163,74,.025)

## CMMI color map
- N1 (0–20): `#ef4444` red | N2 (21–40): `#f97316` orange
- N3 (41–60): `#fbbf24` amber (dark text) | N4 (61–80): `#a3e635` lime (dark text)
- N5 (81–100): `#16a34a` green | no-data: `#2e4055`

## Large-monitor considerations
- Font sizes ≥ .8rem for legend/breadcrumb/nav
- Topbar 56px for breathing room
- Page header title ≥ 1.1rem

**Why:** These are project-canonical across all pages.
**How to apply:** Use token set above for any new page or component. No Bootstrap/Tailwind ever.
