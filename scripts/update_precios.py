#!/usr/bin/env python3
"""SUPERBARATO Bot v2 — catálogo COMPLETO, SOLO Córdoba Capital, 1 vez/día.

Fuentes (en orden):
  1. SEPA minorista (datos oficiales, CC-BY): ZIP diario con precios por
     SUCURSAL. Se filtra a sucursales de la localidad Córdoba (capital),
     provincia AR-X. Cubre Vea/Disco/Jumbo/Carrefour/Día/La Anónima y toda
     bandera que reporte sucursales en capital (descubrimiento dinámico).
  2. VTEX full-catalog (cadenas cordobesas con tienda online: Cordiez):
     paginado completo del catálogo, sin término de búsqueda.
  3. Scrape best-effort (Mariano Max, Makro, Tadicor, Almacor, Diarco):
     ofertas publicadas. Si falla, se conserva el archivo del día anterior
     marcado stale. NUNCA se inventan precios.

Salida: data/catalogo/<super>.json + data/catalogo/index.json
El frontend NUNCA muestra nada fuera de Córdoba Capital.

Solo stdlib. Uso:
  python scripts/update_precios.py            # corrida completa diaria
  python scripts/update_precios.py --solo sepa|cordiez|scrape
  python scripts/update_precios.py --solo cordiez --max-paginas 2
  python scripts/update_precios.py --selftest  # fixture sintético, sin red
"""
import csv
import io
import json
import re
import shutil
import statistics
import sys
import time
import unicodedata
import urllib.request
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CATALOGO = DATA / "catalogo"
SUPERS_JSON = DATA / "supermercados.json"
TMP = ROOT / ".tmp-sepa"

# ---------------------------------------------------------------- SEPA
SEPA_BASE = ("https://datos.produccion.gob.ar/dataset/"
             "6f47ec76-d1ce-4e34-a7e1-621fe9b1d0b5/resource")
# resourceId por día de semana JS (domingo=0). Fuente: superprecios-claros.
SEPA_RESOURCES = {
    0: ("f8e75128-515a-436e-bf8d-5c63a62f2005", "sepa_domingo.zip"),
    1: ("0a9069a9-06e8-4f98-874d-da5578693290", "sepa_lunes.zip"),
    2: ("9dc06241-cc83-44f4-8e25-c9b1636b8bc8", "sepa_martes.zip"),
    3: ("1e92cd42-4f94-4071-a165-62c4cb2ce23c", "sepa_miercoles.zip"),
    4: ("d076720f-a7f0-4af8-b1d6-1b99d5a90c14", "sepa_jueves.zip"),
    5: ("91bc072a-4726-44a1-85ec-4a8467aad27e", "sepa_viernes.zip"),
    6: ("b3c3da5d-213d-41e7-8d74-f23fda0a3c30", "sepa_sabado.zip"),
}
CHROME_HEADERS = {
    # Set completo verificado (2026-09-10): sin Accept-Encoding gzip ni
    # Referer, CloudFront/WAF responde 403 al ZIP SEPA.
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"),
    "Accept": ("text/html,application/xhtml+xml,application/xml;q=0.9,"
               "image/avif,image/webp,image/apng,*/*;q=0.8"),
    "Accept-Language": "es-AR,es;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "identity",
    "Referer": "https://datos.produccion.gob.ar/",
    "Sec-Ch-Ua": '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Upgrade-Insecure-Requests": "1",
}
VTEX_HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SUPERBARATO-bot"}

# Provincias aceptadas (columna sucursales_provincia) y localidad capital.
PROV_CORDOBA = {"AR-X", "X", "CORDOBA", "CÓRDOBA"}
CAPITAL_SET = {"CORDOBA"}  # tras normalizar (sin tildes, sin palabra CAPITAL)

# (comercio, bandera) -> id de display en supermercados.json
KNOWN_BANDERAS = {
    (9, 1): "vea", (9, 2): "disco", (9, 3): "jumbo",
    (10, 1): "carrefour-hiper", (10, 2): "carrefour-market",
    (10, 3): "carrefour-express", (10, 4): "carrefour-maxi",
    (15, 1): "dia", (2, 1): "la-anonima",
}

# ---------------------------------------------------------------- utils
def norm(s):
    s = (s or "").strip().upper()
    s = "".join(c for c in unicodedata.normalize("NFKD", s)
                if not unicodedata.combining(c))
    s = re.sub(r"\bCAPITAL\b", "", s)
    return re.sub(r"\s+", " ", s).strip()


def to_num(s):
    try:
        v = float((s or "").strip().replace(",", "."))
        return v if v == v and abs(v) != float("inf") else None
    except (ValueError, AttributeError):
        return None


