// Productos (con contraseña): secciones, productos, precios y combinados. Y ajustes.
import { get, post, patch, del, download } from './api.js';
import { h, clear, eur, parseEuros, centsToInput, fmtDateTime } from './util.js';
import { modal, toast, errorToast, confirmDialog, askText, formDialog } from './ui.js';

// Colores de sección: intensos para que el texto blanco de los botones se lea bien en claro y en oscuro.
const PALETTE = ['#B45309', '#7C4A1E', '#CA8A04', '#BE185D', '#0369A1', '#6D28D9', '#15803D', '#0F766E', '#B91C1C', '#475569'];

let tab = 'productos';

export async function render(main) {
  const body = h('div', { class: 'admin-body' });
  const tabs = h('div', { class: 'row admin-tabs' });
  const drawTabs = () => {
    clear(tabs);
    for (const [key, label] of [['productos', 'Productos y precios'], ['ajustes', 'Ajustes']]) {
      tabs.append(h('button', { class: `btn pill${tab === key ? ' on' : ''}`, onclick: () => { tab = key; drawTabs(); load(); } }, label));
    }
  };
  async function load() {
    clear(body).append(h('p', { class: 'muted' }, 'Cargando…'));
    try {
      const content = await (tab === 'productos' ? productsTab : settingsTab)(load);
      clear(body).append(content);
    } catch (err) {
      clear(body).append(h('p', { class: 'field-error' }, err.message));
    }
  }
  main.append(h('div', { class: 'admin' }, h('h1', {}, 'Productos'), tabs, body));
  drawTabs();
  await load();
  return null;
}

// --- Productos -----------------------------------------------------------------

async function productsTab(reload) {
  const [cats, products] = await Promise.all([get('/api/categories'), get('/api/products')]);

  const priceInput = (p) => {
    const input = h('input', { class: 'price-input', value: centsToInput(p.price_cents), inputmode: 'decimal', 'aria-label': `Precio de ${p.name}` });
    const save = async () => {
      const cents = parseEuros(input.value);
      if (cents === null) { errorToast('Precio no válido. Ejemplo: 3 o 3,50'); input.value = centsToInput(p.price_cents); return; }
      if (cents === p.price_cents) return;
      try { await patch(`/api/products/${p.id}`, { price_cents: cents }); p.price_cents = cents; toast(`${p.name}: ${eur(cents)}`); } catch (err) { errorToast(err); input.value = centsToInput(p.price_cents); }
    };
    input.addEventListener('change', save);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
    return input;
  };

  const sections = cats.map((c) => {
    const items = products.filter((p) => p.category_id === c.id);
    const rows = items.map((p) => h('tr', { class: p.active ? '' : 'inactive' },
      h('td', { class: 'strong' }, p.name,
        p.kind === 'combinado' ? h('span', { class: 'badge badge-low' }, 'Combinado') : null,
        p.active ? null : h('span', { class: 'muted small' }, ' · oculto en la venta')),
      h('td', { class: 'num' }, p.kind === 'simple' ? priceInput(p) : h('span', { class: 'muted' }, `desde ${eur(p.price_cents)}`)),
      h('td', { class: 'actions' },
        h('button', { class: 'btn ghost small-btn', onclick: () => editProduct(p, cats, reload) }, 'Editar'),
        h('button', { class: 'btn ghost small-btn danger-text', onclick: () => deleteProduct(p, reload) }, 'Eliminar'))));
    return h('div', { class: 'stack' },
      h('div', { class: 'section-title' },
        h('h2', {}, h('span', { class: 'cat-dot', style: `--cat:${c.color}` }), c.name, h('span', { class: 'muted small' }, `  ${items.length} producto${items.length === 1 ? '' : 's'}`)),
        h('div', { class: 'row' },
          h('button', { class: 'btn ghost small-btn', onclick: () => editCategory(c, reload) }, 'Editar sección'),
          h('button', { class: 'btn primary small-btn', onclick: () => editProduct(null, cats, reload, c.id) }, '+ Producto'))),
      rows.length ? h('table', { class: 'table' }, h('tbody', {}, rows))
        : h('p', { class: 'empty' }, 'Sección vacía. ', h('button', { class: 'btn ghost small-btn danger-text', onclick: () => deleteCategory(c, reload) }, 'Eliminar sección')));
  });

  return h('div', { class: 'stack' },
    h('div', { class: 'row between wrap' },
      h('p', { class: 'muted' }, 'Precios finales, IVA incluido. Para cambiar un precio, escríbelo y pulsa Intro.'),
      h('button', { class: 'btn primary', onclick: () => editCategory(null, reload) }, '+ Nueva sección')),
    cats.length ? sections : h('p', { class: 'empty' }, 'Crea primero una sección (por ejemplo «Cervezas»).'));
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
  if (!(await confirmDialog({ title: `¿Eliminar la sección «${cat.name}»?`, message: 'Solo se puede eliminar si está vacía.', confirmText: 'Eliminar', danger: true }))) return;
  try { await del(`/api/categories/${cat.id}`); toast('Sección eliminada.'); reload(); } catch (err) { errorToast(err); }
}

