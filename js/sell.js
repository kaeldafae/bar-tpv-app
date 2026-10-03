// Pantalla de venta: categorías, productos, cuenta, cobro, combinados, invitaciones,
// últimas ventas (anular) y movimientos de caja.
import { api, get, post, ApiError } from './api.js';
import { h, clear, eur, parseEuros, uuid4, fmtTime } from './util.js';
import { modal, toast, errorToast, confirmDialog, askText, formDialog, setBusy } from './ui.js';

const BILLS = [500, 1000, 2000, 5000];
const INVITATION_REASONS = ['Cliente habitual', 'Cumpleaños', 'Compensación por error', 'Consumo propio'];
const VOID_REASONS = ['Marcado por error', 'Cliente no lo quiso', 'Producto en mal estado', 'Cobrado dos veces'];
const TAB_CANCEL_REASONS = ['Abierta por error', 'Ya se cobró aparte', 'Se fue sin pagar'];

const st = {
  catalog: null,
  activeCat: null,
  cart: [],
  saleId: null, // se mantiene mientras la cuenta no cambie: reintentar un cobro nunca duplica
  modalOpen: false,
  // Cuenta abierta a nombre de alguien que está en pantalla: { id, name, version }.
  // Cada cambio de la cuenta se guarda en el servidor al momento.
  tab: null,
  saving: Promise.resolve(),
  unsaved: false,
  openTabs: 0,
};

let ctxRef = null;
let els = {};

export async function render(main, ctx) {
  ctxRef = ctx;
  els.grid = h('div', { class: 'grid', id: 'product-grid' });
  els.tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Categorías' });
  els.cartLines = h('div', { class: 'cart-lines' });
  els.total = h('div', { class: 'total-amount', id: 'cart-total' });
  els.count = h('span', { class: 'muted' });
  els.mobileTotal = h('span', { class: 'strong' });
  els.charge = h('button', { class: 'btn success charge', id: 'btn-cobrar', onclick: openCharge }, 'COBRAR');
  els.title = h('h2', { class: 'cart-title' });
  els.tabBar = h('div', { class: 'tab-bar hidden' });
  els.tabsBtn = h('button', { class: 'btn primary tabs-btn', id: 'btn-cuentas', onclick: openTabsList }, 'Cuentas abiertas');
  const aside = h('aside', { class: 'cart', 'aria-label': 'Cuenta actual' },
    h('div', { class: 'row between' }, els.title, els.count),
    els.tabBar,
    els.cartLines,
    els.tabsBtn,
    h('div', { class: 'cart-tools' },
      h('button', { class: 'btn ghost', onclick: invite }, 'Invitación'),
      h('button', { class: 'btn ghost', onclick: recentSales }, 'Últimas ventas'),
      h('button', { class: 'btn ghost', onclick: cashMovement }, 'Caja +/−'),
      h('button', { class: 'btn ghost', onclick: emptyCart }, 'Vaciar'),
    ),
    h('div', { class: 'total-row' }, h('span', { class: 'muted total-label' }, 'TOTAL'), els.total),
    els.charge,
  );
  const mobileBar = h('div', { class: 'mobile-bar' },
    h('button', { class: 'btn ghost grow', onclick: () => document.body.classList.toggle('cart-open') },
      h('span', { class: 'muted small' }, 'Ver cuenta'), ' ', els.mobileTotal),
    h('button', { class: 'btn success', onclick: openCharge }, 'COBRAR'));
  main.append(h('div', { class: 'sell' }, h('section', { class: 'products' }, els.tabs, els.grid), aside, mobileBar));
  await loadCatalog();
  if (st.tab) await reloadTab().catch(() => {}); // pudo cobrarse en otra pantalla
  renderCart();
  refreshTabsCount();
  const timer = setInterval(() => {
    if (st.modalOpen) return;
    loadCatalog().catch(() => {});
    refreshTabsCount();
  }, 30_000);
  return () => { clearInterval(timer); document.body.classList.remove('cart-open'); };
}