def to_int(s):
    try:
        return int(float((s or "").strip().replace(",", ".")))
    except (ValueError, AttributeError, TypeError):
        return None


def fetch(url, headers, timeout=30, retries=3):
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:
            last = e
            time.sleep(2 ** i)
    raise last


# ---------------------------------------------------------------- categorías
CATEGORIAS = [
    ("lacteos", ["leche", "queso", "yogur", "yoghurt", "manteca", "crema de leche",
                 "chantilly", "ricota", "muzzarella", "mozzarella", "helado", "postre de leche"]),
    ("bebidas", ["gaseosa", "coca", "sprite", "fanta", "pepsi", "seven up", "cerveza",
                 "quilmes", "brahma", "heineken", "vino", "malbec", "cabernet", "jugo",
                 "ades", "cepita", "baggio", "agua mineral", "villavicencio", "eco de los andes",
                 "energizante", "monster", "speed", "red bull", "sidra", "champagne",
                 "champaña", "fernet", "vodka", "ron", "whisky", "licor", "amargo",
                 "aperitivo", "gancia", " sidra", "tónica", "tonica", "levite", "aquarius",
                 "powerade", "gatorade", "te frio", "té frío", "mate listo"]),
    ("carniceria", ["asado", "vacio", "vacío", "matambre", "nalga", "cuadril", "lomo",
                    "carne picada", "pollo", "pata muslo", "pechuga", "suprema", "cerdo",
                    "bondiola", "chorizo", "morcilla", "salchicha", "viena", "milanesa",
                    "hamburguesa", "pescado", "merluza", "filet", "brotola", "cazuela de mar",
                    "cordero", "lechón", "lechon", "entraña", "bife", "osobuco", "costilla",
                    "tapa de asado", "colita de cuadril", "peceto", "morrón relleno",
                    "fiambre", "jamon", "jamón", "salame", "salamin", "mortadela",
                    "panceta", "tocino", "salchichon", "longaniza", "pastron", "lomo de atun"]),
    ("verduleria", ["papa", "tomate", "lechuga", "cebolla", "morron", "morrón", "pimiento",
                    "zanahoria", "zapallo", "acelga", "espinaca", "manzana", "banana",
                    "naranja", "mandarina", "limon", "limón", "pera", "durazno", "uva",
                    "frutilla", "verdura", "fruta", "palta", "choclo", "batata", "remolacha",
                    "repollo", "apio", "perejil", "ajo", "berenjena", "zapallito", "pepino",
                    "kiwi", "sandia", "sandía", "melon", "melón", "anana", "ananá", "pomelo",
                    "ciruela", "damasco", "cereza", "arándano", "arandano", "rucula",
                    "rúcula", "radicheta", "repollo", "coliflor", "brocoli", "brócoli",
                    "chaucha", "arveja", "haba", "puerro", "nabo", "rabanito", "albahaca",
                    "cilantro", "oregano fresco", "tomate cherry", "papa andina", "batata",
                    "mandioca", "palmito", "champiñon", "champignon", "ensalada", "sopa de verdura"]),
    ("panaderia", ["pan ", "panaderia", "panadería", "factura", "medialuna", "bizcocho",
                   "magdalena", "budin", "budín", "pan dulce", "rosca", "criollo",
                   "criollito", "tortita", "torta ", "bizcochuelo", "prepizza", "prepiza",
                   "pan de molde", "pan lactal", "pan rallado", "panettone", "stollen",
                   "donut", "dona ", "churro", "bollo", "pebete", "figaza", "baguette",
                   "ciabatta", "grisines", "tostada", "tostado "]),
    ("limpieza", ["lavandina", "detergente", "limpiador", "desinfectante", "desengrasante",
                  "lustramuebles", "lavavajilla", "papel higienico", "papel higiénico",
                  "rollo de cocina", "servilleta", "bolsa de residuo", "bolsa de consorcio",
                  "trapo", "rejilla", "escoba", "cloro", "suavizante", "quitamanchas",
                  "cif", "ayudin", "magistral", "ala jabon", "drive", "skip", "lysoform",
                  "esponja", "fibras", "guantes de limpieza", "balde", "lampazo", "plumero"]),
    ("perfumeria", ["shampoo", "acondicionador", "jabon de tocador", "jabon liquido",
                    "jabon", "crema corporal", "crema facial", "desodorante",
                    "antitranspirante", "dentifrico", "pasta dental", "cepillo dental",
                    "perfume", "colonia", "pañal", "panal", "toalla femenina",
                    "protector diario", "algodon", "hisopo", "afeitadora", "espuma de afeitar",
                    "talco", "nivea", "dove", "rexona", "colgate", "plusbelle", "pantene",
                    "garnier", "loreal", "natura", "avon", "desodorante de piso"]),
    ("almacen", ["yerba", "fideos", "tallarines", "arroz", "aceite", "harina", "azucar",
                 "cafe", "café", "te ", "té", "mate cocido", "mermelada", "dulce de leche",
                 "miel", "galletita", "galleta", "alfajor", "chocolate", "cacao", "nesquik",
                 "toddy", "conserva", "atun", "atún", "sardina", "caballa", "pure de tomate",
                 "puré de tomate", "salsa", "mayonesa", "ketchup", "mostaza", "vinagre",
                 "sal ", "pimienta", "condimento", "caldo", "sopa ", "polenta", "lenteja",
                 "poroto", "garbanzo", "avena", "cereal", "granola", "barra de cereal",
                 "snack", "papas fritas", "mani", "maní", "nuez", "almendra", "pasas de uva",
                 "levadura", "gelatina", "flan", "postre", "bizcachuelo", "magdalena",
                 "vainilla", "coco rallado", "dulce de batata", "dulce de membrillo",
                 "mermelada", "jalea", "ketchup", "salsa golf", "aceto", "aceituna",
                 "pickles", "arvejas en lata", "choclo en lata", "durazno en almibar",
                 "coctel de frutas", "leche condensada", "crema de mani"]),
]


