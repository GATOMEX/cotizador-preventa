import * as Odoo from './odoo.js';
import * as Catalogos from './catalogos.js';
import * as Data from './data.js';
import { exportQuote } from './exportXlsx.js';

// ---- Modelo -------------------------------------------------------------
// Cada bloque agrupa líneas en "apartados" (grupos). Tecnología es `multi`:
// permite varios apartados con nombre (CCTV, Alarmas, WiFi…). Los demás bloques
// tienen un único apartado sin nombre. El modelo de línea es común a todos.
const grupo = (nombre = '') => ({ id: crypto.randomUUID(), nombre, lines: [] });

const BLOCKS = [
  { id: 'tecnologia', title: 'Tecnología', sheet: 'Tecnologia', multi: true,
    sub: 'Apartados por sistema: CCTV, alarmas, wifi…', grupos: [grupo('CCTV')] },
  { id: 'ferreteria', title: 'Materiales ferreteros', sheet: 'Ferreteria', multi: false,
    sub: 'Tubería/canalización y accesorios (auto-relleno: fase próxima)', grupos: [grupo()] },
  { id: 'cableado', title: 'Cableado y accesorios', sheet: 'Cableado', multi: false,
    sub: 'UTP, conectores, jacks, patch cords…', grupos: [grupo()] },
  { id: 'manoObra', title: 'Mano de obra', sheet: 'ManoObra', multi: false,
    sub: 'Instalación, configuración, puesta en marcha', grupos: [grupo()] },
];

const allLines = (b) => b.grupos.flatMap(g => g.lines);

const MARGIN_GENERAL = 60;
const MARGIN_IMPORTADO = 90;

const meta = {
  cliente: '', tipoProyecto: '', vendedor: '',
  fecha: new Date().toISOString().slice(0, 10),
  tasaMercado: 60, consideraciones: '',
};
let marginGlobal = MARGIN_GENERAL;

const tasaAplicada = () => (Number(meta.tasaMercado) || 0) + 2;

const newLine = (over = {}) => ({
  id: crypto.randomUUID(),
  descripcion: '', codigo: '', existencia: null,
  moneda: 'DOP',        // moneda del precio de compra ingresado
  compraOrig: 0,        // precio de compra en su moneda
  importado: false,     // fuerza margen 90%
  margen: marginGlobal, // % markup sobre costo
  venta: 0,             // precio de venta en DOP
  cantidad: 1,
  fuente: '',           // referencia del precio (lista fabricante / mayorista / fecha)
  ...over,
});

// ---- Cálculo ------------------------------------------------------------
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// costo unitario en DOP (convierte si la línea está en USD)
const compraDOP = (l) => l.moneda === 'USD'
  ? round2((Number(l.compraOrig) || 0) * tasaAplicada())
  : round2(Number(l.compraOrig) || 0);

const ventaFromMargin = (l) => round2(compraDOP(l) * (1 + (Number(l.margen) || 0) / 100));
function marginFromVenta(l) {
  const c = compraDOP(l);
  return c ? round2((l.venta / c - 1) * 100) : 0;
}

