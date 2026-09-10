// Catálogos de precios de fabricantes + mano de obra.
// Cada archivo tiene un layout distinto → un adaptador por formato normaliza a
// un registro común. Detección por nombres de hoja / contenido.
//
// Registro unificado:
//   { origen, categoria, nombre, codigoFab, descripcion,
//     moneda:'USD'|'DOP', costo:Number|null, venta:Number|null,
//     tipo:'producto'|'mano_obra' }
//
// - producto: costo = Costo AWM (se le aplica margen en la app). venta = null.
// - mano_obra: venta = tarifa listada (precio de cobro). costo = null.

let ITEMS = [];   // registros unificados de todos los catálogos cargados
let SOURCES = []; // [{origen, tipo, count}]

const norm = (s) => String(s ?? '').trim().toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const num = (v) => {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));   // limpia "~30", "$1,269", "-"
  return Number.isFinite(n) ? n : null;
};
const aoa = (ws) => XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
const findRow = (rows, pred) => rows.findIndex(pred);
const colOf = (headerRow, label) =>
  headerRow.findIndex(c => norm(c) === norm(label));
const scanCol = (rows, label, maxRow = 6) => {   // busca una etiqueta suelta (headers partidos)
  for (let r = 0; r < Math.min(maxRow, rows.length); r++) {
    const c = rows[r].findIndex(x => norm(x) === norm(label));
    if (c !== -1) return c;
  }
  return -1;
};

// ---- Adaptador Hanwha (hoja 'HVA Pricelist') ----------------------------
function parseHanwha(wb) {
  const rows = aoa(wb.Sheets['HVA Pricelist']);
  const hr = findRow(rows, r => r.some(c => norm(c) === 'category') && r.some(c => norm(c) === 'item #'));
  if (hr === -1) return [];
  const H = rows[hr];
  const cCat = colOf(H, 'Category'), cItem = colOf(H, 'Item #'),
        cType = colOf(H, 'Item Type'), cDesc = colOf(H, 'Description'),
        cCosto = scanCol(rows, 'Costo AWM'), cEan = colOf(H, 'EAN code');
  const out = [];
  let cat = '';
  for (let r = hr + 1; r < rows.length; r++) {
    const row = rows[r];
    const item = String(row[cItem] ?? '').trim();
    const catCell = String(row[cCat] ?? '').trim();
    if (!item) { if (catCell) cat = catCell; continue; }   // fila separadora de categoría
    const costo = cCosto !== -1 ? num(row[cCosto]) : null;
    if (costo === null || costo <= 0) continue;
    const tipo = String(row[cType] ?? '').trim();
    out.push({
      origen: 'Hanwha', categoria: catCell || cat,
      nombre: `${item} ${tipo}`.trim(), codigoFab: item,
      descripcion: String(row[cDesc] ?? '').trim(),
      moneda: 'USD', costo, venta: null, tipo: 'producto',
    });
  }
  return out;
}

// ---- Adaptador Axis (hoja 'All products') -------------------------------
function parseAxis(wb) {
  const rows = aoa(wb.Sheets['All products']);
  const hr = findRow(rows, r => r.some(c => norm(c) === 'product name'));
  if (hr === -1) return [];
  const H = rows[hr];
  const cName = colOf(H, 'Product Name'), cNum = colOf(H, 'Product Number US'),
        cCat = colOf(H, 'Product Category'), cDesc = colOf(H, 'Product Description'),
        cCosto = colOf(H, 'COSTO AWM');
  const out = [];
  for (let r = hr + 1; r < rows.length; r++) {
    const row = rows[r];
    const name = String(row[cName] ?? '').trim();
    if (!name) continue;
    const costo = cCosto !== -1 ? num(row[cCosto]) : null;
    if (costo === null || costo <= 0) continue;
    out.push({
      origen: 'Axis', categoria: String(row[cCat] ?? '').trim(),
      nombre: name, codigoFab: String(row[cNum] ?? '').trim(),
      descripcion: String(row[cDesc] ?? '').trim(),
      moneda: 'USD', costo, venta: null, tipo: 'producto',
    });
  }
  return out;
}

