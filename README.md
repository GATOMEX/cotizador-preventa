# Cotizador de Preventa — AWM

Herramienta web estática (HTML/JS, sin backend) para armar cotizaciones de
preventa: bloques de Tecnología, Materiales ferreteros, Cableado y Mano de obra,
con cruce contra inventario de Odoo y exportación a Excel editable.

## Uso

1. Abrir `index.html` (local o vía GitHub Pages).
2. **Cargar inventario Odoo** → seleccionar `productos_odoo.xlsx`.
3. Agregar líneas por bloque. Al escribir la descripción, el datalist sugiere
   productos de Odoo; al elegir/confirmar se rellena código, existencia y precio
   de compra.
4. Ajustar margen (global o por línea) y cantidades.
5. **Exportar Excel** → genera `.xlsx` con una hoja por bloque + Resumen.
   Sin fórmulas ni protección: totalmente editable.

## Formato del Excel de Odoo

Primera hoja, primera fila = encabezados. Se reconocen (tolerante a acentos/mayúsculas):

| Campo          | Encabezados aceptados |
|----------------|-----------------------|
| Nombre         | nombre, descripción, producto, name |
| Código interno | código interno, codigo, default_code, ref, referencia |
| Existencia     | existencia, stock, qty_available, disponible, cantidad |
| Precio         | precio, precio de compra, costo, standard_price, cost |

Solo *nombre* es obligatorio.

## Reglas de negocio

**Margen (markup sobre costo):** `venta = compra_DOP × (1 + margen%)`.
- General: **60%**
- Importado (checkbox por línea): **90%**

Editar el margen recalcula la venta; editar la venta recalcula el margen.
**Aplicar** fuerza el margen general a las líneas NO importadas.

**Tipo de cambio USD→DOP:** tasa aplicada = **tasa de mercado + 2**
(mercado DO$60 → se cotiza a DO$62). Cada línea puede estar en DOP o USD; si es
USD, el costo se convierte a DOP con la tasa aplicada. Cambiar la tasa recalcula
todas las líneas en USD.

## Salida (Excel)

- **Pestaña 1 — Cotización:** cabecera (cliente, tipo de proyecto, vendedor,
  fecha, tasa aplicada), bloques con sus líneas y subtotales, totales generales
  y el cuadro de consideraciones especiales.
- **Pestaña 2 — Referencias:** origen de cada precio (moneda, precio original,
  tasa aplicada, precio en DOP, fuente/lista).

Sin fórmulas ni protección: totalmente editable.

## Publicar en GitHub Pages

Repo → Settings → Pages → *Deploy from a branch* → `main` / `/root`.
El `.nojekyll` evita el procesamiento Jekyll.

## Arquitectura

- `index.html` — layout y carga de SheetJS (CDN).
- `css/styles.css` — estilos.
- `js/odoo.js` — lectura del Excel de Odoo + búsqueda/match.
- `js/exportXlsx.js` — generación del Excel de salida.
- `js/app.js` — modelo de línea, render de bloques, cálculo de margen/subtotales.

Todos los bloques comparten el mismo modelo de línea. Las próximas fases
(auto-relleno de canalización, motor de reglas de completitud) sólo **empujan
líneas** a esos bloques; no se rehace la arquitectura.

## Roadmap

- [x] Núcleo de líneas + cálculo margen/subtotal + Odoo + export
- [x] Márgenes 60/90, tasa USD (+2), moneda por línea, referencias de precios
- [ ] Integrar listas de precios de fabricantes (Hanwha, etc.) y mano de obra
- [ ] Canalización: dado diámetro y metros → accesorios (codos, coples, cajas…)
- [ ] Motor de completitud: p.ej. N cámaras 8MP → sugerir NVR/switch PoE por canales/consumo
- [ ] Persistencia local (localStorage) del borrador de cotización
- [ ] Actualización del inventario Odoo (manual vs. archivo en repo)
