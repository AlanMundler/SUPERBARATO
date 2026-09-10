# 🛒 SUPERBARATO — Ofertas de supermercados en Córdoba

Comparador estático en **GitHub Pages** para Córdoba Capital: agrupa las mejores ofertas **por categorías**, **compara el mismo producto entre supers**, **recomienda a dónde ir por rubro** y arma **listas de compras por supermercado** (carrito óptimo).

## Skills orquestados (super-skill)
| Skill | Aporte |
|---|---|
| `backend-patterns` | Bot con retry+backoff, sin N+1, un solo JSON |
| `frontend-patterns` | Debounce en buscador, composición simple, render por grupos |
| `actualizar-lista-precios` | Regla **nunca inventar precios**: si el bot consigue <20 items, conserva el JSON y marca `stale` |
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
assets/app.js, styles.css   → frontend vanilla
data/supermercados.json     → 8 supers (5 VTEX + 3 scrape cordobés)
data/categorias.json        → 8 categorías
data/ofertas.json           → precios planos {producto, marca, categoria, super, precio...}
scripts/update_precios.py   → bot diario (solo stdlib)
.github/workflows/update-precios.yml → cron 08:00 ART + commit automático
```

## Probar local
```powershell
python -m http.server 8000
# abrir http://localhost:8000
python scripts/update_precios.py --check
```

## Publicar en GitHub Pages
1. `git remote add origin <tu-repo>`, push a `main` (o `master`).
2. En GitHub: **Settings → Pages → Deploy from branch → main, /(root)**.
3. El workflow corre solo cada día a las 08:00 ART y commitea `data/ofertas.json`.

## Fuentes por super (Córdoba)
- **VTEX (API pública, sin key):** Vea, Disco, Jumbo, Carrefour, Día.
- **Scrape HTML + respaldo manual:** Mariano Max (`/ofertas`), Cordiez, Hiper Libertad.
- **Fase 2:** ChangoMás, Makro, Tadicor, Almacor + dump SEPA oficial.

## Reglas
- Nunca commitear precios inventados: el bot falla cerrado (`stale:true`) y conserva datos previos.
- Precios de referencia: verificar en el super antes de una compra grande.
