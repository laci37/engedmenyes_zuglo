'use strict';

/* ---------------------------------------------------------------- */
/* CSV loading & parsing                                             */
/* ---------------------------------------------------------------- */

const DATA_URL = 'data.csv';

// Zugló 2026. évi költségvetésének kiadási főösszege (Ft) — nem a CSV-ből
// származik, a képviselő-testület által elfogadott 2026-os költségvetésből.
const BUDGET_2026_EXPENDITURE = 61455000000;

const MONTH_ABBR = {
  'január': 'jan', 'február': 'febr', 'március': 'márc', 'április': 'ápr',
  'május': 'máj', 'június': 'jún', 'július': 'júl', 'augusztus': 'aug',
  'szeptember': 'szept', 'október': 'okt', 'november': 'nov', 'december': 'dec',
};

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\r') {
      /* ignore, \n (or EOF) terminates the row */
    } else if (c === '\n') {
      row.push(field); field = ''; rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => cell.trim() !== ''));
}

function parseNum(str) {
  if (!str) return 0;
  const cleaned = String(str).replace(/[^\d-]/g, '');
  return cleaned ? parseInt(cleaned, 10) : 0;
}

function buildRecords(rows) {
  const dataRows = rows.slice(1); // drop header row
  let lastDate = '';
  const records = [];
  for (const r of dataRows) {
    const cim = (r[1] || '').trim();
    if (!cim) continue;
    const dateRaw = (r[0] || '').trim();
    if (dateRaw) lastDate = dateRaw;
    records.push({
      datum: lastDate,
      cim,
      alapertekLakas: parseNum(r[2]),
      alapertekIroda: parseNum(r[3]),
      engedmenyesLakas: parseNum(r[4]),
      engedmenyesIroda: parseNum(r[5]),
      parkolo: parseNum(r[6]),
      megvaltas: parseNum(r[7]),
      megszavazva: (r[8] || '').trim().toLowerCase(),
      tobbletLakas: parseNum(r[9]),
      bevetel: parseNum(r[10]),
    });
  }
  return records;
}

function shortMonth(datum) {
  const m = datum.match(/^(\d{4})\.\s*(\S+)/);
  if (!m) return datum;
  const abbr = MONTH_ABBR[m[2].toLowerCase()] || m[2];
  return `${m[1]} ${abbr}`;
}

/* ---------------------------------------------------------------- */
/* Formatting helpers                                                 */
/* ---------------------------------------------------------------- */

function formatInt(v) { return Math.round(v).toLocaleString('hu-HU'); }
function formatFt(v) { return formatInt(v) + ' Ft'; }
function formatCompactFt(v) {
  if (v >= 1e9) return (v / 1e9).toFixed(1).replace(/\.0$/, '').replace('.', ',') + ' Mrd Ft';
  if (v >= 1e6) return Math.round(v / 1e6) + ' M Ft';
  if (v >= 1e3) return Math.round(v / 1e3) + ' E Ft';
  return formatFt(v);
}
function formatPercent(v, digits) {
  return (v * 100).toLocaleString('hu-HU', { minimumFractionDigits: digits, maximumFractionDigits: digits }) + '%';
}
function niceMax(value) {
  if (value <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const residual = value / magnitude;
  let niceResidual;
  if (residual <= 1) niceResidual = 1;
  else if (residual <= 2) niceResidual = 2;
  else if (residual <= 5) niceResidual = 5;
  else niceResidual = 10;
  return niceResidual * magnitude;
}

/* ---------------------------------------------------------------- */
/* Shared tooltip                                                     */
/* ---------------------------------------------------------------- */

const tooltip = document.createElement('div');
tooltip.className = 'viz-tooltip';
document.body.appendChild(tooltip);

function positionTooltip(evt) {
  tooltip.style.left = (evt.clientX + 14) + 'px';
  tooltip.style.top = (evt.clientY + 14) + 'px';
}
function showTooltip(evt, html) {
  tooltip.innerHTML = html;
  tooltip.classList.add('visible');
  positionTooltip(evt);
}
function moveTooltip(evt) { positionTooltip(evt); }
function hideTooltip() { tooltip.classList.remove('visible'); }

/* ---------------------------------------------------------------- */
/* SVG helpers                                                        */
/* ---------------------------------------------------------------- */

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}
function barPath(x, y, w, h, r) {
  if (h <= 0 || w <= 0) return '';
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} ` +
         `L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}