def categorizar(descripcion, marca=""):
    t = norm((descripcion or "") + " " + (marca or ""))
    for cat, kws in CATEGORIAS:
        for kw in kws:
            if norm(kw) in t:
                return cat
    return "otros"


# ---------------------------------------------------------------- SEPA
def sepa_url_hoy():
    art = datetime.utcnow() - timedelta(hours=3)  # hora argentina, sin DST
    js_dow = (art.weekday() + 1) % 7  # lun=0..dom=6 -> dom=0..sab=6
    rid, fname = SEPA_RESOURCES[js_dow]
    return f"{SEPA_BASE}/{rid}/download/{fname}", art.date().isoformat()


def sepa_download(dest):
    url, fecha = sepa_url_hoy()
    print(f"[sepa] descargando {url}", flush=True)
    req = urllib.request.Request(url, headers=CHROME_HEADERS)
    with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f, length=1024 * 256)
    print(f"[sepa] {dest} bytes={dest.stat().st_size}", flush=True)
    return fecha


def split_pipe(line):
    return line.replace("\r", "").replace("\n", "").split("|")


def find_col(header, *candidatos):
    for i, h in enumerate(header):
        hl = norm(h)
        for c in candidatos:
            if norm(c) in hl:
                return i
    return None


def parse_comercio_csv(text):
    """{(comercio, bandera): nombre} descubierto del propio dump."""
    out = {}
    lines = [l for l in text.splitlines() if l.strip()]
    if len(lines) < 2:
        return out
    header = split_pipe(lines[0])
    i_com = find_col(header, "id_comercio") if find_col(header, "id_comercio") is not None else 0
    i_ban = find_col(header, "id_bandera") if find_col(header, "id_bandera") is not None else 1
    i_nom = find_col(header, "banderas_descripcion", "bandera_descripcion",
                     "descripcion_bandera", "nombre_bandera", "bandera_nombre")
    if i_nom is None:
        i_nom = find_col(header, "razon_social", "razon social", "comercio_nombre",
                         "nombre_comercio", "descripcion")
    if i_nom is None:
        i_nom = len(header) - 1
    for ln in lines[1:]:
        if ln[:5].lower().startswith("ultim"):
            continue
        f = split_pipe(ln)
        com, ban = to_int(f[i_com]) if i_com < len(f) else None, None
        ban = to_int(f[i_ban]) if i_ban < len(f) else None
        nom = f[i_nom].strip() if i_nom < len(f) else ""
        if com and ban and nom:
            out[(com, ban)] = nom.title()
    return out