async function loadCatalog() {
  st.catalog = await get('/api/catalog');
  const cats = st.catalog.categories;
  if (!cats.find((c) => c.id === st.activeCat)) st.activeCat = cats.length ? cats[0].id : null;
  renderTabs();
  renderGrid();
}

function catColor(id) {
  const c = st.catalog.categories.find((x) => x.id === id);
  return c ? c.color : '#3A3F4B';
}

function renderTabs() {
  clear(els.tabs);
  for (const c of st.catalog.categories) {
    const on = c.id === st.activeCat;
    els.tabs.append(h('button', {
      role: 'tab', 'aria-selected': on ? 'true' : 'false', class: `tab${on ? ' on' : ''}`, style: `--cat:${c.color}`,
      onclick: () => { st.activeCat = c.id; renderTabs(); renderGrid(); },
    }, c.name));
  }
}

function renderGrid() {
  clear(els.grid);
  const products = st.catalog.products.filter((p) => p.category_id === st.activeCat);
  if (!products.length) {
    els.grid.append(h('p', { class: 'empty' }, st.catalog.categories.length ? 'No hay productos en esta sección. Añádelos en Productos.' : 'Todavía no hay productos. Créalos en Productos.'));
    return;
  }
  // Cuántos de cada producto hay ya en la cuenta: se ve en la esquina del botón.
  const inCart = {};
  for (const l of st.cart) inCart[l.product_id] = (inCart[l.product_id] || 0) + l.qty;
  for (const p of products) {
    els.grid.append(h('button', {
      class: 'tile', style: `--cat:${catColor(p.category_id)}`, onclick: () => addProduct(p),
    },
      inCart[p.id] ? h('span', { class: 'tile-count', 'aria-label': `${inCart[p.id]} en la cuenta` }, String(inCart[p.id])) : null,
      h('span', { class: 'tile-name' }, p.name),
      h('span', { class: 'tile-foot' },
        h('span', { class: 'tile-price' }, p.kind === 'combinado' ? `desde ${eur(p.price_cents)}` : eur(p.price_cents))),
    ));
  }
}

// --- Cuenta ------------------------------------------------------------------

function cartChanged() {
  st.saleId = null;
  renderCart();
  if (st.tab) saveTab();
}

function addLine(line) {
  const existing = st.cart.find((l) => l.key === line.key && l.unit_price_cents === line.unit_price_cents);
  if (existing) existing.qty += 1;
  else st.cart.push({ ...line, qty: 1 });
  cartChanged();
}

async function addProduct(p) {
  if (p.kind === 'combinado') {
    const choice = await chooseCombo(p);
    if (!choice) return;
    addLine({
      key: `c:${p.id}:${choice.licor.id}:${choice.refresco.id}`, product_id: p.id,
      name: `${p.name} ${choice.licor.label} + ${choice.refresco.label}`, unit_price_cents: choice.licor.price_cents,
      licor_option_id: choice.licor.id, refresco_option_id: choice.refresco.id, color: catColor(p.category_id),
    });
  } else {
    addLine({ key: `p:${p.id}`, product_id: p.id, name: p.name, unit_price_cents: p.price_cents, color: catColor(p.category_id) });
  }
}

function logRemoval(line, qty) {
  if (st.tab) return; // en una cuenta abierta lo registra el servidor al guardar
  post('/api/events/cart-line-removed', { product_id: line.product_id, name: line.name.slice(0, 120), qty, unit_price_cents: line.unit_price_cents })
    .catch(() => {});
}

function changeQty(line, delta) {
  if (delta < 0) logRemoval(line, 1);
  line.qty += delta;
  if (line.qty <= 0) st.cart = st.cart.filter((l) => l !== line);
  cartChanged();
}

async function emptyCart() {
  if (!st.cart.length) return;
  const ok = await confirmDialog({
    title: st.tab ? `¿Vaciar la cuenta de ${st.tab.name}?` : '¿Vaciar la cuenta?',
    message: st.tab ? 'Se quita todo lo apuntado. La cuenta sigue abierta, vacía.' : 'Se quitan todas las líneas sin cobrar.',
    confirmText: 'Vaciar', danger: true });
  if (!ok) return;
  st.cart.forEach((l) => logRemoval(l, l.qty));
  st.cart = [];
  cartChanged();
}

