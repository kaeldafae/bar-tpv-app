// Arranque, navegación, estado global, acceso de administración y apertura de turno.
import { api, get, post, setLoginHandler, ApiError } from './api.js';
import { h, clear, eur, parseEuros, centsToInput, fmtDate } from './util.js';
import { modal, toast, errorToast, confirmDialog } from './ui.js';
import * as sell from './sell.js';
import * as closeShift from './close.js';
import * as reports from './reports.js';
import * as adminView from './admin.js';

const VIEWS = {
  vender: { label: 'Vender', icon: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z M3 6h18 M16 10a4 4 0 0 1-8 0', mod: sell, admin: false },
  cerrar: { label: 'Cerrar turno', icon: 'M12 2v10 M18.4 6.6a9 9 0 1 1-12.8 0', mod: closeShift, admin: true },
  informes: { label: 'Informes', icon: 'M4 20V10 M10 20V4 M16 20v-7 M22 20H2', mod: reports, admin: true },
  admin: { label: 'Admin', icon: 'M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4 M12 15v2', mod: adminView, admin: true },
};

export const ctx = {
  state: null,
  view: 'vender',
  async refreshState() {
    ctx.state = await get('/api/state');
    renderChrome();
    return ctx.state;
  },
  go,
  ensureAdmin,
  noShift: () => noShiftDetected(),
};

let leaveCurrent = null;

function icon(path) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '22');
  svg.setAttribute('height', '22');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', path);
  svg.append(p);
  return svg;
}

// --- Contraseña de administración -----------------------------------------

let loginPromise = null;
function loginPrompt() {
  if (loginPromise) return loginPromise;
  loginPromise = modal((close) => {
    const input = h('input', { type: 'password', id: 'admin-pass', autocomplete: 'current-password', autofocus: true });
    const error = h('p', { class: 'field-error' });
    const btn = h('button', { class: 'btn primary big', type: 'submit' }, 'Entrar');
    const form = h('form', {
      class: 'stack login',
      onsubmit: async (e) => {
        e.preventDefault();
        if (!input.value) { error.textContent = 'Escribe la contraseña.'; return; }
        btn.disabled = true;
        try {
          await post('/api/admin/login', { password: input.value });
          close(true);
        } catch (err) {
          error.textContent = err.message;
          input.select();
        } finally {
          btn.disabled = false;
        }
      },
    },
      h('div', { class: 'login-head' }, icon(VIEWS.admin.icon), h('div', {}, h('div', { class: 'brand-small' }, 'CP BAR'), h('h2', {}, 'Administración'))),
      h('label', { for: 'admin-pass' }, 'Contraseña'),
      input,
      error,
      btn,
      h('button', { class: 'btn ghost', type: 'button', onclick: () => close(false) }, 'Cancelar'),
      h('p', { class: 'muted small center' }, 'La sesión se cierra sola tras 5 minutos sin uso.'),
    );
    return form;
  }).then(async (ok) => {
    loginPromise = null;
    if (ok) await ctx.refreshState().catch(() => {});
    return ok === true;
  });
  return loginPromise;
}
setLoginHandler(loginPrompt);

async function ensureAdmin() {
  await ctx.refreshState();
  if (ctx.state.is_admin) return true;
  return loginPrompt();
}

// --- Navegación ------------------------------------------------------------

async function go(view) {
  const target = VIEWS[view] ? view : 'vender';
  if (VIEWS[target].admin && !(await ensureAdmin())) return;
  if (leaveCurrent) { try { leaveCurrent(); } catch { /* nada */ } leaveCurrent = null; }
  ctx.view = target;
  renderChrome();
  const main = clear(document.getElementById('main'));
  try {
    leaveCurrent = (await VIEWS[target].mod.render(main, ctx)) || null;
  } catch (err) {
    main.append(h('div', { class: 'panel' }, h('h2', {}, 'No se ha podido cargar esta pantalla'), h('p', {}, err.message),
      h('button', { class: 'btn', onclick: () => go(target) }, 'Reintentar')));
  }
}

function renderChrome() {
  const s = ctx.state;
  const nav = clear(document.getElementById('nav'));
  for (const [key, v] of Object.entries(VIEWS)) {
    nav.append(h('button', {
      class: `nav-item${ctx.view === key ? ' active' : ''}`,
      'aria-current': ctx.view === key ? 'page' : null,
      onclick: () => go(key),
    }, icon(v.icon), h('span', {}, v.label)));
  }
  const info = clear(document.getElementById('shift-info'));
  if (s && s.shift) {
    info.append(h('div', { class: 'muted small' }, 'Turno abierto'),
      h('div', { class: 'strong' }, fmtDate(s.shift.business_date)),
      h('div', { class: 'muted small' }, `Fondo ${eur(s.shift.opening_float_cents)}`));
  } else {
    info.append(h('div', { class: 'muted small' }, 'Sin turno abierto'));
  }
  const adminBox = clear(document.getElementById('admin-state'));
  if (s && s.is_admin) {
    adminBox.append(h('button', {
      class: 'btn ghost small-btn',
      onclick: async () => { await post('/api/admin/logout'); await ctx.refreshState(); if (VIEWS[ctx.view].admin) go('vender'); toast('Has salido de administración.'); },
    }, 'Salir de admin'));
  }
  renderBanners();
}

