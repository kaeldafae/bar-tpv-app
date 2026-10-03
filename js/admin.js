// Administración: productos y secciones, inventario y ajustes.
import { get, post, patch, del, download } from './api.js';
import { h, clear, eur, parseEuros, parseScaled, centsToInput, UNITS, qtyText, parseQty, qtyToInput, packagesText, pct, fmtDateTime } from './util.js';
import { modal, toast, errorToast, confirmDialog, askText, formDialog } from './ui.js';

const PALETTE = ['#9A4F12', '#6B4226', '#8A6A0C', '#9E2A52', '#1D6688', '#5B3EA0', '#2F6B3A', '#3F5A63', '#8C2F2F', '#475569'];
const STATUS = { ok: ['Bien', 'badge-ok'], bajo: ['Quedan pocos', 'badge-low'], agotado: ['AGOTADO', 'badge-out'] };

let tab = 'productos';
let ctxRef = null;

export async function render(main, ctx) {
  ctxRef = ctx;
  const body = h('div', { class: 'admin-body' });
  const tabs = h('div', { class: 'row admin-tabs' });
  const drawTabs = () => {
    clear(tabs);
    for (const [key, label] of [['productos', 'Productos'], ['inventario', 'Inventario'], ['ajustes', 'Ajustes']]) {
      tabs.append(h('button', { class: `btn pill${tab === key ? ' on' : ''}`, onclick: () => { tab = key; drawTabs(); load(); } }, label));
    }
  };
  async function load() {
    clear(body);
    body.append(h('p', { class: 'muted' }, 'Cargando…'));
    try {
      const view = tab === 'productos' ? productsTab : tab === 'inventario' ? inventoryTab : settingsTab;
      const content = await view(load);
      clear(body).append(content);
    } catch (err) {
      clear(body).append(h('p', { class: 'field-error' }, err.message));
    }
  }
  main.append(h('div', { class: 'admin' }, h('h1', {}, 'Administración'), tabs, body));
  drawTabs();
  await load();
  return null;
}

const statusBadge = (s) => h('span', { class: `badge ${STATUS[s][1]}` }, STATUS[s][0]);

// --- Productos -----------------------------------------------------------------

let filterCat = null;

async function productsTab(reload) {
  const [cats, products, ings] = await Promise.all([get('/api/categories'), get('/api/products'), get('/api/ingredients')]);
  if (filterCat && !cats.find((c) => c.id === filterCat)) filterCat = null;
  const catName = (id) => (cats.find((c) => c.id === id) || {}).name || '—';

  const chips = h('div', { class: 'row wrap' },
    h('button', { class: `chip${filterCat === null ? ' on' : ''}`, onclick: () => { filterCat = null; reload(); } }, 'Todas'),
    cats.map((c) => h('button', { class: `chip${filterCat === c.id ? ' on' : ''}`, style: `--cat:${c.color}`, onclick: () => { filterCat = c.id; reload(); } }, c.name)),
    h('button', { class: 'chip dashed', onclick: () => editCategory(null, reload) }, '+ Nueva sección'),
    filterCat ? h('button', { class: 'chip', onclick: () => editCategory(cats.find((c) => c.id === filterCat), reload) }, 'Editar sección') : null,
    filterCat ? h('button', { class: 'chip danger-text', onclick: () => deleteCategory(cats.find((c) => c.id === filterCat), reload) }, 'Eliminar sección') : null,
  );

  const rows = products.filter((p) => filterCat === null || p.category_id === filterCat).map((p) => {
    let priceCell;
    if (p.kind === 'simple') {
      const input = h('input', { class: 'price-input', value: centsToInput(p.price_cents), inputmode: 'decimal', 'aria-label': `Precio de ${p.name}` });
      const save = async () => {
        const cents = parseEuros(input.value);
        if (cents === null) { errorToast('Precio no válido.'); input.value = centsToInput(p.price_cents); return; }
        if (cents === p.price_cents) return;
        try { await patch(`/api/products/${p.id}`, { price_cents: cents }); toast(`${p.name}: ${eur(cents)}`); reload(); } catch (err) { errorToast(err); }
      };
      input.addEventListener('change', save);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
      priceCell = input;
    } else {
      priceCell = h('span', { class: 'muted' }, 'según licor');
    }
    return h('tr', { class: p.active ? '' : 'inactive' },
      h('td', { class: 'strong' }, p.name, p.active ? null : h('span', { class: 'muted small' }, ' (no visible en venta)')),
      h('td', {}, catName(p.category_id)),
      h('td', {}, priceCell),
      h('td', {}, statusBadge(p.status)),
      h('td', { class: 'num' }, p.kind === 'simple' ? eur(p.cost_cents) : '—'),
      h('td', { class: 'num' }, p.kind === 'simple' ? `${eur(p.margin_cents)} · ${pct(p.margin_pct)}` : '—'),
      h('td', { class: 'actions' },
        h('button', { class: 'btn ghost small-btn', onclick: () => editProduct(p, cats, ings, reload) }, 'Editar'),
        h('button', { class: 'btn ghost small-btn danger-text', onclick: () => deleteProduct(p, reload) }, 'Eliminar')));
  });

  return h('div', { class: 'stack' },
    h('div', { class: 'row between' }, chips,
      h('button', { class: 'btn primary', onclick: () => editProduct(null, cats, ings, reload), disabled: !cats.length }, '+ Añadir producto')),
    rows.length ? h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, ['Producto', 'Sección', 'Precio final', 'Disponibilidad', 'Coste', 'Margen', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, rows)) : h('p', { class: 'empty' }, cats.length ? 'No hay productos en esta sección.' : 'Crea primero una sección.'),
    h('p', { class: 'muted small' }, 'Precios finales con IVA incluido. Para cambiar un precio, escríbelo y pulsa Intro. Un producto agotado no se puede vender hasta registrar una compra o un recuento en Inventario.'));
}