const cartTotal = () => st.cart.reduce((sum, l) => sum + l.unit_price_cents * l.qty, 0);

function renderCart() {
  clear(els.cartLines);
  const items = st.cart.reduce((n, l) => n + l.qty, 0);
  els.count.textContent = items === 1 ? '1 artículo' : `${items} artículos`;
  els.title.textContent = st.tab ? `Cuenta de ${st.tab.name}` : 'Cuenta actual';
  document.body.classList.toggle('on-tab', !!st.tab);
  clear(els.tabBar);
  els.tabBar.classList.toggle('hidden', !st.tab);
  if (st.tab) {
    els.tabBar.append(
      h('span', { class: 'muted small grow' }, st.unsaved ? 'Sin guardar: revisa la conexión' : 'Se guarda sola. Puedes seguir apuntando.'),
      h('button', { class: 'btn ghost small-btn', onclick: renameTab }, 'Cambiar nombre'),
      h('button', { class: 'btn primary small-btn', id: 'btn-dejar-abierta', onclick: leaveTabOpen }, 'Dejar abierta'));
  }
  els.tabsBtn.textContent = st.openTabs ? `Cuentas abiertas (${st.openTabs})` : 'Cuentas abiertas';
  if (!st.cart.length) els.cartLines.append(h('p', { class: 'empty' }, st.tab ? `Pulsa un producto para apuntárselo a ${st.tab.name}.` : 'Pulsa un producto para añadirlo.'));
  for (const l of st.cart) {
    els.cartLines.append(h('div', { class: 'line' },
      h('div', { class: 'line-name' }, h('div', { class: 'strong' }, l.name), h('div', { class: 'muted small' }, `${eur(l.unit_price_cents)} / ud`)),
      h('button', { class: 'qty-btn', 'aria-label': `Quitar uno de ${l.name}`, onclick: () => changeQty(l, -1) }, '−'),
      h('span', { class: 'qty' }, String(l.qty)),
      h('button', { class: 'qty-btn', 'aria-label': `Añadir uno de ${l.name}`, onclick: () => changeQty(l, 1) }, '+'),
      h('span', { class: 'line-total' }, eur(l.unit_price_cents * l.qty)),
    ));
  }
  const total = eur(cartTotal());
  els.total.textContent = total;
  els.mobileTotal.textContent = st.tab ? `${st.tab.name} · ${total}` : total;
  els.charge.disabled = !st.cart.length;
  if (st.catalog) renderGrid(); // contadores de los botones de producto
}

// --- Cuentas abiertas a nombre -------------------------------------------------

function lineKey(l) {
  return l.licor_option_id ? `c:${l.product_id}:${l.licor_option_id}:${l.refresco_option_id}` : `p:${l.product_id}`;
}

function cartFromTab(tab) {
  return tab.lines.map((l) => {
    const p = st.catalog && st.catalog.products.find((x) => x.id === l.product_id);
    return { ...l, key: lineKey(l), color: p ? catColor(p.category_id) : '#3A3F4B' };
  });
}

function tabLines(cart) {
  return cart.map((l) => ({
    product_id: l.product_id, qty: l.qty, unit_price_cents: l.unit_price_cents,
    licor_option_id: l.licor_option_id ?? null, refresco_option_id: l.refresco_option_id ?? null,
  }));
}

function showTab(tab) {
  st.tab = { id: tab.id, name: tab.name, version: tab.version };
  st.cart = cartFromTab(tab);
  st.saleId = null;
  st.unsaved = false;
  renderCart();
}

async function reloadTab() {
  const tab = await get(`/api/tabs/${st.tab.id}`);
  if (tab.status !== 'open') {
    toast(`La cuenta de ${tab.name} ya no está abierta.`, 'error');
    st.tab = null;
    st.cart = [];
    renderCart();
    return;
  }
  showTab(tab);
}

