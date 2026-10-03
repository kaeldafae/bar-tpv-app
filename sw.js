// Service worker de la app de la tablet: guarda todos los archivos de la app para que
// funcione sin internet. build.py rellena VERSION y FILES.
//
// Actualizaciones: una versión nueva se descarga entera en segundo plano y queda
// «esperando». La página decide cuándo aplicarla (al instante si la caja está libre,
// o cuando el camarero pulse «Actualizar»), para no reiniciar en mitad de un cobro.
const VERSION = "d24505e419ae";
const FILES = [
"./",
"./app-python.zip",
"./app.css",
"./apple-touch-icon.png",
"./boot.js",
"./copias.js",
"./icon-192.png",
"./icon-512.png",
"./icon-maskable-512.png",
"./icon.svg",
"./index.html",
"./js/admin.js",
"./js/api.js",
"./js/app.js",
"./js/close.js",
"./js/reports.js",
"./js/sell.js",
"./js/ui.js",
"./js/util.js",
"./manifest.webmanifest",
"./pyodide/annotated_doc-0.0.4-py3-none-any.whl",
"./pyodide/annotated_types-0.7.0-py3-none-any.whl",
"./pyodide/anyio-4.13.0-py3-none-any.whl",
"./pyodide/fastapi-0.136.1-py3-none-any.whl",
"./pyodide/httpx-0.28.1-py3-none-any.whl",
"./pyodide/jinja2-3.1.6-py3-none-any.whl",
"./pyodide/markupsafe-3.0.3-cp314-cp314-pyemscripten_2026_0_wasm32.whl",
"./pyodide/pycryptodome-3.23.0-cp37-abi3-pyemscripten_2026_0_wasm32.whl",
"./pyodide/pydantic-2.12.5-py3-none-any.whl",
"./pyodide/pydantic_core-2.41.5-cp314-cp314-pyemscripten_2026_0_wasm32.whl",
"./pyodide/pyodide-lock.json",
"./pyodide/pyodide.asm.mjs",
"./pyodide/pyodide.asm.wasm",
"./pyodide/pyodide.mjs",
"./pyodide/python_stdlib.zip",
"./pyodide/sniffio-1.3.1-py3-none-any.whl",
"./pyodide/starlette-1.0.0-py3-none-any.whl",
"./pyodide/typing_extensions-4.15.0-py3-none-any.whl",
"./pyodide/typing_inspection-0.4.2-py3-none-any.whl",
"./tablet.js"
];
const CACHE = `cpbar-${VERSION}`;

self.addEventListener('install', (event) => {
  // cache: 'reload' = descargar de verdad, sin usar la caché HTTP del navegador (GitHub Pages
  // la guarda 10 minutos): si no, una versión nueva podía quedarse con archivos viejos.
  event.waitUntil(caches.open(CACHE)
    .then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('message', (event) => {
  if (event.data === 'actualizar') self.skipWaiting();
  if (event.data === 'version' && event.source) event.source.postMessage({ version: VERSION });
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('cpbar-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // GitHub y demás: a la red
  event.respondWith(
    caches.open(CACHE)
      .then((cache) => cache.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      })))
      // Abrir la app sin conexión: siempre hay index.html guardado.
      .catch(() => caches.match('./index.html')),
  );
});