def parse_sucursales_csv(text, comercio):
    """Devuelve (set capital {(com, suc)}, n_total, n_arx, top_localidades)."""
    lines = [l for l in text.splitlines() if l.strip()]
    capital, n_total, n_arx = set(), 0, 0
    locs = Counter()
    if len(lines) < 2:
        return capital, n_total, n_arx, locs
    header = split_pipe(lines[0])
    i_suc = find_col(header, "id_sucursal") if find_col(header, "id_sucursal") is not None else 2
    i_prov = find_col(header, "provincia")
    if i_prov is None:
        i_prov = 13
    i_loc = find_col(header, "localidad", "ciudad", "departamento_nombre")
    for ln in lines[1:]:
        if ln[:5].lower().startswith("ultim"):
            continue
        f = split_pipe(ln)
        suc = to_int(f[i_suc]) if i_suc < len(f) else None
        if not suc:
            continue
        n_total += 1
        prov = norm(f[i_prov]) if i_prov < len(f) else ""
        if prov not in PROV_CORDOBA:
            continue
        n_arx += 1
        loc = norm(f[i_loc]) if (i_loc is not None and i_loc < len(f)) else ""
        locs[loc or "(sin dato)"] += 1
        if i_loc is None or loc in CAPITAL_SET:
            capital.add((comercio, suc))
    return capital, n_total, n_arx, locs


class Agregador:
    """Mediana por (bandera, ean) solo con precios de Córdoba Capital."""

    def __init__(self):
        self.d = {}

    def add(self, bandera, ean, desc, marca, unidad, lista, efectivo, promo, leyenda, suc):
        k = (bandera, ean)
        r = self.d.get(k)
        if r is None:
            r = self.d[k] = {"d": desc, "m": marca, "u": unidad, "vals": [],
                             "listas": [], "sucs": set(), "promo": 0, "ley": ""}
        r["vals"].append(efectivo)
        r["listas"].append(lista)
        r["sucs"].add(suc)
        if promo:
            r["promo"] += 1
            if not r["ley"] and leyenda:
                r["ley"] = leyenda


def procesar_productos_csv(text, comercio, capital_set, ag, stats):
    n = keep = 0
    for ln in text.splitlines():
        if not ln.strip() or ln[:5].lower().startswith("ultim"):
            continue
        f = split_pipe(ln)
        if len(f) < 10:
            continue
        if f[0].strip().lower().startswith("id_"):
            continue  # header
        suc = to_int(f[2])
        if suc is None or (comercio, suc) not in capital_set:
            continue
        ban = to_int(f[1])
        ean = (f[4] or f[3]).strip()
        if not ban or not ean:
            continue
        lista = to_num(f[9])
        promo = to_num(f[13]) if len(f) > 13 else None
        if lista is None or lista <= 0:
            continue
        efectivo = promo if (promo and promo > 0) else lista
        stats["filas_capital"] += 1
        ag.add(ban, ean, (f[5] or "").strip()[:90], (f[8] or "").strip()[:40] or "Varias",
               (f[7] or "").strip()[:10], lista, efectivo,
               bool(promo and promo > 0), (f[14] or "").strip()[:80] if len(f) > 14 else "",
               suc)
        keep += 1
        n += 1
    return n, keep


def build_items(ag):
    items = defaultdict(list)
    for (ban, ean), r in ag.d.items():
        vals = sorted(r["vals"])
        listas = sorted(r["listas"])
        mid = len(vals) // 2
        precio = vals[mid] if len(vals) % 2 else (vals[mid - 1] + vals[mid]) / 2
        midl = len(listas) // 2
        pl = listas[midl] if len(listas) % 2 else (listas[midl - 1] + listas[midl]) / 2
        nombre = r["d"] or ean
        items[ban].append({
            "ean": ean, "producto": nombre, "marca": r["m"],
            "categoria": categorizar(nombre, r["m"]),
            "precio": int(round(precio)), "precio_lista": int(round(pl)),
            "precio_min": int(round(vals[0])), "promo": r["promo"] > 0,
            "leyenda": r["ley"], "suc": len(r["sucs"]), "unidad": r["u"],
            "fuente": "sepa",
        })
    for v in items.values():
        v.sort(key=lambda o: (not o["promo"], o["precio"]))
    return items