async function editCategory(cat, reload) {
  const values = await formDialog({
    title: cat ? 'Editar sección' : 'Nueva sección',
    fields: [
      { name: 'name', label: 'Nombre', value: cat ? cat.name : '' },
      { name: 'color', label: 'Color de los botones', type: 'color', value: cat ? cat.color : PALETTE[0], options: PALETTE },
    ],
    validate: (v) => (v.name.trim() ? null : 'Escribe el nombre.'),
  });
  if (!values) return;
  try {
    if (cat) await patch(`/api/categories/${cat.id}`, { name: values.name.trim(), color: values.color });
    else await post('/api/categories', { name: values.name.trim(), color: values.color });
    toast('Sección guardada.');
    reload();
  } catch (err) { errorToast(err); }
}

async function deleteCategory(cat, reload) {
  if (!(await confirmDialog({ title: `¿Eliminar la sección «${cat.name}»?`, message: 'Solo se puede eliminar si no tiene productos.', confirmText: 'Eliminar', danger: true }))) return;
  try { await del(`/api/categories/${cat.id}`); filterCat = null; toast('Sección eliminada.'); reload(); } catch (err) { errorToast(err); }
}

async function deleteProduct(p, reload) {
  if (!(await confirmDialog({ title: `¿Eliminar «${p.name}»?`, message: 'Si ya se ha vendido, se archiva: desaparece de la venta pero se conserva en los informes.', confirmText: 'Eliminar', danger: true }))) return;
  try {
    const r = await del(`/api/products/${p.id}`);
    toast(r.result === 'archived' ? 'Producto archivado (tenía ventas).' : 'Producto eliminado.');
    reload();
  } catch (err) { errorToast(err); }
}

function ingredientSelect(ings, value, { allowNone = false, onlyUnit = null } = {}) {
  const opts = ings.filter((i) => !onlyUnit || i.unit === onlyUnit);
  return h('select', {},
    allowNone ? h('option', { value: '', selected: !value }, 'Ninguno (no descuenta nada)') : null,
    !allowNone && !value ? h('option', { value: '', selected: true }, 'Elige un insumo…') : null,
    opts.map((i) => h('option', { value: i.id, selected: i.id === value }, `${i.name} (${UNITS[i.unit].label})`)));
}