function drawYAxis(svg, { marginLeft, marginTop, plotWidth, plotHeight, maxValue, tickFormatter }) {
  const tickCount = 4;
  for (let t = 0; t <= tickCount; t++) {
    const v = maxValue * t / tickCount;
    const y = marginTop + plotHeight - (v / maxValue) * plotHeight;
    svg.appendChild(svgEl('line', {
      x1: marginLeft, x2: marginLeft + plotWidth, y1: y, y2: y,
      class: t === 0 ? 'axis-line' : 'gridline',
    }));
    const label = svgEl('text', { x: marginLeft - 8, y: y + 4, 'text-anchor': 'end' });
    label.textContent = tickFormatter(v);
    svg.appendChild(label);
  }
}

function drawXLabel(svg, cx, y, text) {
  const el = svgEl('text', {
    x: cx, y, 'text-anchor': 'end',
    transform: `rotate(-35 ${cx} ${y})`,
  });
  el.textContent = text;
  svg.appendChild(el);
}

/* ---------------------------------------------------------------- */
/* Chart: stacked monthly cases (approved / rejected)                 */
/* ---------------------------------------------------------------- */

function renderStackedCasesChart(svg, monthly) {
  const width = 960, marginLeft = 44, marginRight = 12, marginTop = 20, marginBottom = 62;
  const plotWidth = width - marginLeft - marginRight;
  const plotHeight = 220;
  const height = marginTop + plotHeight + marginBottom;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.innerHTML = '';

  const maxTotal = niceMax(Math.max(...monthly.map(d => d.approved + d.rejected), 1));
  const n = monthly.length;
  const bandWidth = plotWidth / n;
  const barWidth = Math.min(26, bandWidth * 0.55);

  drawYAxis(svg, { marginLeft, marginTop, plotWidth, plotHeight, maxValue: maxTotal, tickFormatter: v => formatInt(v) });

  monthly.forEach((d, i) => {
    const cx = marginLeft + bandWidth * i + bandWidth / 2;
    const baseline = marginTop + plotHeight;
    const segs = [
      { key: 'Jóváhagyva', value: d.approved, color: 'var(--status-good)' },
      { key: 'Elutasítva', value: d.rejected, color: 'var(--status-critical)' },
    ].filter(s => s.value > 0);

    let cursorH = 0; // cumulative height from baseline
    segs.forEach((seg, si) => {
      const segH = (seg.value / maxTotal) * plotHeight;
      const isTop = si === segs.length - 1;
      const gap = si > 0 ? 2 : 0;
      const y = baseline - cursorH - segH;
      const h = Math.max(segH - gap, 0);
      const x = cx - barWidth / 2;
      let mark;
      if (isTop) {
        mark = svgEl('path', { d: barPath(x, y + gap, barWidth, h, 4), fill: seg.color });
      } else {
        mark = svgEl('rect', { x, y: y + gap, width: barWidth, height: h, fill: seg.color });
      }
      mark.addEventListener('mouseenter', e => showTooltip(e,
        `<strong>${d.label}</strong><br>${seg.key}: ${formatInt(seg.value)} ügy`));
      mark.addEventListener('mousemove', moveTooltip);
      mark.addEventListener('mouseleave', hideTooltip);
      svg.appendChild(mark);
      cursorH += segH;
    });

    const total = d.approved + d.rejected;
    if (total > 0) {
      const topY = baseline - (total / maxTotal) * plotHeight - 6;
      const lbl = svgEl('text', { x: cx, y: topY, 'text-anchor': 'middle', class: 'bar-label' });
      lbl.textContent = formatInt(total);
      svg.appendChild(lbl);
    }
    drawXLabel(svg, cx, marginTop + plotHeight + 14, d.label);
  });
}

/* ---------------------------------------------------------------- */
/* Chart: monthly revenue (single hue, sequential)                    */
/* ---------------------------------------------------------------- */

