// SUPERBARATO Córdoba Capital — frontend estático, sin build.
// Fixes: links del bot, búsqueda sin tildes, índice cacheado, ver-más,
// quitar individual, toast, barra flotante, ahorro honesto.

const state = {
  supersMeta: [],
  supersIdx: [],
  categorias: [],
  ofertas: [],
  meta: {},
  catActiva: "",
  busqueda: "",
  superFiltro: "",
  comparando: null,
  visibles: 60,
  vista: "buscar",
  orden: "precio",
  mejorSuper: null,
  cartSuper: null,
  favs: [],
  lista: JSON.parse(localStorage.getItem("superbarato-lista") || "[]"),
  idx: null, // { byKey: Map, byId: Map }
};

const $ = (id) => document.getElementById(id);
const fmt = (n) => "$" + Number(n).toLocaleString("es-AR");
const normTxt = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function superById(id) {
  return state.supersMeta.find((s) => s.id === id)
    || state.supersIdx.find((s) => s.id === id)
    || { nombre: id, color: "#6f6e63" };
}
function catIcono(id) {
  const c = state.categorias.find((x) => x.id === id);
  return (c && c.icono) || "📦";
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

let toastTimer = null;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

function grupoKey(o) {
  const base = o.ean ? "E" + o.ean : "N" + normTxt(o.producto + "||" + o.marca);
  return base.replace(/"/g, "");
}

// Índice construido UNA vez: grupos ordenados + mapa id->oferta
function buildIndex() {
  const byKey = new Map();
  const byId = new Map();
  for (const o of state.ofertas) {
    byId.set(o.id, o);
    const key = grupoKey(o);
    if (!byKey.has(key)) {
      byKey.set(key, { key, producto: o.producto, marca: o.marca, categoria: o.categoria, items: [] });
    }
    byKey.get(key).items.push(o);
  }
  for (const g of byKey.values()) g.items.sort((a, b) => a.precio - b.precio);
  state.idx = { byKey, byId };
}

function grupos() {
  const toks = normTxt(state.busqueda).split(/\s+/).filter(Boolean);
  const out = [];
  for (const g of state.idx.byKey.values()) {
    if (state.catActiva && g.categoria !== state.catActiva) continue;
    if (state.superFiltro && !g.items.some((o) => o.super === state.superFiltro)) continue;
    if (toks.length) {
      const hay = normTxt(g.producto + " " + g.marca);
      if (!toks.every((t) => hay.includes(t))) continue;
    }
    const items = state.superFiltro ? g.items.filter((o) => o.super === state.superFiltro) : g.items;
    if (!items.length) continue;
    out.push({ key: g.key, producto: g.producto, marca: g.marca, categoria: g.categoria, items });
  }
  if (state.orden === "ppu") {
    const minPpu = (g) => {
      const v = g.items.filter((o) => o.ppu).map((o) => o.ppu);
      return v.length ? Math.min(...v) : Infinity;
    };
    out.sort((a, b) => minPpu(a) - minPpu(b));
  } else {
    out.sort((a, b) => a.items[0].precio - b.items[0].precio);
  }
  return out;
}

function renderMeta() {
  $("meta-linea").textContent =
    `${state.ofertas.length.toLocaleString("es-AR")} precios · ` +
    `${state.supersIdx.length || new Set(state.ofertas.map((o) => o.super)).size} supers · ` +
    `actualizado ${state.meta.actualizado || "?"}`;
}

function renderTabs() {
  const nav = $("tabs-categorias");
  nav.innerHTML = "";
  const counts = {};
  for (const g of state.idx.byKey.values()) counts[g.categoria] = (counts[g.categoria] || 0) + 1;
  const cats = state.categorias.filter((c) => counts[c.id]);
  const todas = [{ id: "", nombre: "Todo", icono: "⭐" }, ...cats];
  for (const c of todas) {
    const b = document.createElement("button");
    b.className = "chip" + (c.id === state.catActiva ? " active" : "");
    const n = c.id ? counts[c.id] : state.idx.byKey.size;
    b.innerHTML = `${c.icono || ""} ${c.nombre} <span class="n">${Number(n).toLocaleString("es-AR")}</span>`;
    b.setAttribute("aria-pressed", c.id === state.catActiva ? "true" : "false");
    b.onclick = () => { state.catActiva = c.id; state.visibles = 60; renderTabs(); renderOfertas(); };
    nav.appendChild(b);
  }
}

function ppuTxt(o) {
  return o.ppu ? `<span class="ppu">${fmt(o.ppu)}/${o.punidad || "un"}</span>` : "";
}
function precioOriginal(o) {
  return (o.precio_lista > o.precio)
    ? `<span class="tachado">${fmt(o.precio_lista)}</span>` : "";
}
function cardHTML(g) {
  const mejor = g.items[0];
  const s = superById(mejor.super);
  const link = mejor.url_producto || mejor.url_tienda;
  return `
    <div class="emoji" aria-hidden="true">${catIcono(g.categoria)}</div>
    <div class="prod-body">
      <p class="prod-name">${g.producto}</p>
      <p class="prod-sub">${g.marca} · ${g.items.length} precio${g.items.length > 1 ? "s" : ""}</p>
      <span class="badge" style="background:${s.color}">${s.nombre}</span>
    </div>
    <div class="prod-side">
      <span class="precio">${fmt(mejor.precio)}</span>
      ${precioOriginal(mejor)}
      ${ppuTxt(mejor)}
      <button class="btn-add" data-add="${mejor.id}" aria-label="Agregar ${g.producto} a mi lista">➕</button>
      ${link ? `<a class="link-btn" href="${link}" target="_blank" rel="noopener">🔗 Ver</a>` : ""}
      <button class="btn-fav${state.favs.includes(g.key) ? " on" : ""}" data-fav="${g.key}" aria-label="Guardar en favoritos" aria-pressed="${state.favs.includes(g.key)}">⭐</button>
    </div>`;
}

function renderOfertas() {
  const box = $("ofertas-lista");
  const gs = grupos();
  const vis = gs.slice(0, state.visibles);
  $("resultados-meta").textContent = gs.length
    ? `${gs.length.toLocaleString("es-AR")} productos · del más barato primero`
    : "";
  if (!gs.length) {
    box.innerHTML = `<div class="empty"><p class="big">🔍</p>
      <p><strong>No encontré nada con “${state.busqueda}”.</strong></p>
      <p class="muted">Probá con menos palabras o con estos:</p>
      <div class="sug-row">${["yerba", "leche", "asado", "pollo", "shampoo"].map((w) =>
        `<button class="chip" data-sug="${w}">${w}</button>`).join("")}</div></div>`;
    box.querySelectorAll("[data-sug]").forEach((b) => {
      b.onclick = () => { $("buscador").value = b.dataset.sug; setBusqueda(b.dataset.sug); };
    });
  } else {
    box.innerHTML = "";
    for (const g of vis) {
      const div = document.createElement("article");
      div.className = "card-prod";
      div.innerHTML = cardHTML(g);
    div.onclick = (e) => {
      if (e.target.closest("[data-add]") || e.target.closest("[data-fav]") || e.target.closest("a")) return;
      state.comparando = g.key;
      renderComparador();
    };
      box.appendChild(div);
    }
    box.querySelectorAll("[data-add]").forEach((b) => {
      b.onclick = (e) => { e.stopPropagation(); agregar(b.dataset.add); };
    });
  }
  const mas = $("btn-mas");
  mas.hidden = gs.length <= state.visibles;
  if (!mas.hidden) mas.textContent = `Ver más baratos ↓ (${(gs.length - state.visibles).toLocaleString("es-AR")} restantes)`;
}

function renderComparador() {
  const modal = $("comparador-modal");
  const box = $("comparador-detalle");
  if (!state.comparando) { modal.hidden = true; return; }
  const g = state.idx.byKey.get(state.comparando);
  if (!g) { modal.hidden = true; return; }
  modal.hidden = false;
  // Filtro estricto: con un super elegido, solo precios de ese super.
  const items = state.superFiltro ? g.items.filter((o) => o.super === state.superFiltro) : g.items;
  if (!items.length) { modal.hidden = true; return; }
  const tituloSuper = state.superFiltro ? ` <span class="muted">en ${superById(state.superFiltro).nombre}</span>` : "";
  box.innerHTML = `<h3>${g.producto} <span class="muted">${g.marca}</span>${tituloSuper}</h3>` + items.map((o, i) => {
    const s = superById(o.super);
    const dif = state.superFiltro ? "" : (i === 0 ? "✅ mejor precio" : `+$${(o.precio - items[0].precio).toLocaleString("es-AR")}`);
    const link = o.url_producto || o.url_tienda;
    return `<div class="comp-row${i === 0 ? " mejor" : ""}">
      <span class="badge" style="background:${s.color}">${s.nombre}</span>
      <span class="precio">${fmt(o.precio)}</span>
      ${precioOriginal(o)}
      ${ppuTxt(o)}
      ${dif ? `<span class="comp-dif${i === 0 ? " win" : ""}">${dif}</span>` : ""}
      <span class="comp-actions">
        ${link ? `<a class="link-btn" href="${link}" target="_blank" rel="noopener">🔗 Ver</a>` : ""}
        <button class="btn-add" data-add="${o.id}" aria-label="Agregar de ${s.nombre}">➕</button>
      </span></div>`;
  }).join("");
  box.querySelectorAll("[data-add]").forEach((b) => {
    b.onclick = () => agregar(b.dataset.add);
  });
  $("btn-cerrar-comp").focus();
}
function cerrarComparador() {
  state.comparando = null;
  $("comparador-modal").hidden = true;
}

function renderRecos() {
  const wins = {};
  for (const g of state.idx.byKey.values()) {
    const mejor = g.items[0];
    wins[g.categoria] = wins[g.categoria] || {};
    wins[g.categoria][mejor.super] = (wins[g.categoria][mejor.super] || 0) + 1;
  }
  const box = $("reco-lista");
  box.innerHTML = "";
  for (const c of state.categorias) {
    const w = wins[c.id];
    if (!w) continue;
    const [superId, n] = Object.entries(w).sort((a, b) => b[1] - a[1])[0];
    const s = superById(superId);
    const d = document.createElement("div");
    d.className = "reco";
    d.innerHTML = `<span class="reco-cat">${c.icono} ${c.nombre}</span>` +
      `<span class="reco-win">→ <strong>${s.nombre}</strong> · ${Number(n).toLocaleString("es-AR")}</span>`;
    box.appendChild(d);
  }
  if (!box.children.length) box.innerHTML = '<p class="muted">Todavía no hay datos para recomendar.</p>';
}

// Lo mejor de cada super: top promos y baratos de un super elegido
function renderMejor() {
  const chips = $("mejor-chips");
  const box = $("mejor-lista");
  if (!chips || !box) return;
  const supers = state.supersIdx.length ? state.supersIdx
    : [...new Set(state.ofertas.map((o) => o.super))].map((id) => ({ id, nombre: superById(id).nombre }));
  if (!supers.length) { box.innerHTML = '<p class="muted">Todavía no hay datos.</p>'; return; }
  if (!state.mejorSuper || !supers.some((s) => s.id === state.mejorSuper)) {
    state.mejorSuper = supers[0].id;
  }
  chips.innerHTML = "";
  for (const s of supers) {
    const meta = superById(s.id);
    const b = document.createElement("button");
    b.className = "chip" + (s.id === state.mejorSuper ? " active" : "");
    b.innerHTML = `<span class="badge" style="background:${meta.color || "#6f6e63"}">${s.nombre}</span>`;
    b.setAttribute("aria-pressed", s.id === state.mejorSuper ? "true" : "false");
    b.onclick = () => { state.mejorSuper = s.id; renderMejor(); };
    chips.appendChild(b);
  }
  const items = state.ofertas.filter((o) => o.super === state.mejorSuper);
  const scored = items.map((o) => ({
    o, desc: (o.precio_lista > o.precio) ? (o.precio_lista - o.precio) : 0,
  }));
  scored.sort((a, b) => (b.desc - a.desc) || (a.o.precio - b.o.precio));
  const top = scored.slice(0, 10);
  if (!top.length) { box.innerHTML = '<p class="muted">Sin productos.</p>'; return; }
  box.innerHTML = "";
  for (const { o, desc } of top) {
    const s = superById(o.super);
    const link = o.url_producto || o.url_tienda;
    const div = document.createElement("article");
    div.className = "card-prod";
    div.innerHTML = `
      <div class="emoji" aria-hidden="true">${catIcono(o.categoria)}</div>
      <div class="prod-body">
        <p class="prod-name">${o.producto}</p>
        <p class="prod-sub">${o.marca}${desc > 0 ? ` · ahorrás ${fmt(desc)}` : ""}</p>
        <span class="badge" style="background:${s.color}">${s.nombre}</span>
      </div>
      <div class="prod-side">
        <span class="precio">${fmt(o.precio)}</span>
        ${ppuTxt(o)}
        <button class="btn-add" data-add="${o.id}" aria-label="Agregar ${o.producto} a mi lista">➕</button>
        ${link ? `<a class="link-btn" href="${link}" target="_blank" rel="noopener">🔗 Ver</a>` : ""}
      </div>`;
    box.appendChild(div);
  }
  box.querySelectorAll("[data-add]").forEach((b) => {
    b.onclick = () => agregar(b.dataset.add);
  });
}

// ---- Favoritos + alertas de baja (sin registro, todo local) ----
function toggleFav(key) {
  const i = state.favs.indexOf(key);
  if (i >= 0) { state.favs.splice(i, 1); toast("Quitado de favoritos"); }
  else { state.favs.push(key); toast("Guardado en favoritos ⭐"); }
  localStorage.setItem("superbarato-favs", JSON.stringify(state.favs));
  document.querySelectorAll("[data-fav]").forEach((b) => {
    const on = state.favs.includes(b.dataset.fav);
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", on);
  });
  renderFavs();
}
function renderFavs() {
  const box = $("favs-lista");
  if (!box) return;
  const gs = state.favs.map((k) => state.idx.byKey.get(k)).filter(Boolean);
  if (!gs.length) { box.innerHTML = '<p class="muted">Tocá ⭐ en lo que compres siempre.</p>'; return; }
  box.innerHTML = "";
  for (const g of gs) {
    const mejor = g.items[0];
    const s = superById(mejor.super);
    const div = document.createElement("article");
    div.className = "card-prod";
    div.innerHTML = `
      <div class="emoji" aria-hidden="true">${catIcono(g.categoria)}</div>
      <div class="prod-body">
        <p class="prod-name">${g.producto}</p>
        <p class="prod-sub">${g.marca}</p>
        <span class="badge" style="background:${s.color}">${s.nombre}</span>
      </div>
      <div class="prod-side">
        <span class="precio">${fmt(mejor.precio)}</span>
        <button class="btn-add" data-add="${mejor.id}" aria-label="Agregar ${g.producto} a mi lista">➕</button>
        <button class="btn-fav on" data-fav="${g.key}" aria-label="Quitar de favoritos" aria-pressed="true">⭐</button>
      </div>`;
    box.appendChild(div);
  }
  box.querySelectorAll("[data-add]").forEach((b) => {
    b.onclick = () => agregar(b.dataset.add);
  });
}
function checkAlertas() {
  let snap = {};
  try { snap = JSON.parse(localStorage.getItem("superbarato-snap") || "{}"); } catch (e) { snap = {}; }
  const bajas = [];
  for (const key of state.favs) {
    const g = state.idx.byKey.get(key);
    if (!g) continue;
    const best = g.items[0].precio;
    const prev = snap[key];
    if (prev && typeof prev.p === "number" && best < prev.p) {
      bajas.push({ g, antes: prev.p, ahora: best });
    }
    snap[key] = { p: best, f: state.meta.actualizado || "" };
  }
  localStorage.setItem("superbarato-snap", JSON.stringify(snap));
  const box = $("alertas-box");
  if (!box) return;
  box.innerHTML = bajas.length ? `<div class="ahorro-banner">🔻 Bajaron ${bajas.length} de tus favoritos</div>` +
    bajas.map(({ g, antes, ahora }) => {
      const s = superById(g.items[0].super);
      return `<div class="reco"><strong>${g.producto}</strong>Ahora ${fmt(ahora)} en ${s.nombre} (antes ${fmt(antes)})</div>`;
    }).join("") : "";
}

// ---- Cazaofertas: mayores rebajas en $ de hoy ----
function renderCaza() {
  const box = $("caza-lista");
  if (!box) return;
  const gs = grupos()
    .map((g) => ({ g, off: g.items[0].precio_lista > g.items[0].precio ? g.items[0].precio_lista - g.items[0].precio : 0 }))
    .filter((x) => x.off > 0)
    .sort((a, b) => b.off - a.off)
    .slice(0, 60);
  if (!gs.length) { box.innerHTML = '<p class="muted">Hoy no hay rebajas marcadas.</p>'; return; }
  box.innerHTML = "";
  for (const { g, off } of gs) {
    const mejor = g.items[0];
    const s = superById(mejor.super);
    const link = mejor.url_producto || mejor.url_tienda;
    const div = document.createElement("article");
    div.className = "card-prod";
    div.innerHTML = `
      <div class="emoji" aria-hidden="true">${catIcono(g.categoria)}</div>
      <div class="prod-body">
        <p class="prod-name">${g.producto}</p>
        <p class="prod-sub">${g.marca} · ahorrás ${fmt(off)}</p>
        <span class="badge" style="background:${s.color}">${s.nombre}</span>
      </div>
      <div class="prod-side">
        <span class="precio">${fmt(mejor.precio)}</span>
        ${precioOriginal(mejor)}
        <button class="btn-add" data-add="${mejor.id}" aria-label="Agregar ${g.producto} a mi lista">➕</button>
        ${link ? `<a class="link-btn" href="${link}" target="_blank" rel="noopener">🔗 Ver</a>` : ""}
        <button class="btn-fav${state.favs.includes(g.key) ? " on" : ""}" data-fav="${g.key}" aria-label="Guardar en favoritos">⭐</button>
      </div>`;
    div.onclick = (e) => {
      if (e.target.closest("[data-add]") || e.target.closest("[data-fav]") || e.target.closest("a")) return;
      state.comparando = g.key;
      renderComparador();
    };
    box.appendChild(div);
  }
  box.querySelectorAll("[data-add]").forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); agregar(b.dataset.add); };
  });
}