async function editProduct(p, cats, ings, reload) {
  const isNew = !p;
  let kind = p ? p.kind : 'simple';
  const ingById = Object.fromEntries(ings.map((i) => [i.id, i]));
  const result = await modal((close) => {
    const name = h('input', { id: 'pe-name', value: p ? p.name : '', maxlength: 120 });
    const cat = h('select', { id: 'pe-cat' }, cats.map((c) => h('option', { value: c.id, selected: p ? c.id === p.category_id : c.id === filterCat }, c.name)));
    const price = h('input', { id: 'pe-price', inputmode: 'decimal', value: p && p.kind === 'simple' ? centsToInput(p.price_cents) : '' });
    const active = h('input', { id: 'pe-active', type: 'checkbox', checked: p ? p.active : true });
    const preview = h('div', { class: 'muted strong' });
    const error = h('p', { class: 'field-error' });
    const recipeBox = h('div', { class: 'stack' });
    const optionsBox = h('div', { class: 'stack' });
    const simplePart = h('div', { class: 'stack' });
    const comboPart = h('div', { class: 'stack' });
    const recipeRows = [];
    const optionRows = [];

    function addRecipeRow(item) {
      const sel = ingredientSelect(ings, item ? item.ingredient_id : null);
      const qty = h('input', { class: 'qty-input', inputmode: 'decimal', value: item ? qtyToInput(item.qty, ingById[item.ingredient_id]?.unit || 'ud') : '' });
      const unit = h('span', { class: 'muted' });
      const row = { sel, qty };
      const sync = () => { const i = ingById[Number(sel.value)]; unit.textContent = i ? UNITS[i.unit].label : ''; updatePreview(); };
      sel.addEventListener('change', sync);
      qty.addEventListener('input', updatePreview);
      const el = h('div', { class: 'row recipe-row' }, sel, qty, unit,
        h('button', { class: 'btn ghost small-btn', type: 'button', 'aria-label': 'Quitar', onclick: () => { recipeRows.splice(recipeRows.indexOf(row), 1); el.remove(); updatePreview(); } }, 'Quitar'));
      recipeRows.push(row);
      recipeBox.append(el);
      sync();
    }

    function addOptionRow(o) {
      const grp = o.grp;
      const label = h('input', { value: o.label || '', placeholder: grp === 'licor' ? 'Ej.: Brugal Añejo' : 'Ej.: Coca-Cola', maxlength: 120 });
      const sel = ingredientSelect(ings, o.ingredient_id || null, { allowNone: grp === 'refresco', onlyUnit: grp === 'licor' ? 'ml' : null });
      const qty = h('input', { class: 'qty-input', inputmode: 'decimal', value: o.ingredient_id ? qtyToInput(o.qty, ingById[o.ingredient_id]?.unit || 'ud') : (grp === 'licor' ? '5' : '1') });
      const unit = h('span', { class: 'muted' });
      const priceIn = grp === 'licor' ? h('input', { class: 'price-input', inputmode: 'decimal', value: o.price_cents != null ? centsToInput(o.price_cents) : '', placeholder: 'Precio' }) : null;
      const row = { grp, label, sel, qty, priceIn };
      const sync = () => {
        const i = ingById[Number(sel.value)];
        unit.textContent = i ? UNITS[i.unit].label : '';
        qty.disabled = !i;
        if (i && !label.value.trim()) label.value = i.name.replace(/^(Ron|Whisky|Cerveza)\s+/i, '');
      };
      sel.addEventListener('change', sync);
      const el = h('div', { class: 'row recipe-row' }, label, sel, qty, unit, priceIn,
        h('button', { class: 'btn ghost small-btn', type: 'button', onclick: () => { optionRows.splice(optionRows.indexOf(row), 1); el.remove(); } }, 'Quitar'));
      optionRows.push(row);
      (grp === 'licor' ? licorBox : mixerBox).append(el);
      sync();
    }

    function recipeCost() {
      let mc = 0;
      for (const r of recipeRows) {
        const i = ingById[Number(r.sel.value)];
        const q = i ? parseQty(r.qty.value, i.unit) : null;
        if (i && q) mc += q * i.cost_mc;
      }
      return Math.round(mc / 1000);
    }

    function updatePreview() {
      if (kind !== 'simple') { preview.textContent = ''; return; }
      const cost = recipeCost();
      const pr = parseEuros(price.value);
      preview.textContent = pr !== null && pr > 0
        ? `Coste ${eur(cost)} · Margen ${eur(pr - cost)} · ${Math.round(((pr - cost) * 1000) / pr) / 10} %`
        : `Coste ${eur(cost)}`;
    }
    price.addEventListener('input', updatePreview);

    const licorBox = h('div', { class: 'stack' });
    const mixerBox = h('div', { class: 'stack' });
    simplePart.append(
      h('label', { for: 'pe-price' }, 'Precio final (€, IVA incluido)'), price,
      h('h3', {}, 'Qué descuenta del inventario cada unidad vendida'),
      recipeBox,
      h('button', { class: 'btn ghost', type: 'button', onclick: () => addRecipeRow(null) }, '+ Añadir insumo'),
      h('p', { class: 'muted small' }, 'Ejemplos: copa = 5 cl de la botella · cerveza = 1 ud · plato = 1 ración. Un producto sin insumos nunca se agota.'),
      preview);
    comboPart.append(
      h('h3', {}, 'Licores (cada uno con su precio final)'), licorBox,
      h('button', { class: 'btn ghost', type: 'button', onclick: () => addOptionRow({ grp: 'licor' }) }, '+ Añadir licor'),
      h('h3', {}, 'Refrescos'), mixerBox,
      h('button', { class: 'btn ghost', type: 'button', onclick: () => addOptionRow({ grp: 'refresco' }) }, '+ Añadir refresco'));

    if (p && p.kind === 'simple') (p.recipe || []).forEach(addRecipeRow);
    if (p && p.kind === 'combinado') p.options.forEach(addOptionRow);
    if (!p) addRecipeRow(null);

    const kindSel = h('select', { id: 'pe-kind', disabled: !isNew },
      h('option', { value: 'simple', selected: kind === 'simple' }, 'Producto normal'),
      h('option', { value: 'combinado', selected: kind === 'combinado' }, 'Combinado (eligiendo licor y refresco)'));
    const showKind = () => {
      simplePart.classList.toggle('hidden', kind !== 'simple');
      comboPart.classList.toggle('hidden', kind !== 'combinado');
      if (kind === 'combinado' && !optionRows.length) { addOptionRow({ grp: 'licor' }); addOptionRow({ grp: 'refresco' }); }
      updatePreview();
    };
    kindSel.addEventListener('change', () => { kind = kindSel.value; showKind(); });
    showKind();

    function collect() {
      const n = name.value.trim();
      if (!n) return 'Escribe el nombre.';
      const body = { name: n, category_id: Number(cat.value), active: active.checked };
      if (kind === 'simple') {
        const pr = parseEuros(price.value);
        if (pr === null) return 'Precio no válido. Ejemplo: 6 o 6,50';
        body.price_cents = pr;
        body.recipe = [];
        for (const r of recipeRows) {
          if (!r.sel.value && !r.qty.value.trim()) continue;
          const i = ingById[Number(r.sel.value)];
          if (!i) return 'Elige el insumo en todas las líneas de la receta (o quita las vacías).';
          const q = parseQty(r.qty.value, i.unit);
          if (!q) return `Cantidad no válida para ${i.name}. ${i.unit === 'ml' ? 'En cl, por ejemplo 5 o 4,5.' : 'Número entero.'}`;
          body.recipe.push({ ingredient_id: i.id, qty: q });
        }
      } else {
        body.options = [];
        for (const r of optionRows) {
          const i = ingById[Number(r.sel.value)];
          const label = r.label.value.trim() || (i ? i.name : '');
          if (!label) return 'Cada opción necesita un nombre.';
          const opt = { grp: r.grp, label, ingredient_id: i ? i.id : null, qty: 0 };
          if (i) {
            const q = parseQty(r.qty.value, i.unit);
            if (!q) return `Cantidad no válida en «${label}».`;
            opt.qty = q;
          }
          if (r.grp === 'licor') {
            if (!i) return `Elige la botella del licor «${label}».`;
            const pr = parseEuros(r.priceIn.value);
            if (pr === null) return `Precio no válido en «${label}».`;
            opt.price_cents = pr;
          }
          body.options.push(opt);
        }
        if (isNew) body.kind = 'combinado';
      }
      return body;
    }

    const submit = async () => {
      const body = collect();
      if (typeof body === 'string') { error.textContent = body; return; }
      try {
        if (isNew) await post('/api/products', body);
        else await patch(`/api/products/${p.id}`, body);
        close(true);
      } catch (err) { error.textContent = err.message; }
    };

    return h('div', { class: 'stack' },
      h('h2', {}, isNew ? 'Añadir producto' : `Editar «${p.name}»`),
      h('div', { class: 'two-col' },
        h('div', { class: 'field' }, h('label', { for: 'pe-name' }, 'Nombre (lo que sale en el botón)'), name),
        h('div', { class: 'field' }, h('label', { for: 'pe-cat' }, 'Sección'), cat)),
      h('div', { class: 'two-col' },
        h('div', { class: 'field' }, h('label', { for: 'pe-kind' }, 'Tipo'), kindSel),
        h('label', { class: 'field-check', for: 'pe-active' }, active, ' Visible en la pantalla de venta')),
      simplePart, comboPart, error,
      h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: () => close(false) }, 'Cancelar'),
        h('button', { class: 'btn primary', onclick: submit }, 'Guardar producto')));
  }, { wide: true });
  if (result) { toast('Producto guardado.'); reload(); }
}