async function deleteProduct(p, reload) {
  if (!(await confirmDialog({ title: `¿Eliminar «${p.name}»?`, message: 'Si ya se ha vendido, desaparece de la venta pero se conserva en los informes.', confirmText: 'Eliminar', danger: true }))) return;
  try {
    const r = await del(`/api/products/${p.id}`);
    toast(r.result === 'archived' ? 'Producto retirado de la venta (tenía ventas).' : 'Producto eliminado.');
    reload();
  } catch (err) { errorToast(err); }
}

async function editProduct(p, cats, reload, categoryId = null) {
  const isNew = !p;
  let kind = p ? p.kind : 'simple';
  const result = await modal((close) => {
    const name = h('input', { id: 'pe-name', value: p ? p.name : '', maxlength: 120, placeholder: 'Ej.: Cerveza Mahou' });
    const cat = h('select', { id: 'pe-cat' }, cats.map((c) => h('option', { value: c.id, selected: p ? c.id === p.category_id : c.id === categoryId }, c.name)));
    const price = h('input', { id: 'pe-price', inputmode: 'decimal', value: p && p.kind === 'simple' ? centsToInput(p.price_cents) : '', placeholder: '0,00', class: 'money-input' });
    const active = h('input', { id: 'pe-active', type: 'checkbox', checked: p ? p.active : true });
    const error = h('p', { class: 'field-error' });
    const licorBox = h('div', { class: 'stack' });
    const mixerBox = h('div', { class: 'stack' });
    const optionRows = [];

    function addOptionRow(o) {
      const label = h('input', { value: o.label || '', placeholder: o.grp === 'licor' ? 'Ej.: Brugal Añejo' : 'Ej.: Coca-Cola', maxlength: 120, 'aria-label': 'Nombre' });
      const priceIn = o.grp === 'licor'
        ? h('input', { class: 'price-input', inputmode: 'decimal', value: o.price_cents != null ? centsToInput(o.price_cents) : '', placeholder: 'Precio', 'aria-label': 'Precio del combinado con este licor' })
        : null;
      const row = { grp: o.grp, label, priceIn };
      const el = h('div', { class: 'option-row' }, label, priceIn,
        h('button', { class: 'btn ghost small-btn', type: 'button', onclick: () => { optionRows.splice(optionRows.indexOf(row), 1); el.remove(); } }, 'Quitar'));
      optionRows.push(row);
      (o.grp === 'licor' ? licorBox : mixerBox).append(el);
    }

    const simplePart = h('div', { class: 'field' }, h('label', { for: 'pe-price' }, 'Precio (€, IVA incluido)'), price);
    const comboPart = h('div', { class: 'stack' },
      h('p', { class: 'muted' }, 'Al venderlo se elige un licor y un refresco. El precio lo pone el licor.'),
      h('h3', {}, 'Licores y su precio'), licorBox,
      h('button', { class: 'btn ghost', type: 'button', onclick: () => addOptionRow({ grp: 'licor' }) }, '+ Añadir licor'),
      h('h3', {}, 'Refrescos'), mixerBox,
      h('button', { class: 'btn ghost', type: 'button', onclick: () => addOptionRow({ grp: 'refresco' }) }, '+ Añadir refresco'));
    if (p && p.kind === 'combinado') p.options.forEach(addOptionRow);

    const kindSel = h('select', { id: 'pe-kind', disabled: !isNew },
      h('option', { value: 'simple', selected: kind === 'simple' }, 'Producto normal'),
      h('option', { value: 'combinado', selected: kind === 'combinado' }, 'Combinado (licor + refresco)'));
    const showKind = () => {
      simplePart.classList.toggle('hidden', kind !== 'simple');
      comboPart.classList.toggle('hidden', kind !== 'combinado');
      if (kind === 'combinado' && !optionRows.length) { addOptionRow({ grp: 'licor' }); addOptionRow({ grp: 'refresco' }); }
    };
    kindSel.addEventListener('change', () => { kind = kindSel.value; showKind(); });
    showKind();

    function collect() {
      const n = name.value.trim();
      if (!n) return 'Escribe el nombre.';
      const body = { name: n, category_id: Number(cat.value), active: active.checked };
      if (kind === 'simple') {
        const pr = parseEuros(price.value);
        if (pr === null) return 'Precio no válido. Ejemplo: 3 o 3,50';
        body.price_cents = pr;
      } else {
        body.options = [];
        for (const r of optionRows) {
          const label = r.label.value.trim();
          if (!label && !(r.priceIn && r.priceIn.value.trim())) continue; // fila vacía
          if (!label) return 'Cada licor y refresco necesita un nombre.';
          const opt = { grp: r.grp, label };
          if (r.grp === 'licor') {
            const pr = parseEuros(r.priceIn.value);
            if (pr === null) return `Precio no válido en «${label}».`;
            opt.price_cents = pr;
          }
          body.options.push(opt);
        }
        if (!body.options.some((o) => o.grp === 'licor') || !body.options.some((o) => o.grp === 'refresco')) return 'Añade al menos un licor y un refresco.';
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
      h('h2', {}, isNew ? 'Nuevo producto' : `Editar «${p.name}»`),
      h('div', { class: 'two-col' },
        h('div', { class: 'field' }, h('label', { for: 'pe-name' }, 'Nombre (lo que sale en el botón)'), name),
        h('div', { class: 'field' }, h('label', { for: 'pe-cat' }, 'Sección'), cat)),
      h('div', { class: 'two-col' },
        h('div', { class: 'field' }, h('label', { for: 'pe-kind' }, 'Tipo'), kindSel),
        h('label', { class: 'field-check', for: 'pe-active' }, active, ' Visible en la pantalla de venta')),
      simplePart, comboPart, error,
      h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: () => close(false) }, 'Cancelar'),
        h('button', { class: 'btn primary', onclick: submit }, 'Guardar')));
  }, { wide: kind === 'combinado' });
  if (result) { toast('Producto guardado.'); reload(); }
}