function renderFuentes() {  const box = $("fuentes-lista");
  if (!box || !state.supersIdx.length) { if (box) box.innerHTML = '<p class="muted">Datos de ejemplo.</p>'; return; }
  box.innerHTML = state.supersIdx.map((s) => {
    const meta = superById(s.id);
    return `<div class="fuente-row"><span class="badge" style="background:${meta.color || "#6f6e63"}">${s.nombre}</span> ` +
      `${(s.items ?? 0).toLocaleString("es-AR")} productos · ${s.zona || ""} · ${s.cobertura || ""}${s.stale ? " · <strong>pendiente de actualizar</strong>" : ""}</div>`;
  }).join("");
}

// ---- Navegación por pestañas: todo entra en una pantalla ----
function showView(nombre) {
  state.vista = nombre;
  for (const v of ["buscar", "ofertas", "lista", "mas"]) {
    document.getElementById("view-" + v).hidden = v !== nombre;
    document.getElementById("view-" + v).classList.toggle("active", v === nombre);
    const tab = document.getElementById("tab-" + v);
    tab.classList.toggle("active", v === nombre);
    if (v === nombre) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  }
  if (nombre === "lista") renderListas();
}
function updateTabBadge() {
  const n = state.lista.filter((id) => state.idx.byId.get(id)).length;
  const b = $("tab-badge");
  b.hidden = !n;
  b.textContent = n > 99 ? "99+" : String(n);
}
function applyTheme() {
  const t = localStorage.getItem("superbarato-theme") ||
    (window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.dataset.theme = t;
  const b = $("btn-tema");
  if (b) b.textContent = `🌓 Modo oscuro: ${t === "dark" ? "sí" : "no"}`;
}

// ---- Lista inteligente: qué comprar en cada super ----
function agregar(id) {
  state.lista.push(id);
  guardar();
  const o = state.idx.byId.get(id);
  toast(o ? `${o.producto.slice(0, 32)}… agregado ✅` : "Agregado ✅");
  renderBar();
}
function quitar(id) {
  const i = state.lista.indexOf(id);
  if (i >= 0) state.lista.splice(i, 1);
  guardar();
  renderBar();
}
function guardar() {
  localStorage.setItem("superbarato-lista", JSON.stringify(state.lista));
  renderListas();
}
function mejorDe(id) {
  const o = state.idx.byId.get(id);
  if (!o) return null;
  const g = state.idx.byKey.get(grupoKey(o));
  return g ? g.items[0] : o;
}
function renderBar() {
  updateTabBadge();
}
function cartDatos(clavesArr) {
  const presentes = [...new Set(state.ofertas.map((o) => o.super))];
  const cob = [];
  for (const sid of presentes) {
    let total = 0, tiene = 0;
    for (const key of clavesArr) {
      const g = state.idx.byKey.get(key);
      const o = g ? g.items.find((x) => x.super === sid) : null;
      if (o) { total += o.precio; tiene++; }
    }
    if (tiene) cob.push({ sid, total, tiene });
  }
  cob.sort((a, b) => (b.tiene - a.tiene) || (a.total - b.total));
  return cob;
}
function cartDetalleHTML(clavesArr, sid) {
  const s = superById(sid);
  const link = metaLink(sid);
  let total = 0, falta = 0, rows = "";
  for (const key of clavesArr) {
    const g = state.idx.byKey.get(key);
    if (!g) continue;
    const best = g.items[0];
    const o = g.items.find((x) => x.super === sid);
    if (!o) {
      falta++;
      rows += `<li><span class="t">${g.producto} <span class="muted">(${g.marca})</span></span><span class="p muted">no está</span></li>`;
      continue;
    }
    total += o.precio;
    const dif = o.precio - best.precio;
    const estado = dif <= 0
      ? `<span class="comp-dif win">✅ mejor precio</span>`
      : `<span class="comp-dif">+$${dif.toLocaleString("es-AR")} vs ${superById(best.super).nombre}</span>`;
    rows += `<li><span class="t">${o.producto} <span class="muted">(${o.marca})</span><br>${estado}</span><span class="p">${fmt(o.precio)}</span></li>`;
  }
  return `<div class="super-grupo"><h3><span class="badge" style="background:${s.color}">${s.nombre}</span>` +
    `<span class="muted">tu lista acá: ${fmt(total)}${falta ? ` · faltan ${falta}` : ""}</span>` +
    `${link ? `<a class="link-btn" href="${link}" target="_blank" rel="noopener">🏪 Ir a la tienda</a>` : ""}</h3><ul>${rows}</ul></div>`;
}
function renderListas() {
  const box = $("listas-detalle");
  if (!state.lista.length) {
    box.innerHTML = '<p class="muted">Todavía vacía. Buscá algo arriba y tocá ➕.</p>';
    setAccionesLista(false);
    return;
  }
  const porSuper = {};
  const claves = new Set();
  let optimo = 0, peor = 0;
  for (const id of state.lista) {
    const m = mejorDe(id);
    if (!m) continue;
    const g = state.idx.byKey.get(grupoKey(m));
    const peorPrecio = g ? g.items[g.items.length - 1].precio : m.precio;
    const media = g ? g.items.reduce((a, o) => a + o.precio, 0) / g.items.length : m.precio;
    optimo += m.precio;
    peor += peorPrecio;
    claves.add(grupoKey(m));
    porSuper[m.super] = porSuper[m.super] || { items: [], total: 0, ahorroMedia: 0 };
    porSuper[m.super].items.push({ ...m, origenId: id });
    porSuper[m.super].total += m.precio;
    porSuper[m.super].ahorroMedia += media - m.precio;
  }
  const ahorro = peor - optimo;
  let html = `<div class="ahorro-banner">🧾 Total óptimo: ${fmt(optimo)}${ahorro > 0 ? ` · Ahorrás ${fmt(Math.round(ahorro))}` : ""}</div>`;
  const orden = Object.entries(porSuper).sort((a, b) => b[1].total - a[1].total);
  for (const [superId, gr] of orden) {
    const s = superById(superId);
    const link = metaLink(superId);
    html += `<div class="super-grupo"><h3><span class="badge" style="background:${s.color}">${s.nombre}</span>` +
      `<span class="muted">carrito · ${gr.items.length} cosa${gr.items.length > 1 ? "s" : ""}</span>` +
      `${link ? `<a class="link-btn" href="${link}" target="_blank" rel="noopener">🏪 Ir a la tienda</a>` : ""}` +
      `<span class="sub">${fmt(gr.total)}</span></h3>` +
      `${gr.ahorroMedia > 1 ? `<p class="muted">Acá ahorrás ${fmt(Math.round(gr.ahorroMedia))} vs el precio promedio.</p>` : ""}<ul>`;
    for (const o of gr.items) {
      html += `<li><span class="t">${o.producto} <span class="muted">(${o.marca})</span></span>` +
        `<span class="p">${fmt(o.precio)}</span>` +
        `<button class="btn-del" data-del="${o.origenId}" aria-label="Quitar ${o.producto}">✕</button></li>`;
    }
    html += "</ul></div>";
  }
  // ¿Y si quiero ir a UN solo super? Tabla completa estilo MyGroceryPal:
  // tu lista cotizada en TODOS los supers, completos primero.
  const presentes = [...new Set(state.ofertas.map((o) => o.super))];
  const single = [];
  const tabla = [];
  for (const sid of presentes) {
    let total = 0, tiene = 0;
    for (const key of claves) {
      const g = state.idx.byKey.get(key);
      const o = g ? g.items.find((x) => x.super === sid) : null;
      if (o) { total += o.precio; tiene++; }
    }
    if (!tiene) continue;
    const falta = claves.size - tiene;
    tabla.push({ sid, total, tiene, falta });
    if (!falta && total > 0) single.push({ sid, total });
  }
  tabla.sort((a, b) => (a.falta - b.falta) || (a.total - b.total));
  single.sort((a, b) => a.total - b.total);
  if (single.length) {
    html += `<h3>Si preferís ir a un solo lugar…</h3>`;
    for (const { sid, total } of single.slice(0, 3)) {
      const s = superById(sid);
      const extra = total - optimo;
      html += `<div class="reco"><strong>🛒 Todo en ${s.nombre}: ${fmt(total)}</strong>` +
        `${extra > 0 ? `(+${fmt(extra)} vs repartir)` : "(igual que el óptimo 🎉)"}</div>`;
    }
  }
  if (tabla.length > 1) {
    html += `<h3>Tu lista en cada super</h3><div class="tabla-canasta">` +
      tabla.map((t, i) => {
        const s = superById(t.sid);
        return `<div class="fila-canasta${i === 0 ? " mejor" : ""}"><span class="badge" style="background:${s.color}">${s.nombre}</span>` +
          `<span><strong>${fmt(t.total)}</strong> <span class="muted">${t.tiene}/${claves.size}${t.falta ? ` · faltan ${t.falta}` : " · completa 🎉"}</span></span>` +
          `${i === 0 ? `<span class="comp-dif win">gana</span>` : ""}</div>`;
      }).join("") + `</div>`;
  }
  const clavesArr = [...claves];
  const cob = cartDatos(clavesArr);
  if (cob.length) {
    if (!state.cartSuper || !cob.some((c) => c.sid === state.cartSuper)) {
      state.cartSuper = (single.length ? single[0].sid : cob[0].sid);
    }
    html += `<h3>Carrito completo por super</h3>` +
      `<p class="muted">Tu lista entera en cada super, comparada con lo más barato.</p>` +
      `<div class="chips" id="cart-chips">` +
      cob.map((c) => `<button class="chip${c.sid === state.cartSuper ? " active" : ""}" data-cart="${c.sid}">${superById(c.sid).nombre} <span class="n">${c.tiene}/${clavesArr.length}</span></button>`).join("") +
      `</div><div id="cart-detalle">` + cartDetalleHTML(clavesArr, state.cartSuper) + `</div>`;
  }
  box.innerHTML = html;
  box.querySelectorAll("[data-cart]").forEach((b) => {
    b.onclick = () => { state.cartSuper = b.dataset.cart; renderListas(); };
  });
  box.querySelectorAll("[data-del]").forEach((b) => {
    b.onclick = () => { quitar(b.dataset.del); renderBar(); toast("Quitado de la lista"); };
  });
  setAccionesLista(true);
}
function setAccionesLista(hay) {
  for (const id of ["btn-copiar", "btn-wa", "btn-limpiar", "btn-compartir"]) {
    const b = $(id);
    if (b) b.disabled = !hay;
  }
}
// Canasta básica en un toque: agrega lo esencial y muestra
// en qué super conviene comprar cada cosa.
const CANASTA_BASICA = ["yerba", "leche", "pan", "pollo", "fideos", "arroz",
  "aceite", "queso", "tomate", "papa", "shampoo", "detergente"];
function armarCanasta() {
  let agregados = 0;
  for (const q of CANASTA_BASICA) {
    const toks = normTxt(q).split(/\s+/).filter(Boolean);
    const g = [...state.idx.byKey.values()].find((gr) => {
      const hay = normTxt(gr.producto + " " + gr.marca);
      return toks.every((t) => hay.includes(t));
    });
    if (g) { state.lista.push(g.items[0].id); agregados++; }
  }
  guardar();
  renderBar();
  toast(agregados ? `Canasta armada: ${agregados} productos ✅` : "No encontré productos");
}
function metaLink(superId) {
  const m = state.supersMeta.find((s) => s.id === superId);
  return (m && m.web) || "";
}
function textoLista() {
  const lineas = ["SUPERBARATO Córdoba Capital — mi lista óptima"];
  const porSuper = {};
  for (const id of state.lista) {
    const m = mejorDe(id);
    if (!m) continue;
    (porSuper[m.super] = porSuper[m.super] || []).push(m);
  }
  for (const [sid, items] of Object.entries(porSuper)) {
    lineas.push(`\n${superById(sid).nombre}:`);
    for (const o of items) lineas.push(`- ${o.producto} (${o.marca}) ${fmt(o.precio)}`);
  }
  return lineas.join("\n");
}
function fallbackCopy(texto, done) {
  const ta = document.createElement("textarea");
  ta.value = texto;
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); } catch (e) { /* sin portapapeles */ }
  ta.remove();
  done();
}
async function copiarLista() {
  const t = textoLista();
  const done = () => toast("Lista copiada ✅");
  try {
    await navigator.clipboard.writeText(t);
    done();
  } catch (e) {
    fallbackCopy(t, done);
  }
}
function compartirLista() {
  if (!state.lista.length) { toast("Tu lista está vacía"); return; }
  const url = location.origin + location.pathname + "?l=" + btoa(JSON.stringify(state.lista));
  const done = () => toast("Link copiado, compartilo ✅");
  if (navigator.clipboard) navigator.clipboard.writeText(url).then(done).catch(() => fallbackCopy(url, done));
  else fallbackCopy(url, done);
}