// --- Inventario --------------------------------------------------------------

function packagesToBase(text, size) {
  const hundredths = parseScaled(text, 2);
  if (hundredths === null) return null;
  return Math.round((hundredths * size) / 100);
}

async function inventoryTab(reload) {
  const ings = await get('/api/ingredients');
  const rows = ings.map((i) => h('tr', {},
    h('td', { class: 'strong' }, i.name),
    h('td', {}, qtyText(i.stock_qty, i.unit), h('div', { class: 'muted small' }, `${packagesText(i.stock_qty, i.package_size)} × ${i.package_label}`)),
    h('td', {}, qtyText(i.min_stock, i.unit)),
    h('td', {}, statusBadge(i.status)),
    h('td', { class: 'num' }, eur(i.package_cost_cents)),
    h('td', { class: 'num' }, eur(i.stock_value_cents)),
    h('td', { class: 'actions' },
      h('button', { class: 'btn primary small-btn', onclick: () => entry(i, i.unit === 'racion' ? 'produccion' : 'compra', reload) }, i.unit === 'racion' ? 'Producción' : 'Compra'),
      h('button', { class: 'btn ghost small-btn', onclick: () => waste(i, reload) }, 'Merma'),
      h('button', { class: 'btn ghost small-btn', onclick: () => editIngredient(i, reload) }, 'Editar'),
      h('button', { class: 'btn ghost small-btn danger-text', onclick: () => deleteIngredient(i, reload) }, 'Eliminar'))));
  const total = ings.reduce((s, i) => s + i.stock_value_cents, 0);
  return h('div', { class: 'stack' },
    h('div', { class: 'row between' }, h('div', { class: 'muted strong' }, `Valor del stock: ${eur(total)}`),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', onclick: () => stockCount(ings, reload), disabled: !ings.length }, 'Recuento físico'),
        h('button', { class: 'btn primary', onclick: () => editIngredient(null, reload) }, '+ Nuevo insumo'))),
    rows.length ? h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, ['Insumo', 'Stock', 'Mínimo', 'Estado', 'Coste envase', 'Valor', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, rows)) : h('p', { class: 'empty' }, 'No hay insumos. Crea las botellas, cervezas, refrescos y raciones que usas.'),
    h('p', { class: 'muted small' }, 'Compra: suma stock y recalcula el coste medio. Producción: tandas de comida (por ejemplo, una olla = 20 raciones). Merma: lo que se rompe o se tira. Recuento: haz el recuento con el bar cerrado, sin vender.'));
}