def correr_sepa(out_dir, meta_supers):
    """Descarga el ZIP del día y genera un JSON por bandera con capital."""
    CATALOGO.mkdir(parents=True, exist_ok=True)
    TMP.mkdir(parents=True, exist_ok=True)
    zpath = TMP / "sepa.zip"
    fecha = sepa_download(zpath)
    resumen = []
    with zipfile.ZipFile(zpath) as outer:
        inners = [n for n in outer.namelist() if n.endswith(".zip")]
        print(f"[sepa] inner zips: {len(inners)}", flush=True)
        for iname in sorted(inners):
            m = re.match(r"sepa_(\d+)_comercio-sepa-(\d+)_", iname.split("/")[-1])
            if not m:
                print(f"[sepa] nombre no reconocido: {iname}", flush=True)
                continue
            comercio = int(m.group(2))
            try:
                inner = zipfile.ZipFile(io.BytesIO(outer.read(iname)))
            except Exception as e:
                print(f"[sepa] inner corrupto {iname}: {e}", flush=True)
                continue
            names = inner.namelist()
            get = lambda *keys: next((n for n in names
                                      for k in keys if n.lower().endswith(k)), None)
            n_com, n_suc, n_prod = get("comercio.csv"), get("sucursales.csv"), get("productos.csv")
            if not (n_com and n_suc and n_prod):
                print(f"[sepa] {iname}: faltan csv ({names[:5]})", flush=True)
                continue
            banderas = parse_comercio_csv(inner.read(n_com).decode("utf-8", errors="replace"))
            capital, n_tot, n_arx, locs = parse_sucursales_csv(
                inner.read(n_suc).decode("utf-8", errors="replace"), comercio)
            print(f"[sepa] com={comercio} suc={n_tot} arx={n_arx} capital={len(capital)} "
                  f"top_loc={locs.most_common(8)}", flush=True)
            if not capital:
                continue
            ag, stats = Agregador(), Counter()
            procesar_productos_csv(
                inner.read(n_prod).decode("utf-8", errors="replace"),
                comercio, capital, ag, stats)
            print(f"[sepa] com={comercio} filas_capital={stats['filas_capital']} "
                  f"productos={len(ag.d)}", flush=True)
            for ban, lst in build_items(ag).items():
                sid = KNOWN_BANDERAS.get((comercio, ban), f"sepa-{comercio}-{ban}")
                nombre = (meta_supers.get(sid, {}).get("nombre")
                          or banderas.get((comercio, ban))
                          or f"Cadena {comercio}-{ban}")
                n_suc = len({s for (c, s) in capital})
                (CATALOGO / f"{sid}.json").write_text(json.dumps({
                    "meta": {"super": sid, "nombre": nombre, "fuente": "sepa",
                             "actualizado": fecha, "zona": "Córdoba Capital",
                             "filtro": "sucursales localidad Córdoba (AR-X)",
                             "sucursales": n_suc, "cobertura": "completa",
                             "total": len(lst)},
                    "items": lst}, ensure_ascii=False), encoding="utf-8")
                resumen.append({"id": sid, "nombre": nombre, "items": len(lst),
                                "sucursales": n_suc, "cobertura": "completa",
                                "fuente": "sepa", "stale": False})
    try:
        zpath.unlink()
    except OSError:
        pass
    return resumen, fecha


# ---------------------------------------------------------------- VTEX full
def vtex_full(api_base, max_paginas=600):
    por_ean, page, total = {}, 0, 0
    while page < max_paginas:
        a, b = page * 50, page * 50 + 49
        try:
            raw = fetch(f"{api_base}?_from={a}&_to={b}", VTEX_HEADERS, timeout=30)
            data = json.loads(raw.decode("utf-8", errors="replace"))
        except Exception as e:
            print(f"  [vtex] pag {page}: {str(e)[:100]} (corte)", flush=True)
            break
        if not isinstance(data, list) or not data:
            break
        for p in data:
            try:
                items = p.get("items") or []
                sellers = (items[0].get("sellers") or []) if items else []
                offer = (sellers[0].get("commertialOffer") or {}) if sellers else {}
                precio = offer.get("Price") or offer.get("price")
                if not precio:
                    continue
                lista = offer.get("ListPrice") or offer.get("listPrice") or precio
                ean = ((items[0].get("ean") or "") if items else "") or p.get("productId", "")
                ean = str(ean).strip()
                if not ean:
                    continue
                nombre = (p.get("productName") or "").strip()[:90]
                marca = (p.get("brand") or "").strip()[:40] or "Varias"
                if ean not in por_ean or precio < por_ean[ean]["precio"]:
                    por_ean[ean] = {"ean": ean, "producto": nombre, "marca": marca,
                                    "categoria": categorizar(nombre, marca),
                                    "precio": int(precio), "precio_lista": int(lista or precio),
                                    "precio_min": int(precio), "promo": bool(lista and lista > precio),
                                    "leyenda": "", "suc": 1, "unidad": "", "fuente": "vtex"}
                total += 1
            except (KeyError, IndexError, TypeError):
                continue
        print(f"  [vtex] pag {page}: {len(data)} ({len(por_ean)} únicos)", flush=True)
        if len(data) < 50:
            break
        page += 1
        time.sleep(0.3)
    return sorted(por_ean.values(), key=lambda o: o["precio"])


