// SUPERBARATO Córdoba Capital (exclusivo) — frontend estático, sin build.
// Carga data/catalogo/index.json + un JSON por super (catálogo completo).
// Fallback: data/ofertas.json (legacy) si el bot aún no corrió.

const state = {
  supersMeta: [],   // data/supermercados.json (colores, nombres, sucursales)
  supersIdx: [],    // catalogo/index.json -> supers reales con datos
  categorias: [],
  ofertas: [],
  meta: {},
  catActiva: "",
  busqueda: "",
  superFiltro: "",
  comparando: null,
  lista: JSON.parse(localStorage.getItem("superbarato-lista") || "[]"),
};

const $ = (id) => document.getElementById(id);
const fmt = (n) => "$" + Number(n).toLocaleString("es-AR");

function superById(id) {
  return state.supersMeta.find((s) => s.id === id)
    || state.supersIdx.find((s) => s.id === id)
    || { nombre: id, color: "#64748b" };
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function grupoKey(o) {
  return (o.ean ? "E" + o.ean : "N" + (o.producto + "||" + o.marca).toLowerCase());
}

// Agrupa ofertas planas por EAN (o nombre+marca) para comparar entre supers
function grupos() {
  const map = new Map();
  for (const o of state.ofertas) {
    if (state.catActiva && o.categoria !== state.catActiva) continue;
    if (state.superFiltro && o.super !== state.superFiltro) continue;
    if (state.busqueda && !(o.producto + " " + o.marca).toLowerCase().includes(state.busqueda)) continue;
    const key = grupoKey(o);
    if (!map.has(key)) map.set(key, { key, producto: o.producto, marca: o.marca, categoria: o.categoria, items: [] });
    map.get(key).items.push(o);
  }
  for (const g of map.values()) g.items.sort((a, b) => a.precio - b.precio);
  return [...map.values()].sort((a, b) => a.items[0].precio - b.items[0].precio);
}

function renderMeta() {
  const nSupers = new Set(state.ofertas.map((o) => o.super)).size;
  $("meta-linea").textContent =
    `${state.ofertas.length.toLocaleString("es-AR")} precios · ${nSupers} supers · ` +
    `SOLO Córdoba Capital · Actualizado: ${state.meta.actualizado || "?"} · Fuente: ${state.meta.fuente || "?"}`;
}

function renderTabs() {
  const nav = $("tabs-categorias");
  nav.innerHTML = "";
  const presentes = new Set(state.ofertas.map((o) => o.categoria));
  const cats = state.categorias.filter((c) => presentes.has(c.id));
  const todas = [{ id: "", nombre: "Todas", icono: "⭐" }, ...cats];
  for (const c of todas) {
    const b = document.createElement("button");
    b.textContent = `${c.icono || ""} ${c.nombre}`;
    if (c.id === state.catActiva) b.classList.add("active");
    b.onclick = () => { state.catActiva = c.id; renderTabs(); renderOfertas(); };
    nav.appendChild(b);
  }
}

function renderOfertas() {
  const box = $("ofertas-lista");
  const gs = grupos().slice(0, 60);
  if (!gs.length) { box.innerHTML = '<p class="muted">Sin resultados. Probá con otra búsqueda.</p>'; return; }
  box.innerHTML = "";
  for (const g of gs) {
    const mejor = g.items[0];
    const s = superById(mejor.super);
    const div = document.createElement("div");
    div.className = "oferta";
    div.innerHTML = `
      <div>
        <span class="badge" style="background:${s.color}">${s.nombre}</span>
        <strong>${g.producto}</strong> <span class="muted">${g.marca} · ${g.items.length} precios</span><br/>
        <span class="muted">Mejor: ${s.nombre}</span>
      </div>
      <div style="text-align:right">
        <span class="precio">${fmt(mejor.precio)}</span>
        <br/><button class="btn-add" data-add="${mejor.id}">➕ agregar</button>
      </div>`;
    div.onclick = (e) => {
      if (e.target.dataset.add) return;
      state.comparando = g.key;
      renderComparador();
    };
    box.appendChild(div);
  }
  box.querySelectorAll("[data-add]").forEach((b) => {
    b.onclick = () => agregar(b.dataset.add);
  });
}

function gruposTodos() {
  const map = new Map();
  for (const o of state.ofertas) {
    const key = grupoKey(o);
    if (!map.has(key)) map.set(key, { key, producto: o.producto, marca: o.marca, categoria: o.categoria, items: [] });
    map.get(key).items.push(o);
  }
  for (const g of map.values()) g.items.sort((a, b) => a.precio - b.precio);
  return [...map.values()];
}

function renderComparador() {
  const box = $("comparador-detalle");
  if (!state.comparando) return;
  const g = gruposTodos().find((x) => x.key === state.comparando);
  if (!g) { box.innerHTML = '<p class="muted">Producto fuera del filtro actual.</p>'; return; }
  const rows = g.items.map((o, i) => {
    const s = superById(o.super);
    const dif = i === 0 ? "✅ mejor" : `+$${(o.precio - g.items[0].precio).toLocaleString("es-AR")}`;
    return `<tr class="${i === 0 ? "mejor" : ""}"><td><span class="badge" style="background:${s.color}">${s.nombre}</span></td><td><strong>${fmt(o.precio)}</strong></td><td>${dif}</td><td><button class="btn-add" data-add="${o.id}">➕</button></td></tr>`;
  }).join("");
  box.innerHTML = `<h3>${g.producto} <span class="muted">${g.marca}</span></h3>
    <table class="comp"><tr><th>Super</th><th>Precio</th><th>Dif.</th><th></th></tr>${rows}</table>`;
  box.querySelectorAll("[data-add]").forEach((b) => { b.onclick = () => agregar(b.dataset.add); });
}

// Recomendación: por cada categoría, qué super tiene más "mejores precios"
function renderRecos() {
  const wins = {};
  for (const g of gruposTodos()) {
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
    d.innerHTML = `<strong>${c.icono} ${c.nombre}:</strong> conviene <strong>${s.nombre}</strong> (${n} producto${n > 1 ? "s" : ""} más barato${n > 1 ? "s" : ""}, solo capital).`;
    box.appendChild(d);
  }
  if (!box.children.length) box.innerHTML = '<p class="muted">Todavía no hay datos para recomendar.</p>';
}

function renderFuentes() {
  const box = $("fuentes-lista");
  if (!box || !state.supersIdx.length) { if (box) box.innerHTML = '<p class="muted">Datos de ejemplo.</p>'; return; }
  box.innerHTML = state.supersIdx.map((s) => {
    const meta = superById(s.id);
    return `<div class="reco"><span class="badge" style="background:${meta.color || "#64748b"}">${s.nombre}</span> ` +
      `${(s.items ?? 0).toLocaleString("es-AR")} productos · ${s.zona || ""} · cobertura ${s.cobertura || ""}${s.stale ? " · <strong>pendiente de actualizar</strong>" : ""}</div>`;
  }).join("");
}

// ---- Lista de compras: carrito óptimo (mejor precio por producto) ----
function agregar(id) {
  state.lista.push(id);
  guardar();
}
function guardar() {
  localStorage.setItem("superbarato-lista", JSON.stringify(state.lista));
  renderListas();
}
function mejorDe(id) {
  const o = state.ofertas.find((x) => x.id === id);
  if (!o) return null;
  const grupo = gruposTodos().find((g) => g.key === grupoKey(o));
  return grupo ? grupo.items[0] : o;
}
function renderListas() {
  const box = $("listas-detalle");
  if (!state.lista.length) { box.innerHTML = '<p class="muted">Lista vacía. Agregá ofertas con ➕.</p>'; return; }
  const porSuper = {};
  let totalOptimo = 0;
  for (const id of state.lista) {
    const mejor = mejorDe(id);
    if (!mejor) continue;
    porSuper[mejor.super] = porSuper[mejor.super] || { items: [], total: 0 };
    porSuper[mejor.super].items.push(mejor);
    porSuper[mejor.super].total += mejor.precio;
    totalOptimo += mejor.precio;
  }
  let html = `<p><strong>Total óptimo estimado: ${fmt(totalOptimo)}</strong> en ${Object.keys(porSuper).length} super(s) de Córdoba Capital.</p>`;
  for (const [superId, g] of Object.entries(porSuper)) {
    const s = superById(superId);
    html += `<div class="super-grupo"><h3><span class="badge" style="background:${s.color}">${s.nombre}</span> ${fmt(g.total)}</h3><ul>`;
    for (const o of g.items) html += `<li>${o.producto} (${o.marca}) — <strong>${fmt(o.precio)}</strong></li>`;
    html += "</ul></div>";
  }
  box.innerHTML = html;
}

function textoLista() {
  const lineas = ["SUPERBARATO Córdoba Capital — mi lista óptima"];
  const porSuper = {};
  for (const id of state.lista) {
    const mejor = mejorDe(id);
    if (!mejor) continue;
    (porSuper[mejor.super] = porSuper[mejor.super] || []).push(mejor);
  }
  for (const [sid, items] of Object.entries(porSuper)) {
    lineas.push(`\n${superById(sid).nombre}:`);
    for (const o of items) lineas.push(`- ${o.producto} (${o.marca}) ${fmt(o.precio)}`);
  }
  return lineas.join("\n");
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
  const partes = await Promise.all(archivos.map(async (s) => {
    try {
      const d = await fetch(`data/catalogo/${s.id}.json`).then((r) => r.json());
      hechos++;
      $("meta-linea").textContent = `Cargando catálogo de Córdoba Capital… ${hechos}/${archivos.length} supers`;
      return (d.items || []).map((o) => ({
        id: `${o.ean}@${s.id}`, ean: o.ean || "", producto: o.producto,
        marca: o.marca || "Varias", categoria: o.categoria || "otros",
        super: s.id, precio: o.precio, precio_lista: o.precio_lista || o.precio,
        promo: !!o.promo, suc: o.suc || 1,
      }));
    } catch (e) {
      console.warn("sin datos de", s.id);
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

  const sel = $("filtro-super");
  const presentes = [...new Set(state.ofertas.map((o) => o.super))];
  for (const sid of presentes) {
    const s = superById(sid);
    const o = document.createElement("option");
    o.value = sid; o.textContent = s.nombre;
    sel.appendChild(o);
  }
  sel.onchange = () => { state.superFiltro = sel.value; renderOfertas(); };
  $("buscador").addEventListener("input", debounce((e) => {
    state.busqueda = e.target.value.toLowerCase().trim();
    renderOfertas();
  }, 250));

  $("btn-limpiar").onclick = () => { state.lista = []; guardar(); };
  $("btn-optima").onclick = () => { renderListas(); document.getElementById("listas").scrollIntoView({ behavior: "smooth" }); };
  $("btn-copiar").onclick = async () => { await navigator.clipboard.writeText(textoLista()); alert("Lista copiada ✅"); };
  $("btn-wa").onclick = () => { window.open("https://wa.me/?text=" + encodeURIComponent(textoLista()), "_blank"); };

  renderMeta(); renderTabs(); renderOfertas(); renderRecos(); renderFuentes(); renderListas();
}

init().catch((e) => {
  document.getElementById("meta-linea").textContent = "Error cargando datos: " + e.message;
});