async function editIngredient(i, reload) {
  const unitOpts = [
    { value: 'ml', label: 'Botella (se mide en cl)' },
    { value: 'ud', label: 'Unidades (cervezas, refrescos, latas…)' },
    { value: 'racion', label: 'Raciones (comida por tandas)' },
  ];
  const fields = [
    { name: 'name', label: 'Nombre', value: i ? i.name : '', placeholder: 'Ej.: Ron Brugal Añejo' },
    { name: 'unit', label: 'Cómo se mide', type: 'select', value: i ? i.unit : 'ml', options: unitOpts },
    { name: 'size', label: 'Tamaño del envase (cl para botellas; 1 para unidades y raciones)', value: i ? qtyToInput(i.package_size, i.unit) : '70', inputmode: 'decimal' },
    { name: 'label', label: 'Nombre del envase', value: i ? i.package_label : 'Botella 70 cl', placeholder: 'Botella 70 cl, Lata, Ración…' },
    { name: 'min', label: 'Aviso de stock mínimo (en envases)', value: i ? packagesText(i.min_stock, i.package_size).replace('.', ',') : '1', inputmode: 'decimal' },
  ];
  if (!i) {
    fields.push({ name: 'initial', label: 'Stock inicial (envases, opcional)', value: '', inputmode: 'decimal', placeholder: '0' });
    fields.push({ name: 'cost', label: 'Coste total de ese stock inicial (€)', value: '', inputmode: 'decimal', placeholder: '0,00' });
  }
  const values = await formDialog({
    title: i ? `Editar «${i.name}»` : 'Nuevo insumo',
    fields,
    validate: (v) => {
      if (!v.name.trim()) return 'Escribe el nombre.';
      const size = parseQty(v.size, v.unit);
      if (!size) return 'Tamaño del envase no válido.';
      if (packagesToBase(v.min || '0', size) === null) return 'Stock mínimo no válido.';
      if (!i && v.initial && packagesToBase(v.initial, size) === null) return 'Stock inicial no válido.';
      if (!i && v.initial && parseEuros(v.cost || '0') === null) return 'Coste no válido.';
      return null;
    },
  });
  if (!values) return;
  const size = parseQty(values.size, values.unit);
  const body = { name: values.name.trim(), package_size: size, package_label: values.label.trim(), min_stock: packagesToBase(values.min || '0', size) };
  try {
    if (i) {
      if (values.unit !== i.unit) body.unit = values.unit;
      await patch(`/api/ingredients/${i.id}`, body);
    } else {
      body.unit = values.unit;
      body.initial_qty = values.initial ? packagesToBase(values.initial, size) : 0;
      body.initial_total_cents = values.cost ? parseEuros(values.cost) : 0;
      await post('/api/ingredients', body);
    }
    toast('Insumo guardado.');
    reload();
  } catch (err) { errorToast(err); }
}

