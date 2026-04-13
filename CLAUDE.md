# CISOToolkit — CLAUDE.md

## Proyecto
Dashboard web para gestión de KRIs (Key Risk Indicators) basado en NIST Cybersecurity Framework 2.0.
Trabajo Final de Máster (TFM) de ciberseguridad.

## Stack
- **Backend**: Node.js + Express + SQLite (better-sqlite3)
- **Frontend**: Vanilla JS, HTML, CSS (sin frameworks)
- **Visualización**: D3.js v7 (heatmap/treemap)
- **Puerto**: 3000 (localhost en desarrollo)
- **Autenticación**: Sesiones Express, usuario por defecto `ciso / Admin1234!`

## Estructura de archivos clave
```
server.js                  — servidor Express + API REST + migraciones SQLite
public/
  heatmap.html             — página principal: treemap D3 con drilldown (post-login)
  data.html                — tabla de KRIs con filtros y export
  login.html               — pantalla de login
  css/styles.css           — estilos globales (dark theme)
  js/common.js             — utilidades compartidas: auth, CMMI helpers, export (JSON/CSV/XML/Excel)
  js/heatmap.js            — lógica del heatmap ECharts (página de referencia, no principal)
  js/data.js               — lógica de data.html
```

## Base de datos (SQLite)
- `functions` → `categories` → `subcategories` → `kris` (1:many)
- `kri_history`: historial de valoraciones por KRI
- Una subcategoría puede tener múltiples KRIs
- El heatmap muestra el AVG de todos los KRIs por subcategoría

## API endpoints principales
- `GET  /api/heatmap`              — datos jerárquicos para el treemap
- `GET  /api/kris`                 — KRIs flat con filtros (functionId, categoryId, subcategoryId, search)
- `POST /api/kris/:subcategoryId`  — crear o actualizar KRI (kri_id en body = update)
- `DELETE /api/kris/:kriId`        — eliminar KRI
- `GET  /api/kris/:kriId/history`  — historial de un KRI
- `GET  /api/export/excel`         — exportar como .xlsx con filtros

## Convenciones
- **Idioma**: interfaz en español, código en inglés
- **CMMI**: escala 0–100, N1 (rojo) → N5 (verde), thresholds: 20/40/60/80
- **Commits**: siempre con tag de versión (v2.3, v2.4, etc.)
- **Versiones en GitHub**: `git tag vX.Y && git push origin master --tags`
- No usar frameworks CSS (Bootstrap, Tailwind, etc.)
- No usar React/Vue — todo Vanilla JS

## Navegación
- Post-login → `/heatmap.html`
- Navbar: **CISOToolkit 🛡** | Heatmap | Datos
- Brand siempre apunta a `/heatmap.html`

## Reiniciar servidor (Windows)
```bash
npx kill-port 3000 && node server.js
```
O desde la terminal del usuario:
```
! npx kill-port 3000 && node server.js
```
