// SUPERBARATO Córdoba — frontend estático (GitHub Pages, sin build)
// Patrones: composición simple, debounce en búsqueda, carrito óptimo por mejor precio.

const state = {
  supers: [],
  categorias: [],
  ofertas: [],
  meta: {},
  catActiva: "",
  busqueda: "",
  superFiltro: "",
  comparando: null,
  lista: JSON.parse(localStorage.getItem("superbarato-lista") || "[]"), // [ofertaId]
};

const $ = (id) => document.getElementById(id);
const fmt = (n) => "$" + Number(n).toLocaleString("es-AR");
const superById = (id) => state.supers.find((s) => s.id === id) || { nombre: id, color: "#666" };

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// Agrupa ofertas planas por producto+marca normalizado
function grupos() {
  const map = new Map();
  for (const o of state.ofertas) {
    if (state.catActiva && o.categoria !== state.catActiva) continue;
    if (state.superFiltro && o.super !== state.superFiltro) continue;
    if (state.busqueda && !(o.producto + " " + o.marca).toLowerCase().includes(state.busqueda)) continue;
    const key = o.producto + "||" + o.marca;
    if (!map.has(key)) map.set(key, { producto: o.producto, marca: o.marca, categoria: o.categoria, items: [] });
    map.get(key).items.push(o);
  }
  for (const g of map.values()) g.items.sort((a, b) => a.precio - b.precio);
  return [...map.values()].sort((a, b) => descuentoMax(b) - descuentoMax(a));
}

function descuentoMax(g) {
  return Math.max(...g.items.map((o) => (o.precio_lista > o.precio ? (o.precio_lista - o.precio) / o.precio_lista : 0)));
}

function renderMeta() {
  const total = state.ofertas.length;
  $("meta-linea").textContent =
    `${total} precios · ${state.supers.length} supers · Zona Córdoba Capital · Actualizado: ${state.meta.actualizado || "?"} · Fuente: ${state.meta.fuente || "?"}`;
}

function renderTabs() {
  const nav = $("tabs-categorias");
  nav.innerHTML = "";
  const todas = [{ id: "", nombre: "Todas", icono: "⭐" }, ...state.categorias];
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
    const dto = mejor.precio_lista > mejor.precio
      ? Math.round((mejor.precio_lista - mejor.precio) / mejor.precio_lista * 100) : 0;
    const div = document.createElement("div");
    div.className = "oferta";
    div.innerHTML = `
      <div>
        <span class="badge" style="background:${s.color}">${s.nombre}</span>
        <strong>${g.producto}</strong> <span class="muted">${g.marca} · ${g.items.length} precios</span><br/>
        <span class="ahorro">${dto ? `−${dto}% · ` : ""}Mejor: ${s.nombre}</span>
      </div>
      <div style="text-align:right">
        <span class="precio">${fmt(mejor.precio)}</span>
        ${mejor.precio_lista > mejor.precio ? `<span class="tachado">${fmt(mejor.precio_lista)}</span>` : ""}
        <br/><button class="btn-add" data-add="${mejor.id}">➕ agregar</button>
      </div>`;
    div.onclick = (e) => {
      if (e.target.dataset.add) return; // el botón agrega, no compara
      state.comparando = g.producto + "||" + g.marca;
      renderComparador();
    };
    box.appendChild(div);
  }
  box.querySelectorAll("[data-add]").forEach((b) => {
    b.onclick = () => agregar(b.dataset.add);
  });
}