async function refreshTabsCount() {
  try {
    st.openTabs = (await get('/api/tabs')).length;
    els.tabsBtn.textContent = st.openTabs ? `Cuentas abiertas (${st.openTabs})` : 'Cuentas abiertas';
  } catch { /* sin conexión: se reintenta en el siguiente ciclo */ }
}

/** Guarda la cuenta abierta. Los guardados van en fila para no pisarse entre sí. */
function saveTab() {
  const run = async () => {
    if (!st.tab) return;
    const tab = st.tab;
    try {
      const saved = await api('PATCH', `/api/tabs/${tab.id}`, { version: tab.version, lines: tabLines(st.cart) });
      if (st.tab && st.tab.id === saved.id) {
        st.tab.version = saved.version;
        if (st.unsaved) { st.unsaved = false; renderCart(); }
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) {
        st.unsaved = true;
        renderCart();
        return errorToast(new Error('No se ha podido guardar la cuenta. Se guardará al hacer el siguiente cambio.'));
      }
      errorToast(err);
      // El servidor manda: se vuelve a lo que tiene guardado (otra pantalla, precio cambiado...).
      if (err instanceof ApiError && err.code === 'price_changed') loadCatalog().catch(() => {});
      if (st.tab && st.tab.id === tab.id) await reloadTab().catch(() => {});
    }
  };
  st.saving = st.saving.then(run, run);
  return st.saving;
}

/** Espera a que la cuenta esté guardada. Devuelve false si no se pudo. */
async function tabSaved() {
  await st.saving;
  if (st.tab && st.unsaved) { await saveTab(); }
  if (st.tab && st.unsaved) { toast('La cuenta no está guardada. Revisa la conexión y vuelve a intentarlo.', 'error'); return false; }
  return true;
}

async function leaveTabOpen() {
  if (!(await tabSaved())) return;
  const name = st.tab.name;
  st.tab = null;
  st.cart = [];
  st.saleId = null;
  renderCart();
  document.body.classList.remove('cart-open');
  refreshTabsCount();
  toast(`Cuenta de ${name} guardada. Sigue abierta.`);
}

async function renameTab() {
  if (!(await tabSaved())) return;
  const name = await askText({ title: 'Cambiar nombre', label: 'Nombre de la cuenta', placeholder: st.tab.name, confirmText: 'Guardar' });
  if (!name || !st.tab) return;
  try {
    showTab(await api('PATCH', `/api/tabs/${st.tab.id}`, { version: st.tab.version, name }));
  } catch (err) { errorToast(err); if (err.code === 'tab_changed') reloadTab().catch(() => {}); }
}

async function openTabsList() {
  if (!(await tabSaved())) return;
  let list;
  try { list = await get('/api/tabs'); } catch (err) { return errorToast(err); }
  // Lo que hay en la cuenta normal (sin nombre) se apunta en la cuenta que se elija.
  const carry = st.tab ? [] : st.cart;
  const carryTotal = carry.reduce((s, l) => s + l.unit_price_cents * l.qty, 0);
  st.modalOpen = true;
  const choice = await modal((close) => {
    const rows = h('div', { class: 'tab-list' });
    const draw = (items) => {
      clear(rows);
      if (!items.length) rows.append(h('p', { class: 'empty' }, 'No hay cuentas abiertas. Crea una con «Nueva cuenta».'));
      for (const t of items) {
        const isCurrent = st.tab && st.tab.id === t.id;
        rows.append(h('div', { class: `tab-row${isCurrent ? ' on' : ''}` },
          h('button', { class: 'tab-open', onclick: () => close({ open: t }) },
            h('span', { class: 'tab-name' }, t.name),
            h('span', { class: 'muted small' }, `${t.items === 1 ? '1 artículo' : `${t.items} artículos`} · desde las ${fmtTime(t.created_at)}`),
            h('span', { class: 'tab-total' }, eur(t.total_cents))),
          h('button', { class: 'btn ghost small-btn', 'aria-label': `Eliminar la cuenta de ${t.name}`, onclick: () => close({ cancel: t }) }, 'Eliminar')));
      }
    };
    draw(list);
    return h('div', { class: 'stack' },
      h('div', { class: 'row between' }, h('h2', {}, 'Cuentas abiertas'),
        h('button', { class: 'btn success', id: 'btn-nueva-cuenta', onclick: () => close({ create: true }) }, '+ Nueva cuenta')),
      carry.length ? h('p', { class: 'notice' }, `Lo que tienes ahora en la cuenta (${eur(carryTotal)}) se apuntará en la cuenta que elijas o crees.`) : null,
      rows,
      h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: () => close(null) }, 'Cerrar')));
  }, { wide: true });
  st.modalOpen = false;
  if (!choice) return;
  if (choice.create) return createTab(carry);
  if (choice.cancel) return cancelTab(choice.cancel);
  if (choice.open) return openTab(choice.open, carry);
}

