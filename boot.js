// Arranque de la app de la tablet (PWA). Funciona sin internet:
// - Carga Python (Pyodide) y el programa de la caja, guardados por el service worker.
// - La base de datos vive en el almacenamiento del navegador (IndexedDB) y se guarda
//   tras cada operación, antes de dar la respuesta: lo cobrado no se pierde.
// - Las peticiones de la interfaz a /api/... no salen a la red: las atiende el mismo
//   programa de la caja dentro de la página (tpv/web.py).
import { loadPyodide } from './pyodide/pyodide.mjs';
import * as copias from './copias.js';
import * as tablet from './tablet.js';

// Paquetes de Pyodide que necesita la caja (sus dependencias se cargan solas).
// pycryptodome: scrypt para la contraseña (el hashlib de Pyodide no lo trae).
const PACKAGES = ['fastapi', 'pydantic', 'starlette', 'anyio', 'pycryptodome'];
// Nombre único: en kaeldafae.github.io hay otras apps y comparten el almacenamiento del navegador.
const DATA = '/cpbar-caja';

const bootBox = document.getElementById('boot');
const bootText = document.getElementById('boot-text');
const say = (t) => { if (bootText) bootText.textContent = t; };

function bootError(err) {
  console.error(err);
  say(`No se ha podido arrancar la caja: ${err && err.message ? err.message : err}. Cierra la app y vuelve a abrirla.`);
  if (bootBox) bootBox.classList.add('boot-error');
}

let py = null;
let web = null;

function syncfs(populate) {
  return new Promise((resolve, reject) => py.FS.syncfs(populate, (err) => (err ? reject(err) : resolve())));
}

/** Guarda la base de datos en el almacenamiento del navegador. */
export async function persist() {
  await syncfs(false);
}

// --- Peticiones a la API dentro de la página ---------------------------------

const realFetch = window.fetch.bind(window);
const cookies = new Map();
let queue = Promise.resolve();

function rememberCookie(header) {
  const [pair, ...attrs] = header.split(';');
  const eq = pair.indexOf('=');
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  const expired = attrs.some((a) => {
    const [k, v] = a.split('=').map((s) => s && s.trim().toLowerCase());
    return (k === 'max-age' && Number(v) <= 0) || (k === 'expires' && Date.parse(v) < Date.now());
  });
  if (!value || value === '""' || expired) cookies.delete(name);
  else cookies.set(name, value);
}

async function callApi(url, init) {
  const method = (init.method || 'GET').toUpperCase();
  const headers = Object.entries(init.headers || {}).map(([k, v]) => [k, String(v)]);
  if (cookies.size) headers.push(['cookie', [...cookies].map(([k, v]) => `${k}=${v}`).join('; ')]);
  const body = init.body == null ? new Uint8Array() : new TextEncoder().encode(String(init.body));
  const proxy = await web.handle(method, url.pathname, url.search.slice(1), headers, body);
  const r = proxy.toJs({ dict_converter: Object.fromEntries });
  proxy.destroy();
  const out = new Headers();
  for (const [k, v] of r.headers) {
    if (k.toLowerCase() === 'set-cookie') rememberCookie(v);
    else out.append(k, v);
  }
  if (method !== 'GET') {
    await persist(); // primero se guarda, después se responde
    if (r.status < 400) copias.changed(method, url.pathname, r.body);
  }
  return new Response(r.body.length ? r.body : null, { status: r.status, headers: out });
}

function installApi() {
  window.fetch = (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return realFetch(input, init);
    // Una petición detrás de otra, como en el servidor (una sola conexión a la base).
    const job = queue.then(() => callApi(url, init));
    queue = job.catch(() => {});
    return job;
  };
}

// --- Funciones para las copias (copias.js) ------------------------------------

export const caja = {
  snapshot: () => { const p = web.snapshot(); const b = p.toJs(); p.destroy(); return b; },
  shiftExcel: (id) => { const p = web.shift_excel(id); const [name, bytes] = p.toJs(); p.destroy(); return { name, bytes }; },
  async restore(bytes) {
    // Espera a que no haya ninguna operación a medias.
    await queue;
    web.restore(bytes);
    await persist();
  },
};

async function start() {
  // Si hay una versión nueva ya descargada, se pone ahora, antes de arrancar la caja.
  if (await tablet.initUpdates()) { say('Actualizando CP BAR…'); return; }
  // Pide al navegador que no borre los datos de la caja si le falta espacio.
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  say('Arrancando la caja…');
  py = await loadPyodide({ indexURL: new URL('pyodide/', location.href).href });
  py.FS.mkdirTree(DATA);
  py.FS.mount(py.FS.filesystems.IDBFS, {}, DATA);
  await syncfs(true);
  say('Cargando el programa…');
  await py.loadPackage(PACKAGES, { messageCallback: () => {} });
  const zip = await (await realFetch('app-python.zip')).arrayBuffer();
  py.unpackArchive(zip, 'zip', { extractDir: '/app' });
  py.runPython("import sys; sys.path.insert(0, '/app')");
  web = py.pyimport('tpv.web');
  web.start(DATA);
  await persist();
  installApi();
  window.cpbarPwa = { backupPanel: copias.backupPanel, appPanel: tablet.appPanel };
  copias.init(caja);
  if (bootBox) bootBox.remove();
  await import('./js/app.js');
  tablet.ready();
}

start().catch(bootError);
