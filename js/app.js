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

const meta = { cliente: '', proyecto: '', vendedor: '' };
let marginGlobal = 30;

const newLine = (over = {}) => ({
  id: crypto.randomUUID(),
  descripcion: '', codigo: '', existencia: null,
  compra: 0, margen: marginGlobal, venta: 0, cantidad: 1,
  ...over,
});

// ---- Cálculo de línea ---------------------------------------------------
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function ventaFromMargin(l) { return round2(l.compra * (1 + (Number(l.margen) || 0) / 100)); }
function marginFromVenta(l) {
  if (!l.compra) return 0;
  return round2((l.venta / l.compra - 1) * 100);
}

// ---- Utilidades DOM -----------------------------------------------------
const $ = (s, r = document) => r.querySelector(s);
const fmt = (n) => 'RD$ ' + (Number(n) || 0).toLocaleString('es-DO',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
    <table>
      <thead><tr>
        <th>Descripción</th>
        <th class="col-code">Código Odoo</th>
        <th class="col-money">P. compra</th>
        <th class="col-margin">Margen %</th>
        <th class="col-money">P. venta</th>
        <th class="col-qty">Cant.</th>
        <th class="col-money">Subtotal</th>
        <th class="col-act"></th>
      </tr></thead>
      <tbody></tbody>
    </table>`;
  const tb = $('tbody', wrap);
  if (!b.lines.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="8" class="muted" style="text-align:center;padding:14px">
      Sin líneas. Usa “+ Agregar línea”.</td>`;
    tb.appendChild(tr);
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
    <td class="num col-money"><input data-f="compra" type="number" step="0.01" min="0" value="${l.compra}" /></td>
    <td class="num col-margin"><input data-f="margen" type="number" step="1" value="${l.margen}" /></td>
    <td class="num col-money"><input data-f="venta" type="number" step="0.01" min="0" value="${l.venta}" /></td>
    <td class="num col-qty"><input data-f="cantidad" type="number" step="1" min="0" value="${l.cantidad}" /></td>
    <td class="readonly col-money">${fmt(l.venta * l.cantidad)}</td>
    <td class="col-act"><button class="btn btn-sm btn-danger" title="Eliminar">✕</button></td>`;

  const inputs = {};
  tr.querySelectorAll('input[data-f]').forEach(inp => {
    inputs[inp.dataset.f] = inp;
    inp.addEventListener('input', () => onField(b, l, inp.dataset.f, inp.value, tr, inputs));
    if (inp.dataset.f === 'descripcion' || inp.dataset.f === 'codigo')
      inp.addEventListener('change', () => tryOdoo(b, l));
  });
  tr.querySelector('.btn-danger').onclick = () => {
    b.lines = b.lines.filter(x => x.id !== l.id);
    render();
  };
  return tr;
}

// Actualiza el modelo y refresca SOLO las celdas afectadas de la fila activa,
// sin re-render (para no perder foco mientras se escribe).
function onField(b, l, field, value, tr, inputs) {
  if (field === 'descripcion' || field === 'codigo') { l[field] = value; return; }
  l[field] = Number(value) || 0;
  if (field === 'compra' || field === 'margen') {
    l.venta = ventaFromMargin(l);
    if (inputs.venta && document.activeElement !== inputs.venta) inputs.venta.value = l.venta;
  } else if (field === 'venta') {
    l.margen = marginFromVenta(l);
    if (inputs.margen && document.activeElement !== inputs.margen) inputs.margen.value = l.margen;
  }
  tr.querySelector('td.readonly').textContent = fmt(l.venta * l.cantidad);
  renderTotals();
}

function tryOdoo(b, l) {
  if (!Odoo.odooCount()) return;
  const hit = Odoo.match({ descripcion: l.descripcion, codigo: l.codigo });
  if (!hit) return;
  l.descripcion = hit.nombre;
  if (hit.codigo) l.codigo = hit.codigo;
  l.existencia = hit.existencia;
  if (hit.precio != null && hit.precio > 0) {
    l.compra = round2(hit.precio);
    l.venta = ventaFromMargin(l);
  }
  render();
}

function renderTotals() {
  let costo = 0, venta = 0;
  for (const b of BLOCKS)
    for (const l of b.lines) {
      costo += (Number(l.compra) || 0) * (Number(l.cantidad) || 0);
      venta += (Number(l.venta) || 0) * (Number(l.cantidad) || 0);
    }
  $('#tCosto').textContent = fmt(costo);
  $('#tVenta').textContent = fmt(venta);
  $('#tUtil').textContent = fmt(venta - costo);
  $('#tMargen').textContent = (venta ? Math.round((venta - costo) / venta * 1000) / 10 : 0) + '%';
}

function esc(s) { return String(s ?? '').replace(/"/g, '&quot;'); }

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
    render();
  } catch (err) {
    alert('No pude leer el Excel de Odoo: ' + err.message);
  }
});

// ---- Meta + margen global ----------------------------------------------
$('#metaCliente').addEventListener('input', e => meta.cliente = e.target.value);
$('#metaProyecto').addEventListener('input', e => meta.proyecto = e.target.value);
$('#metaVendedor').addEventListener('input', e => meta.vendedor = e.target.value);
$('#marginGlobal').addEventListener('input', e => marginGlobal = Number(e.target.value) || 0);
$('#applyMarginAll').onclick = () => {
  for (const b of BLOCKS) for (const l of b.lines) {
    l.margen = marginGlobal; l.venta = ventaFromMargin(l);
  }
  render();
};

// ---- Export -------------------------------------------------------------
$('#exportBtn').onclick = () => {
  const anyLines = BLOCKS.some(b => b.lines.length);
  if (!anyLines) { alert('Agrega al menos una línea antes de exportar.'); return; }
  exportQuote({ meta, blocks: BLOCKS });
};

// arranque
render();