async function createTab(carry) {
  const name = await askText({ title: 'Nueva cuenta', label: 'Nombre de la persona', placeholder: 'Ej.: Juan, Mesa 4, El del taller', confirmText: 'Abrir cuenta' });
  if (!name) return;
  try {
    const tab = await post('/api/tabs', { name, lines: tabLines(carry) });
    showTab(tab);
    refreshTabsCount();
    toast(`Cuenta de ${tab.name} abierta.`);
  } catch (err) {
    if (err instanceof ApiError && err.code === 'tab_name_taken' && err.details) {
      const ok = await confirmDialog({ title: err.message, message: '¿Quieres abrir la que ya existe?', confirmText: 'Abrirla' });
      if (ok) return openTab(await get(`/api/tabs/${err.details.id}`), carry);
      return;
    }
    if (err instanceof ApiError && err.code === 'price_changed') loadCatalog().catch(() => {});
    errorToast(err);
  }
}

async function openTab(tab, carry) {
  if (carry.length) {
    try {
      tab = await api('PATCH', `/api/tabs/${tab.id}`, { version: tab.version, lines: [...tab.lines.map(stripName), ...tabLines(carry)] });
      toast(`Apuntado en la cuenta de ${tab.name}.`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'price_changed') loadCatalog().catch(() => {});
      return errorToast(err);
    }
  }
  showTab(tab);
}

function stripName(l) {
  return { product_id: l.product_id, qty: l.qty, unit_price_cents: l.unit_price_cents,
    licor_option_id: l.licor_option_id ?? null, refresco_option_id: l.refresco_option_id ?? null };
}

async function cancelTab(tab) {
  let reason = null;
  if (tab.items) {
    reason = await askText({ title: `Eliminar la cuenta de ${tab.name} (${eur(tab.total_cents)})`,
      label: 'Motivo (obligatorio, queda registrado). No se cobra nada.', suggestions: TAB_CANCEL_REASONS, confirmText: 'Eliminar', danger: true });
    if (!reason) return;
  } else {
    const ok = await confirmDialog({ title: `¿Eliminar la cuenta de ${tab.name}?`, message: 'Está vacía.', confirmText: 'Eliminar', danger: true });
    if (!ok) return;
  }
  try {
    await post(`/api/tabs/${tab.id}/cancel`, { reason });
    if (st.tab && st.tab.id === tab.id) { st.tab = null; st.cart = []; renderCart(); }
    refreshTabsCount();
    toast(`Cuenta de ${tab.name} eliminada.`);
  } catch (err) { errorToast(err); }
}

// --- Combinado ---------------------------------------------------------------