// ---- Utilidades DOM -----------------------------------------------------
const $ = (s, r = document) => r.querySelector(s);
const fmt = (n) => 'RD$ ' + (Number(n) || 0).toLocaleString('es-DO',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s ?? '').replace(/"/g, '&quot;');

// ---- Render -------------------------------------------------------------
const blocksEl = $('#blocks');

function render() {
  blocksEl.innerHTML = '';
  for (const b of BLOCKS) blocksEl.appendChild(renderBlock(b));
  renderTotals();
  schedulePersist();
}

// ---- Persistencia del borrador (IndexedDB, debounced) ------------------
let persistT = null;
function schedulePersist() {
  clearTimeout(persistT);
  persistT = setTimeout(() => {
    Data.saveBorrador({
      meta, marginGlobal,
      blocks: BLOCKS.map(b => ({
        id: b.id,
        grupos: b.grupos.map(g => ({ nombre: g.nombre, lines: g.lines })),
      })),
    }).catch(() => {});
  }, 400);
}

const THEAD = `
  <thead><tr>
    <th>Descripción</th>
    <th class="col-code">Código Odoo</th>
    <th class="col-cur">Moneda</th>
    <th class="col-money">P. compra</th>
    <th class="col-imp">Imp.</th>
    <th class="col-margin">Margen %</th>
    <th class="col-money">P. venta (DOP)</th>
    <th class="col-qty">Cant.</th>
    <th class="col-money">Subtotal</th>
    <th class="col-src">Fuente precio</th>
    <th class="col-act"></th>
  </tr></thead>`;

function renderBlock(b) {
  const wrap = document.createElement('section');
  wrap.className = 'block card';
  const head = document.createElement('div');
  head.className = 'block-head';
  head.innerHTML = `<div><h2>${b.title}</h2><div class="block-sub">${b.sub}</div></div>`;
  if (b.multi) {
    const addG = document.createElement('button');
    addG.className = 'btn btn-sm';
    addG.textContent = '+ Agregar apartado';
    addG.onclick = () => { b.grupos.push(grupo('Nuevo apartado')); render(); };
    head.appendChild(addG);
  }
  wrap.appendChild(head);
  for (const g of b.grupos) wrap.appendChild(renderGrupo(b, g));
  return wrap;
}

function renderGrupo(b, g) {
  const box = document.createElement('div');
  box.className = 'grupo';

  if (b.multi) {
    const gh = document.createElement('div');
    gh.className = 'grupo-head';
    gh.innerHTML = `
      <input class="grupo-nombre" value="${esc(g.nombre)}"
        placeholder="Nombre del apartado (CCTV, Alarmas, WiFi…)" />
      <button class="btn btn-sm btn-danger" title="Eliminar apartado">Eliminar apartado ✕</button>`;
    gh.querySelector('.grupo-nombre').addEventListener('input', e => {
      g.nombre = e.target.value; schedulePersist();
    });
    gh.querySelector('.btn-danger').onclick = () => {
      if (g.lines.length && !confirm(`¿Eliminar el apartado "${g.nombre || 'sin nombre'}" y sus ${g.lines.length} línea(s)?`)) return;
      b.grupos = b.grupos.filter(x => x.id !== g.id);
      if (!b.grupos.length) b.grupos.push(grupo('CCTV'));
      render();
    };
    box.appendChild(gh);
  }

  const tw = document.createElement('div');
  tw.className = 'table-wrap';
  tw.innerHTML = `<table>${THEAD}<tbody></tbody></table>`;
  const tb = $('tbody', tw);
  if (!g.lines.length) {
    tb.innerHTML = `<tr><td colspan="11" class="muted center" style="padding:12px">
      Sin líneas. Usa “+ Agregar línea”.</td></tr>`;
  } else {
    for (const l of g.lines) tb.appendChild(renderRow(g, l));
  }
  box.appendChild(tw);

  const add = document.createElement('button');
  add.className = 'btn btn-sm add-line';
  add.textContent = '+ Agregar línea';
  add.onclick = () => { g.lines.push(newLine()); render(); };
  box.appendChild(add);
  return box;
}

function renderRow(g, l) {
  const tr = document.createElement('tr');
  const existBadge = l.existencia === null || l.existencia === undefined ? ''
    : `<span class="exist ${l.existencia > 0 ? 'exist-ok' : 'exist-no'}">
         ${l.existencia > 0 ? 'stock ' + l.existencia : 'sin stock'}</span>`;
  tr.innerHTML = `
    <td><input list="odooList" data-f="descripcion" value="${esc(l.descripcion)}"
         placeholder="Descripción del producto" /></td>
    <td class="col-code"><input data-f="codigo" value="${esc(l.codigo)}" placeholder="—" />${existBadge}</td>
    <td class="col-cur"><select data-f="moneda">
        <option value="DOP" ${l.moneda === 'DOP' ? 'selected' : ''}>DOP</option>
        <option value="USD" ${l.moneda === 'USD' ? 'selected' : ''}>USD</option>
      </select></td>
    <td class="num col-money"><input data-f="compraOrig" type="number" step="0.01" min="0" value="${l.compraOrig}" /></td>
    <td class="center col-imp"><input data-f="importado" type="checkbox" ${l.importado ? 'checked' : ''} title="Importado (90%)" /></td>
    <td class="num col-margin"><input data-f="margen" type="number" step="1" value="${l.margen}" /></td>
    <td class="num col-money"><input data-f="venta" type="number" step="0.01" min="0" value="${l.venta}" /></td>
    <td class="num col-qty"><input data-f="cantidad" type="number" step="1" min="0" value="${l.cantidad}" /></td>
    <td class="readonly col-money" data-sub>${fmt(l.venta * l.cantidad)}</td>
    <td class="col-src"><input data-f="fuente" value="${esc(l.fuente)}" placeholder="Lista / mayorista / fecha" /></td>
    <td class="col-act"><button class="btn btn-sm btn-danger" title="Eliminar">✕</button></td>`;

  const inputs = {};
  tr.querySelectorAll('[data-f]').forEach(inp => {
    inputs[inp.dataset.f] = inp;
    const evt = (inp.type === 'checkbox' || inp.tagName === 'SELECT') ? 'change' : 'input';
    inp.addEventListener(evt, () => onField(l, inp, tr, inputs));
    if (inp.dataset.f === 'descripcion' || inp.dataset.f === 'codigo')
      inp.addEventListener('change', () => tryResolve(l));
  });
  tr.querySelector('.btn-danger').onclick = () => {
    g.lines = g.lines.filter(x => x.id !== l.id); render();
  };
  return tr;
}

// Actualiza el modelo y refresca sólo las celdas afectadas (sin re-render,
// para no perder foco al escribir).
function onField(l, inp, tr, inputs) {
  const f = inp.dataset.f;
  if (f === 'descripcion' || f === 'codigo' || f === 'fuente') { l[f] = inp.value; return; }
  if (f === 'moneda') { l.moneda = inp.value; l.venta = ventaFromMargin(l); syncRow(l, tr, inputs); return; }
  if (f === 'importado') {
    l.importado = inp.checked;
    l.margen = l.importado ? MARGIN_IMPORTADO : marginGlobal;
    l.venta = ventaFromMargin(l);
    syncRow(l, tr, inputs); return;
  }
  l[f] = Number(inp.value) || 0;
  if (f === 'compraOrig' || f === 'margen') {
    l.venta = ventaFromMargin(l);
    if (inputs.venta && document.activeElement !== inputs.venta) inputs.venta.value = l.venta;
  } else if (f === 'venta') {
    l.margen = marginFromVenta(l);
    if (inputs.margen && document.activeElement !== inputs.margen) inputs.margen.value = l.margen;
  }
  tr.querySelector('[data-sub]').textContent = fmt(l.venta * l.cantidad);
  renderTotals();
  schedulePersist();
}

function syncRow(l, tr, inputs) {
  if (inputs.margen) inputs.margen.value = l.margen;
  if (inputs.venta) inputs.venta.value = l.venta;
  tr.querySelector('[data-sub]').textContent = fmt(l.venta * l.cantidad);
  renderTotals();
}

// Resuelve una línea: primero contra catálogos de fabricante / mano de obra,
// luego contra inventario Odoo. Si es producto de fabricante, además cruza con
// Odoo para traer código interno y existencia cuando coincida.
function tryResolve(l) {
  const cat = Catalogos.match(l.codigo) || Catalogos.match(l.descripcion);
  if (cat) { applyCatalog(l, cat); return; }
  applyOdoo(l);
}

function applyCatalog(l, rec) {
  l.descripcion = rec.nombre;
  l.fuente = rec.origen;
  if (rec.tipo === 'mano_obra') {
    // la tarifa listada ES el precio de venta (no se le aplica margen)
    l.moneda = 'DOP';
    l.venta = round2(rec.moneda === 'USD' ? rec.venta * tasaAplicada() : rec.venta);
    l.compraOrig = 0; l.margen = 0; l.importado = false;
  } else {
    l.moneda = rec.moneda;
    l.compraOrig = round2(rec.costo || 0);
    l.importado = rec.moneda === 'USD';
    l.margen = l.importado ? MARGIN_IMPORTADO : marginGlobal;
    l.venta = ventaFromMargin(l);
    if (rec.codigoFab) l.codigo = rec.codigoFab;
    crossOdoo(l);   // intenta traer código interno + existencia desde Odoo
  }
  render();
}

function applyOdoo(l) {
  if (!Odoo.odooCount()) return;
  const hit = Odoo.match({ descripcion: l.descripcion, codigo: l.codigo });
  if (!hit) return;
  l.descripcion = hit.nombre;
  if (hit.codigo) l.codigo = hit.codigo;
  l.existencia = hit.existencia;
  if (hit.precio != null && hit.precio > 0) {
    l.moneda = 'DOP';                 // el coste de Odoo se asume en DOP
    l.compraOrig = round2(hit.precio);
    l.importado = false;
    l.margen = marginGlobal;
    l.venta = ventaFromMargin(l);
    if (!l.fuente) l.fuente = 'Odoo (inventario)';
  }
  render();
}

// para un producto ya resuelto por fabricante, busca su código/existencia en Odoo
function crossOdoo(l) {
  if (!Odoo.odooCount()) return;
  const hit = Odoo.match({ descripcion: l.descripcion, codigo: l.codigo });
  if (!hit) return;
  if (hit.codigo) l.codigo = hit.codigo;   // preferimos el código interno de Odoo
  l.existencia = hit.existencia;
}

function renderTotals() {
  let costo = 0, venta = 0;
  for (const b of BLOCKS)
    for (const l of allLines(b)) {
      const q = Number(l.cantidad) || 0;
      costo += compraDOP(l) * q;
      venta += (Number(l.venta) || 0) * q;
    }
  $('#tCosto').textContent = fmt(costo);
  $('#tVenta').textContent = fmt(venta);
  $('#tUtil').textContent = fmt(venta - costo);
  $('#tMargen').textContent = (venta ? Math.round((venta - costo) / venta * 1000) / 10 : 0) + '%';
}

// recalcula todas las líneas USD cuando cambia la tasa
function recalcUSD() {
  for (const b of BLOCKS)
    for (const l of allLines(b)) if (l.moneda === 'USD') l.venta = ventaFromMargin(l);
  render();
}

// ---- Datalist unificado (Odoo + catálogos) -----------------------------
function refreshDatalist() {
  const dl = $('#odooList');
  const frag = document.createDocumentFragment();
  for (const p of Odoo.allProducts()) {
    const o = document.createElement('option');
    o.value = p.nombre;
    o.label = `Odoo${p.codigo ? ' ' + p.codigo : ''} · stock ${p.existencia ?? '?'}`;
    frag.appendChild(o);
  }
  for (const it of Catalogos.all()) {
    const o = document.createElement('option');
    o.value = it.nombre;
    o.label = it.tipo === 'mano_obra'
      ? `${it.origen} · ${it.moneda} ${it.venta}`
      : `${it.origen} · costo ${it.moneda} ${it.costo}`;
    frag.appendChild(o);
  }
  dl.innerHTML = '';
  dl.appendChild(frag);
}

// ---- Settings (datos base) ---------------------------------------------
let baseMeta = { odoo: null, cat: null };

function renderBaseStatus() {
  $('#baseStatus').textContent = `Odoo ${Odoo.odooCount()} · Listas ${Catalogos.count()}`;
  $('#baseStatus').className = 'pill pill-ok';
}

function renderSrcTable() {
  const rows = [];
  const oOrig = baseMeta.odoo?.origen === 'local'
    ? `actualizado ${baseMeta.odoo.fecha || ''}` : 'repositorio';
  rows.push(`<tr><td>Inventario Odoo</td><td>${Odoo.odooCount()}</td><td>${oOrig}</td><td></td></tr>`);
  const cOrig = baseMeta.cat?.origen === 'local'
    ? `actualizado ${baseMeta.cat.fecha || ''}` : 'repositorio';
  for (const s of Catalogos.sources())
    rows.push(`<tr><td>${s.origen}</td><td>${s.count}</td><td>${cOrig}</td><td></td></tr>`);
  $('#srcBody').innerHTML = rows.join('');
}

$('#settingsBtn').onclick = () => { renderSrcTable(); $('#settings').hidden = false; };
$('#settingsClose').onclick = () => { $('#settings').hidden = true; };
$('#settings').addEventListener('click', e => { if (e.target.id === 'settings') $('#settings').hidden = true; });

$('#updOdoo').onclick = () => $('#odooFile').click();
$('#odooFile').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const buf = await file.arrayBuffer();
    const { count, meta: m } = await Data.updateOdoo(buf);
    baseMeta.odoo = m; refreshDatalist(); renderBaseStatus(); renderSrcTable();
    alert(`Inventario Odoo actualizado: ${count} productos.`);
  } catch (err) { alert('No pude leer el Excel de Odoo: ' + err.message); }
  e.target.value = '';
});