function renderRevenueChart(svg, monthly) {
  const width = 960, marginLeft = 56, marginRight = 12, marginTop = 20, marginBottom = 62;
  const plotWidth = width - marginLeft - marginRight;
  const plotHeight = 220;
  const height = marginTop + plotHeight + marginBottom;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.innerHTML = '';

  const maxValue = niceMax(Math.max(...monthly.map(d => d.revenue), 1));
  const n = monthly.length;
  const bandWidth = plotWidth / n;
  const barWidth = Math.min(26, bandWidth * 0.55);

  drawYAxis(svg, { marginLeft, marginTop, plotWidth, plotHeight, maxValue, tickFormatter: v => formatCompactFt(v) });

  monthly.forEach((d, i) => {
    const cx = marginLeft + bandWidth * i + bandWidth / 2;
    const baseline = marginTop + plotHeight;
    const h = (d.revenue / maxValue) * plotHeight;
    const x = cx - barWidth / 2;
    if (h > 0) {
      const mark = svgEl('path', { d: barPath(x, baseline - h, barWidth, h, 4), fill: 'var(--series-1)' });
      mark.addEventListener('mouseenter', e => showTooltip(e,
        `<strong>${d.label}</strong><br>Bevétel: ${formatFt(d.revenue)}`));
      mark.addEventListener('mousemove', moveTooltip);
      mark.addEventListener('mouseleave', hideTooltip);
      svg.appendChild(mark);

      const lbl = svgEl('text', { x: cx, y: baseline - h - 6, 'text-anchor': 'middle', class: 'bar-label' });
      lbl.textContent = formatCompactFt(d.revenue);
      svg.appendChild(lbl);
    }
    drawXLabel(svg, cx, marginTop + plotHeight + 14, d.label);
  });
}

/* ---------------------------------------------------------------- */
/* Chart: alapérték vs engedményes (grouped, 2 categories x 2 series)  */
/* ---------------------------------------------------------------- */

function renderUnitsChart(svg, categories, seriesA, seriesB) {
  const width = 960, marginLeft = 48, marginRight = 12, marginTop = 20, marginBottom = 36;
  const plotWidth = width - marginLeft - marginRight;
  const plotHeight = 220;
  const height = marginTop + plotHeight + marginBottom;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.innerHTML = '';

  const maxValue = niceMax(Math.max(...seriesA.values, ...seriesB.values, 1));
  const n = categories.length;
  const bandWidth = plotWidth / n;
  const barWidth = Math.min(28, bandWidth * 0.28);
  const gap = 6;

  drawYAxis(svg, { marginLeft, marginTop, plotWidth, plotHeight, maxValue, tickFormatter: v => formatInt(v) });

  categories.forEach((cat, i) => {
    const bandCx = marginLeft + bandWidth * i + bandWidth / 2;
    const baseline = marginTop + plotHeight;
    [
      { label: seriesA.label, value: seriesA.values[i], color: 'var(--series-1)', offset: -(barWidth + gap / 2) },
      { label: seriesB.label, value: seriesB.values[i], color: 'var(--series-2)', offset: gap / 2 },
    ].forEach(s => {
      const h = (s.value / maxValue) * plotHeight;
      const x = bandCx + s.offset;
      if (h > 0) {
        const mark = svgEl('path', { d: barPath(x, baseline - h, barWidth, h, 4), fill: s.color });
        mark.addEventListener('mouseenter', e => showTooltip(e,
          `<strong>${cat}</strong><br>${s.label}: ${formatInt(s.value)}`));
        mark.addEventListener('mousemove', moveTooltip);
        mark.addEventListener('mouseleave', hideTooltip);
        svg.appendChild(mark);

        const lbl = svgEl('text', { x: x + barWidth / 2, y: baseline - h - 6, 'text-anchor': 'middle', class: 'bar-label' });
        lbl.textContent = formatInt(s.value);
        svg.appendChild(lbl);
      }
    });
    const xlabel = svgEl('text', { x: bandCx, y: baseline + 20, 'text-anchor': 'middle' });
    xlabel.textContent = cat;
    svg.appendChild(xlabel);
  });
}

/* ---------------------------------------------------------------- */
/* Legends                                                            */
/* ---------------------------------------------------------------- */

function renderLegend(container, items) {
  container.innerHTML = '';
  items.forEach(item => {
    const el = document.createElement('span');
    el.className = 'legend-item';
    el.innerHTML = `<span class="legend-swatch" style="background:${item.color}"></span>${item.label}`;
    container.appendChild(el);
  });
}

/* ---------------------------------------------------------------- */
/* KPI tiles                                                          */
/* ---------------------------------------------------------------- */