function chooseCombo(p) {
  st.modalOpen = true;
  return modal((close) => {
    let licor = null;
    let refresco = null;
    const licores = p.options.filter((o) => o.grp === 'licor');
    const refrescos = p.options.filter((o) => o.grp === 'refresco');
    const summary = h('div', { class: 'grow' });
    const price = h('span', { class: 'price-big' });
    const add = h('button', { class: 'btn success big', disabled: true, onclick: () => close({ licor, refresco }) }, 'Añadir a la cuenta');
    const group = (items, pick, isOn) => h('div', { class: 'opt-grid' }, items.map((o) => h('button', {
      class: 'opt', 'data-id': o.id,
      onclick: (e) => { pick(o); e.currentTarget.parentElement.querySelectorAll('.opt').forEach((b) => b.classList.toggle('on', isOn(Number(b.dataset.id)))); update(); },
    }, h('span', { class: 'strong' }, o.label), o.price_cents !== null ? h('span', {}, eur(o.price_cents)) : null)));
    function update() {
      clear(summary);
      summary.append(h('div', { class: 'strong big-text' }, `${licor ? licor.label : '¿Licor?'} + ${refresco ? refresco.label : '¿Refresco?'}`));
      price.textContent = licor ? eur(licor.price_cents) : '';
      add.disabled = !(licor && refresco);
    }
    update();
    return h('div', { class: 'stack' },
      h('h2', {}, p.name),
      h('h3', { class: 'muted' }, '1 · Licor'),
      group(licores, (o) => { licor = o; }, (id) => licor && licor.id === id),
      h('h3', { class: 'muted' }, '2 · Refresco'),
      group(refrescos, (o) => { refresco = o; }, (id) => refresco && refresco.id === id),
      h('div', { class: 'row between combo-foot' }, summary, price,
        h('button', { class: 'btn ghost', onclick: () => close(null) }, 'Cancelar'), add),
    );
  }, { wide: true }).finally(() => { st.modalOpen = false; });
}

// --- Cobro -------------------------------------------------------------------

async function handleSaleError(err) {
  if (!(err instanceof ApiError)) return errorToast(err);
  if ((err.code === 'tab_changed' || err.code === 'tab_closed') && st.tab) {
    await reloadTab().catch(() => {});
    return errorToast(err);
  }
  if (err.code === 'price_changed' || err.code === 'combo_changed') {
    await loadCatalog();
    for (const l of st.cart) {
      const p = st.catalog.products.find((x) => x.id === l.product_id);
      if (!p) continue;
      if (p.kind === 'simple') l.unit_price_cents = p.price_cents;
      else {
        const o = p.options.find((x) => x.id === l.licor_option_id);
        if (o) l.unit_price_cents = o.price_cents;
      }
    }
    cartChanged();
    return errorToast(err);
  }
  if (err.code === 'no_open_shift') return ctxRef.noShift();
  return errorToast(err);
}

function saleBody(extra) {
  if (!st.saleId) st.saleId = uuid4();
  if (st.tab) {
    // Se cobra lo que tiene guardado la cuenta; la versión evita cobrar algo distinto de lo que se ve.
    return { id: st.saleId, tab_id: st.tab.id, tab_version: st.tab.version, lines: [],
      client_created_at: new Date().toISOString(), device_id: 'pc', ...extra };
  }
  return {
    id: st.saleId,
    lines: st.cart.map((l) => ({
      product_id: l.product_id, qty: l.qty, unit_price_cents: l.unit_price_cents,
      licor_option_id: l.licor_option_id ?? null, refresco_option_id: l.refresco_option_id ?? null,
    })),
    client_created_at: new Date().toISOString(),
    device_id: 'pc',
    ...extra,
  };
}

function finishSale(message) {
  st.cart = [];
  st.saleId = null;
  st.tab = null;
  st.unsaved = false;
  renderCart();
  refreshTabsCount();
  document.body.classList.remove('cart-open');
  toast(message);
  loadCatalog().catch(() => {});
  ctxRef.refreshState().catch(() => {});
}