// --- Ajustes -----------------------------------------------------------------

async function settingsTab(reload) {
  // En la app de la tablet (PWA) las copias van a GitHub: su panel lo pone pwa/copias.js.
  const pwa = globalThis.cpbarPwa;
  const [backups, state] = await Promise.all([pwa ? null : get('/api/backups'), get('/api/state')]);
  const pass = async () => {
    const v = await formDialog({
      title: 'Cambiar contraseña',
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
      label: 'Se borran las ventas, turnos, cuentas abiertas y movimientos de práctica. Se conservan secciones, productos y precios (y una copia de la práctica). Escribe EMPEZAR para confirmar.',
      confirmText: 'Empezar en real', danger: true,
    });
    if (typed === null) return;
    if (typed.trim().toUpperCase() !== 'EMPEZAR') return errorToast('Para confirmar escribe EMPEZAR.');
    try {
      await post('/api/admin/start-real', { confirm: 'EMPEZAR' });
      toast('Listo. Ya puedes abrir el turno y vender.');
      setTimeout(() => location.reload(), 1500);
    } catch (err) { errorToast(err); }
  };
  return h('div', { class: 'settings' },
    state.demo_data ? h('div', { class: 'panel stack danger-panel' }, h('h2', {}, 'Empezar en real'),
      h('p', {}, 'Estás en modo práctica. Cuando tengas tus productos y precios, pulsa aquí para borrar las ventas de prueba y empezar de verdad.'),
      state.shift ? h('p', { class: 'field-error' }, 'Antes cierra el turno de prueba (menú Cerrar turno).') : null,
      h('button', { class: 'btn danger', onclick: startReal, disabled: !!state.shift }, 'Empezar en real')) : null,
    pwa ? pwa.backupPanel(reload) : h('div', { class: 'panel stack' }, h('h2', {}, 'Copias de seguridad'),
      h('p', {}, backups.latest ? `Última copia: ${fmtDateTime(backups.latest)} · ${backups.count} copias guardadas.` : 'Todavía no hay copias.'),
      backups.last_error ? h('p', { class: 'field-error' }, `Último error: ${backups.last_error}`) : null,
      h('p', { class: 'muted small' }, 'Se hace una copia al día y al cerrar cada turno. Se conservan 30 diarias, 12 mensuales y 6 anuales.'),
      backups.export_folder ? h('p', { class: 'muted small' }, `Las 30 últimas también en tu escritorio: ${backups.export_folder}\\Copias de seguridad.`) : null,
      h('p', { class: 'muted small' }, backups.usb_drives.length ? `Pendrive detectado: ${backups.usb_drives.join(', ')}. Al cerrar el turno se copia también ahí.` : 'Sin pendrive conectado.'),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', onclick: backupNow }, 'Hacer copia ahora'),
        h('button', { class: 'btn ghost', onclick: backupDownload }, 'Descargar una copia'))),
    h('div', { class: 'panel stack' }, h('h2', {}, 'Contraseña'),
      h('p', { class: 'muted' }, 'Solo se pide para entrar aquí (productos, precios y ajustes). Vender, cobrar, anular y cerrar el turno no la piden.'),
      h('button', { class: 'btn ghost', onclick: pass }, 'Cambiar contraseña')),
    h('div', { class: 'panel stack' }, h('h2', {}, 'Información'),
      h('p', { class: 'muted small' }, `CP BAR · Caja · versión ${state.version}`)));
}
