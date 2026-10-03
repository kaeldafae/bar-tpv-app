// Utilidades sin dependencias: DOM, dinero, cantidades, fechas e identificadores.

/** Crea un elemento. attrs: on* = evento, class, style (texto), resto = atributo/propiedad. */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'class') {
      el.className = value;
    } else if (key === 'style') {
      el.setAttribute('style', value);
    } else if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'selected') {
      el[key] = value;
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** 123450 -> "1.234,50 €" (siempre con separador de miles). */
export function eur(cents) {
  if (cents === null || cents === undefined) return '—';
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${euros},${String(abs % 100).padStart(2, '0')} €`;
}

/** Texto -> entero escalado sin pasar por coma flotante. parseScaled("12,5", 2) -> 1250. */
export function parseScaled(text, decimals) {
  let s = String(text ?? '').replace(/[€\s]/g, '');
  if (s === '') return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const re = decimals > 0 ? new RegExp(`^\\d{1,9}(\\.\\d{1,${decimals}})?$`) : /^\d{1,9}$/;
  if (!re.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * 10 ** decimals + Number(frac.padEnd(decimals, '0') || 0);
}

export const parseEuros = (text) => parseScaled(text, 2);

/** Valor para un campo de importe: 1250 -> "12,50". */
export function centsToInput(cents) {
  if (cents === null || cents === undefined) return '';
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`;
}

// Unidades del inventario. Internamente: ml, ud, racion (enteros).
export const UNITS = {
  ml: { label: 'cl', decimals: 1, toBase: 10, long: 'centilitros (cl)' },
  ud: { label: 'ud', decimals: 0, toBase: 1, long: 'unidades' },
  racion: { label: 'raciones', decimals: 0, toBase: 1, long: 'raciones' },
};

/** Cantidad en unidad base -> texto en unidad visible: 50 ml -> "5 cl". */
export function qtyText(qty, unit) {
  const u = UNITS[unit];
  if (unit === 'ml') {
    const cl = qty / 10;
    return `${cl.toLocaleString('es-ES', { maximumFractionDigits: 1 })} cl`;
  }
  return `${qty} ${u.label}`;
}

/** Texto en unidad visible -> unidad base. "4,5" cl -> 45 ml. */
export function parseQty(text, unit) {
  const u = UNITS[unit];
  return parseScaled(text, u.decimals);
}

export function qtyToInput(qty, unit) {
  if (unit === 'ml') return (qty / 10).toLocaleString('es-ES', { maximumFractionDigits: 1, useGrouping: false });
  return String(qty);
}

export function packagesText(qty, size) {
  const n = qty / size;
  return n.toLocaleString('es-ES', { maximumFractionDigits: 2 });
}

/** UUID v4 con crypto.getRandomValues (funciona también fuera de HTTPS, para la fase 2). */
export function uuid4() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const x = [...b].map((v) => v.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

export function fmtDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function fmtDate(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

export function localISODate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function pct(value) {
  return value === null || value === undefined ? '—' : `${value.toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`;
}
