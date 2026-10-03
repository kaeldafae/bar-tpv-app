// Cliente de la API. Si una acción de administración caduca, pide la contraseña y reintenta una vez.

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let loginHandler = null;
export function setLoginHandler(fn) {
  loginHandler = fn;
}

async function raw(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'network', 'No hay conexión con el programa de caja. Comprueba que está abierto (icono CP BAR).');
  }
  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  if (!res.ok) {
    if (res.status === 422) {
      throw new ApiError(422, 'invalid', 'Algún dato no es válido. Revisa los campos.', data && data.detail);
    }
    throw new ApiError(res.status, data?.error || 'error', data?.message || `Error ${res.status}`, data?.details);
  }
  return data;
}

export async function api(method, path, body) {
  try {
    return await raw(method, path, body);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && err.code === 'admin_required' && loginHandler) {
      const ok = await loginHandler();
      if (ok) return raw(method, path, body);
    }
    throw err;
  }
}

export const get = (p) => api('GET', p);
export const post = (p, b = {}) => api('POST', p, b);
export const patch = (p, b) => api('PATCH', p, b);
export const del = (p) => api('DELETE', p);

/** Descarga un archivo de la API (Excel, copia) asegurando antes la sesión de administración. */
export async function download(path) {
  let res = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
  if (res.status === 401 && loginHandler && (await loginHandler())) {
    res = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
  }
  if (!res.ok) {
    let message = `Error ${res.status}`;
    try { message = (await res.json()).message || message; } catch { /* sin cuerpo */ }
    throw new ApiError(res.status, 'download', message);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = match ? match[1] : 'descarga';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return a.download;
}

/** Guarda un Excel en la carpeta «TPV BAR» del escritorio; si no se puede, lo descarga. Devuelve el texto para el aviso. */
export async function saveOrDownload(savePath, downloadPath) {
  const r = await api('POST', savePath, {});
  if (r && r.path) return `Guardado en el escritorio, carpeta TPV BAR: ${r.path.split(/[\\/]/).pop()}`;
  const name = await download(downloadPath);
  return `No se pudo guardar en la carpeta TPV BAR. Descargado en Descargas: ${name}`;
}
