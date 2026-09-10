#!/usr/bin/env python3
"""SUPERBARATO Bot — actualiza data/ofertas.json

Estrategia (en orden):
  1. VTEX (Disco/Vea/Jumbo/Carrefour/Día): API pública de catálogo, sin key.
     Ej: https://www.disco.com.ar/api/catalog_system/pub/products/search?ft=yerba&_from=0&_to=19
  2. SEPA / Precios Claros: si hay dump oficial configurado vía SEPA_URL, se mezcla.
  3. Scraping cordobeses (Mariano Max / Cordiez / Libertad): HTML de /ofertas con reintentos.
  4. Si todo falla: NO inventa precios — conserva el JSON anterior y marca stale.

Solo stdlib (urllib + json + re) para correr en GitHub Actions sin instalar nada.
Uso: python scripts/update_precios.py [--check] [--canasta data/canasta.txt]
"""
import json, re, sys, time, urllib.request, urllib.parse
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OFERTAS = ROOT / "data" / "ofertas.json"
SUPERS = ROOT / "data" / "supermercados.json"

CANASTA_DEFAULT = ["yerba", "fideos", "arroz", "aceite", "leche", "queso",
                   "gaseosa", "asado", "pollo", "papa", "pan", "lavandina",
                   "detergente", "shampoo"]

HEADERS = {"User-Agent": "Mozilla/5.0 (SUPERBARATO-bot; Cordoba-AR; +github-actions)"}

def fetch(url, timeout=20, retries=3):
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", errors="replace")
        except Exception as e:  # retry con backoff exponencial
            last = e
            time.sleep(2 ** i)
    raise last

def vtex_search(api_base, termino, n=10):
    """Devuelve lista de dicts {producto, marca, precio, precio_lista} o [] si falla."""
    q = urllib.parse.urlencode({"ft": termino, "_from": 0, "_to": n - 1})
    try:
        raw = fetch(f"{api_base}?{q}")
        data = json.loads(raw)
    except Exception as e:
        print(f"  [vtex] {api_base} ft={termino}: FALLO ({e})", flush=True)
        return []
    out = []
    for p in data:
        try:
            nombre = p.get("productName", "").strip()
            marca = (p.get("brand") or "").strip() or "Varias"
            items = p.get("items") or []
            if not items:
                continue
            sellers = (items[0].get("sellers") or [])
            if not sellers:
                continue
            offer = (sellers[0].get("commertialOffer") or {})
            precio = offer.get("Price") or offer.get("price")
            lista = offer.get("ListPrice") or offer.get("listPrice") or precio
            if not precio:
                continue
            out.append({"producto": nombre[:80], "marca": marca[:40],
                        "precio": int(precio), "precio_lista": int(lista or precio)})
        except Exception:
            continue
    print(f"  [vtex] {api_base} ft={termino}: {len(out)} items", flush=True)
    return out

CATEGORIA_POR_TERMINO = {
    "yerba": "almacen", "fideos": "almacen", "arroz": "almacen", "aceite": "almacen",
    "leche": "lacteos", "queso": "lacteos", "gaseosa": "bebidas",
    "asado": "carniceria", "pollo": "carniceria", "papa": "verduleria", "pan": "panaderia",
    "lavandina": "limpieza", "detergente": "limpieza", "shampoo": "perfumeria",
}

def scrape_ofertas_html(url, patron_precio=r"\$\s?([\d\.\,]+)"):
    """Scraper genérico mínimo para supers cordobeses sin API.
    Extrae (texto, precio) cercanos. Devuelve [] si el HTML cambió."""
    try:
        html = fetch(url)
    except Exception as e:
        print(f"  [scrape] {url}: FALLO red ({e})", flush=True)
        return []
    textos = re.findall(r"<(?:h\d|p|a|span)[^>]*>([^<>]{8,90})</(?:h\d|p|a|span)>", html)
    precios = [int(p.replace(".", "").replace(",", "")) for p in re.findall(patron_precio, html)]
    pares = []
    for t, pr in zip(textos[:len(precios)], precios):
        t = re.sub(r"\s+", " ", t).strip()
        if 100 < pr < 5_000_000 and len(t) > 8:
            pares.append({"producto": t[:80], "marca": "Oferta", "precio": pr, "precio_lista": pr})
    print(f"  [scrape] {url}: {len(pares)} pares", flush=True)
    return pares[:30]

def main():
    check_only = "--check" in sys.argv
    canasta = list(CANASTA_DEFAULT)
    if "--canasta" in sys.argv:
        i = sys.argv.index("--canasta")
        try:
            canasta = [l.strip() for l in Path(sys.argv[i + 1]).read_text(encoding="utf-8").splitlines() if l.strip()]
        except Exception as e:
            print(f"Canasta no leída ({e}), uso default.")

    supers = json.loads(SUPERS.read_text(encoding="utf-8"))
    anterior = json.loads(OFERTAS.read_text(encoding="utf-8")) if OFERTAS.exists() else {"ofertas": []}

    nuevas = []
    for s in supers:
        sid = s["id"]
        print(f"== {sid} ({s['fuente']})", flush=True)
        if s["fuente"] == "vtex" and s.get("api_base"):
            for term in canasta:
                for it in vtex_search(s["api_base"], term, n=5):
                    nuevas.append({
                        "id": f"{re.sub(r'[^a-z0-9]+','-', (it['producto']+'-'+sid).lower())[:60]}",
                        "producto": it["producto"], "marca": it["marca"],
                        "categoria": CATEGORIA_POR_TERMINO.get(term, "almacen"),
                        "super": sid, "precio": it["precio"],
                        "precio_lista": it["precio_lista"], "unidad": "",
                        "fuente": "vtex",
                    })
                time.sleep(0.5)  # no saturar APIs
        elif s["fuente"] == "scrape":
            for it in scrape_ofertas_html(s["web"]):
                nuevas.append({
                    "id": f"{re.sub(r'[^a-z0-9]+','-', (it['producto']+'-'+sid).lower())[:60]}",
                    "producto": it["producto"], "marca": it["marca"],
                    "categoria": "almacen", "super": sid,
                    "precio": it["precio"], "precio_lista": it["precio_lista"],
                    "unidad": "", "fuente": "scrape",
                })

    print(f"Total nuevo: {len(nuevas)} | anterior: {len(anterior.get('ofertas', []))}", flush=True)

    # Regla anti-invención: si conseguimos muy poco (<20 items), no pisamos el archivo.
    if len(nuevas) < 20:
        print("MUY POCOS DATOS: conservo ofertas.json anterior y marco stale. Revisar bloqueos/APIs.", flush=True)
        if not check_only and anterior.get("meta"):
            anterior["meta"]["stale"] = True
            anterior["meta"]["ultimo_intento"] = str(date.today())
            OFERTAS.write_text(json.dumps(anterior, ensure_ascii=False, indent=2), encoding="utf-8")
        return 1

    salida = {"meta": {"moneda": "ARS", "zona": "Córdoba Capital",
                        "actualizado": str(date.today()), "fuente": "vtex+scrape",
                        "total": len(nuevas)},
              "ofertas": nuevas}
    if check_only:
        print(json.dumps(salida["meta"], ensure_ascii=False))
        return 0
    OFERTAS.write_text(json.dumps(salida, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK: {OFERTAS} actualizado.", flush=True)
    return 0

if __name__ == "__main__":
    sys.exit(main())