// ---- Adaptador Mano de Obra (hojas con encabezado CONCEPTO) -------------
function parseManoObra(wb) {
  const out = [];
  for (const sh of wb.SheetNames) {
    const rows = aoa(wb.Sheets[sh]);
    const hr = findRow(rows, r => r.some(c => norm(c) === 'concepto'));
    if (hr === -1) continue;
    const H = rows[hr];
    const cCon = colOf(H, 'CONCEPTO'), cDesc = colOf(H, 'DESCRIPCIÓN / ALCANCE'),
          cRD = colOf(H, 'RD$'), cUSD = colOf(H, 'USD'), cMon = colOf(H, 'Moneda');
    for (let r = hr + 1; r < rows.length; r++) {
      const row = rows[r];
      const con = String(row[cCon] ?? '').trim();
      if (!con) continue;
      if (/^secci[oó]n/i.test(con) || norm(con) === 'concepto') continue;  // títulos
      const mon = norm(cMon !== -1 ? row[cMon] : '');
      const esUSD = mon.includes('usd');
      const venta = esUSD ? num(row[cUSD]) : (num(row[cRD]) ?? num(row[cUSD]));
      if (venta === null || venta <= 0) continue;
      out.push({
        origen: `MO · ${sh.replace(/^\d+\.\s*/, '').trim()}`, categoria: sh,
        nombre: con, codigoFab: '',
        descripcion: String(row[cDesc] ?? '').trim(),
        moneda: esUSD ? 'USD' : 'DOP', costo: null, venta, tipo: 'mano_obra',
      });
    }
  }
  return out;
}

// ---- Detección + carga --------------------------------------------------
function parseWorkbook(wb, fileName) {
  const names = wb.SheetNames.map(n => n);
  if (names.includes('HVA Pricelist')) return { tipo: 'Hanwha', items: parseHanwha(wb) };
  if (names.includes('All products') && /axis/i.test(String(aoa(wb.Sheets['All products'])[0]?.[0] ?? '')))
    return { tipo: 'Axis', items: parseAxis(wb) };
  // Mano de obra: alguna hoja tiene encabezado CONCEPTO
  const looksMO = names.some(n => aoa(wb.Sheets[n]).some(r => r.some(c => norm(c) === 'concepto')));
  if (looksMO || /\bmo\b|mano de obra/i.test(fileName)) return { tipo: 'ManoObra', items: parseManoObra(wb) };
  return { tipo: 'desconocido', items: [] };
}

export async function loadFiles(fileList) {
  const results = [];
  for (const file of fileList) {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const { tipo, items } = parseWorkbook(wb, file.name);
      // reemplaza registros previos del mismo origen (recarga)
      const origenes = new Set(items.map(i => i.origen));
      ITEMS = ITEMS.filter(i => !origenes.has(i.origen));
      ITEMS.push(...items);
      results.push({ file: file.name, tipo, count: items.length });
    } catch (e) {
      results.push({ file: file.name, tipo: 'error', count: 0, error: e.message });
    }
  }
  recomputeSources();
  return { results, total: ITEMS.length, sources: SOURCES };
}

export function count() { return ITEMS.length; }
export function sources() { return SOURCES; }
export function all() { return ITEMS; }

function recomputeSources() {
  SOURCES = Object.values(ITEMS.reduce((a, i) => {
    (a[i.origen] ??= { origen: i.origen, tipo: i.tipo, count: 0 }).count++; return a;
  }, {}));
}
export function setItems(arr) { ITEMS = Array.isArray(arr) ? arr : []; recomputeSources(); }

export function search(query, limit = 40) {
  const q = norm(query);
  if (!q) return [];
  const toks = q.split(/\s+/);
  const res = [];
  for (const it of ITEMS) {
    const hay = norm(it.nombre) + ' ' + norm(it.codigoFab) + ' ' + norm(it.descripcion);
    if (toks.every(t => hay.includes(t))) res.push(it);
    if (res.length >= limit) break;
  }
  return res;
}

// match por nombre exacto o por código de fabricante
export function match(text) {
  const t = norm(text);
  if (!t) return null;
  return ITEMS.find(i => norm(i.nombre) === t)
      || ITEMS.find(i => i.codigoFab && norm(i.codigoFab) === t)
      || null;
}
