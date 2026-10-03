// Cosas propias de la app de la tablet: instalarla, actualizarla y mantener la pantalla encendida.
//
// Actualizaciones: el service worker descarga la versión nueva en segundo plano (cuando
// hay internet) y la deja preparada. Se aplica sola la próxima vez que se abre la app, o
// antes si se pulsa «Actualizar ahora». Nunca se reinicia sola en mitad del servicio.
import { h, clear } from './js/util.js';
import { modal, toast } from './js/ui.js';

const CHECK_EVERY_MS = 30 * 60 * 1000;
let registration = null;
let installEvent = null;
let updateReady = false;
let reloading = false;

const isInstalled = () => matchMedia('(display-mode: standalone)').matches
  || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;

// --- Barra superior (instalar / versión nueva) --------------------------------------

function bar() {
  let el = document.getElementById('pwa-bar');
  if (!el) {
    el = h('div', { id: 'pwa-bar', class: 'pwa-bar hidden', role: 'status' });
    (document.querySelector('.content') || document.body).prepend(el);
  }
  return el;
}

function drawBar() {
  const el = bar();
  clear(el);
  if (updateReady) {
    el.className = 'pwa-bar pwa-bar-update';
    el.append(
      h('span', { class: 'pwa-bar-icon', 'aria-hidden': 'true' }, '↻'),
      h('span', { class: 'grow' }, h('strong', {}, 'Hay una versión nueva de CP BAR. '), 'Se pondrá sola la próxima vez que abras la app.'),
      h('button', { class: 'btn primary small-btn', onclick: applyUpdate }, 'Actualizar ahora'));
    return;
  }
  if (!isInstalled() && sessionStorageGet('cpbar.instalar.oculto') !== '1') {
    el.className = 'pwa-bar';
    el.append(
      h('span', { class: 'pwa-bar-icon', 'aria-hidden': 'true' }, '⬇'),
      h('span', { class: 'grow' }, h('strong', {}, 'Instala CP BAR en esta tablet. '), 'Tendrás su icono, se abrirá a pantalla completa y funcionará sin internet.'),
      h('button', { class: 'btn primary small-btn', id: 'btn-instalar', onclick: install }, 'Instalar'),
      h('button', { class: 'btn ghost small-btn', 'aria-label': 'Ocultar', onclick: () => { sessionStorageSet('cpbar.instalar.oculto', '1'); drawBar(); } }, '✕'));
    return;
  }
  el.className = 'pwa-bar hidden';
}

function sessionStorageGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
function sessionStorageSet(k, v) { try { sessionStorage.setItem(k, v); } catch { /* sin almacenamiento */ } }

// --- Instalar -------------------------------------------------------------------------

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  drawBar();
});
window.addEventListener('appinstalled', () => {
  installEvent = null;
  toast('CP BAR instalada. Ábrela desde su icono.');
  drawBar();
});

async function install() {
  if (installEvent) {
    installEvent.prompt();
    const choice = await installEvent.userChoice.catch(() => null);
    installEvent = null;
    if (choice && choice.outcome === 'accepted') return;
    drawBar();
    return;
  }
  // El navegador no ofrece el diálogo (Samsung Internet, Firefox, iPad…): instrucciones.
  const samsung = /SamsungBrowser/i.test(navigator.userAgent);
  const ios = /iPad|iPhone/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  await modal((close) => h('div', { class: 'stack' },
    h('h2', {}, 'Instalar CP BAR en la tablet'),
    ios
      ? h('ol', { class: 'steps-list' }, h('li', {}, 'Pulsa el botón Compartir (el cuadrado con la flecha).'), h('li', {}, 'Elige «Añadir a pantalla de inicio».'), h('li', {}, 'Pulsa «Añadir».'))
      : samsung
        ? h('ol', { class: 'steps-list' }, h('li', {}, 'Pulsa el menú ☰ abajo a la derecha.'), h('li', {}, 'Elige «Añadir página a» → «Pantalla de inicio» (o «Instalar»).'), h('li', {}, 'Abre CP BAR desde su icono.'))
        : h('ol', { class: 'steps-list' }, h('li', {}, 'Pulsa el menú ⋮ arriba a la derecha de Chrome.'), h('li', {}, 'Elige «Instalar aplicación» o «Añadir a pantalla de inicio».'), h('li', {}, 'Pulsa «Instalar» y abre CP BAR desde su icono.')),
    h('p', { class: 'muted' }, 'Recomendado: usar Google Chrome. Solo hace falta internet la primera vez.'),
    h('div', { class: 'row end' }, h('button', { class: 'btn primary', onclick: () => close() }, 'Entendido'))));
}

// --- Actualizaciones -------------------------------------------------------------------

