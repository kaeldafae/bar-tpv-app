// Arranque, navegación, estado global, acceso de administración y apertura de turno.
import { api, get, post, setLoginHandler, ApiError } from './api.js';
import { h, clear, eur, parseEuros, centsToInput, fmtDate } from './util.js';
import { modal, toast, errorToast, confirmDialog } from './ui.js';
import * as sell from './sell.js';
import * as closeShift from './close.js';
import * as reports from './reports.js';
import * as adminView from './admin.js';

// Solo Admin (productos y precios) pide contraseña.
const VIEWS = {
  vender: { label: 'Vender', icon: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z M3 6h18 M16 10a4 4 0 0 1-8 0', mod: sell, admin: false },
  cerrar: { label: 'Cerrar turno', icon: 'M12 2v10 M18.4 6.6a9 9 0 1 1-12.8 0', mod: closeShift, admin: false },
  informes: { label: 'Informes', icon: 'M4 20V10 M10 20V4 M16 20v-7 M22 20H2', mod: reports, admin: false },
  admin: { label: 'Productos', icon: 'M4 6h16 M4 12h16 M4 18h10', mod: adminView, admin: true },
};
const LOCK_ICON = 'M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4';
const SUN = 'M12 4V2 M12 22v-2 M4 12H2 M22 12h-2 M5.6 5.6 4.2 4.2 M19.8 19.8l-1.4-1.4 M5.6 18.4l-1.4 1.4 M19.8 4.2l-1.4 1.4 M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z';
const MOON = 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z';

// --- Tema claro / oscuro ----------------------------------------------------------
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('cpbar.tema', theme); } catch { /* sin almacenamiento */ }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#121418' : '#F4F2EE');
  const btn = document.getElementById('theme-btn');
  if (btn) {
    clear(btn).append(icon(theme === 'dark' ? SUN : MOON));
    btn.title = theme === 'dark' ? 'Tema claro' : 'Tema oscuro';
  }
}

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
      h('div', { class: 'login-head' }, icon(LOCK_ICON), h('div', {}, h('div', { class: 'brand-small' }, 'CP BAR'), h('h2', {}, 'Productos y precios'))),
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
    const lock = v.admin ? icon(LOCK_ICON) : null;
    if (lock) { lock.classList.add('lock'); lock.setAttribute('width', '16'); lock.setAttribute('height', '16'); }
    nav.append(h('button', {
      class: `nav-item${ctx.view === key ? ' active' : ''}`,
      'aria-current': ctx.view === key ? 'page' : null,
      onclick: () => go(key),
    }, icon(v.icon), h('span', {}, v.label), lock));
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
      onclick: async () => { await post('/api/admin/logout'); await ctx.refreshState(); if (VIEWS[ctx.view].admin) go('vender'); toast('Productos bloqueados con contraseña.'); },
    }, 'Bloquear productos'));
  }
  renderBanners();
}

function renderBanners() {
  const s = ctx.state;
  const box = clear(document.getElementById('banners'));
  if (!s) return;
  if (s.demo_data) {
    box.append(h('div', { class: 'banner banner-demo' },
      h('strong', {}, 'Modo práctica · productos y precios de ejemplo. '),
      'Pon los tuyos en Productos. Cuando estés listo: Productos → Ajustes → «Empezar en real».'));
  }
  if (s.last_sale_at && Date.now() < new Date(s.last_sale_at).getTime() - 5 * 60 * 1000) {
    box.append(h('div', { class: 'banner banner-error' },
      h('strong', {}, 'La hora del aparato está atrasada. '),
      'Es anterior a la última venta guardada. Corrige la fecha y hora antes de seguir vendiendo.'));
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
    h('p', { class: 'big-text' }, 'Primer arranque: crea una contraseña. Solo se pedirá para cambiar productos y precios; vender, cobrar y cerrar el turno no la piden.'),
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

applyTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
document.getElementById('theme-btn')?.addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});
tickClock();
setInterval(tickClock, 10_000);
setInterval(poll, 30_000);
boot();

export { api };
