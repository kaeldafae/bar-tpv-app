// Informes por periodo: solo dinero. Ventas, ticket medio, caja, diferencias y lo más vendido.
import { get, saveOrDownload } from './api.js';
import { h, clear, eur, fmtDate, localISODate } from './util.js';
import { toast, errorToast } from './ui.js';

let range = null;
let presetLabel = 'Este mes';

function presets() {
  const today = new Date();
  const d = (y, m, day) => localISODate(new Date(y, m, day));
  const y = today.getFullYear();
  const m = today.getMonth();
  return [
    ['Hoy', localISODate(today), localISODate(today)],
    ['Últimos 7 días', localISODate(new Date(y, m, today.getDate() - 6)), localISODate(today)],
    ['Este mes', d(y, m, 1), localISODate(today)],
    ['Mes pasado', d(y, m - 1, 1), d(y, m, 0)],
    ['Este año', d(y, 0, 1), localISODate(today)],
  ];
}

export async function render(main) {
  if (!range) { const p = presets()[2]; range = { from: p[1], to: p[2] }; }
  const out = h('div', { class: 'stack' });
  const from = h('input', { type: 'date', id: 'r-from', value: range.from });
  const to = h('input', { type: 'date', id: 'r-to', value: range.to });
  const chips = h('div', { class: 'row wrap' });
  const drawChips = () => {
    clear(chips).append(...presets().map(([label, a, b]) => h('button', {
      class: `chip${presetLabel === label ? ' on' : ''}`,
      onclick: () => { presetLabel = label; from.value = a; to.value = b; drawChips(); load(); },
    }, label)));
  };
  const load = async () => {
    range = { from: from.value, to: to.value };
    clear(out).append(h('p', { class: 'muted' }, 'Calculando…'));
    try {
      const [rep, shifts] = await Promise.all([
        get(`/api/reports?date_from=${range.from}&date_to=${range.to}`),
        get('/api/shifts'),
      ]);
      clear(out).append(view(rep, shifts));
    } catch (err) { clear(out).append(h('p', { class: 'field-error' }, err.message)); }
  };
  const excel = async () => {
    const q = `date_from=${range.from}&date_to=${range.to}`;
    try { toast(await saveOrDownload(`/api/reports/excel/save?${q}`, `/api/reports/excel?${q}`), 'ok', 6000); } catch (err) { errorToast(err); }
  };
  const custom = () => { presetLabel = null; drawChips(); load(); };
  from.addEventListener('change', custom);
  to.addEventListener('change', custom);
  drawChips();
  main.append(h('div', { class: 'reports stack' },
    h('div', { class: 'row between wrap' }, h('h1', {}, 'Informes'),
      h('button', { class: 'btn primary', onclick: excel }, 'Descargar Excel')),
    chips,
    h('div', { class: 'row wrap' }, h('label', { for: 'r-from' }, 'Desde'), from, h('label', { for: 'r-to' }, 'Hasta'), to),
    out));
  await load();
  return null;
}

function kpi(label, value, cls = '') {
  return h('div', { class: `kpi ${cls}` }, h('div', { class: 'muted strong' }, label), h('div', { class: 'kpi-value' }, value));
}

function table(headers, rows, empty) {
  if (!rows.length) return h('p', { class: 'empty' }, empty);
  return h('div', { class: 'scroll-x' }, h('table', { class: 'table' },
    h('thead', {}, h('tr', {}, headers.map(([t, num]) => h('th', { class: num ? 'num' : '' }, t)))), h('tbody', {}, rows)));
}

const diffClass = (c) => (c < 0 ? 'neg-text' : c > 0 ? 'pos-text' : '');

function view(rep, shifts) {
  const t = rep.totals;
  const maxRevenue = Math.max(1, ...rep.products.map((p) => p.revenue_cents));
  const shiftExcel = async (id) => {
    try { toast(await saveOrDownload(`/api/shifts/${id}/excel/save`, `/api/shifts/${id}/excel`), 'ok', 6000); } catch (err) { errorToast(err); }
  };
  return h('div', { class: 'stack' },
    h('div', { class: 'kpis' },
      kpi('Ventas netas', eur(t.net_cents), 'main-kpi'),
      kpi('Nº de ventas', String(t.sales_count)),
      kpi('Ticket medio', eur(t.average_ticket_cents)),
      kpi('Anulado', eur(t.voids_cents)),
      kpi('Salidas de caja', eur(t.cash_out_cents)),
      kpi('Diferencias de caja', eur(t.cash_difference_cents), t.cash_difference_cents < 0 ? 'bad' : t.cash_difference_cents > 0 ? 'good' : '')),
    h('h2', {}, 'Por día'),
    table([['Fecha'], ['Ventas', 1], ['Importe neto', 1], ['Ticket medio', 1], ['Anulado', 1], ['Entradas', 1], ['Salidas', 1], ['Dif. caja', 1]],
      rep.days.map((d) => h('tr', {},
        h('td', {}, fmtDate(d.date)), h('td', { class: 'num' }, String(d.sales_count)), h('td', { class: 'num strong' }, eur(d.net_cents)),
        h('td', { class: 'num' }, eur(d.average_ticket_cents)), h('td', { class: 'num' }, eur(d.voids_cents)),
        h('td', { class: 'num' }, eur(d.cash_in_cents)), h('td', { class: 'num' }, eur(d.cash_out_cents)),
        h('td', { class: `num ${diffClass(d.cash_difference_cents)}` }, eur(d.cash_difference_cents)))),
      'No hay ventas en estas fechas.'),
    h('h2', {}, 'Lo que más se vende'),
    table([['Producto'], ['Uds', 1], [''], ['Importe', 1], ['Invitadas', 1]], rep.products.map((p) => h('tr', {},
      h('td', { class: 'strong' }, p.name), h('td', { class: 'num' }, String(p.qty)),
      h('td', { class: 'bar-cell' }, h('div', { class: 'bar', style: `width:${Math.round((p.revenue_cents / maxRevenue) * 100)}%` })),
      h('td', { class: 'num strong' }, eur(p.revenue_cents)),
      h('td', { class: 'num' }, p.invited_qty ? String(p.invited_qty) : ''))),
    'Sin productos vendidos.'),
    h('h2', {}, 'Turnos'),
    table([['Fecha'], ['Estado'], ['Ventas netas', 1], ['Esperado', 1], ['Contado', 1], ['Diferencia', 1], ['']], shifts.map((s) => h('tr', {},
      h('td', {}, fmtDate(s.business_date)), h('td', {}, s.status === 'closed' ? 'Cerrado' : h('span', { class: 'pos-text' }, 'Abierto')),
      h('td', { class: 'num' }, eur(s.net_sales_cents)), h('td', { class: 'num' }, eur(s.expected_cash_cents)),
      h('td', { class: 'num' }, eur(s.counted_cash_cents)), h('td', { class: `num ${diffClass(s.difference_cents)}` }, eur(s.difference_cents)),
      h('td', {}, s.status === 'closed' ? h('button', { class: 'btn ghost small-btn', onclick: () => shiftExcel(s.id) }, 'Excel') : ''))),
    'Todavía no hay turnos.'));
}