function watchWorker(worker) {
  if (!worker) return;
  const ready = () => {
    if (worker.state === 'installed' && navigator.serviceWorker.controller) {
      updateReady = true;
      drawBar();
    }
  };
  worker.addEventListener('statechange', ready);
  ready();
}

export async function applyUpdate() {
  const waiting = registration && registration.waiting;
  if (!waiting) { location.reload(); return; }
  waiting.postMessage('actualizar'); // al cambiar de versión, «controllerchange» recarga la app
}

export async function checkForUpdate() {
  if (!registration) return 'sin-sw';
  if (registration.waiting) { updateReady = true; drawBar(); return 'lista'; }
  try { await registration.update(); } catch { return 'sin-conexion'; }
  if (registration.installing) return 'descargando';
  return registration.waiting ? 'lista' : 'al-dia';
}

/**
 * Registra el service worker. Si al abrir la app ya hay una versión nueva descargada,
 * la aplica antes de arrancar la caja (devuelve true: la página se va a recargar).
 */
export async function initUpdates() {
  if (!('serviceWorker' in navigator)) return false;
  // La primera vez no hay versión anterior: tomar el control no es una actualización.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !hadController) return;
    reloading = true;
    location.reload();
  });
  try {
    registration = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
  } catch (err) {
    console.warn('Service worker', err);
    return false;
  }
  if (registration.waiting && navigator.serviceWorker.controller) {
    registration.waiting.postMessage('actualizar'); // al abrir: se pone la versión nueva
    return true;
  }
  registration.addEventListener('updatefound', () => watchWorker(registration.installing));
  const check = () => { if (navigator.onLine) registration.update().catch(() => {}); };
  setInterval(check, CHECK_EVERY_MS);
  window.addEventListener('online', check);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  return false;
}

export async function swVersion() {
  const ctrl = navigator.serviceWorker && navigator.serviceWorker.controller;
  if (!ctrl) return null;
  return new Promise((resolve) => {
    const onMsg = (e) => { if (e.data && e.data.version) { navigator.serviceWorker.removeEventListener('message', onMsg); resolve(e.data.version); } };
    navigator.serviceWorker.addEventListener('message', onMsg);
    ctrl.postMessage('version');
    setTimeout(() => resolve(null), 1500);
  });
}

// --- Pantalla siempre encendida ----------------------------------------------------------
// Una caja no debe apagar la pantalla en mitad del servicio.

let wakeLock = null;
async function keepAwake() {
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch { /* sin permiso o batería baja: no pasa nada */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !wakeLock) keepAwake(); });

// --- Panel en Productos → Ajustes ---------------------------------------------------------

export function appPanel(reload) {
  const status = h('p', { class: 'muted' });
  const version = h('p', { class: 'strong' }, 'Versión…');
  Promise.all([fetch('/api/health').then((r) => r.json()).catch(() => null), swVersion()]).then(([health, sw]) => {
    version.textContent = `CP BAR ${health ? health.version : ''}${sw ? ` · ${sw}` : ''}`;
  });
  status.textContent = updateReady ? 'Hay una versión nueva preparada.' : 'Las actualizaciones se descargan solas cuando hay internet.';
  const checkBtn = h('button', { class: 'btn ghost', onclick: async () => {
    checkBtn.disabled = true;
    status.textContent = 'Buscando…';
    const r = await checkForUpdate();
    checkBtn.disabled = false;
    status.textContent = {
      'al-dia': 'Ya tienes la última versión.',
      'lista': 'Hay una versión nueva preparada. Pulsa «Actualizar ahora».',
      'descargando': 'Descargando la versión nueva… En cuanto esté, aparecerá arriba «Actualizar ahora».',
      'sin-conexion': 'Sin internet: se buscará en cuanto haya conexión.',
      'sin-sw': 'Este navegador no permite actualizar la app.',
    }[r];
    if (r === 'lista') { updateReady = true; drawBar(); reload(); }
  } }, 'Buscar actualización');
  return h('div', { class: 'panel stack' }, h('h2', {}, 'App de la tablet'),
    version, status,
    h('p', { class: 'muted small' }, isInstalled() ? 'Instalada como aplicación. La pantalla se mantiene encendida mientras la caja está abierta.' : 'Abierta en el navegador: instálala para tener su icono y que funcione mejor sin internet.'),
    h('div', { class: 'row wrap' }, checkBtn,
      updateReady ? h('button', { class: 'btn primary', onclick: applyUpdate }, 'Actualizar ahora') : null,
      !isInstalled() ? h('button', { class: 'btn primary', onclick: install }, 'Instalar en la tablet') : null));
}

/** Se llama cuando la caja ya está en pantalla. */
export function ready() {
  drawBar();
  keepAwake();
  if (registration && registration.waiting && navigator.serviceWorker.controller) { updateReady = true; drawBar(); }
}