async function deleteIngredient(i, reload) {
  if (!(await confirmDialog({ title: `¿Eliminar «${i.name}»?`, message: 'Si se usa en algún producto, primero quítalo de su receta.', confirmText: 'Eliminar', danger: true }))) return;
  try { await del(`/api/ingredients/${i.id}`); toast('Insumo eliminado.'); reload(); } catch (err) { errorToast(err); }
}

async function entry(i, kind, reload) {
  const isProd = kind === 'produccion';
  const values = await formDialog({
    title: `${isProd ? 'Producción' : 'Compra'} · ${i.name}`,
    fields: [
      { name: 'packages', label: `Cantidad (${i.package_label}${i.package_size > 1 ? ', admite decimales' : ''})`, inputmode: 'decimal', placeholder: isProd ? 'Ej.: 20' : 'Ej.: 6' },
      { name: 'total', label: isProd ? 'Coste total de la tanda (€)' : 'Importe total pagado (€)', inputmode: 'decimal', placeholder: '0,00' },
      { name: 'note', label: 'Nota (opcional)', placeholder: isProd ? 'Ej.: olla del viernes' : 'Ej.: proveedor, nº de albarán' },
    ],
    confirmText: 'Registrar',
    validate: (v) => {
      const q = packagesToBase(v.packages, i.package_size);
      if (!q) return 'Cantidad no válida.';
      if (parseEuros(v.total) === null) return 'Importe no válido.';
      return null;
    },
  });
  if (!values) return;
  try {
    await post(`/api/ingredients/${i.id}/entries`, {
      qty: packagesToBase(values.packages, i.package_size), total_cents: parseEuros(values.total), kind, note: values.note.trim() || null,
    });
    toast('Entrada registrada. Stock y coste actualizados.');
    reload();
  } catch (err) { errorToast(err); }
}

