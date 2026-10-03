// Ventanas, avisos y confirmaciones. Todo con texto (textContent), nunca HTML de datos.
import { h, clear } from './util.js';

const root = () => document.getElementById('overlays');

/** Abre una ventana modal. build(close) devuelve el contenido. Devuelve una promesa con el valor de close(). */
export function modal(build, { wide = false, dismissable = true } = {}) {
  return new Promise((resolve) => {
    const previous = document.activeElement;
    let done = false;
    const close = (value) => {
      if (done) return;
      done = true;
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      if (previous && previous.focus) previous.focus();
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && dismissable) close(undefined);
    };
    const box = h('section', { class: `modal${wide ? ' modal-wide' : ''}`, role: 'dialog', 'aria-modal': 'true' });
    const backdrop = h('div', {
      class: 'backdrop',
      onmousedown: (e) => { if (e.target === backdrop && dismissable) close(undefined); },
    }, box);
    box.append(build(close));
    root().append(backdrop);
    document.addEventListener('keydown', onKey);
    const focusable = box.querySelector('[autofocus], input, select, textarea, button.primary');
    if (focusable) setTimeout(() => focusable.focus(), 0);
  });
}

export function toast(message, kind = 'ok', ms = 3500) {
  const t = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' }, message);
  const box = document.getElementById('toasts');
  box.append(t);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(() => t.classList.add('toast-hide'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

export function errorToast(err) {
  toast(err && err.message ? err.message : String(err), 'error', 6000);
}

export function confirmDialog({ title, message, confirmText = 'Confirmar', danger = false }) {
  return modal((close) => h('div', { class: 'stack' },
    h('h2', {}, title),
    message ? h('p', { class: 'muted big-text' }, message) : null,
    h('div', { class: 'row end' },
      h('button', { class: 'btn ghost', onclick: () => close(false) }, 'Cancelar'),
      h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => close(true) }, confirmText),
    ),
  )).then((v) => v === true);
}

/** Pide un texto obligatorio (motivo, concepto...). Devuelve el texto o null. */
export function askText({ title, label, placeholder = '', confirmText = 'Aceptar', danger = false, suggestions = [] }) {
  return modal((close) => {
    const input = h('input', { type: 'text', maxlength: 200, placeholder, autofocus: true, id: 'ask-text' });
    const error = h('p', { class: 'field-error' });
    const submit = () => {
      const v = input.value.trim();
      if (!v) { error.textContent = 'Este campo es obligatorio.'; input.focus(); return; }
      close(v);
    };
    // preventDefault: si no, al cerrar la ventana el Intro "pulsa" el botón que recupera el foco.
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    return h('div', { class: 'stack' },
      h('h2', {}, title),
      h('label', { for: 'ask-text' }, label),
      input,
      suggestions.length ? h('div', { class: 'row wrap' }, suggestions.map((s) =>
        h('button', { class: 'chip', type: 'button', onclick: () => { input.value = s; input.focus(); } }, s))) : null,
      error,
      h('div', { class: 'row end' },
        h('button', { class: 'btn ghost', onclick: () => close(null) }, 'Cancelar'),
        h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: submit }, confirmText),
      ),
    );
  }).then((v) => (typeof v === 'string' ? v : null));
}

/** Formulario genérico de campos. fields: [{name,label,type,value,options,help,required}] */
export function formDialog({ title, fields, confirmText = 'Guardar', validate }) {
  return modal((close) => {
    const inputs = {};
    const error = h('p', { class: 'field-error' });
    const body = fields.map((f) => {
      const id = `f-${f.name}`;
      let input;
      if (f.type === 'select') {
        input = h('select', { id }, f.options.map((o) => h('option', { value: o.value, selected: String(o.value) === String(f.value) }, o.label)));
      } else if (f.type === 'checkbox') {
        input = h('input', { id, type: 'checkbox', checked: !!f.value });
      } else if (f.type === 'color') {
        input = h('div', { class: 'swatches', id, 'data-value': f.value || f.options[0] },
          f.options.map((c) => h('button', {
            type: 'button', class: `swatch${c === (f.value || f.options[0]) ? ' on' : ''}`, style: `background:${c}`,
            'aria-label': `Color ${c}`,
            onclick: (e) => {
              input.dataset.value = c;
              input.querySelectorAll('.swatch').forEach((s) => s.classList.remove('on'));
              e.currentTarget.classList.add('on');
            },
          })));
      } else {
        input = h('input', { id, type: f.type || 'text', value: f.value ?? '', placeholder: f.placeholder || '',
          inputmode: f.inputmode, maxlength: f.maxlength || 120, autocomplete: f.autocomplete || 'off' });
      }
      inputs[f.name] = input;
      return h('div', { class: f.type === 'checkbox' ? 'field field-check' : 'field' },
        h('label', { for: id }, f.label), input, f.help ? h('small', { class: 'muted' }, f.help) : null);
    });
    const read = () => Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k,
      el.type === 'checkbox' ? el.checked : (el.dataset && el.dataset.value !== undefined && el.tagName === 'DIV' ? el.dataset.value : el.value)]));
    const submit = () => {
      const values = read();
      const problem = validate ? validate(values) : null;
      if (problem) { error.textContent = problem; return; }
      close(values);
    };
    const firstInput = Object.values(inputs).find((el) => el.tagName === 'INPUT' && el.type !== 'checkbox');
    if (firstInput) firstInput.setAttribute('autofocus', '');
    Object.values(inputs).forEach((el) => {
      if (el.tagName === 'INPUT') el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    });
    return h('div', { class: 'stack' },
      h('h2', {}, title),
      body,
      error,
      h('div', { class: 'row end' },
        h('button', { class: 'btn ghost', onclick: () => close(null) }, 'Cancelar'),
        h('button', { class: 'btn primary', onclick: submit }, confirmText),
      ),
    );
  }).then((v) => v || null);
}

export function emptyState(text) {
  return h('p', { class: 'empty' }, text);
}

export function setBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
  button.classList.toggle('busy', busy);
}

export { clear };
