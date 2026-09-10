# 🛒 SUPERBARATO — Catálogo completo, SOLO Córdoba Capital

Comparador estático en **GitHub Pages**, actualizado **1 vez por día** con el catálogo completo de todos los supermercados de **Córdoba Capital (Argentina)**. Nada del interior, nada de otras provincias: agrupa las mejores ofertas **por categorías**, **compara el mismo producto entre supers**, **recomienda a dónde ir por rubro** y arma **listas de compras por supermercado** (carrito óptimo).

## Skills orquestados (super-skill)
| Skill | Aporte |
|---|---|
| `backend-patterns` | Bot con retry+backoff, sin N+1, un solo JSON |
| `frontend-patterns` | Debounce en buscador, composición simple, render por grupos |
| `actualizar-lista-precios` | Regla **nunca inventar precios**: si una fuente falla, conserva el archivo previo y marca `stale` |
| `hallmark` / `coding-standards` | Vanilla sin framework para Pages (rápido, sin build) |

## Repos existentes que inspiraron esto (no reinventar)
- **`matiasbontempo/ratoneando-go`** (⭐53) — API Go + Redis + scrapers, usado en ratoneando.ar. Mejor arquitectura si luego querés backend.
- **`0xKoaj/compralist`** — comparador Coto/Jumbo/Disco/Vea/Día + **carrito óptimo** (idea reutilizada en nuestras listas).
- **`PabloAliArgentina/super_scraper`** — scrapers multi-super Argentina.
- **`jbianco/super_lista`** — agregador con **API VTEX** (Carrefour, ChangoMás, Disco, Jumbo). Base de nuestra fuente VTEX.
- **`juanoxidev/chrome-extension-supermercados`** — compara Día/Carrefour/Coto/Jumbo/Disco/Vea en el navegador.
- Datos: **SEPA / Precios Claros** (publicación diaria oficial) + VTEX + folletos cordobeses. Referencias vivas: pricely.ar, yapa (Telegram), servidos.ar.

## Estructura
```
index.html                  → sitio (raíz, apto GitHub Pages)
assets/app.js, styles.css   → frontend vanilla (carga data/catalogo/)
data/supermercados.json     → 15 supers, todos con presencia en Córdoba Capital
data/categorias.json        → 9 categorías (clasificación por palabras clave)
data/catalogo/index.json    → índice generado por el bot (SOLO capital)
data/catalogo/<super>.json  → catálogo completo por super (precios = mediana capital)
data/ofertas.json           → legacy: solo fallback si el bot aún no corrió
scripts/update_precios.py   → bot diario v2 (solo stdlib, con --selftest)
.github/workflows/update-precios.yml → cron diario 08:00 ART + commit automático
```

## Probar local
```powershell
python -m http.server 8000
# abrir http://localhost:8000
python scripts/update_precios.py --selftest        # sin red: fixture + categorías
python scripts/update_precios.py --solo cordiez --max-paginas 2   # VTEX en vivo
```

## Publicar en GitHub Pages
1. `git remote add origin <tu-repo>`, push a `main` (o `master`).
2. En GitHub: **Settings → Pages → Deploy from branch → main, /(root)**.
3. El workflow corre solo cada día a las 08:00 ART y commitea `data/catalogo/`.

## Fuentes (todas filtradas a Córdoba Capital)
- **SEPA minorista oficial** (dump diario CC-BY): precios por sucursal → se conservan
  solo sucursales de la localidad Córdoba (AR-X). Cubre Vea, Disco, Jumbo,
  Carrefour (Hiper/Market/Express/Maxi), Día, La Anónima (ex Libertad) y toda
  bandera que reporte en capital (descubrimiento dinámico). Precio publicado =
  mediana entre sucursales capitalinas.
- **VTEX full-catalog:** Cordiez (cadena cordobesa, catálogo completo paginado).
- **Scrape best-effort (cobertura parcial):** Mariano Max, Makro, Tadicor, Almacor, Diarco.
- Novedad 2026: los 4 Hiper Libertad de capital (Rodríguez del Busto, Gral. Paz,
  Rivera, Sabattini) pasaron a **La Anónima**.

## Reglas
- Nunca commitear precios inventados: el bot falla cerrado (`stale:true`) y conserva datos previos.
- Precios de referencia: verificar en el super antes de una compra grande.