async function waste(i, reload) {
  const values = await formDialog({
    title: `Merma · ${i.name}`,
    fields: [
      { name: 'qty', label: `Cantidad perdida (${UNITS[i.unit].label})`, inputmode: 'decimal' },
      { name: 'note', label: 'Motivo', placeholder: 'Ej.: botella rota, comida sobrante tirada' },
    ],
    confirmText: 'Registrar merma',
    validate: (v) => (!parseQty(v.qty, i.unit) ? 'Cantidad no válida.' : !v.note.trim() ? 'Indica el motivo.' : null),
  });
  if (!values) return;
  try { await post(`/api/ingredients/${i.id}/waste`, { qty: parseQty(values.qty, i.unit), note: values.note.trim() }); toast('Merma registrada.'); reload(); } catch (err) { errorToast(err); }
}

async function stockCount(ings, reload) {
  const result = await modal((close) => {
    const inputs = ings.map((i) => ({ i, input: h('input', { class: 'qty-input', inputmode: 'decimal', placeholder: '—', 'aria-label': `Contado de ${i.name}` }) }));
    const error = h('p', { class: 'field-error' });
    const submit = async () => {
      const items = [];
      for (const { i, input } of inputs) {
        if (!input.value.trim()) continue;
        const q = packagesToBase(input.value, i.package_size);
        if (q === null) { error.textContent = `Cantidad no válida en ${i.name}.`; return; }
        items.push({ ingredient_id: i.id, counted: q });
      }
      if (!items.length) { error.textContent = 'Escribe al menos una cantidad contada.'; return; }
      try { close(await post('/api/stock-counts', { items })); } catch (err) { error.textContent = err.message; }
    };
    return h('div', { class: 'stack' },
      h('h2', {}, 'Recuento físico'),
      h('p', { class: 'muted' }, 'Escribe lo que hay de verdad, en envases (por ejemplo 2,5 botellas o 36 latas). Deja en blanco lo que no cuentes. Hazlo sin vender.'),
      h('div', { class: 'scroll-box' }, h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, ['Insumo', 'Teórico', 'Contado (envases)'].map((t) => h('th', {}, t)))),
        h('tbody', {}, inputs.map(({ i, input }) => h('tr', {}, h('td', {}, i.name),
          h('td', {}, `${packagesText(i.stock_qty, i.package_size)} × ${i.package_label}`), h('td', {}, input)))))),
      error,
      h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: () => close(null) }, 'Cancelar'),
        h('button', { class: 'btn primary', onclick: submit }, 'Guardar recuento')));
  }, { wide: true });
  if (!result) return;
  await modal((close) => h('div', { class: 'stack' },
    h('h2', {}, 'Resultado del recuento'),
    h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, ['Insumo', 'Teórico', 'Contado', 'Diferencia', 'Valor'].map((t) => h('th', {}, t)))),
      h('tbody', {}, result.lines.map((l) => {
        const ing = ings.find((x) => x.id === l.ingredient_id);
        return h('tr', { class: l.difference < 0 ? 'neg' : '' }, h('td', {}, l.name), h('td', {}, qtyText(l.theoretical, ing.unit)),
          h('td', {}, qtyText(l.counted, ing.unit)), h('td', {}, qtyText(l.difference, ing.unit)), h('td', { class: 'num' }, eur(l.difference_value_cents)));
      }))),
    h('div', { class: 'row end' }, h('button', { class: 'btn primary', onclick: () => close() }, 'Entendido'))), { wide: true });
  reload();
}

// --- Ajustes -----------------------------------------------------------------

