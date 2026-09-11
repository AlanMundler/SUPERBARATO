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
  return (o.ean ? "E" + o.ean : "N" + normTxt(o.producto + "||" + o.marca));
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
  out.sort((a, b) => a.items[0].precio - b.items[0].precio);
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
      <button class="btn-add" data-add="${mejor.id}" aria-label="Agregar ${g.producto} a mi lista">➕</button>
      ${link ? `<a class="link-btn" href="${link}" target="_blank" rel="noopener">🔗 Ver</a>` : ""}
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
        if (e.target.closest("[data-add]") || e.target.closest("a")) return;
        state.comparando = g.key;
        renderComparador(true);
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

function renderComparador(scroll) {
  const panel = $("comparador-panel");
  const box = $("comparador-detalle");
  if (!state.comparando) { panel.hidden = true; return; }
  const g = state.idx.byKey.get(state.comparando);
  if (!g) { panel.hidden = true; return; }
  panel.hidden = false;
  box.innerHTML = `<h3>${g.producto} <span class="muted">${g.marca}</span></h3>` + g.items.map((o, i) => {
    const s = superById(o.super);
    const dif = i === 0 ? "✅ mejor precio" : `+$${(o.precio - g.items[0].precio).toLocaleString("es-AR")}`;
    const link = o.url_producto || o.url_tienda;
    return `<div class="comp-row${i === 0 ? " mejor" : ""}">
      <span class="badge" style="background:${s.color}">${s.nombre}</span>
      <span class="precio">${fmt(o.precio)}</span>
      <span class="comp-dif${i === 0 ? " win" : ""}">${dif}</span>
      <span class="comp-actions">
        ${link ? `<a class="link-btn" href="${link}" target="_blank" rel="noopener">🔗 Ver</a>` : ""}
        <button class="btn-add" data-add="${o.id}" aria-label="Agregar de ${s.nombre}">➕</button>
      </span></div>`;
  }).join("");
  box.querySelectorAll("[data-add]").forEach((b) => {
    b.onclick = () => agregar(b.dataset.add);
  });
  if (scroll) {
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    panel.classList.remove("flash");
    void panel.offsetWidth;
    panel.classList.add("flash");
  }
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
    d.innerHTML = `<strong>${c.icono} ${c.nombre}</strong>Conviene <strong>${s.nombre}</strong> · ${Number(n).toLocaleString("es-AR")} más baratos`;
    box.appendChild(d);
  }
  if (!box.children.length) box.innerHTML = '<p class="muted">Todavía no hay datos para recomendar.</p>';
}

function renderFuentes() {
  const box = $("fuentes-lista");
  if (!box || !state.supersIdx.length) { if (box) box.innerHTML = '<p class="muted">Datos de ejemplo.</p>'; return; }
  box.innerHTML = state.supersIdx.map((s) => {
    const meta = superById(s.id);
    return `<div class="fuente-row"><span class="badge" style="background:${meta.color || "#6f6e63"}">${s.nombre}</span> ` +
      `${(s.items ?? 0).toLocaleString("es-AR")} productos · ${s.zona || ""} · ${s.cobertura || ""}${s.stale ? " · <strong>pendiente de actualizar</strong>" : ""}</div>`;
  }).join("");
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
  const bar = $("lista-bar");
  if (!state.lista.length) { bar.hidden = true; return; }
  let total = 0, n = 0;
  for (const id of state.lista) {
    const m = mejorDe(id);
    if (m) { total += m.precio; n++; }
  }
  bar.hidden = false;
  $("lista-bar-total").textContent = `${n} · ${fmt(total)}`;
}
function renderListas() {
  const box = $("listas-detalle");
  if (!state.lista.length) {
    box.innerHTML = '<p class="muted">Todavía vacía. Buscá algo arriba y tocá ➕.</p>';
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
  // ¿Y si quiero ir a UN solo super? Ranking de los que tienen TODO lo de mi lista
  const presentes = [...new Set(state.ofertas.map((o) => o.super))];
  const single = [];
  for (const sid of presentes) {
    let total = 0, falta = 0;
    for (const key of claves) {
      const g = state.idx.byKey.get(key);
      const o = g ? g.items.find((x) => x.super === sid) : null;
      if (o) total += o.precio;
      else falta++;
    }
    if (!falta && total > 0) single.push({ sid, total });
  }
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
  box.innerHTML = html;
  box.querySelectorAll("[data-del]").forEach((b) => {
    b.onclick = () => { quitar(b.dataset.del); renderBar(); toast("Quitado de la lista"); };
  });
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
  document.getElementById("listas").scrollIntoView({ behavior: "smooth" });
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
async function copiarLista() {
  const t = textoLista();
  try {
    await navigator.clipboard.writeText(t);
  } catch (e) {
    const ta = document.createElement("textarea");
    ta.value = t;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  toast("Lista copiada ✅");
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
  $("btn-mas").onclick = () => { state.visibles += 60; renderOfertas(); };
  $("btn-cerrar-comp").onclick = () => { state.comparando = null; renderComparador(false); };

  $("btn-limpiar").onclick = () => { state.lista = []; guardar(); renderBar(); toast("Lista vaciada"); };
  $("btn-canasta").onclick = armarCanasta;
  $("btn-copiar").onclick = copiarLista;
  $("btn-wa").onclick = () => { window.open("https://wa.me/?text=" + encodeURIComponent(textoLista()), "_blank"); };
  $("lista-bar").onclick = () => { document.getElementById("listas").scrollIntoView({ behavior: "smooth" }); };

  renderMeta(); renderTabs(); renderOfertas(); renderRecos(); renderFuentes(); renderListas(); renderBar();
}

init().catch((e) => {
  document.getElementById("meta-linea").textContent = "Error cargando datos: " + e.message;
});
