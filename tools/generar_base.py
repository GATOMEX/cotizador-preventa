#!/usr/bin/env python3
"""Genera data/odoo.json y data/catalogos.json desde los xlsx de fabricantes.

Uso:
    python3 tools/generar_base.py "/ruta/a/Lista de Precios AWM"

Espera en esa carpeta: 'Productos Odoo.xlsx', 'Hanwha.xlsx', 'Axis.xls',
' lista de MO AWM.xlsx'. Requiere: pandas, openpyxl, xlrd.
Debe producir el MISMO formato de registro que js/odoo.js y js/catalogos.js.
"""
import sys, os, json, re, unicodedata, pandas as pd

def norm(s):
    s = str(s).strip().lower()
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')

def num(v):
    if v is None: return None
    try: return round(float(re.sub(r'[^0-9.\-]', '', str(v))), 2)
    except ValueError: return None

def aoa(p, sh):
    df = pd.read_excel(p, sheet_name=sh, header=None)
    return df.where(pd.notnull(df), None).values.tolist()

def col(H, l):
    for i, c in enumerate(H):
        if norm(c) == norm(l): return i
    return -1

def scan(rows, l, mx=6):
    for r in range(min(mx, len(rows))):
        for i, c in enumerate(rows[r]):
            if norm(c) == norm(l): return i
    return -1

def cell(r, i):
    return '' if i == -1 or i >= len(r) or r[i] is None else str(r[i]).strip()

def main(d):
    out = os.path.join(os.path.dirname(__file__), '..', 'data')
    os.makedirs(out, exist_ok=True)

    # Odoo
    p = os.path.join(d, 'Productos Odoo.xlsx')
    rows = aoa(p, pd.ExcelFile(p).sheet_names[0]); H = rows[0]
    cN, cC, cP, cE = col(H, 'Nombre'), col(H, 'Referencia interna'), col(H, 'Coste'), col(H, 'Stock real')
    odoo = []
    for r in rows[1:]:
        nombre = cell(r, cN)
        if not nombre: continue
        odoo.append({'nombre': nombre, 'codigo': cell(r, cC).replace('.0', ''),
                     'existencia': (None if cE == -1 or r[cE] is None else int(num(r[cE]) or 0)),
                     'precio': (None if cP == -1 else num(r[cP]))})
    json.dump(odoo, open(f'{out}/odoo.json', 'w'), ensure_ascii=False)

    cat = []
    # Hanwha
    p = os.path.join(d, 'Hanwha.xlsx'); rows = aoa(p, 'HVA Pricelist')
    hr = next(i for i, r in enumerate(rows) if any(norm(c) == 'category' for c in r) and any(norm(c) == 'item #' for c in r))
    H = rows[hr]; cItem, cType, cDesc, cCat = col(H, 'Item #'), col(H, 'Item Type'), col(H, 'Description'), col(H, 'Category')
    cCosto = scan(rows, 'Costo AWM'); lastcat = ''
    for r in rows[hr + 1:]:
        item, catcell = cell(r, cItem), cell(r, cCat)
        if not item:
            if catcell: lastcat = catcell
            continue
        costo = num(r[cCosto]) if cCosto != -1 and cCosto < len(r) else None
        if not costo or costo <= 0: continue
        cat.append({'origen': 'Hanwha', 'categoria': catcell or lastcat,
                    'nombre': f'{item} {cell(r, cType)}'.strip(), 'codigoFab': item,
                    'descripcion': cell(r, cDesc)[:300], 'moneda': 'USD', 'costo': costo,
                    'venta': None, 'tipo': 'producto'})
    # Axis
    p = os.path.join(d, 'Axis.xls'); rows = aoa(p, 'All products')
    hr = next(i for i, r in enumerate(rows) if any(norm(c) == 'product name' for c in r))
    H = rows[hr]; cName, cNum, cCat, cDesc, cCosto = (col(H, 'Product Name'), col(H, 'Product Number US'),
        col(H, 'Product Category'), col(H, 'Product Description'), col(H, 'COSTO AWM'))
    for r in rows[hr + 1:]:
        name = cell(r, cName)
        if not name: continue
        costo = num(r[cCosto]) if cCosto != -1 and cCosto < len(r) else None
        if not costo or costo <= 0: continue
        cat.append({'origen': 'Axis', 'categoria': cell(r, cCat), 'nombre': name,
                    'codigoFab': cell(r, cNum), 'descripcion': cell(r, cDesc)[:300],
                    'moneda': 'USD', 'costo': costo, 'venta': None, 'tipo': 'producto'})
    # Mano de obra
    p = os.path.join(d, ' lista de MO AWM.xlsx')
    for sh in pd.ExcelFile(p).sheet_names:
        rows = aoa(p, sh)
        hr = next((i for i, r in enumerate(rows) if any(norm(c) == 'concepto' for c in r)), -1)
        if hr == -1: continue
        H = rows[hr]; cCon, cDesc, cRD, cUSD, cMon = (col(H, 'CONCEPTO'), col(H, 'DESCRIPCIÓN / ALCANCE'),
            col(H, 'RD$'), col(H, 'USD'), col(H, 'Moneda'))
        origen = 'MO · ' + re.sub(r'^\d+\.\s*', '', sh).strip()
        for r in rows[hr + 1:]:
            con = cell(r, cCon)
            if not con or re.match(r'^secci[oó]n', con, re.I) or norm(con) == 'concepto': continue
            usd = 'usd' in (norm(r[cMon]) if cMon != -1 and cMon < len(r) and r[cMon] is not None else '')
            venta = num(r[cUSD]) if usd else (num(r[cRD]) if num(r[cRD]) is not None else num(r[cUSD]))
            if not venta or venta <= 0: continue
            cat.append({'origen': origen, 'categoria': sh, 'nombre': con, 'codigoFab': '',
                        'descripcion': cell(r, cDesc)[:300], 'moneda': ('USD' if usd else 'DOP'),
                        'costo': None, 'venta': venta, 'tipo': 'mano_obra'})
    json.dump(cat, open(f'{out}/catalogos.json', 'w'), ensure_ascii=False)

    man = {'generado': pd.Timestamp.now().strftime('%Y-%m-%d'), 'fuentes': {
        'odoo': {'items': len(odoo)},
        'Hanwha': {'items': sum(1 for x in cat if x['origen'] == 'Hanwha')},
        'Axis': {'items': sum(1 for x in cat if x['origen'] == 'Axis')},
        'ManoObra': {'items': sum(1 for x in cat if x['tipo'] == 'mano_obra')}}}
    json.dump(man, open(f'{out}/manifest.json', 'w'), ensure_ascii=False, indent=1)
    print(f'odoo: {len(odoo)}  catalogos: {len(cat)}')

if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit('Uso: python3 tools/generar_base.py "/ruta/a/Lista de Precios AWM"')
    main(sys.argv[1])