$('#updCat').onclick = () => $('#catFile').click();
$('#catFile').addEventListener('change', async (e) => {
  const files = [...e.target.files]; if (!files.length) return;
  try {
    const { results, total, meta: m } = await Data.updateCatalogos(files);
    baseMeta.cat = m; refreshDatalist(); renderBaseStatus(); renderSrcTable();
    const resumen = results.map(r =>
      r.tipo === 'error' ? `✗ ${r.file}: ${r.error}`
      : r.tipo === 'desconocido' ? `? ${r.file}: formato no reconocido`
      : `✓ ${r.file} → ${r.tipo}: ${r.count}`).join('\n');
    alert(`Listas actualizadas (${total} ítems):\n` + resumen);
  } catch (err) { alert('Error cargando listas: ' + err.message); }
  e.target.value = '';
});

$('#resetBase').onclick = async () => {
  if (!confirm('¿Restablecer Odoo y las listas a la versión del repositorio? Se borran las actualizaciones locales.')) return;
  const { meta: m } = await Data.resetToRepo();
  baseMeta = m; refreshDatalist(); renderBaseStatus(); renderSrcTable();
  alert('Listas restablecidas a la base del repositorio.');
};

// ---- Meta + tasa + margen global ---------------------------------------
$('#metaCliente').addEventListener('input', e => { meta.cliente = e.target.value; schedulePersist(); });
$('#metaTipo').addEventListener('input', e => { meta.tipoProyecto = e.target.value; schedulePersist(); });
$('#metaVendedor').addEventListener('input', e => { meta.vendedor = e.target.value; schedulePersist(); });
$('#metaFecha').addEventListener('input', e => { meta.fecha = e.target.value; schedulePersist(); });
$('#metaConsideraciones').addEventListener('input', e => { meta.consideraciones = e.target.value; schedulePersist(); });
$('#tasaMercado').addEventListener('input', e => {
  meta.tasaMercado = Number(e.target.value) || 0;
  $('#tasaAplicada').value = tasaAplicada().toFixed(2);
  recalcUSD();
});
$('#marginGlobal').addEventListener('input', e => marginGlobal = Number(e.target.value) || 0);
$('#applyMarginAll').onclick = () => {
  for (const b of BLOCKS) for (const l of allLines(b)) {
    if (l.importado) continue;         // no pisar importados (90%)
    l.margen = marginGlobal; l.venta = ventaFromMargin(l);
  }
  render();
};

