// Carga de datos base + persistencia. Sin servidor: la base vive versionada en
// data/*.json (repo) y cualquier actualización se guarda como override local en
// IndexedDB, que tiene prioridad sobre el repo hasta que se restablezca.

import * as Odoo from './odoo.js';
import * as Catalogos from './catalogos.js';
import * as idb from './idb.js';

const K = {
  odoo: 'odoo', odooMeta: 'odoo_meta',
  cat: 'catalogos', catMeta: 'catalogos_meta',
  borrador: 'borrador',
};

async function fetchJSON(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

// Puebla Odoo y Catálogos desde IndexedDB (override) o desde el repo (base).
export async function loadBase() {
  const meta = { odoo: null, cat: null };

  let odoo = await idb.get(K.odoo);
  if (odoo) meta.odoo = (await idb.get(K.odooMeta)) || { origen: 'local' };
  else { odoo = await fetchJSON('data/odoo.json'); meta.odoo = { origen: 'repo' }; }
  Odoo.setProducts(odoo);

  let cat = await idb.get(K.cat);
  if (cat) meta.cat = (await idb.get(K.catMeta)) || { origen: 'local' };
  else { cat = await fetchJSON('data/catalogos.json'); meta.cat = { origen: 'repo' }; }
  Catalogos.setItems(cat);

  return { odooCount: Odoo.odooCount(), catCount: Catalogos.count(),
           sources: Catalogos.sources(), meta };
}

// Actualiza Odoo desde un xlsx cargado y lo persiste como override local.
export async function updateOdoo(arrayBuffer) {
  const { count } = Odoo.loadOdooFromArrayBuffer(arrayBuffer);
  const meta = { origen: 'local', fecha: new Date().toISOString().slice(0, 10) };
  await idb.set(K.odoo, Odoo.allProducts());
  await idb.set(K.odooMeta, meta);
  return { count, meta };
}

// Actualiza una o varias listas de fabricante/MO y persiste el conjunto.
export async function updateCatalogos(fileList) {
  const res = await Catalogos.loadFiles(fileList);
  const meta = { origen: 'local', fecha: new Date().toISOString().slice(0, 10) };
  await idb.set(K.cat, Catalogos.all());
  await idb.set(K.catMeta, meta);
  return { ...res, meta };
}

// Restablece TODO a la base del repo (borra overrides locales).
export async function resetToRepo() {
  await idb.del(K.odoo); await idb.del(K.odooMeta);
  await idb.del(K.cat); await idb.del(K.catMeta);
  return loadBase();
}

// ---- Borrador de la cotización -----------------------------------------
export async function saveBorrador(state) { await idb.set(K.borrador, state); }
export async function loadBorrador() { return idb.get(K.borrador); }
export async function clearBorrador() { await idb.del(K.borrador); }
