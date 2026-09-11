// Genera el Excel de salida. Valores planos (sin fórmulas), limpio y editable.
// Pestaña 1 "Cotización": cabecera + bloques + totales + consideraciones.
// Pestaña 2 "Referencias": origen/fuente de cada precio.

const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function exportQuote({ meta, blocks, compraDOP }) {
  const wb = XLSX.utils.book_new();
  const rows = [];

  // ---- Cabecera ----
  rows.push(['COTIZACIÓN DE PREVENTA — AWM Sistemas de Seguridad']);
  rows.push([]);
  rows.push(['Cliente', meta.cliente || '']);
  rows.push(['Tipo de proyecto', meta.tipoProyecto || '']);
  rows.push(['Vendedor', meta.vendedor || '']);
  rows.push(['Fecha', meta.fecha || '']);
  rows.push(['Tasa USD aplicada', 'DO$ ' + money(meta.tasaAplicada).toFixed(2)]);
  rows.push([]);

  const HEAD = ['Descripción', 'Código Odoo', 'P. compra (DOP)', 'Margen %',
                'P. venta (DOP)', 'Cantidad', 'Subtotal (DOP)'];
  let gCosto = 0, gVenta = 0;

  const grupos = (b) => b.grupos || [{ nombre: '', lines: b.lines || [] }];

  for (const b of blocks) {
    if (!grupos(b).some(g => g.lines.length)) continue;
    rows.push([b.title.toUpperCase()]);
    let bCosto = 0, bVenta = 0;
    for (const g of grupos(b)) {
      if (!g.lines.length) continue;
      if (b.multi) rows.push([`  ▸ ${g.nombre || 'Sin nombre'}`]);   // subtítulo del apartado
      rows.push(HEAD);
      let sCosto = 0, sVenta = 0;
      for (const l of g.lines) {
        const c = compraDOP(l), q = Number(l.cantidad) || 0;
        rows.push([l.descripcion || '', l.codigo || '', money(c), Number(l.margen) || 0,
                   money(l.venta), q, money(l.venta * q)]);
        sCosto += c * q; sVenta += l.venta * q;
      }
      if (b.multi) rows.push(['', '', '', '', '', `Subtotal ${g.nombre || ''}`.trim(), money(sVenta)]);
      bCosto += sCosto; bVenta += sVenta;
    }
    rows.push(['', '', '', '', '', 'Subtotal bloque', money(bVenta)]);
    rows.push([]);
    gCosto += bCosto; gVenta += bVenta;
  }

  rows.push(['', '', '', '', '', 'COSTO TOTAL', money(gCosto)]);
  rows.push(['', '', '', '', '', 'VENTA TOTAL', money(gVenta)]);
  rows.push(['', '', '', '', '', 'UTILIDAD', money(gVenta - gCosto)]);
  rows.push(['', '', '', '', '', 'MARGEN EFECTIVO',
             (gVenta ? Math.round((gVenta - gCosto) / gVenta * 1000) / 10 : 0) + '%']);
  rows.push([]);
  rows.push(['CONSIDERACIONES ESPECIALES']);
  rows.push([meta.consideraciones || '—']);

  const ws1 = XLSX.utils.aoa_to_sheet(rows);
  ws1['!cols'] = [{ wch: 46 }, { wch: 14 }, { wch: 16 }, { wch: 10 },
                  { wch: 16 }, { wch: 10 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'Cotización');

  // ---- Pestaña 2: Referencias de precios ----
  const ref = [['Bloque / apartado', 'Descripción', 'Código', 'Moneda', 'P. compra (orig)',
                'Tasa aplicada', 'P. compra (DOP)', 'Fuente / referencia']];
  for (const b of blocks) {
    for (const g of grupos(b)) {
      const etq = b.multi && g.nombre ? `${b.title} · ${g.nombre}` : b.title;
      for (const l of g.lines) {
        ref.push([etq, l.descripcion || '', l.codigo || '', l.moneda,
                  money(l.compraOrig),
                  l.moneda === 'USD' ? money(meta.tasaAplicada) : '',
                  money(compraDOP(l)), l.fuente || '']);
      }
    }
  }
  const ws2 = XLSX.utils.aoa_to_sheet(ref);
  ws2['!cols'] = [{ wch: 18 }, { wch: 42 }, { wch: 14 }, { wch: 8 },
                  { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Referencias');

  const stamp = (meta.fecha || new Date().toISOString().slice(0, 10));
  const cli = (meta.cliente || 'cotizacion').replace(/[^\w\-]+/g, '_').slice(0, 30);
  XLSX.writeFile(wb, `Cotizacion_${cli}_${stamp}.xlsx`);
}