function setBusqueda(v) {
  state.busqueda = v;
  state.visibles = 60;
  $("btn-limpiar-busqueda").hidden = !v;
  renderOfertas();
}

async function cargarCatalogo() {
  const idx = await fetch("data/catalogo/index.json").then((r) => {
    if (!r.ok) throw new Error("sin catalogo");
    return r.json();
  });
  state.meta = idx;
  state.supersIdx = idx.supers || [];
  const archivos = idx.supers || [];
  let hechos = 0;
  const total = archivos.length;
  const skele = () => {
    $("ofertas-lista").innerHTML = Array.from({ length: 6 }).map(() =>
      `<div class="card-prod"><div class="emoji">⏳</div><div class="prod-body"><p class="prod-name">Cargando precios… ${hechos}/${total} supers</p></div></div>`).join("");
  };
  skele();
  const partes = await Promise.all(archivos.map(async (s) => {
    try {
      const d = await fetch(`data/catalogo/${s.id}.json`).then((r) => r.json());
      hechos++;
      $("meta-linea").textContent = `Cargando precios… ${hechos}/${total} supers`;
      if (hechos % 2 === 0) skele();
      return (d.items || []).map((o) => ({
        id: `${o.ean}@${s.id}`, ean: o.ean || "", producto: o.producto,
        marca: o.marca || "Varias", categoria: o.categoria || "otros",
        super: s.id, precio: o.precio, precio_lista: o.precio_lista || o.precio,
        promo: !!o.promo, suc: o.suc || 1,
        url_producto: o.url_producto || "", url_tienda: o.url_tienda || "",
        ppu: o.ppu || null, punidad: o.punidad || "",
      }));
    } catch (e) {
      hechos++;
      return [];
    }
  }));
  return partes.flat();
}

