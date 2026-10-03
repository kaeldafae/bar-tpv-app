// Cerrar turno: 1) contar la caja, 2) ver el resultado, 3) cerrar y descargar el Excel.
import { get, post, saveOrDownload, download } from './api.js';
import { h, clear, eur, parseEuros, centsToInput } from './util.js';
import { toast, errorToast, confirmDialog, setBusy } from './ui.js';

const DENOMS = [50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1];
const denomLabel = (d) => (d >= 100 ? `${d / 100} €` : `${d} cént.`);

export async function render(main, ctx) {
  const state = await ctx.refreshState();
  if (!state.shift) {
    main.append(h('div', { class: 'panel narrow stack' }, h('h1', {}, 'No hay turno abierto'),
      h('p', { class: 'big-text' }, 'Para vender, abre un turno nuevo.'),
      h('button', { class: 'btn success big', onclick: () => location.reload() }, 'Abrir turno')));
    return null;
  }
  let summary = await get('/api/shifts/current');
  const counts = Object.fromEntries(DENOMS.map((d) => [d, 0]));
  let counted = null;
  let useBreakdown = false;
  let step = 1;
  const wrap = h('div', { class: 'close-wizard' });
  main.append(wrap);

  const breakdownTotal = () => DENOMS.reduce((s, d) => s + d * counts[d], 0);

  function steps() {
    return h('ol', { class: 'steps' }, ['Contar la caja', 'Resultado', 'Cerrar y Excel'].map((t, i) =>
      h('li', { class: step === i + 1 ? 'on' : step > i + 1 ? 'done' : '' }, h('span', { class: 'step-n' }, String(i + 1)), t)));
  }

  function draw() {
    clear(wrap);
    wrap.append(h('h1', {}, 'Cerrar turno'), steps());
    const tabs = state.open_tabs;
    if (tabs && tabs.count) {
      wrap.append(h('p', { class: 'notice' }, `Hay ${tabs.count === 1 ? '1 cuenta abierta' : `${tabs.count} cuentas abiertas`} sin cobrar (${eur(tabs.total_cents)}). `
        + 'No entran en la caja de este turno: siguen abiertas y se cobran cuando paguen.'));
    }
    if (step === 1) wrap.append(stepCount());
    if (step === 2) wrap.append(stepResult());
    if (step === 3) wrap.append(stepClose());
  }

  function stepCount() {
    const error = h('p', { class: 'field-error' });
    const total = h('input', { id: 'counted', inputmode: 'decimal', class: 'money-input', value: counted === null ? '' : centsToInput(counted), placeholder: '0,00' });
    const bdTotal = h('span', { class: 'price-big', id: 'bd-total' }, eur(breakdownTotal()));
    const grid = h('div', { class: 'denoms' }, DENOMS.map((d) => {
      const input = h('input', { type: 'number', min: 0, step: 1, value: counts[d] || '', inputmode: 'numeric', 'aria-label': `Cantidad de ${denomLabel(d)}` });
      input.addEventListener('input', () => {
        const n = Number.parseInt(input.value, 10);
        counts[d] = Number.isFinite(n) && n > 0 ? n : 0;
        bdTotal.textContent = eur(breakdownTotal());
      });
      return h('label', { class: 'denom' }, h('span', { class: 'strong' }, denomLabel(d)), input);
    }));
    const bdBox = h('div', { class: `stack${useBreakdown ? '' : ' hidden'}` }, grid, h('div', { class: 'row between' }, h('span', { class: 'strong' }, 'Total del desglose'), bdTotal));
    const toggle = h('button', { class: 'btn ghost', type: 'button', onclick: () => {
      useBreakdown = !useBreakdown;
      bdBox.classList.toggle('hidden', !useBreakdown);
      total.disabled = useBreakdown;
      toggle.textContent = useBreakdown ? 'Escribir solo el total' : 'Contar por billetes y monedas';
    } }, useBreakdown ? 'Escribir solo el total' : 'Contar por billetes y monedas');
    total.disabled = useBreakdown;
    const next = () => {
      if (useBreakdown) counted = breakdownTotal();
      else {
        const v = parseEuros(total.value);
        if (v === null) { error.textContent = 'Escribe el efectivo contado. Ejemplo: 734,50'; return; }
        counted = v;
      }
      step = 2;
      draw();
    };
    total.addEventListener('keydown', (e) => { if (e.key === 'Enter') next(); });
    setTimeout(() => total.focus(), 0);
    return h('div', { class: 'panel stack' },
      h('p', { class: 'big-text' }, 'Cuenta todo el dinero que hay en la caja ahora mismo, incluido el fondo.'),
      h('label', { for: 'counted' }, 'Efectivo contado (€)'), total,
      toggle, bdBox, error,
      h('div', { class: 'row end' }, h('button', { class: 'btn primary big', onclick: next }, 'Siguiente')));
  }

  function stepResult() {
    const diff = counted - summary.expected_cash_cents;
    const label = diff === 0 ? 'Cuadra' : diff < 0 ? 'Falta dinero' : 'Sobra dinero';
    return h('div', { class: 'panel stack' },
      h('div', { class: 'kpis' },
        kpi('Efectivo esperado', eur(summary.expected_cash_cents)),
        kpi('Efectivo contado', eur(counted)),
        h('div', { class: `kpi diff ${diff === 0 ? 'ok' : 'bad'}` }, h('div', { class: 'muted strong' }, label), h('div', { class: 'kpi-value', id: 'difference' }, eur(diff)))),
      h('table', { class: 'table' }, h('tbody', {},
        row('Fondo inicial', eur(summary.opening_float_cents)),
        row(`Ventas en efectivo (${summary.sales_count})`, eur(summary.cash_sales_cents)),
        row('Anulaciones', `− ${eur(summary.voids_cents)}`),
        row('Entradas de caja', `+ ${eur(summary.cash_in_cents)}`),
        row('Salidas de caja', `− ${eur(summary.cash_out_cents)}`),
        row('Efectivo esperado', eur(summary.expected_cash_cents), true),
        row(`Invitaciones`, String(summary.invitations_count)))),
      diff !== 0 ? h('p', { class: 'muted' }, 'Si la diferencia es grande, vuelve atrás y cuenta otra vez. Quedará registrada en el Excel y en los informes.') : null,
      h('div', { class: 'row between' },
        h('button', { class: 'btn ghost big', onclick: () => { step = 1; draw(); } }, 'Volver a contar'),
        h('button', { class: 'btn primary big', onclick: () => { step = 3; draw(); } }, 'Siguiente')));
  }

  function stepClose() {
    const keep = h('input', { id: 'next-float', inputmode: 'decimal', class: 'money-input', value: centsToInput(Math.min(counted, summary.opening_float_cents)) });
    const error = h('p', { class: 'field-error' });
    const btn = h('button', { class: 'btn success big', id: 'do-close' }, 'Cerrar turno y descargar Excel');
    btn.addEventListener('click', async () => {
      const next = parseEuros(keep.value);
      if (next === null) { error.textContent = 'Importe no válido.'; return; }
      if (next > counted) { error.textContent = 'No puedes dejar más dinero del que has contado.'; return; }
      const ok = await confirmDialog({ title: '¿Cerrar el turno?', message: `Contado ${eur(counted)}. Se deja ${eur(next)} de fondo para el próximo turno y se retira ${eur(counted - next)}. Después no se podrá modificar.`, confirmText: 'Cerrar turno' });
      if (!ok) return;
      setBusy(btn, true);
      try {
        const body = { counted_cash_cents: counted, next_float_cents: next };
        if (useBreakdown) body.breakdown = Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0));
        const closed = await post('/api/shifts/current/close', body);
        await ctx.refreshState();
        done(closed);
      } catch (err) { setBusy(btn, false); errorToast(err); }
    });
    return h('div', { class: 'panel stack' },
      h('label', { for: 'next-float' }, 'Dinero que se queda en la caja para mañana (fondo)'), keep,
      h('p', { class: 'muted' }, 'El resto se retira. Este fondo se propondrá al abrir el próximo turno.'),
      error,
      h('div', { class: 'row between' }, h('button', { class: 'btn ghost big', onclick: () => { step = 2; draw(); } }, 'Atrás'), btn));
  }

  async function done(closed) {
    clear(wrap);
    const dl = async () => {
      try { toast(await saveOrDownload(`/api/shifts/${closed.id}/excel/save`, `/api/shifts/${closed.id}/excel`), 'ok', 6000); } catch (err) { errorToast(err); }
    };
    const savedName = closed.excel_saved ? closed.excel_saved.split(/[\\/]/).pop() : null;
    wrap.append(h('h1', {}, 'Turno cerrado'), h('div', { class: 'panel stack' },
      h('p', { class: 'big-text' }, `Diferencia de caja: ${eur(closed.difference_cents)}.`),
      savedName
        ? h('p', { class: 'big-text' }, 'El Excel del cierre está guardado en tu escritorio, carpeta ', h('strong', {}, 'TPV BAR → Cierres de turno'), `: ${savedName}`)
        : h('p', { class: 'big-text' }, 'El Excel se está descargando en la carpeta Descargas.'),
      closed.backup ? h('p', { class: 'muted' }, closed.backup.usb.length ? 'Copia de seguridad hecha (también en el pendrive).' : 'Copia de seguridad hecha.') :
        h('p', { class: 'field-error' }, 'No se pudo hacer la copia de seguridad. Revisa Admin → Ajustes.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost big', onclick: dl }, 'Guardar el Excel otra vez'),
        h('button', { class: 'btn success big', onclick: () => location.reload() }, 'Abrir turno nuevo'))));
    if (!savedName) {
      try { await download(`/api/shifts/${closed.id}/excel`); } catch (err) { errorToast(err); }
    }
  }

  draw();
  return null;
}

function kpi(label, value) {
  return h('div', { class: 'kpi' }, h('div', { class: 'muted strong' }, label), h('div', { class: 'kpi-value' }, value));
}

function row(label, value, bold = false) {
  return h('tr', { class: bold ? 'strong' : '' }, h('td', {}, label), h('td', { class: 'num' }, value));
}