// ---- Nueva cotización / Export -----------------------------------------
$('#nuevoBtn').onclick = async () => {
  if (!confirm('¿Vaciar la cotización actual y empezar una nueva?')) return;
  for (const b of BLOCKS) b.grupos = [grupo(b.multi ? 'CCTV' : '')];
  meta.cliente = meta.tipoProyecto = meta.vendedor = meta.consideraciones = '';
  meta.fecha = new Date().toISOString().slice(0, 10);
  await Data.clearBorrador();
  hydrateMetaInputs();
  render();
};

$('#exportBtn').onclick = () => {
  if (!BLOCKS.some(b => allLines(b).length)) { alert('Agrega al menos una línea antes de exportar.'); return; }
  exportQuote({
    meta: { ...meta, tasaAplicada: tasaAplicada() },
    blocks: BLOCKS,
    compraDOP,
  });
};

// ---- Arranque -----------------------------------------------------------
function hydrateMetaInputs() {
  $('#metaCliente').value = meta.cliente || '';
  $('#metaTipo').value = meta.tipoProyecto || '';
  $('#metaVendedor').value = meta.vendedor || '';
  $('#metaFecha').value = meta.fecha || '';
  $('#metaConsideraciones').value = meta.consideraciones || '';
  $('#tasaMercado').value = meta.tasaMercado ?? 60;
  $('#marginGlobal').value = marginGlobal;
  $('#tasaAplicada').value = tasaAplicada().toFixed(2);
}

async function init() {
  try {
    const res = await Data.loadBase();
    baseMeta = res.meta;
  } catch (err) {
    $('#baseStatus').textContent = 'Error cargando base';
    console.error(err);
  }
  // restaurar borrador si existe
  try {
    const b = await Data.loadBorrador();
    if (b) {
      Object.assign(meta, b.meta || {});
      if (typeof b.marginGlobal === 'number') marginGlobal = b.marginGlobal;
      if (Array.isArray(b.blocks))
        for (const sb of b.blocks) {
          const blk = BLOCKS.find(x => x.id === sb.id);
          if (!blk) continue;
          if (Array.isArray(sb.grupos) && sb.grupos.length) {
            blk.grupos = sb.grupos.map(g => ({
              id: crypto.randomUUID(), nombre: g.nombre || '', lines: g.lines || [],
            }));
          } else if (Array.isArray(sb.lines)) {   // borrador en formato viejo
            blk.grupos = [{ id: crypto.randomUUID(), nombre: blk.multi ? 'CCTV' : '', lines: sb.lines }];
          }
        }
    }
  } catch (err) { console.error(err); }

  hydrateMetaInputs();
  refreshDatalist();
  renderBaseStatus();
  render();
}

init();