async function cargarLegacy() {
  const of = await fetch("data/ofertas.json").then((r) => r.json());
  state.meta = of.meta || {};
  return (of.ofertas || of).map((o) => ({
    id: o.id, ean: "", producto: o.producto, marca: o.marca || "Varias",
    categoria: o.categoria || "otros", super: o.super, precio: o.precio,
    precio_lista: o.precio_lista || o.precio,
    promo: (o.precio_lista || o.precio) > o.precio, suc: 1,
    url_producto: "", url_tienda: "",
  }));
}

async function init() {
  const [supers, cats] = await Promise.all([
    fetch("data/supermercados.json").then((r) => r.json()),
    fetch("data/categorias.json").then((r) => r.json()),
  ]);
  state.supersMeta = supers;
  state.categorias = cats;
  try { state.favs = JSON.parse(localStorage.getItem("superbarato-favs") || "[]"); } catch (e) { state.favs = []; }

  try {
    state.ofertas = await cargarCatalogo();
  } catch (e) {
    state.ofertas = await cargarLegacy();
  }
  buildIndex();

  const sel = $("filtro-super");
  const presentes = [...new Set(state.ofertas.map((o) => o.super))];
  for (const sid of presentes) {
    const s = superById(sid);
    const o = document.createElement("option");
    o.value = sid; o.textContent = `🏪 ${s.nombre}`;
    sel.appendChild(o);
  }
  sel.onchange = () => { state.superFiltro = sel.value; state.visibles = 60; renderOfertas(); };
  $("buscador").addEventListener("input", debounce((e) => {
    setBusqueda(e.target.value.trim());
  }, 200));
  $("btn-limpiar-busqueda").onclick = () => { $("buscador").value = ""; setBusqueda(""); $("buscador").focus(); };
  $("btn-mas").onclick = () => { state.visibles = Math.min(state.visibles + 60, 300); renderOfertas(); };
  $("btn-cerrar-comp").onclick = cerrarComparador;
  $("comparador-modal").addEventListener("click", (e) => {
    if (e.target.id === "comparador-modal") cerrarComparador();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("comparador-modal").hidden) cerrarComparador();
  });

  $("btn-limpiar").onclick = () => { state.lista = []; guardar(); renderBar(); toast("Lista vaciada"); };
  $("btn-canasta").onclick = () => { armarCanasta(); showView("lista"); };
  $("btn-copiar").onclick = copiarLista;
  $("btn-compartir").onclick = compartirLista;
  $("btn-wa").onclick = () => { window.open("https://wa.me/?text=" + encodeURIComponent(textoLista()), "_blank"); };
  $("tab-buscar").onclick = () => showView("buscar");
  $("tab-ofertas").onclick = () => { showView("ofertas"); renderCaza(); };
  $("tab-lista").onclick = () => showView("lista");
  $("tab-mas").onclick = () => showView("mas");
  document.addEventListener("click", (e) => {
    const b = e.target.closest ? e.target.closest("[data-fav]") : null;
    if (b) { e.stopPropagation(); toggleFav(b.dataset.fav); }
  });
  const setOrden = (modo) => {
    state.orden = modo;
    $("ord-precio").classList.toggle("active", modo === "precio");
    $("ord-ppu").classList.toggle("active", modo === "ppu");
    renderOfertas();
  };
  $("ord-precio").onclick = () => setOrden("precio");
  $("ord-ppu").onclick = () => setOrden("ppu");

  renderMeta(); renderTabs(); renderOfertas(); renderRecos(); renderMejor(); renderFuentes(); renderListas(); renderBar(); renderFavs(); checkAlertas(); applyTheme(); showView("buscar");
  try {
    const q = new URLSearchParams(location.search).get("l");
    if (q) {
      const ids = JSON.parse(atob(q));
      if (Array.isArray(ids) && ids.length) {
        state.lista = ids.filter((id) => state.idx.byId.get(id));
        guardar();
        renderBar();
        toast(`Te compartieron ${state.lista.length} productos ✅`);
        showView("lista");
        history.replaceState(null, "", location.pathname);
      }
    }
  } catch (e) { /* link inválido, se ignora */ }
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => {}); });
  }
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    window.__sbInstall = e;
    $("btn-instalar").hidden = false;
  });
  $("btn-instalar").onclick = async () => {
    if (window.__sbInstall) {
      window.__sbInstall.prompt();
      window.__sbInstall = null;
      $("btn-instalar").hidden = true;
    }
  };
  $("btn-tema").onclick = () => {
    const t = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem("superbarato-theme", t);
    applyTheme();
  };
}

init().catch((e) => {
  document.getElementById("meta-linea").textContent = "Error cargando datos: " + e.message;
});
