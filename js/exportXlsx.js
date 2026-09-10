// Genera el Excel de salida. Valores planos (sin fórmulas), limpio y editable.
// Una hoja por bloque + hoja "Resumen". SheetJS aoa_to_sheet.

const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

function blockSheet(lines) {
  const head = ['Descripción', 'Código Odoo', 'Existencia', 'Precio compra',
                'Margen %', 'Precio venta', 'Cantidad', 'Subtotal'];
  const body = lines.map(l => ([
    l.descripcion || '',
    l.codigo || '',
    l.existencia === null || l.existencia === undefined ? '' : l.existencia,
    money(l.compra),
    Number(l.margen) || 0,
    money(l.venta),
    Number(l.cantidad) || 0,
    money(l.venta * l.cantidad),
  ]));
  const costo = lines.reduce((a, l) => a + money(l.compra) * (Number(l.cantidad) || 0), 0);
  const venta = lines.reduce((a, l) => a + money(l.venta) * (Number(l.cantidad) || 0), 0);
  body.push([]);
  body.push(['', '', '', 'Totales', '', money(costo), '', money(venta)]);
  const ws = XLSX.utils.aoa_to_sheet([head, ...body]);
  ws['!cols'] = [{ wch: 46 }, { wch: 14 }, { wch: 10 }, { wch: 14 },
                 { wch: 9 }, { wch: 14 }, { wch: 9 }, { wch: 14 }];
  return ws;
}

export function exportQuote({ meta, blocks }) {
  const wb = XLSX.utils.book_new();

  // Resumen primero
  const resumen = [
    ['COTIZACIÓN DE PREVENTA — AWM'],
    [],
    ['Cliente', meta.cliente || ''],
    ['Proyecto', meta.proyecto || ''],
    ['Vendedor', meta.vendedor || ''],
    ['Fecha', new Date().toLocaleDateString('es-DO')],
    [],
    ['Bloque', 'Costo', 'Venta', 'Utilidad'],
  ];
  let gCosto = 0, gVenta = 0;
  for (const b of blocks) {
    const costo = b.lines.reduce((a, l) => a + money(l.compra) * (Number(l.cantidad) || 0), 0);
    const venta = b.lines.reduce((a, l) => a + money(l.venta) * (Number(l.cantidad) || 0), 0);
    if (b.lines.length) resumen.push([b.title, money(costo), money(venta), money(venta - costo)]);
    gCosto += costo; gVenta += venta;
  }
  resumen.push([]);
  resumen.push(['TOTAL', money(gCosto), money(gVenta), money(gVenta - gCosto)]);
  resumen.push(['Margen efectivo', gVenta ? Math.round((gVenta - gCosto) / gVenta * 1000) / 10 + '%' : '0%']);
  const wsR = XLSX.utils.aoa_to_sheet(resumen);
  wsR['!cols'] = [{ wch: 22 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsR, 'Resumen');

  for (const b of blocks) {
    if (!b.lines.length) continue;
    XLSX.utils.book_append_sheet(wb, blockSheet(b.lines), b.sheet);
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const cli = (meta.cliente || 'cotizacion').replace(/[^\w\-]+/g, '_').slice(0, 30);
  XLSX.writeFile(wb, `Cotizacion_${cli}_${stamp}.xlsx`);
}