function renderBanners() {
  const s = ctx.state;
  const box = clear(document.getElementById('banners'));
  if (!s) return;
  if (s.demo_data) {
    box.append(h('div', { class: 'banner banner-demo' },
      h('strong', {}, 'MODO PRÁCTICA · datos de EJEMPLO con precios ficticios. '),
      'Cambia productos y precios en Admin. Cuando estés listo: Admin → Ajustes → «Empezar en real».'));
  }
  if (s.last_sale_at && Date.now() < new Date(s.last_sale_at).getTime() - 5 * 60 * 1000) {
    box.append(h('div', { class: 'banner banner-error' },
      h('strong', {}, 'La hora del ordenador está atrasada. '),
      'Es anterior a la última venta guardada. Corrige la fecha y hora de Windows antes de seguir vendiendo.'));
  }
}

function tickClock() {
  const el = document.getElementById('clock');
  if (el) el.textContent = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

// --- Primer arranque y apertura de turno ----------------------------------

function setupScreen() {
  const main = clear(document.getElementById('main'));
  const p1 = h('input', { type: 'password', id: 'p1', autocomplete: 'new-password', autofocus: true });
  const p2 = h('input', { type: 'password', id: 'p2', autocomplete: 'new-password' });
  const error = h('p', { class: 'field-error' });
  main.append(h('form', {
    class: 'panel narrow stack',
    onsubmit: async (e) => {
      e.preventDefault();
      if (p1.value.length < 8) { error.textContent = 'Mínimo 8 caracteres.'; return; }
      if (p1.value !== p2.value) { error.textContent = 'Las dos contraseñas no coinciden.'; return; }
      try {
        await post('/api/admin/setup', { password: p1.value });
        toast('Contraseña creada. Guárdala en un lugar seguro.');
        await boot();
      } catch (err) { error.textContent = err.message; }
    },
  },
    h('h1', {}, 'Bienvenido a CP BAR'),
    h('p', { class: 'big-text' }, 'Primer arranque: crea la contraseña de administración. Se pedirá para cambiar precios, productos, inventario, anular ventas, cerrar el turno y ver informes.'),
    h('label', { for: 'p1' }, 'Contraseña (mínimo 8 caracteres)'), p1,
    h('label', { for: 'p2' }, 'Repite la contraseña'), p2,
    error,
    h('button', { class: 'btn primary big', type: 'submit' }, 'Crear contraseña'),
  ));
  setTimeout(() => p1.focus(), 0);
}

function openShiftScreen() {
  ctx.view = 'vender';
  renderChrome();
  const main = clear(document.getElementById('main'));
  const input = h('input', { id: 'float', inputmode: 'decimal', value: centsToInput(ctx.state.suggested_float_cents), class: 'money-input' });
  const error = h('p', { class: 'field-error' });
  const btn = h('button', { class: 'btn success big', type: 'submit' }, 'Abrir turno');
  main.append(h('form', {
    class: 'panel narrow stack',
    onsubmit: async (e) => {
      e.preventDefault();
      const cents = parseEuros(input.value);
      if (cents === null) { error.textContent = 'Importe no válido. Ejemplo: 250 o 250,50'; return; }
      if (cents !== ctx.state.suggested_float_cents) {
        const ok = await confirmDialog({
          title: 'El fondo no coincide con el previsto',
          message: `Se dejaron ${eur(ctx.state.suggested_float_cents)} al cerrar el último turno y ahora indicas ${eur(cents)}. Quedará registrado. ¿Continuar?`,
          confirmText: 'Sí, abrir turno',
        });
        if (!ok) return;
      }
      btn.disabled = true;
      try {
        await post('/api/shifts/open', { opening_float_cents: cents });
        toast('Turno abierto. ¡Buen servicio!');
        await boot();
      } catch (err) { error.textContent = err.message; btn.disabled = false; }
    },
  },
    h('h1', {}, 'Abrir turno'),
    h('p', { class: 'big-text' }, 'Cuenta el dinero que hay en la caja antes de empezar (fondo de cambio).'),
    h('label', { for: 'float' }, 'Fondo de caja (€)'),
    input,
    error,
    btn,
  ));
  setTimeout(() => input.select(), 0);
}

async function boot() {
  try {
    await ctx.refreshState();
  } catch (err) {
    const main = clear(document.getElementById('main'));
    main.append(h('div', { class: 'panel narrow stack' }, h('h1', {}, 'No hay conexión con la caja'), h('p', { class: 'big-text' }, err.message),
      h('button', { class: 'btn primary big', onclick: boot }, 'Reintentar')));
    return;
  }
  if (!ctx.state.admin_configured) return setupScreen();
  if (!ctx.state.shift) return openShiftScreen();
  return go(ctx.view);
}

export function noShiftDetected() {
  toast('No hay turno abierto. Ábrelo para seguir vendiendo.', 'error');
  boot();
}

async function poll() {
  try {
    const before = ctx.state && ctx.state.shift && ctx.state.shift.id;
    await ctx.refreshState();
    const after = ctx.state.shift && ctx.state.shift.id;
    if (ctx.state.admin_configured && before && !after && ctx.view === 'vender') boot();
  } catch { /* sin conexión: se reintenta en el siguiente ciclo */ }
}

window.addEventListener('error', (e) => errorToast(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => {
  if (e.reason instanceof ApiError) errorToast(e.reason);
  else errorToast(e.reason || 'Error inesperado');
});

tickClock();
setInterval(tickClock, 10_000);
setInterval(poll, 30_000);
boot();

export { api };
