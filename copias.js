// Copias de seguridad de la app de la tablet en un repositorio PRIVADO de GitHub (API REST).
//
// La caja funciona sin internet. Cuando hay conexión, sube:
//   copias/tpv.sqlite3            la base de datos entera (el historial de GitHub guarda cada versión)
//   cierres/CPBAR_turno_….xlsx    el Excel de cada cierre de turno
// Si no hay conexión, lo deja pendiente y lo sube en cuanto vuelve.
//
// La llave (token) es de GitHub, «fine-grained», con permiso solo de Contents (lectura y
// escritura) sobre ese repositorio. Se guarda únicamente en esta tablet.
import { h, clear } from './js/util.js';
import { toast, errorToast, formDialog, confirmDialog, setBusy } from './js/ui.js';

const CONFIG_KEY = 'cpbar.github';
const STATE_KEY = 'cpbar.github.estado';
const DB_PATH = 'copias/tpv.sqlite3';
const UPLOAD_EVERY_MS = 30 * 60 * 1000; // con cambios, como mucho una subida cada 30 minutos
const CHECK_EVERY_MS = 5 * 60 * 1000;

let caja = null;
let busy = false;

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* almacenamiento lleno o bloqueado */ }
}
const config = () => load(CONFIG_KEY, null);
const state = () => load(STATE_KEY, { dirty: true, pendingShifts: [], lastUpload: null, lastError: null });
function setState(patch) { save(STATE_KEY, { ...state(), ...patch }); }

export function init(api) {
  caja = api;
  window.addEventListener('online', () => flush());
  setInterval(() => flushIfDue(), CHECK_EVERY_MS);
  setTimeout(() => flushIfDue(), 20_000);
}

/** Lo llama boot.js tras cada operación que cambia datos. */
export function changed(method, path, body) {
  const s = state();
  s.dirty = true;
  if (path === '/api/shifts/current/close') {
    try {
      const closed = JSON.parse(new TextDecoder().decode(body));
      if (closed && closed.id) s.pendingShifts = [...new Set([...(s.pendingShifts || []), closed.id])];
    } catch { /* sin cuerpo: solo se marca la copia */ }
    save(STATE_KEY, s);
    setTimeout(() => flush(), 1000); // tras un cierre se sube enseguida
    return;
  }
  save(STATE_KEY, s);
}

function flushIfDue() {
  const s = state();
  const last = s.lastUpload ? Date.parse(s.lastUpload) : 0;
  if ((s.pendingShifts || []).length || (s.dirty && Date.now() - last > UPLOAD_EVERY_MS)) flush();
}

// --- API de GitHub -------------------------------------------------------------

function toBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(binary);
}

async function gh(cfg, method, path, body, accept = 'application/vnd.github+json') {
  const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${path}`, {
    method,
    headers: { Authorization: `Bearer ${cfg.token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  if (res.status === 404 && method === 'GET') return null;
  if (!res.ok) {
    let msg = `GitHub respondió ${res.status}`;
    if (res.status === 401) msg = 'La llave de GitHub no es válida o ha caducado.';
    if (res.status === 403 || res.status === 404) msg = 'La llave no tiene permiso para escribir en ese repositorio.';
    throw new Error(msg);
  }
  return res;
}

async function putFile(cfg, path, bytes, message) {
  const current = await gh(cfg, 'GET', path);
  const sha = current ? (await current.json()).sha : undefined;
  await gh(cfg, 'PUT', path, { message, content: toBase64(bytes), ...(sha ? { sha } : {}) });
}

/** Sube lo pendiente. Devuelve true si todo quedó subido. */
export async function flush({ force = false } = {}) {
  const cfg = config();
  if (!cfg || !caja || busy || (!navigator.onLine && !force)) return false;
  busy = true;
  try {
    const stamp = new Date().toLocaleString('es-ES');
    for (const id of [...(state().pendingShifts || [])]) {
      const { name, bytes } = caja.shiftExcel(id);
      await putFile(cfg, `cierres/${name}`, bytes, `Cierre de turno ${name}`);
      setState({ pendingShifts: state().pendingShifts.filter((x) => x !== id) });
    }
    if (state().dirty || force) {
      setState({ dirty: false }); // si cambia algo mientras se sube, volverá a quedar marcado
      try {
        await putFile(cfg, DB_PATH, caja.snapshot(), `Copia de la caja ${stamp}`);
      } catch (err) { setState({ dirty: true }); throw err; }
    }
    setState({ lastUpload: new Date().toISOString(), lastError: null });
    return true;
  } catch (err) {
    setState({ lastError: `${new Date().toLocaleString('es-ES')}: ${err.message}` });
    return false;
  } finally {
    busy = false;
  }
}

// --- Restaurar -------------------------------------------------------------------

async function restoreBytes(bytes, from) {
  const ok = await confirmDialog({
    title: `¿Restaurar la copia ${from}?`,
    message: 'Se sustituyen TODOS los datos de esta tablet (ventas, turnos, productos, cuentas abiertas) por los de la copia. Lo de ahora se pierde si no tiene copia.',
    confirmText: 'Restaurar', danger: true,
  });
  if (!ok) return;
  await caja.restore(bytes);
  setState({ dirty: true });
  toast('Copia restaurada. Se reinicia la caja…');
  setTimeout(() => location.reload(), 1200);
}

async function restoreFromGitHub() {
  const cfg = config();
  const res = await gh(cfg, 'GET', DB_PATH, null, 'application/vnd.github.raw');
  if (!res) throw new Error('Todavía no hay ninguna copia en GitHub.');
  await restoreBytes(new Uint8Array(await res.arrayBuffer()), 'más reciente de GitHub');
}

function restoreFromFile() {
  const input = h('input', { type: 'file', accept: '.sqlite3,application/vnd.sqlite3,application/octet-stream' });
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try { await restoreBytes(new Uint8Array(await file.arrayBuffer()), `del archivo ${file.name}`); } catch (err) { errorToast(err); }
  });
  input.click();
}

