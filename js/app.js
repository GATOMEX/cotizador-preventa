import * as Odoo from './odoo.js';
import { exportQuote } from './exportXlsx.js';

// ---- Modelo -------------------------------------------------------------
// Todos los bloques comparten el mismo modelo de línea. Canalización y el
// motor de completitud (fases siguientes) sólo EMPUJAN líneas a estos arrays.
const BLOCKS = [
  { id: 'tecnologia', title: 'Tecnología', sheet: 'Tecnologia',
    sub: 'Cámaras, NVR/DVR, switches PoE, control de acceso…', lines: [] },
  { id: 'ferreteria', title: 'Materiales ferreteros', sheet: 'Ferreteria',
    sub: 'Tubería/canalización y accesorios (auto-relleno: fase próxima)', lines: [] },
  { id: 'cableado', title: 'Cableado y accesorios', sheet: 'Cableado',
    sub: 'UTP, conectores, jacks, patch cords…', lines: [] },
  { id: 'manoObra', title: 'Mano de obra', sheet: 'ManoObra',
    sub: 'Instalación, configuración, puesta en marcha', lines: [] },
];

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
}

function renderBlock(b) {
  const wrap = document.createElement('section');
  wrap.className = 'block card';
  wrap.innerHTML = `
    <div class="block-head">
      <div><h2>${b.title}</h2><div class="block-sub">${b.sub}</div></div>
      <button class="btn btn-sm" data-add="${b.id}">+ Agregar línea</button>
    </div>
    <div class="table-wrap"><table>
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
      </tr></thead>
      <tbody></tbody>
    </table></div>`;
  const tb = $('tbody', wrap);
  if (!b.lines.length) {
    tb.innerHTML = `<tr><td colspan="11" class="muted center" style="padding:14px">
      Sin líneas. Usa “+ Agregar línea”.</td></tr>`;
  } else {
    for (const l of b.lines) tb.appendChild(renderRow(b, l));
  }
  $(`[data-add="${b.id}"]`, wrap).onclick = () => { b.lines.push(newLine()); render(); };
  return wrap;
}

function renderRow(b, l) {
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
      inp.addEventListener('change', () => tryOdoo(l));
  });
  tr.querySelector('.btn-danger').onclick = () => {
    b.lines = b.lines.filter(x => x.id !== l.id); render();
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
}

function syncRow(l, tr, inputs) {
  if (inputs.margen) inputs.margen.value = l.margen;
  if (inputs.venta) inputs.venta.value = l.venta;
  tr.querySelector('[data-sub]').textContent = fmt(l.venta * l.cantidad);
  renderTotals();
}

function tryOdoo(l) {
  if (!Odoo.odooCount()) return;
  const hit = Odoo.match({ descripcion: l.descripcion, codigo: l.codigo });
  if (!hit) return;
  l.descripcion = hit.nombre;
  if (hit.codigo) l.codigo = hit.codigo;
  l.existencia = hit.existencia;
  if (hit.precio != null && hit.precio > 0) {
    l.moneda = 'DOP';                 // el precio de Odoo se asume en DOP
    l.compraOrig = round2(hit.precio);
    l.venta = ventaFromMargin(l);
    if (!l.fuente) l.fuente = 'Odoo (inventario)';
  }
  render();
}

function renderTotals() {
  let costo = 0, venta = 0;
  for (const b of BLOCKS)
    for (const l of b.lines) {
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
    for (const l of b.lines) if (l.moneda === 'USD') l.venta = ventaFromMargin(l);
  render();
}

// ---- Odoo: carga + datalist --------------------------------------------
function refreshDatalist() {
  const dl = $('#odooList');
  dl.innerHTML = '';
  for (const p of Odoo.allProducts().slice(0, 2000)) {
    const o = document.createElement('option');
    o.value = p.nombre;
    o.label = p.codigo ? `${p.codigo} · stock ${p.existencia ?? '?'}` : '';
    dl.appendChild(o);
  }
}

$('#odooBtn').onclick = () => $('#odooFile').click();
$('#odooFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const buf = await file.arrayBuffer();
    const { count } = Odoo.loadOdooFromArrayBuffer(buf);
    refreshDatalist();
    const s = $('#odooStatus');
    s.textContent = `Odoo: ${count} productos`;
    s.className = 'pill pill-ok';
  } catch (err) {
    alert('No pude leer el Excel de Odoo: ' + err.message);
  }
});

// ---- Meta + tasa + margen global ---------------------------------------
$('#metaCliente').addEventListener('input', e => meta.cliente = e.target.value);
$('#metaTipo').addEventListener('input', e => meta.tipoProyecto = e.target.value);
$('#metaVendedor').addEventListener('input', e => meta.vendedor = e.target.value);
$('#metaFecha').value = meta.fecha;
$('#metaFecha').addEventListener('input', e => meta.fecha = e.target.value);
$('#metaConsideraciones').addEventListener('input', e => meta.consideraciones = e.target.value);
$('#tasaMercado').addEventListener('input', e => {
  meta.tasaMercado = Number(e.target.value) || 0;
  $('#tasaAplicada').value = tasaAplicada().toFixed(2);
  recalcUSD();
});
$('#marginGlobal').addEventListener('input', e => marginGlobal = Number(e.target.value) || 0);
$('#applyMarginAll').onclick = () => {
  for (const b of BLOCKS) for (const l of b.lines) {
    if (l.importado) continue;         // no pisar importados (90%)
    l.margen = marginGlobal; l.venta = ventaFromMargin(l);
  }
  render();
};

// ---- Export -------------------------------------------------------------
$('#exportBtn').onclick = () => {
  if (!BLOCKS.some(b => b.lines.length)) { alert('Agrega al menos una línea antes de exportar.'); return; }
  exportQuote({
    meta: { ...meta, tasaAplicada: tasaAplicada() },
    blocks: BLOCKS,
    compraDOP,
  });
};

// arranque
$('#tasaAplicada').value = tasaAplicada().toFixed(2);
render();