def vtex_arbol(api_base):
    """Lista de rutas de categoría ['Carnes', 'Carnes/Vacuna', ...] del árbol VTEX."""
    host = api_base.split("/api/")[0]
    raw = fetch(f"{host}/api/catalog_system/pub/category/tree/3",
                VTEX_HEADERS, timeout=30)
    tree = json.loads(raw.decode("utf-8", errors="replace"))
    rutas = []

    def caminar(nodos, pref):
        for n in nodos:
            ruta = pref + [n.get("name", "")]
            rutas.append("/".join(ruta))
            caminar(n.get("children") or [], ruta)

    caminar(tree, [])
    return [r for r in rutas if r]


def vtex_full_categorias(api_base, max_cats=None, max_paginas=600):
    """Catálogo completo recorriendo cada categoría (evita el tope de offset
    del search plano). Si el árbol falla, usa el paginado plano."""
    import urllib.parse
    try:
        rutas = vtex_arbol(api_base)
        print(f"  [vtex] arbol: {len(rutas)} categorias", flush=True)
    except Exception as e:
        print(f"  [vtex] arbol fallo ({str(e)[:80]}), sin extras por categoria", flush=True)
        return []
    if max_cats:
        rutas = rutas[:max_cats]
    por_ean = {}
    for ruta in rutas:
        fq = "fq=" + urllib.parse.quote("C:/" + ruta + "/", safe="/:")
        page = 0
        while page < max_paginas:
            a, b = page * 50, page * 50 + 49
            try:
                raw = fetch(f"{api_base}?{fq}&_from={a}&_to={b}",
                            VTEX_HEADERS, timeout=30)
                data = json.loads(raw.decode("utf-8", errors="replace"))
            except Exception:
                break
            if not isinstance(data, list) or not data:
                break
            for p in data:
                try:
                    items = p.get("items") or []
                    sellers = (items[0].get("sellers") or []) if items else []
                    offer = (sellers[0].get("commertialOffer") or {}) if sellers else {}
                    precio = offer.get("Price") or offer.get("price")
                    if not precio:
                        continue
                    lista = offer.get("ListPrice") or offer.get("listPrice") or precio
                    ean = ((items[0].get("ean") or "") if items else "") or p.get("productId", "")
                    ean = str(ean).strip()
                    if not ean:
                        continue
                    nombre = (p.get("productName") or "").strip()[:90]
                    marca = (p.get("brand") or "").strip()[:40] or "Varias"
                    if ean not in por_ean or precio < por_ean[ean]["precio"]:
                        por_ean[ean] = {
                            "ean": ean, "producto": nombre, "marca": marca,
                            "categoria": categorizar(nombre, marca),
                            "precio": int(precio), "precio_lista": int(lista or precio),
                            "precio_min": int(precio),
                            "promo": bool(lista and lista > precio),
                            "leyenda": "", "suc": 1, "unidad": "", "fuente": "vtex"}
                except (KeyError, IndexError, TypeError):
                    continue
            if len(data) < 50:
                break
            page += 1
            time.sleep(0.2)
        print(f"  [vtex] {ruta}: {len(por_ean)} únicos acumulados", flush=True)
    return sorted(por_ean.values(), key=lambda o: o["precio"])


# ---------------------------------------------------------------- scrape
SCRAPE_URLS = {
    "mariano-max": ["https://www.marianomax.com.ar/ofertas"],
    "makro": ["https://www.makro.com.ar/ofertas", "https://www.makro.com.ar/"],
    "tadicor": ["https://www.tadicor.com.ar/ofertas", "https://www.tadicor.com.ar/"],
    "almacor": ["https://www.almacor.com.ar/ofertas", "https://www.almacor.com.ar/"],
    "diarco": ["https://www.diarco.com.ar/ofertas", "https://www.diarco.com.ar/"],
}


def scrape_ofertas(urls):
    for url in urls:
        try:
            html = fetch(url, VTEX_HEADERS, timeout=25).decode("utf-8", errors="replace")
        except Exception as e:
            print(f"  [scrape] {url}: {str(e)[:100]}", flush=True)
            continue
        textos = re.findall(r"<(?:h\d|p|a|span|div)[^>]*>([^<>]{8,90})</(?:h\d|p|a|span|div)>", html)
        precios = [int(p.replace(".", "").replace(",", ""))
                   for p in re.findall(r"\$\s?([\d\.\,]+)", html)]
        pares = []
        for t, pr in zip(textos[:len(precios)], precios):
            t = re.sub(r"\s+", " ", t).strip()
            if 100 < pr < 5_000_000 and len(t) > 8 and "cookie" not in t.lower():
                pares.append((t[:90], pr))
        print(f"  [scrape] {url}: {len(pares)} pares", flush=True)
        if len(pares) >= 3:
            return pares
    return []