function renderKPIs(container, records) {
  const total = records.length;
  const approved = records.filter(r => r.megszavazva === 'igen');
  const rejected = records.filter(r => r.megszavazva !== 'igen');
  const approvalRate = total ? Math.round((approved.length / total) * 100) : 0;
  const totalSurplus = approved.reduce((s, r) => s + r.tobbletLakas, 0);
  const totalRevenue = approved.reduce((s, r) => s + r.bevetel, 0);
  const lostRevenue = rejected.reduce((s, r) => s + r.megvaltas, 0);
  const revenueVsBudget = totalRevenue / BUDGET_2026_EXPENDITURE;

  const tiles = [
    { label: 'Összes ügy', value: formatInt(total) },
    { label: 'Jóváhagyva', value: formatInt(approved.length), sub: `${approvalRate}% arány` },
    { label: 'Elutasítva', value: formatInt(rejected.length) },
    { label: 'Jóváhagyott többletlakás', value: formatInt(totalSurplus) },
    { label: 'Megváltási bevétel', value: formatCompactFt(totalRevenue), sub: formatFt(totalRevenue) },
    { label: 'Elutasított megváltás', value: formatCompactFt(lostRevenue), sub: 'nem realizált összeg' },
    { label: 'Bevétel a 2026-os kiadási költségvetés arányában', value: formatPercent(revenueVsBudget, 2),
      sub: `${formatCompactFt(totalRevenue)} / ${formatCompactFt(BUDGET_2026_EXPENDITURE)}` },
  ];

  container.innerHTML = '';
  tiles.forEach(t => {
    const el = document.createElement('div');
    el.className = 'stat-tile';
    el.innerHTML = `<p class="stat-label">${t.label}</p>` +
      `<p class="stat-value">${t.value}</p>` +
      (t.sub ? `<p class="stat-sub">${t.sub}</p>` : '');
    container.appendChild(el);
  });
}

/* ---------------------------------------------------------------- */
/* Monthly grouping                                                    */
/* ---------------------------------------------------------------- */

function groupByMonth(records) {
  const order = [];
  const map = new Map();
  for (const r of records) {
    if (!map.has(r.datum)) {
      map.set(r.datum, { label: shortMonth(r.datum), approved: 0, rejected: 0, revenue: 0 });
      order.push(r.datum);
    }
    const g = map.get(r.datum);
    if (r.megszavazva === 'igen') { g.approved++; g.revenue += r.bevetel; }
    else { g.rejected++; }
  }
  return order.map(k => map.get(k));
}

/* ---------------------------------------------------------------- */
/* Accessibility table views for the two monthly charts                */
/* ---------------------------------------------------------------- */

function renderMonthlyTable(container, monthly, valueCols) {
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Hónap</th>' + valueCols.map(c => `<th class="num">${c.label}</th>`).join('') + '</tr>';
  const tbody = document.createElement('tbody');
  monthly.forEach(d => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${d.label}</td>` + valueCols.map(c => `<td class="num">${c.format(d)}</td>`).join('');
    tbody.appendChild(tr);
  });
  table.appendChild(thead);
  table.appendChild(tbody);
  container.innerHTML = '';
  container.appendChild(table);
}

function wireTableToggle(button) {
  button.addEventListener('click', () => {
    const target = document.getElementById(button.dataset.target);
    const isHidden = target.hasAttribute('hidden');
    if (isHidden) { target.removeAttribute('hidden'); button.textContent = 'Táblázat elrejtése'; button.setAttribute('aria-expanded', 'true'); }
    else { target.setAttribute('hidden', ''); button.textContent = 'Táblázat megjelenítése'; button.setAttribute('aria-expanded', 'false'); }
  });
}

/* ---------------------------------------------------------------- */
/* Main data table (search + sort)                                    */
/* ---------------------------------------------------------------- */

const TABLE_COLUMNS = [
  { key: 'datum', type: 'str' },
  { key: 'cim', type: 'str' },
  { key: 'alapertekLakas', type: 'num' },
  { key: 'alapertekIroda', type: 'num' },
  { key: 'engedmenyesLakas', type: 'num' },
  { key: 'engedmenyesIroda', type: 'num' },
  { key: 'parkolo', type: 'num' },
  { key: 'megvaltas', type: 'num' },
  { key: 'megszavazva', type: 'str' },
  { key: 'tobbletLakas', type: 'num' },
  { key: 'bevetel', type: 'num' },
];

let tableState = { sortKey: null, sortDir: 1, query: '' };

function renderMainTable(records) {
  const tbody = document.getElementById('mainTableBody');
  let rows = records.filter(r => r.cim.toLowerCase().includes(tableState.query));

  if (tableState.sortKey) {
    const col = TABLE_COLUMNS.find(c => c.key === tableState.sortKey);
    rows = rows.slice().sort((a, b) => {
      const av = a[tableState.sortKey], bv = b[tableState.sortKey];
      let cmp;
      if (col.type === 'num') cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv), 'hu');
      return cmp * tableState.sortDir;
    });
  }

  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${r.datum}</td>
      <td>${r.cim}</td>
      <td class="num">${formatInt(r.alapertekLakas)}</td>
      <td class="num">${formatInt(r.alapertekIroda)}</td>
      <td class="num">${formatInt(r.engedmenyesLakas)}</td>
      <td class="num">${formatInt(r.engedmenyesIroda)}</td>
      <td class="num">${formatInt(r.parkolo)}</td>
      <td class="num">${formatFt(r.megvaltas)}</td>
      <td>${statusBadge(r.megszavazva)}</td>
      <td class="num">${r.tobbletLakas ? formatInt(r.tobbletLakas) : '–'}</td>
      <td class="num">${r.bevetel ? formatFt(r.bevetel) : '–'}</td>
    </tr>
  `).join('');
}