function renderComparador() {
  const box = $("comparador-detalle");
  if (!state.comparando) return;
  const g = grupos().find((x) => x.producto + "||" + x.marca === state.comparando)
    || gruposTodos().find((x) => x.producto + "||" + x.marca === state.comparando);
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

function gruposTodos() {
  const map = new Map();
  for (const o of state.ofertas) {
    const key = o.producto + "||" + o.marca;
    if (!map.has(key)) map.set(key, { producto: o.producto, marca: o.marca, categoria: o.categoria, items: [] });
    map.get(key).items.push(o);
  }
  for (const g of map.values()) g.items.sort((a, b) => a.precio - b.precio);
  return [...map.values()];
}

// Recomendación: por cada categoría, qué super tiene más "mejores precios"
function renderRecos() {
  const wins = {}; // cat -> {super: count}
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
    d.innerHTML = `<strong>${c.icono} ${c.nombre}:</strong> conviene <strong>${s.nombre}</strong> (${n} producto${n > 1 ? "s" : ""} más barato${n > 1 ? "s" : ""}).`;
    box.appendChild(d);
  }
  if (!box.children.length) box.innerHTML = '<p class="muted">Todavía no hay datos para recomendar.</p>';
}

// ---- Lista de compras: carrito óptimo ----
function agregar(id) {
  state.lista.push(id);
  guardar();
}
function guardar() {
  localStorage.setItem("superbarato-lista", JSON.stringify(state.lista));
  renderListas();
}
function renderListas() {
  const box = $("listas-detalle");
  if (!state.lista.length) { box.innerHTML = '<p class="muted">Lista vacía. Agregá ofertas con ➕.</p>'; return; }
  const porSuper = {};
  let totalOptimo = 0;
  for (const id of state.lista) {
    const o = state.ofertas.find((x) => x.id === id);
    if (!o) continue;
    // carrito óptimo: si el producto existe más barato en otro super, sugerir el mejor
    const grupo = gruposTodos().find((g) => g.producto === o.producto && g.marca === o.marca);
    const mejor = grupo ? grupo.items[0] : o;
    porSuper[mejor.super] = porSuper[mejor.super] || { items: [], total: 0 };
    porSuper[mejor.super].items.push(mejor);
    porSuper[mejor.super].total += mejor.precio;
    totalOptimo += mejor.precio;
  }
  let html = `<p><strong>Total óptimo estimado: ${fmt(totalOptimo)}</strong> en ${Object.keys(porSuper).length} super(s). Ir a un solo super suele costar más: lo óptimo es dividir.</p>`;
  for (const [superId, g] of Object.entries(porSuper)) {
    const s = superById(superId);
    html += `<div class="super-grupo"><h3><span class="badge" style="background:${s.color}">${s.nombre}</span> ${fmt(g.total)}</h3><ul>`;
    for (const o of g.items) html += `<li>${o.producto} (${o.marca}) — <strong>${fmt(o.precio)}</strong></li>`;
    html += "</ul></div>";
  }
  box.innerHTML = html;
}

function textoLista() {
  const lineas = ["SUPERBARATO Córdoba — mi lista óptima"];
  const porSuper = {};
  for (const id of state.lista) {
    const o = state.ofertas.find((x) => x.id === id);
    if (!o) continue;
    const grupo = gruposTodos().find((g) => g.producto === o.producto && g.marca === o.marca);
    const mejor = grupo ? grupo.items[0] : o;
    (porSuper[mejor.super] = porSuper[mejor.super] || []).push(mejor);
  }
  for (const [sid, items] of Object.entries(porSuper)) {
    lineas.push(`\n${superById(sid).nombre}:`);
    for (const o of items) lineas.push(`- ${o.producto} (${o.marca}) ${fmt(o.precio)}`);
  }
  return lineas.join("\n");
}

async function init() {
  const [supers, cats, of] = await Promise.all([
    fetch("data/supermercados.json").then((r) => r.json()),
    fetch("data/categorias.json").then((r) => r.json()),
    fetch("data/ofertas.json").then((r) => r.json()),
  ]);
  state.supers = supers;
  state.categorias = cats;
  state.ofertas = of.ofertas || of;
  state.meta = of.meta || {};

  const sel = $("filtro-super");
  for (const s of supers) {
    const o = document.createElement("option");
    o.value = s.id; o.textContent = s.nombre;
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

  renderMeta(); renderTabs(); renderOfertas(); renderRecos(); renderListas();
}

init().catch((e) => {
  document.getElementById("meta-linea").textContent = "Error cargando datos: " + e.message;
});
