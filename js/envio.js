// Envío de los cierres de turno a la app «Gestión del bar».
//
// La caja guarda cada cierre en una cola (tabla `cierres`). Este módulo la vacía:
// pide a la caja lo que toca enviar, lo manda a Gestión con la llave de esta caja y
// apunta el resultado. Sin internet no pasa nada: lo intenta otra vez más tarde
// (cada vez esperando un poco más, hasta 1 hora) y en cuanto vuelve la conexión.
// Gestión no importa nunca un cierre dos veces, así que reenviar es seguro.
import { get, post, put, download } from './api.js';
import { h, clear, eur, fmtDate, fmtDateTime } from './util.js';
import { toast, errorToast, formDialog, confirmDialog } from './ui.js';

const EVERY_MS = 2 * 60 * 1000;
const TIMEOUT_MS = 20_000;
const STALE_MS = 24 * 60 * 60 * 1000;

let running = null;
let status = null;
let started = false;

export const lastStatus = () => status;

async function refresh() {
  try {
    status = await get('/api/conexion');
    window.dispatchEvent(new CustomEvent('cpbar:envio', { detail: status }));
  } catch { /* la caja no responde: se verá en el siguiente ciclo */ }
  return status;
}

/** Manda un cierre a Gestión. Devuelve el resultado para apuntarlo en la caja. */
async function sendOne(endpoint, token, item) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(item.payload),
      signal: ctrl.signal,
      cache: 'no-store',
      credentials: 'omit',
    });
  } catch {
    return { ok: false, offline: true, error: 'Sin conexión con Gestión.' };
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try { data = await res.json(); } catch { /* sin cuerpo */ }
  if (res.ok) {
    return { ok: true, remote_status: data && data.estado === 'repetido' ? 'repetido' : 'recibido' };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: 'Gestión no reconoce la llave de esta caja. Vuelve a conectarla en Productos → Ajustes.' };
  }
  const msg = data && (data.message || data.error);
  return { ok: false, error: msg ? `Gestión: ${String(msg).slice(0, 200)}` : `Gestión respondió con error ${res.status}.` };
}

/**
 * Envía lo pendiente. Con `force` no espera a que pase el tiempo entre reintentos
 * (botón «Enviar ahora», al cerrar el turno o al volver internet).
 * Devuelve { configured, sent, failed, error }.
 */
export function run({ force = false } = {}) {
  // Si ya hay un envío en marcha, uno forzado espera a que acabe y vuelve a mirar
  // (por ejemplo, el cierre que se acaba de hacer no estaba en el envío anterior).
  if (running) return force ? running.then(() => run({ force })) : running;
  running = (async () => {
    const out = { configured: false, sent: 0, failed: 0, error: null };
    try {
      // Primero solo se lee: si no hay nada pendiente no se escribe nada en la caja
      // (en la tablet cada escritura cuenta como cambio para la copia de GitHub).
      const s = await get('/api/conexion');
      out.configured = s.configured;
      if (!s.configured || !s.pending) {
        status = s;
        window.dispatchEvent(new CustomEvent('cpbar:envio', { detail: s }));
        return out;
      }
      const job = await post('/api/cierres/envio', { force });
      out.configured = job.configured;
      for (const item of job.items || []) {
        const result = await sendOne(job.endpoint, job.token, item);
        await post(`/api/cierres/${item.id}/resultado`, { ok: result.ok, remote_status: result.remote_status, error: result.error });
        if (result.ok) out.sent += 1;
        else {
          out.failed += 1;
          out.error = result.error;
          if (result.offline) break; // sin internet: no tiene sentido probar los demás ahora
        }
      }
    } catch (err) {
      out.error = err && err.message ? err.message : String(err);
    }
    await refresh();
    return out;
  })().finally(() => { running = null; });
  return running;
}

/** Arranca los envíos automáticos. Se llama una vez al abrir la caja. */
export function start() {
  if (started) return;
  started = true;
  setTimeout(() => run(), 4000);
  setInterval(() => { if (navigator.onLine !== false) run(); }, EVERY_MS);
  window.addEventListener('online', () => run({ force: true }));
}