async function openCharge() {
  if (!st.cart.length) return;
  if (!(await tabSaved())) return;
  const total = cartTotal();
  const title = st.tab ? `Cobrar la cuenta de ${st.tab.name}` : 'Cobrar';
  st.modalOpen = true;
  const result = await modal((close) => {
    let tendered = null;
    const input = h('input', { id: 'tendered', inputmode: 'decimal', class: 'money-input', placeholder: '0,00', autocomplete: 'off' });
    const change = h('span', { class: 'change-amount', id: 'change' });
    const changeBox = h('div', { class: 'change-box' }, h('span', { class: 'change-label' }, 'Cambio a devolver'), change);
    const error = h('p', { class: 'field-error' });
    const confirmBtn = h('button', { class: 'btn success big grow2', id: 'confirm-charge', onclick: confirm }, 'CONFIRMAR COBRO');
    function setTendered(cents, fromInput = false) {
      tendered = cents;
      if (!fromInput) input.value = cents === null ? '' : (cents / 100).toFixed(2).replace('.', ',');
      refresh();
    }
    function refresh() {
      error.textContent = '';
      if (tendered === null) {
        change.textContent = '—';
        changeBox.classList.remove('bad');
        confirmBtn.disabled = false; // sin importe: se entiende pago exacto
        confirmBtn.textContent = 'COBRAR EXACTO';
        return;
      }
      confirmBtn.textContent = 'CONFIRMAR COBRO';
      const diff = tendered - total;
      change.textContent = diff >= 0 ? eur(diff) : `Faltan ${eur(-diff)}`;
      changeBox.classList.toggle('bad', diff < 0);
      confirmBtn.disabled = diff < 0;
    }
    input.addEventListener('input', () => {
      const v = input.value.trim();
      if (!v) return setTendered(null, true);
      const cents = parseEuros(v);
      if (cents === null) { tendered = null; change.textContent = '—'; confirmBtn.disabled = true; error.textContent = 'Importe no válido.'; return; }
      setTendered(cents, true);
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !confirmBtn.disabled) { e.preventDefault(); confirm(); } });
    async function confirm() {
      setBusy(confirmBtn, true);
      try {
        const sale = await post('/api/sales', saleBody({ tendered_cents: tendered ?? total }));
        close(sale);
      } catch (err) {
        setBusy(confirmBtn, false);
        if (err instanceof ApiError && err.status === 0) { error.textContent = `${err.message} La venta NO se ha guardado: vuelve a pulsar cuando vuelva la conexión.`; return; }
        close({ error: err });
      }
    }
    refresh();
    return h('div', { class: 'stack charge-modal' },
      h('div', { class: 'row between' }, h('h2', {}, title),
        h('div', { class: 'row' }, h('button', { class: 'btn pill on', type: 'button' }, 'Efectivo'),
          h('button', { class: 'btn pill', type: 'button', disabled: true }, 'Tarjeta · pronto'))),
      h('div', { class: 'two-col' },
        h('div', { class: 'box' }, h('div', { class: 'muted strong' }, 'Total a cobrar'), h('div', { class: 'price-huge', id: 'charge-total' }, eur(total))),
        h('div', { class: 'box' }, h('label', { for: 'tendered', class: 'muted strong' }, 'Entregado por el cliente'), input)),
      h('div', { class: 'row between' }, h('span', { class: 'muted strong' }, 'Billetes recibidos (cada clic suma)'),
        h('button', { class: 'btn ghost', onclick: () => setTendered(null) }, 'Borrar importe')),
      h('div', { class: 'bills' },
        h('button', { class: 'bill exact', id: 'bill-exact', onclick: () => setTendered(total) }, 'Exacto'),
        BILLS.map((b) => h('button', { class: 'bill', onclick: () => setTendered((tendered ?? 0) + b) }, eur(b).replace(',00', '')))),
      changeBox,
      error,
      h('div', { class: 'row' }, h('button', { class: 'btn ghost big grow', onclick: () => close(null) }, 'Volver'), confirmBtn),
    );
  }, { wide: true, dismissable: true });
  st.modalOpen = false;
  if (!result) return;
  if (result.error) return handleSaleError(result.error);
  finishSale(result.change_cents > 0 ? `Cobrado ${eur(result.total_cents)}. Cambio: ${eur(result.change_cents)}` : `Cobrado ${eur(result.total_cents)}.`);
}

async function invite() {
  if (!st.cart.length) return toast('Añade a la cuenta lo que se invita.', 'error');
  if (!(await tabSaved())) return;
  const reason = await askText({ title: 'Invitación', label: 'Motivo (obligatorio)', suggestions: INVITATION_REASONS, confirmText: 'Registrar invitación' });
  if (!reason) return;
  try {
    await post('/api/sales', saleBody({ kind: 'invitacion', note: reason }));
    finishSale('Invitación registrada.');
  } catch (err) { handleSaleError(err); }
}