function downloadCopy() {
  const blob = new Blob([caja.snapshot()], { type: 'application/vnd.sqlite3' });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const a = h('a', { href: URL.createObjectURL(blob), download: `CPBAR_copia_${stamp}.sqlite3` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  toast('Copia descargada en Descargas.');
}

// --- Panel de Admin → Ajustes ------------------------------------------------------

async function configure(reload) {
  const cur = config() || {};
  const v = await formDialog({
    title: 'Copias en GitHub',
    fields: [
      { name: 'owner', label: 'Usuario de GitHub', value: cur.owner || 'kaeldafae' },
      { name: 'repo', label: 'Repositorio PRIVADO para las copias', value: cur.repo || 'bar-tpv-datos' },
      { name: 'token', label: 'Llave (token) de GitHub', type: 'password', value: '', autocomplete: 'off',
        help: cur.token ? 'Déjalo vacío para mantener la llave actual.' : 'Empieza por github_pat_. Solo se guarda en esta tablet.' },
    ],
    confirmText: 'Guardar y probar',
    validate: (x) => (!x.owner.trim() || !x.repo.trim() ? 'Escribe usuario y repositorio.' : (!x.token.trim() && !cur.token) ? 'Pega la llave de GitHub.' : null),
  });
  if (!v) return;
  save(CONFIG_KEY, { owner: v.owner.trim(), repo: v.repo.trim(), token: v.token.trim() || cur.token });
  setState({ dirty: true });
  const ok = await flush({ force: true });
  if (ok) toast('Conectado. Primera copia subida a GitHub.');
  else errorToast(new Error(`No se ha podido subir: ${state().lastError || 'sin conexión'}`));
  reload();
}

export function backupPanel(reload) {
  const cfg = config();
  const s = state();
  const panel = h('div', { class: 'panel stack' }, h('h2', {}, 'Copias de seguridad'));
  const status = cfg
    ? [h('p', {}, `Se suben solas a GitHub: ${cfg.owner}/${cfg.repo} (privado).`),
      h('p', {}, s.lastUpload ? `Última subida: ${new Date(s.lastUpload).toLocaleString('es-ES')}.` : 'Todavía no se ha subido ninguna copia.'),
      (s.pendingShifts || []).length || s.dirty
        ? h('p', { class: 'muted' }, navigator.onLine ? 'Hay cambios pendientes de subir.' : 'Sin conexión: los cambios se subirán cuando vuelva internet.')
        : h('p', { class: 'muted' }, 'Todo está subido.'),
      s.lastError ? h('p', { class: 'field-error' }, `Último error: ${s.lastError}`) : null]
    : [h('p', { class: 'field-error' }, 'Las copias a GitHub no están configuradas. Si se borran los datos del navegador, se pierden las ventas.'),
      h('p', { class: 'muted small' }, 'Configúralas una vez: necesitas un repositorio privado y una llave de GitHub (ver instrucciones).')];
  const upload = h('button', { class: 'btn primary', disabled: !cfg, onclick: async () => {
    setBusy(upload, true);
    const ok = await flush({ force: true });
    setBusy(upload, false);
    if (ok) toast('Copia subida a GitHub.'); else errorToast(new Error(state().lastError || 'Sin conexión.'));
    reload();
  } }, 'Subir copia ahora');
  panel.append(...status.filter(Boolean),
    h('p', { class: 'muted small' }, 'La copia se sube cada 30 minutos si hay cambios y siempre al cerrar el turno, junto con el Excel del cierre. Sin internet la caja sigue funcionando y sube lo pendiente después.'),
    h('div', { class: 'row wrap' },
      upload,
      h('button', { class: 'btn ghost', onclick: () => configure(reload) }, cfg ? 'Cambiar repositorio o llave' : 'Configurar copias en GitHub'),
      h('button', { class: 'btn ghost', onclick: downloadCopy }, 'Descargar una copia')),
    h('h3', {}, 'Restaurar'),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn ghost', disabled: !cfg, onclick: () => restoreFromGitHub().catch(errorToast) }, 'Restaurar la última copia de GitHub'),
      h('button', { class: 'btn ghost', onclick: restoreFromFile }, 'Restaurar desde un archivo')));
  return panel;
}

export { clear };
