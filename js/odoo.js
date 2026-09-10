// Cruce con inventario Odoo. Lee productos_odoo.xlsx en el navegador (SheetJS)
// y construye un índice de búsqueda por nombre / código interno.
//
// Columnas esperadas (tolerante a variaciones de encabezado):
//   nombre        -> nombre / descripcion / product / name
//   codigo interno-> codigo / código interno / default_code / ref / referencia
//   existencia    -> existencia / stock / qty_available / disponible / cantidad
//   precio        -> precio / precio de compra / costo / standard_price / cost

const HEADER_ALIASES = {
  nombre:     ['nombre', 'descripcion', 'descripción', 'producto', 'product', 'name'],
  codigo:     ['codigo interno', 'código interno', 'referencia interna', 'codigo', 'código', 'default_code', 'ref', 'referencia', 'internal reference'],
  existencia: ['existencia', 'stock', 'stock real', 'qty_available', 'disponible', 'cantidad', 'cantidad a mano', 'on hand'],
  precio:     ['precio de compra', 'costo', 'coste', 'standard_price', 'cost', 'precio de coste'],
};

let PRODUCTS = [];   // [{nombre, codigo, existencia, precio}]

const norm = (s) => String(s ?? '').trim().toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function resolveColumns(headerRow) {
  const map = {};
  headerRow.forEach((h, i) => {
    const hn = norm(h);
    for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
      if (map[key] === undefined && aliases.some(a => norm(a) === hn)) map[key] = i;
    }
  });
  return map;
}

export function loadOdooFromArrayBuffer(buf) {
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (!rows.length) throw new Error('Hoja vacía');

  const cols = resolveColumns(rows[0]);
  if (cols.nombre === undefined)
    throw new Error('No encontré la columna de nombre/descripción en el Excel de Odoo.');

  PRODUCTS = rows.slice(1)
    .filter(r => String(r[cols.nombre] ?? '').trim() !== '')
    .map(r => ({
      nombre: String(r[cols.nombre]).trim(),
      codigo: cols.codigo !== undefined ? String(r[cols.codigo] ?? '').trim() : '',
      existencia: cols.existencia !== undefined ? Number(r[cols.existencia]) || 0 : null,
      precio: cols.precio !== undefined ? Number(r[cols.precio]) || 0 : null,
    }));

  return { count: PRODUCTS.length, columns: cols };
}

export function odooCount() { return PRODUCTS.length; }
export function allProducts() { return PRODUCTS; }
export function setProducts(arr) { PRODUCTS = Array.isArray(arr) ? arr : []; }

// Búsqueda simple por tokens contenidos (nombre o código).
export function search(query, limit = 30) {
  const q = norm(query);
  if (!q) return [];
  const tokens = q.split(/\s+/);
  const scored = [];
  for (const p of PRODUCTS) {
    const hay = norm(p.nombre) + ' ' + norm(p.codigo);
    if (tokens.every(t => hay.includes(t))) {
      // score: coincidencia por código > prefijo de nombre > contiene
      let score = 0;
      if (norm(p.codigo) === q) score += 100;
      if (norm(p.nombre).startsWith(q)) score += 10;
      scored.push({ p, score });
    }
  }
  scored.sort((a, b) => b.score - a.score || a.p.nombre.length - b.p.nombre.length);
  return scored.slice(0, limit).map(s => s.p);
}

// Resuelve una línea contra Odoo por nombre exacto o por código.
export function match({ descripcion, codigo }) {
  const d = norm(descripcion), c = norm(codigo);
  if (c) {
    const byCode = PRODUCTS.find(p => norm(p.codigo) === c);
    if (byCode) return byCode;
  }
  if (d) {
    const exact = PRODUCTS.find(p => norm(p.nombre) === d);
    if (exact) return exact;
  }
  return null;
}