// --- Últimas ventas y anulaciones ------------------------------------------------

async function recentSales() {
  let sales;
  try { sales = await get('/api/sales/recent?limit=40'); } catch (err) { return handleSaleError(err); }
  st.modalOpen = true;
  await modal((close) => {
    const list = h('div', { class: 'recent' });
    const draw = (items) => {
      clear(list);
      if (!items.length) list.append(h('p', { class: 'empty' }, 'Todavía no hay ventas en este turno.'));
      for (const s of items) {
        const remaining = s.lines.some((l) => l.qty > l.voided_qty);
        list.append(h('div', { class: 'recent-sale' },
          h('div', { class: 'row between' },
            h('div', {}, h('span', { class: 'strong' }, fmtTime(s.created_at)), ' · ', s.kind === 'invitacion' ? h('span', { class: 'badge badge-low' }, 'Invitación') : eur(s.total_cents),
              s.voided_cents ? h('span', { class: 'badge badge-out' }, `Anulado ${eur(s.voided_cents)}`) : null),
            remaining ? h('button', { class: 'btn danger small-btn', onclick: () => doVoid(s, null) }, 'Anular venta') : h('span', { class: 'muted' }, 'Anulada')),
          s.lines.map((l) => h('div', { class: 'row between recent-line' },
            h('span', {}, `${l.qty} × ${l.name}`, l.voided_qty ? h('span', { class: 'muted' }, ` (anuladas ${l.voided_qty})`) : null),
            l.qty > l.voided_qty && (s.lines.length > 1 || l.qty - l.voided_qty > 1) ? h('button', { class: 'btn ghost small-btn', onclick: () => doVoid(s, l) }, 'Anular 1') : null)),
        ));
      }
    };
    async function doVoid(sale, line) {
      const what = line ? `1 × ${line.name}` : `toda la venta de las ${fmtTime(sale.created_at)}`;
      const reason = await askText({ title: `Anular ${what}`, label: 'Motivo (obligatorio, queda registrado)', suggestions: VOID_REASONS, confirmText: 'Anular', danger: true });
      if (!reason) return;
      try {
        await post('/api/voids', { id: uuid4(), sale_id: sale.id, line_id: line ? line.id : null, qty: line ? 1 : null, reason });
        toast('Anulación registrada. El importe se descuenta de la caja.');
        draw(await get('/api/sales/recent?limit=40'));
      } catch (err) { errorToast(err); }
    }
    draw(sales);
    return h('div', { class: 'stack' }, h('div', { class: 'row between' }, h('h2', {}, 'Últimas ventas del turno'),
      h('button', { class: 'btn ghost', onclick: () => close() }, 'Cerrar')), list);
  }, { wide: true });
  st.modalOpen = false;
}

async function cashMovement() {
  st.modalOpen = true;
  const values = await formDialog({
    title: 'Movimiento de caja',
    fields: [
      { name: 'direction', label: 'Tipo', type: 'select', value: 'salida', options: [
        { value: 'salida', label: 'Sale dinero (pago a proveedor, retirada a caja fuerte…)' },
        { value: 'entrada', label: 'Entra dinero (cambio, aportación…)' }] },
      { name: 'amount', label: 'Importe (€)', inputmode: 'decimal', placeholder: '0,00' },
      { name: 'concept', label: 'Concepto', placeholder: 'Ej.: hielo, pan, retirada', maxlength: 200 },
    ],
    confirmText: 'Registrar',
    validate: (v) => {
      const c = parseEuros(v.amount);
      if (!c || c <= 0) return 'Importe no válido.';
      if (!v.concept.trim()) return 'Indica el concepto.';
      return null;
    },
  });
  st.modalOpen = false;
  if (!values) return;
  try {
    await post('/api/cash-movements', { direction: values.direction, amount_cents: parseEuros(values.amount), concept: values.concept.trim() });
    toast(`Movimiento registrado: ${values.direction === 'salida' ? '−' : '+'}${eur(parseEuros(values.amount))}`);
  } catch (err) { handleSaleError(err); }
}