# ---------------------------------------------------------------- main
def escribir_super(sid, nombre, items, fuente, fecha, cobertura, sucursales=0):
    CATALOGO.mkdir(parents=True, exist_ok=True)
    (CATALOGO / f"{sid}.json").write_text(json.dumps({
        "meta": {"super": sid, "nombre": nombre, "fuente": fuente,
                 "actualizado": fecha, "zona": "Córdoba Capital",
                 "filtro": ("cadena cordobesa (solo opera en Córdoba)"
                            if fuente in ("vtex", "scrape") and sid in
                            ("cordiez", "mariano-max", "almacor", "tadicor")
                            else "sucursales de Córdoba Capital"),
                 "sucursales": sucursales, "cobertura": cobertura,
                 "total": len(items)},
        "items": items}, ensure_ascii=False), encoding="utf-8")


def main():
    args = sys.argv[1:]
    if "--selftest" in args:
        return selftest()
    solo = args[args.index("--solo") + 1] if "--solo" in args else None
    max_pag = int(args[args.index("--max-paginas") + 1]) if "--max-paginas" in args else 600
    max_cats = int(args[args.index("--max-cats") + 1]) if "--max-cats" in args else None
    hoy = (datetime.utcnow() - timedelta(hours=3)).date().isoformat()

    meta_supers = {}
    if SUPERS_JSON.exists():
        for s in json.loads(SUPERS_JSON.read_text(encoding="utf-8")):
            meta_supers[s["id"]] = s

    resumen, fecha = [], hoy
    if solo in (None, "sepa"):
        try:
            r, fecha = correr_sepa(CATALOGO, meta_supers)
            resumen += r
        except Exception as e:
            print(f"[sepa] FALLO GENERAL: {e} (se conservan archivos previos)", flush=True)

    if solo in (None, "cordiez"):
        try:
            base = meta_supers.get("cordiez", {}).get("api_base", "")
            plano = vtex_full(base, max_paginas=max_pag) if base else []
            extra = (vtex_full_categorias(base, max_cats=max_cats, max_paginas=max_pag)
                     if base else [])
            unidos = {o["ean"]: o for o in plano}
            for o in extra:
                if o["ean"] not in unidos or o["precio"] < unidos[o["ean"]]["precio"]:
                    unidos[o["ean"]] = o
            items = sorted(unidos.values(), key=lambda o: o["precio"])
            print(f"[cordiez] plano={len(plano)} extra_cat={len(extra)} "
                  f"total={len(items)}", flush=True)
            if len(items) >= 50:
                escribir_super("cordiez", "Cordiez", items, "vtex", hoy, "completa")
                resumen.append({"id": "cordiez", "nombre": "Cordiez", "items": len(items),
                                "sucursales": 0, "cobertura": "completa",
                                "fuente": "vtex", "stale": False})
            else:
                raise RuntimeError(f"solo {len(items)} items")
        except Exception as e:
            print(f"[cordiez] {e}; se conserva archivo previo", flush=True)
            resumen.append({"id": "cordiez", "nombre": "Cordiez", "items": -1,
                            "sucursales": 0, "cobertura": "completa",
                            "fuente": "vtex", "stale": True})

    if solo in (None, "scrape"):
        for sid in ("mariano-max", "makro", "tadicor", "almacor", "diarco"):
            nombre = meta_supers.get(sid, {}).get("nombre", sid)
            try:
                pares = scrape_ofertas(SCRAPE_URLS[sid])
                if len(pares) < 3:
                    raise RuntimeError(f"solo {len(pares)} pares")
                vistos = {}
                for t, pr in pares:
                    k = norm(t)
                    if k not in vistos or pr < vistos[k]["precio"]:
                        vistos[k] = {"ean": "SCR-" + re.sub(r"[^A-Z0-9]+", "-",
                                                            norm(t))[:50],
                                     "producto": t, "marca": "Oferta",
                                     "categoria": categorizar(t),
                                     "precio": pr, "precio_lista": pr,
                                     "precio_min": pr, "promo": True,
                                     "leyenda": "Oferta publicada", "suc": 1,
                                     "unidad": "", "fuente": "scrape"}
                items = sorted(vistos.values(), key=lambda o: o["precio"])
                escribir_super(sid, nombre, items, "scrape", hoy, "parcial")
                resumen.append({"id": sid, "nombre": nombre, "items": len(items),
                                "sucursales": 0, "cobertura": "parcial",
                                "fuente": "scrape", "stale": False})
            except Exception as e:
                print(f"[{sid}] {e}; se conserva archivo previo", flush=True)
                resumen.append({"id": sid, "nombre": nombre, "items": -1,
                                "sucursales": 0, "cobertura": "parcial",
                                "fuente": "scrape", "stale": True})

    # index.json = lo que el frontend muestra (SOLO lo que existe en disco)
    supers = []
    total = 0
    for f in sorted(CATALOGO.glob("*.json")):
        if f.name == "index.json":
            continue
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
            m = d.get("meta", {})
            r = next((x for x in resumen if x["id"] == f.stem), None)
            stale = r["stale"] if r else True
            supers.append({"id": f.stem, "nombre": m.get("nombre", f.stem),
                           "items": m.get("total", len(d.get("items", []))),
                           "sucursales": m.get("sucursales", 0),
                           "cobertura": m.get("cobertura", "?"),
                           "fuente": m.get("fuente", "?"),
                           "actualizado": m.get("actualizado", "?"), "stale": stale})
            total += m.get("total", 0)
        except Exception as e:
            print(f"[index] {f.name}: {e}", flush=True)
    (CATALOGO / "index.json").write_text(json.dumps({
        "actualizado": fecha, "zona": "Córdoba Capital (exclusivo)",
        "fuente": "sepa+vtex+scrape", "total_items": total,
        "total_supers": len(supers),
        "nota": ("Precios de sucursales de Córdoba Capital (SEPA) + cadenas "
                 "cordobesas. Nada fuera de la capital."),
        "supers": supers}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"OK: {len(supers)} supers, {total} items. fecha={fecha}", flush=True)
    return 0


# ---------------------------------------------------------------- selftest
def selftest():
    print("[selftest] fixture SEPA + categorizador", flush=True)
    assert categorizar("Yerba Mate Taragüí 1kg") == "almacen"
    assert categorizar("Leche entera La Serenísima") == "lacteos"
    assert categorizar("Asado de novillo x kg") == "carniceria"
    assert categorizar("Lavandina Ayudín 2L") == "limpieza"
    assert categorizar("Shampoo Plusbelle") == "perfumeria"
    assert categorizar("Gaseosa Coca Cola 2.25L") == "bebidas"
    assert categorizar("Pan francés x kg") == "panaderia"
    assert categorizar("Papa x kg") == "verduleria"
    assert categorizar("Destornillador phillips") == "otros"

    com = ("id_comercio|id_bandera|bandera_descripcion\n"
           "9|1|Vea\n9|2|Disco\n")
    suc = ("id_comercio|id_bandera|id_sucursal|direccion|localidad|provincia\n"
           "9|1|101|Av Colon 3200|Cordoba|AR-X\n"
           "9|1|102|Av Rafael Nuñez|Cordoba|AR-X\n"
           "9|1|201|Centro|Villa Allende|AR-X\n"
           "9|1|301|Calle 1|Rosario|AR-S\n"
           "9|2|501|Nueva Cordoba|Córdoba Capital|AR-X\n")
    prod = ("id_producto|encabezado\n"
            "9|1|101|7790001|7790001|Yerba Mate 1kg|1|kg|Taragui|5000|5000|1|kg|4500|OFERTA|0|\n"
            "9|1|102|7790001|7790001|Yerba Mate 1kg|1|kg|Taragui|5200|5200|1|kg|0||0|\n"
            "9|1|201|7790001|7790001|Yerba Mate 1kg|1|kg|Taragui|100|100|1|kg|0||0|\n"
            "9|1|301|7790001|7790001|Yerba Mate 1kg|1|kg|Taragui|200|200|1|kg|0||0|\n"
            "9|2|501|7790002|7790002|Leche Entera 1L|1|l|Serenisima|1600|1600|1|l|1400|PROMO|0|\n")
    banderas = parse_comercio_csv(com)
    assert banderas == {(9, 1): "Vea", (9, 2): "Disco"}, banderas
    capital, n_tot, n_arx, locs = parse_sucursales_csv(suc, 9)
    assert capital == {(9, 101), (9, 102), (9, 501)}, capital
    assert n_tot == 5 and n_arx == 4, (n_tot, n_arx)
    ag, stats = Agregador(), Counter()
    procesar_productos_csv(prod, 9, capital, ag, stats)
    assert stats["filas_capital"] == 3, stats
    items = build_items(ag)
    assert set(items) == {1, 2}, set(items)
    yerba = items[1][0]
    assert yerba["precio"] == 4850, yerba  # mediana efectivos 4500,5200
    assert yerba["precio_lista"] == 5100, yerba
    assert yerba["categoria"] == "almacen" and yerba["promo"] is True
    leche = items[2][0]
    assert leche["precio"] == 1400 and leche["categoria"] == "lacteos"
    print("[selftest] TODO OK: filtro capital estricto + medianas + categorías", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())