// --- Avisos ------------------------------------------------------------------------

/** Aviso para la barra superior si hay cierres atascados. null si todo va bien. */
export function banner() {
  const s = status;
  if (!s || !s.configured || !s.pending) return null;
  const old = s.oldest_pending_at && Date.now() - Date.parse(s.oldest_pending_at) > STALE_MS;
  const keyError = s.recent.some((r) => !r.sent_at && r.last_error && /llave/i.test(r.last_error));
  if (!old && !keyError) return null;
  return h('div', { class: 'banner banner-error' },
    h('strong', {}, `${s.pending === 1 ? 'Hay 1 cierre' : `Hay ${s.pending} cierres`} sin llegar a Gestión. `),
    keyError ? 'La llave de esta caja no es válida: vuelve a conectarla en Productos → Ajustes.'
      : 'Revisa que haya internet. Se siguen intentando solos; también puedes descargarlos en Productos → Ajustes.');
}

// --- Resultado al cerrar el turno -----------------------------------------------------

/** Línea de estado para la pantalla «Turno cerrado»: envía al momento y dice cómo ha ido. */
export function closeNotice(closed) {
  const line = h('p', { class: 'muted' }, 'Enviando el cierre a Gestión…');
  const fileBtn = h('button', { class: 'btn ghost big', onclick: async () => {
    try { toast(`Descargado: ${await download(`/api/shifts/${closed.id}/cierre`)}`, 'ok', 6000); } catch (err) { errorToast(err); }
  } }, 'Descargar archivo del cierre');
  const box = h('div', { class: 'stack' }, line);
  if (!closed.cierre_id) {
    line.textContent = 'Modo práctica: este cierre no se envía a Gestión.';
    return box;
  }
  run({ force: true }).then((r) => {
    if (!r.configured) {
      line.textContent = 'Esta caja aún no está conectada a Gestión. Puedes subir el cierre a mano con el archivo, o conectarla en Productos → Ajustes.';
      box.append(h('div', { class: 'row' }, fileBtn));
      return;
    }
    const mine = status && status.recent.find((x) => x.id === closed.cierre_id);
    if (mine && mine.sent_at) {
      line.className = 'ok-text strong';
      line.textContent = '✓ Cierre enviado a Gestión.';
    } else {
      line.className = 'notice';
      line.textContent = `El cierre no ha llegado a Gestión todavía (${(mine && mine.last_error) || r.error || 'sin conexión'}). Se enviará solo en cuanto haya internet.`;
      box.append(h('div', { class: 'row' }, fileBtn));
    }
  });
  return box;
}

// --- Panel en Productos → Ajustes ------------------------------------------------------

function stateText(r) {
  if (r.sent_at) return r.remote_status === 'repetido' ? 'Ya estaba en Gestión' : 'Enviado';
  if (r.last_error) return `Pendiente · ${r.last_error}`;
  return 'Pendiente';
}

