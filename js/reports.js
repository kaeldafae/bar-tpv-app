// Informes por periodo: ventas por día y producto, margen real, diferencias de caja e inventario.
import { get, saveOrDownload } from './api.js';
import { h, clear, eur, pct, fmtDate, fmtDateTime, localISODate, qtyText } from './util.js';
import { toast, errorToast } from './ui.js';

let range = null;

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
  from.addEventListener('change', load);
  to.addEventListener('change', load);
  main.append(h('div', { class: 'reports' },
    h('div', { class: 'row between wrap' }, h('h1', {}, 'Informes'),
      h('button', { class: 'btn primary', onclick: excel }, 'Guardar en Excel')),
    h('div', { class: 'row wrap' },
      presets().map(([label, a, b]) => h('button', { class: 'chip', onclick: () => { from.value = a; to.value = b; load(); } }, label)),
      h('label', { for: 'r-from', class: 'muted' }, 'Desde'), from, h('label', { for: 'r-to', class: 'muted' }, 'Hasta'), to),
    out));
  await load();
  return null;
}

function kpi(label, value, cls = '') {
  return h('div', { class: `kpi ${cls}` }, h('div', { class: 'muted strong' }, label), h('div', { class: 'kpi-value' }, value));
}

function table(headers, rows, empty) {
  if (!rows.length) return h('p', { class: 'empty' }, empty);
  return h('div', { class: 'scroll-x' }, h('table', { class: 'table' }, h('thead', {}, h('tr', {}, headers.map((t) => h('th', {}, t)))), h('tbody', {}, rows)));
}

function view(rep, shifts) {
  const t = rep.totals;
  const maxQty = Math.max(1, ...rep.products.map((p) => p.qty));
  const shiftExcel = async (id) => {
    try { toast(await saveOrDownload(`/api/shifts/${id}/excel/save`, `/api/shifts/${id}/excel`), 'ok', 6000); } catch (err) { errorToast(err); }
  };
  return h('div', { class: 'stack' },
    h('div', { class: 'kpis' },
      kpi('Ventas netas', eur(t.net_cents)),
      kpi('Margen real', `${eur(t.margin_cents)} · ${pct(t.margin_pct)}`),
      kpi('Nº de ventas', String(t.sales_count)),
      kpi('Diferencias de caja', eur(t.cash_difference_cents), t.cash_difference_cents < 0 ? 'bad' : ''),
      kpi('Diferencias de inventario', eur(t.inventory_difference_cents), t.inventory_difference_cents < 0 ? 'bad' : ''),
      kpi('Invitaciones (coste)', eur(t.invited_cost_cents))),
    h('h2', {}, 'Ventas por día'),
    table(['Fecha', 'Ventas', 'Importe neto', 'Anulado', 'Coste', 'Margen', 'Margen %', 'Dif. caja'], rep.days.map((d) => h('tr', {},
      h('td', {}, fmtDate(d.date)), h('td', { class: 'num' }, String(d.sales_count)), h('td', { class: 'num strong' }, eur(d.net_cents)),
      h('td', { class: 'num' }, eur(d.voids_cents)), h('td', { class: 'num' }, eur(d.cost_cents)), h('td', { class: 'num' }, eur(d.margin_cents)),
      h('td', { class: 'num' }, pct(d.margin_pct)), h('td', { class: `num ${d.cash_difference_cents < 0 ? 'neg-text' : ''}` }, eur(d.cash_difference_cents)))),
    'No hay ventas en estas fechas.'),
    h('h2', {}, 'Productos más vendidos'),
    table(['Producto', 'Uds', '', 'Importe', 'Margen', 'Margen %', 'Invitadas'], rep.products.map((p) => h('tr', {},
      h('td', { class: 'strong' }, p.name), h('td', { class: 'num' }, String(p.qty)),
      h('td', { class: 'bar-cell' }, h('div', { class: 'bar', style: `width:${Math.round((p.qty / maxQty) * 100)}%` })),
      h('td', { class: 'num' }, eur(p.revenue_cents)), h('td', { class: 'num' }, eur(p.margin_cents)), h('td', { class: 'num' }, pct(p.margin_pct)),
      h('td', { class: 'num' }, p.invited_qty ? String(p.invited_qty) : ''))),
    'Sin productos vendidos.'),
    h('h2', {}, 'Diferencias de inventario'),
    table(['Fecha', 'Tipo', 'Insumo', 'Diferencia', 'Valor', 'Nota'], rep.inventory_changes.map((c) => h('tr', {},
      h('td', {}, fmtDateTime(c.created_at)), h('td', {}, c.kind === 'merma' ? 'Merma' : 'Recuento'), h('td', {}, c.name),
      h('td', { class: 'num' }, qtyText(c.difference, c.unit)), h('td', { class: `num ${c.value_cents < 0 ? 'neg-text' : ''}` }, eur(c.value_cents)), h('td', {}, c.note || ''))),
    'Sin diferencias de inventario en estas fechas.'),
    h('h2', {}, 'Turnos (Excel de cada cierre)'),
    table(['Fecha', 'Estado', 'Ventas netas', 'Esperado', 'Contado', 'Diferencia', ''], shifts.map((s) => h('tr', {},
      h('td', {}, fmtDate(s.business_date)), h('td', {}, s.status === 'closed' ? 'Cerrado' : 'Abierto'),
      h('td', { class: 'num' }, eur(s.net_sales_cents)), h('td', { class: 'num' }, eur(s.expected_cash_cents)),
      h('td', { class: 'num' }, eur(s.counted_cash_cents)), h('td', { class: `num ${s.difference_cents < 0 ? 'neg-text' : ''}` }, eur(s.difference_cents)),
      h('td', {}, s.status === 'closed' ? h('button', { class: 'btn ghost small-btn', onclick: () => shiftExcel(s.id) }, 'Excel') : ''))),
    'Todavía no hay turnos.'));
}