async function settingsTab(reload) {
  // En la app de la tablet (PWA) las copias van a GitHub: su panel lo pone pwa/copias.js.
  const pwa = globalThis.cpbarPwa;
  const [backups, state] = await Promise.all([pwa ? null : get('/api/backups'), get('/api/state')]);
  const pass = async () => {
    const v = await formDialog({
      title: 'Cambiar contraseña de administración',
      fields: [
        { name: 'current', label: 'Contraseña actual', type: 'password', autocomplete: 'current-password' },
        { name: 'next', label: 'Contraseña nueva (mínimo 8 caracteres)', type: 'password', autocomplete: 'new-password' },
        { name: 'repeat', label: 'Repite la nueva', type: 'password', autocomplete: 'new-password' },
      ],
      validate: (x) => (x.next.length < 8 ? 'Mínimo 8 caracteres.' : x.next !== x.repeat ? 'Las contraseñas nuevas no coinciden.' : null),
    });
    if (!v) return;
    try { await post('/api/admin/password', { current: v.current, new: v.next }); toast('Contraseña cambiada.'); } catch (err) { errorToast(err); }
  };
  const backupNow = async () => {
    try { const r = await post('/api/backups'); toast(r.usb.length ? 'Copia hecha (también en el pendrive).' : 'Copia hecha.'); reload(); } catch (err) { errorToast(err); }
  };
  const backupDownload = async () => {
    try { const name = await download('/api/backups/download'); toast(`Copia descargada: ${name}`); } catch (err) { errorToast(err); }
  };
  const startReal = async () => {
    const typed = await askText({
      title: 'Empezar en real',
      label: 'Se borran las ventas, turnos y movimientos de práctica, y el stock se pone a cero. Se conservan secciones, productos, precios e insumos (y una copia de la práctica). Escribe EMPEZAR para confirmar.',
      confirmText: 'Empezar en real', danger: true,
    });
    if (typed === null) return;
    if (typed.trim().toUpperCase() !== 'EMPEZAR') return errorToast('Para confirmar escribe EMPEZAR.');
    try {
      await post('/api/admin/start-real', { confirm: 'EMPEZAR' });
      toast('Listo. Registra el stock real (Inventario → Compra o Recuento) y abre el turno.');
      setTimeout(() => location.reload(), 1500);
    } catch (err) { errorToast(err); }
  };
  return h('div', { class: 'settings' },
    h('div', { class: 'panel stack' }, h('h2', {}, 'Contraseña'),
      h('p', { class: 'muted' }, 'Protege Admin, anulaciones, movimientos de caja, cierre de turno e informes.'),
      h('button', { class: 'btn primary', onclick: pass }, 'Cambiar contraseña')),
    pwa ? pwa.backupPanel(reload) : h('div', { class: 'panel stack' }, h('h2', {}, 'Copias de seguridad'),
      h('p', {}, backups.latest ? `Última copia: ${fmtDateTime(backups.latest)} · ${backups.count} copias guardadas.` : 'Todavía no hay copias.'),
      backups.last_error ? h('p', { class: 'field-error' }, `Último error: ${backups.last_error}`) : null,
      h('p', { class: 'muted small' }, `Carpeta: ${backups.folder}. Se hace una copia al día y al cerrar cada turno. Se conservan 30 diarias, 12 mensuales y 6 anuales.`),
      backups.export_folder ? h('p', { class: 'muted small' }, `Además se guardan las 30 últimas en tu escritorio: ${backups.export_folder}\\Copias de seguridad.`) : null,
      h('p', { class: 'muted small' }, backups.usb_drives.length ? `Pendrive detectado: ${backups.usb_drives.join(', ')}. Al cerrar el turno se copia también ahí.` : 'Sin pendrive conectado. Conecta uno al cerrar el turno para tener copia fuera del ordenador.'),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', onclick: backupNow }, 'Hacer copia ahora'),
        h('button', { class: 'btn ghost', onclick: backupDownload }, 'Descargar una copia'))),
    state.demo_data ? h('div', { class: 'panel stack danger-panel' }, h('h2', {}, 'Empezar en real'),
      h('p', {}, 'Ahora estás en modo práctica. Cuando hayas ajustado productos y precios, pulsa aquí para borrar la práctica y empezar a trabajar de verdad.'),
      state.shift ? h('p', { class: 'field-error' }, 'Antes cierra el turno de prueba (menú Cerrar turno).') : null,
      h('button', { class: 'btn danger', onclick: startReal, disabled: !!state.shift }, 'Empezar en real')) : null,
    h('div', { class: 'panel stack' }, h('h2', {}, 'Información'),
      h('p', { class: 'muted small' }, `CP BAR · TPV versión ${state.version}`)));
}