export function panel(reload) {
  const box = h('div', { class: 'panel stack' }, h('h2', {}, 'Gestión del bar'), h('p', { class: 'muted' }, 'Cargando…'));
  const draw = (s) => {
    clear(box);
    box.append(h('h2', {}, 'Gestión del bar'));
    if (!s) { box.append(h('p', { class: 'field-error' }, 'No se ha podido leer el estado.')); return; }
    box.append(h('p', {}, s.configured
      ? ['Conectada como ', h('strong', {}, s.device.name), ` · ${s.endpoint_host}`]
      : ['Sin conectar. Esta caja se llama ', h('strong', {}, s.device.name), '. Al cerrar cada turno, el cierre queda guardado para Gestión.']));
    if (s.demo) {
      box.append(h('p', { class: 'notice' }, 'Modo práctica: los cierres de práctica no se envían. Se empiezan a enviar al pulsar «Empezar en real».'));
    }
    box.append(h('p', { class: 'muted' }, s.pending
      ? `${s.pending === 1 ? '1 cierre pendiente' : `${s.pending} cierres pendientes`} de llegar a Gestión.`
      : (s.last_sent_at ? `Todo enviado. Último envío: ${fmtDateTime(s.last_sent_at)}.` : 'No hay cierres pendientes.')));
    if (s.recent.length) {
      box.append(h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Turno'), h('th', { class: 'num' }, 'Vendido'), h('th', { class: 'num' }, 'Descuadre'), h('th', {}, 'Estado'))),
        h('tbody', {}, s.recent.map((r) => h('tr', {},
          h('td', {}, `${fmtDate(r.business_date)} · nº ${r.shift_id}`),
          h('td', { class: 'num' }, eur(r.net_cents)),
          h('td', { class: 'num' }, eur(r.difference_cents)),
          h('td', { class: r.sent_at ? 'ok-text' : 'muted' }, stateText(r)))))));
    }
    const sendBtn = h('button', { class: 'btn primary', disabled: !s.configured || !s.pending, onclick: async () => {
      sendBtn.disabled = true;
      const r = await run({ force: true });
      if (r.sent && !r.failed) toast(r.sent === 1 ? 'Cierre enviado.' : `${r.sent} cierres enviados.`);
      else if (r.failed || r.error) errorToast(r.error || 'No se ha podido enviar.');
      else toast('No había nada que enviar.');
      draw(status);
    } }, 'Enviar ahora');
    const fileBtn = h('button', { class: 'btn ghost', disabled: !s.pending, onclick: async () => {
      try { toast(`Descargado: ${await download('/api/cierres/archivo')}. Súbelo en Gestión → Ventas → Subir archivo.`, 'ok', 8000); } catch (err) { errorToast(err); }
    } }, 'Descargar pendientes (archivo)');
    const connectBtn = h('button', { class: s.configured ? 'btn ghost' : 'btn primary', onclick: () => connect(s) },
      s.configured ? 'Cambiar conexión' : 'Conectar con Gestión');
    box.append(h('div', { class: 'row wrap' }, connectBtn, s.configured ? sendBtn : null, fileBtn,
      s.configured ? h('button', { class: 'btn ghost', onclick: disconnect }, 'Desconectar') : null));
    box.append(h('p', { class: 'muted small' }, 'Gestión no importa nunca un cierre dos veces: da igual que llegue por internet y también por archivo.'));
  };
  const connect = async (s) => {
    const v = await formDialog({
      title: 'Conectar con Gestión',
      confirmText: 'Conectar',
      fields: [
        { name: 'device_name', label: 'Nombre de esta caja', value: s.device.name, maxlength: 40, help: 'Así aparecerá en Gestión. Por ejemplo: Tablet, PC.' },
        { name: 'code', label: 'Código de conexión', maxlength: 2000, placeholder: 'CPBAR1:…', help: 'Cópialo en Gestión → Ajustes → Cajas → Añadir caja, y pégalo aquí.' },
      ],
      validate: (x) => (!x.device_name.trim() ? 'Pon un nombre a esta caja.' : !x.code.trim() ? 'Pega el código de conexión.' : null),
    });
    if (!v) return;
    try {
      draw(await put('/api/conexion', { device_name: v.device_name, code: v.code }));
      toast('Caja conectada. Enviando cierres pendientes…');
      const r = await run({ force: true });
      if (r.error) errorToast(r.error);
      else if (r.sent) toast(r.sent === 1 ? 'Cierre enviado.' : `${r.sent} cierres enviados.`);
      draw(status);
    } catch (err) { errorToast(err); }
  };
  const disconnect = async () => {
    const ok = await confirmDialog({ title: '¿Desconectar de Gestión?', message: 'Los cierres se seguirán guardando aquí y podrás enviarlos por archivo o al volver a conectar.', confirmText: 'Desconectar', danger: true });
    if (!ok) return;
    try { draw(await put('/api/conexion', { disconnect: true })); } catch (err) { errorToast(err); }
  };
  refresh().then(draw);
  return box;
}