function statusBadge(status) {
  if (status === 'igen') return '<span class="status-badge igen">✓ igen</span>';
  return '<span class="status-badge nem">✕ nem</span>';
}

function wireMainTable(records) {
  document.querySelectorAll('#mainTable thead th').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (tableState.sortKey === key) tableState.sortDir *= -1;
      else { tableState.sortKey = key; tableState.sortDir = 1; }
      document.querySelectorAll('#mainTable thead th').forEach(t => { t.classList.remove('sorted'); t.removeAttribute('data-dir'); });
      th.classList.add('sorted');
      th.setAttribute('data-dir', tableState.sortDir === 1 ? '▲' : '▼');
      renderMainTable(records);
    });
  });

  document.getElementById('searchBox').addEventListener('input', e => {
    tableState.query = e.target.value.trim().toLowerCase();
    renderMainTable(records);
  });
}

/* ---------------------------------------------------------------- */
/* Freshness indicator                                                 */
/* ---------------------------------------------------------------- */

function renderFreshness(lastModified) {
  const el = document.getElementById('freshness');
  if (lastModified) {
    const d = new Date(lastModified);
    el.textContent = `Adatok utolsó frissítése: ${d.toLocaleString('hu-HU')}`;
  } else {
    el.textContent = `Adatok betöltve: ${new Date().toLocaleString('hu-HU')}`;
  }
}

/* ---------------------------------------------------------------- */
/* Bootstrap                                                           */
/* ---------------------------------------------------------------- */

async function init() {
  try {
    const res = await fetch(DATA_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    renderFreshness(res.headers.get('Last-Modified'));

    const records = buildRecords(parseCSV(text));
    const monthly = groupByMonth(records);

    renderKPIs(document.getElementById('kpiRow'), records);

    renderLegend(document.getElementById('legendCases'), [
      { color: 'var(--status-good)', label: 'Jóváhagyva' },
      { color: 'var(--status-critical)', label: 'Elutasítva' },
    ]);
    renderStackedCasesChart(document.getElementById('chartCases'), monthly);
    renderMonthlyTable(document.getElementById('tableCasesWrap'), monthly, [
      { label: 'Jóváhagyva', format: d => formatInt(d.approved) },
      { label: 'Elutasítva', format: d => formatInt(d.rejected) },
      { label: 'Összesen', format: d => formatInt(d.approved + d.rejected) },
    ]);

    renderRevenueChart(document.getElementById('chartRevenue'), monthly);
    renderMonthlyTable(document.getElementById('tableRevenueWrap'), monthly, [
      { label: 'Bevétel', format: d => formatFt(d.revenue) },
    ]);

    const approvedRecords = records.filter(r => r.megszavazva === 'igen');
    renderLegend(document.getElementById('legendUnits'), [
      { color: 'var(--series-1)', label: 'Alapérték' },
      { color: 'var(--series-2)', label: 'Engedményes' },
    ]);
    renderUnitsChart(document.getElementById('chartUnits'),
      ['Lakás', 'Iroda'],
      { label: 'Alapérték', values: [
        approvedRecords.reduce((s, r) => s + r.alapertekLakas, 0),
        approvedRecords.reduce((s, r) => s + r.alapertekIroda, 0),
      ] },
      { label: 'Engedményes', values: [
        approvedRecords.reduce((s, r) => s + r.engedmenyesLakas, 0),
        approvedRecords.reduce((s, r) => s + r.engedmenyesIroda, 0),
      ] });

    renderMainTable(records);
    wireMainTable(records);
    document.querySelectorAll('.table-toggle').forEach(wireTableToggle);

    window.addEventListener('resize', () => {
      renderStackedCasesChart(document.getElementById('chartCases'), monthly);
      renderRevenueChart(document.getElementById('chartRevenue'), monthly);
    });
  } catch (err) {
    const el = document.getElementById('freshness');
    el.textContent = 'Nem sikerült betölteni az adatokat (' + DATA_URL + '): ' + err.message;
    el.classList.add('error');
    console.error(err);
  }
}

init();
