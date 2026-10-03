// Stündliche Diagramme mit Chart.js (global `Chart` aus dem CDN-Skript)
import { compass, fmt, knToBft } from './units.js';
import { inWindow } from './rating.js';

let charts = [];

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function palette() {
  return {
    text: css('--text-muted'),
    grid: css('--chart-grid'),
    s1: css('--chart-1'),
    s2: css('--chart-2'),
    s3: css('--chart-3'),
    shade: css('--shade'),
    green: css('--success'),
    yellow: css('--warning'),
  };
}

// Stunden außerhalb des Tauchfensters dezent hinterlegen
const windowShade = (hours, spot, color) => ({
  id: 'windowShade',
  beforeDatasetsDraw(chart) {
    const { ctx, chartArea: a, scales: { x } } = chart;
    const half = (x.getPixelForValue(1) - x.getPixelForValue(0)) / 2;
    ctx.save();
    ctx.fillStyle = color;
    hours.forEach((h, i) => {
      if (inWindow(h.time, spot)) return;
      const cx = x.getPixelForValue(i);
      ctx.fillRect(Math.max(a.left, cx - half), a.top, Math.min(a.right, cx + half) - Math.max(a.left, cx - half), a.bottom - a.top);
    });
    ctx.restore();
  },
});

// Grenzwert-Linien (grün/gelb) auf der linken y-Achse
const limitLines = (limits) => ({
  id: 'limitLines',
  afterDatasetsDraw(chart) {
    const { ctx, chartArea: a, scales: { y } } = chart;
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    for (const { value, color } of limits) {
      if (value == null || value > y.max) continue;
      const py = y.getPixelForValue(value);
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(a.left, py);
      ctx.lineTo(a.right, py);
      ctx.stroke();
    }
    ctx.restore();
  },
});

// Richtungspfeile über dem Diagramm: Pfeil zeigt, wohin Wind/Strömung geht
const directionArrows = (dirs, color, { from = true } = {}) => ({
  id: 'directionArrows',
  afterDraw(chart) {
    const { ctx, chartArea: a, scales: { x } } = chart;
    const stepPx = x.getPixelForValue(1) - x.getPixelForValue(0);
    const every = stepPx < 14 ? 2 : 1;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.5;
    dirs.forEach((deg, i) => {
      if (deg == null || i % every) return;
      ctx.save();
      ctx.translate(x.getPixelForValue(i), a.top - 11);
      ctx.rotate(((from ? deg + 180 : deg) * Math.PI) / 180);
      ctx.beginPath();
      ctx.moveTo(0, 6);
      ctx.lineTo(0, -4);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(-3.5, -2);
      ctx.lineTo(3.5, -2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    });
    ctx.restore();
  },
});

function baseOptions(p, { y, y2, arrows = false }) {
  const scales = {
    x: { ticks: { color: p.text, maxRotation: 0, autoSkip: true, autoSkipPadding: 8 }, grid: { display: false }, border: { color: p.grid } },
    y: { beginAtZero: y.beginAtZero ?? true, suggestedMax: y.suggestedMax, title: { display: true, text: y.title, color: p.text }, ticks: { color: p.text }, grid: { color: p.grid }, border: { display: false } },
  };
  if (y2) {
    scales.y2 = { position: 'right', beginAtZero: y2.beginAtZero ?? true, title: { display: true, text: y2.title, color: p.text }, ticks: { color: p.text }, grid: { display: false }, border: { display: false } };
  }
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    layout: { padding: { top: arrows ? 22 : 4 } },
    plugins: {
      legend: { position: 'bottom', labels: { color: p.text, boxWidth: 12, boxHeight: 2, padding: 10 } },
      tooltip: { callbacks: {} },
    },
    scales,
    elements: { point: { radius: 0, hitRadius: 8, hoverRadius: 4 }, line: { tension: 0.3, borderWidth: 2 } },
  };
}

function addChart(container, title, config) {
  const card = document.createElement('figure');
  card.className = 'chart-card';
  card.innerHTML = `<figcaption>${title}</figcaption><div class="chart-box"><canvas></canvas></div>`;
  container.append(card);
  charts.push(new Chart(card.querySelector('canvas'), config));
}

export function destroyCharts() {
  charts.forEach((c) => c.destroy());
  charts = [];
}

/**
 * hours: die 24 Stunden des gewählten Tages; th: aufgelöste Grenzwerte
 * pegelSeries: [{ time, value }] stündliche Messwerte (optional)
 */
export function renderDayCharts(container, { hours, spot, th, pegelSeries }) {
  destroyCharts();
  container.innerHTML = '';
  if (typeof Chart === 'undefined') {
    container.innerHTML = '<p class="muted">Diagramme nicht verfügbar (Chart.js konnte nicht geladen werden).</p>';
    return;
  }
  const p = palette();
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  const labels = hours.map((h) => h.time.slice(11, 13));
  const shade = windowShade(hours, spot, p.shade);

  // Wind
  const windOpts = baseOptions(p, { y: { title: 'kn', suggestedMax: th.wind[1] + 4 }, arrows: true });
  windOpts.plugins.tooltip.callbacks.label = (ctx) => {
    const h = hours[ctx.dataIndex];
    return ctx.datasetIndex === 0
      ? ` Wind ${fmt(h.wind)} kn (${knToBft(h.wind)} Bft) aus ${compass(h.windDir)}`
      : ` Böen ${fmt(h.gust)} kn`;
  };
  addChart(container, 'Wind &amp; Böen <span class="muted">· Pfeile: Windrichtung · Linien: Grenzwerte</span>', {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Wind', data: hours.map((h) => h.wind), borderColor: p.s1, backgroundColor: p.s1 + '22', fill: true },
        { label: 'Böen', data: hours.map((h) => h.gust), borderColor: p.s2, borderDash: [5, 4], borderWidth: 1.5 },
      ],
    },
    options: windOpts,
    plugins: [shade, limitLines([{ value: th.wind[0], color: p.green }, { value: th.wind[1], color: p.yellow }]), directionArrows(hours.map((h) => h.windDir), p.text)],
  });

  if (spot.type === 'meer' && hours.some((h) => h.wave != null)) {
    const waveOpts = baseOptions(p, { y: { title: 'm', suggestedMax: th.wave[1] * 1.2 }, y2: { title: 's' }, arrows: true });
    waveOpts.plugins.tooltip.callbacks.label = (ctx) => {
      const h = hours[ctx.dataIndex];
      if (ctx.datasetIndex === 0) return ` Welle ${fmt(h.wave, 2)} m aus ${compass(h.waveDir)}`;
      if (ctx.datasetIndex === 1) return ` Dünung ${fmt(h.swell, 2)} m aus ${compass(h.swellDir)}`;
      return ` Periode ${fmt(h.wavePeriod, 1)} s`;
    };
    addChart(container, 'Seegang <span class="muted">· Pfeile: Laufrichtung der Wellen</span>', {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Wellenhöhe', data: hours.map((h) => h.wave), borderColor: p.s1, backgroundColor: p.s1 + '22', fill: true },
          { label: 'Dünung', data: hours.map((h) => h.swell), borderColor: p.s3 },
          { label: 'Periode', data: hours.map((h) => h.wavePeriod), borderColor: p.s2, borderDash: [2, 3], borderWidth: 1.5, yAxisID: 'y2' },
        ],
      },
      options: waveOpts,
      plugins: [shade, limitLines([{ value: th.wave[0], color: p.green }, { value: th.wave[1], color: p.yellow }]), directionArrows(hours.map((h) => h.waveDir), p.text)],
    });
  }

  // Temperaturen: Luft + Wasser (Modell an der Küste bzw. Pegel-Messwerte)
  const pegelByTime = new Map((pegelSeries ?? []).map((m) => [m.time, m.value]));
  const pegelDay = hours.map((h) => pegelByTime.get(h.time) ?? null);
  const tempSets = [{ label: 'Luft', data: hours.map((h) => h.temp), borderColor: p.s2 }];
  if (hours.some((h) => h.sst != null)) tempSets.push({ label: 'Wasser (Modell)', data: hours.map((h) => h.sst), borderColor: p.s1 });
  if (pegelDay.some((v) => v != null)) tempSets.push({ label: `Wasser (Pegel ${spot.pegel?.name ?? ''})`, data: pegelDay, borderColor: p.s3, spanGaps: true });
  const tempOpts = baseOptions(p, { y: { title: '°C', beginAtZero: false } });
  tempOpts.plugins.tooltip.callbacks.label = (ctx) => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y, 1)} °C`;
  addChart(container, 'Temperatur', { type: 'line', data: { labels, datasets: tempSets }, options: tempOpts, plugins: [shade] });

  if (spot.type === 'meer' && hours.some((h) => h.seaLevel != null || h.current != null)) {
    const tideOpts = baseOptions(p, { y: { title: 'm', beginAtZero: false }, y2: { title: 'kn' }, arrows: true });
    tideOpts.plugins.tooltip.callbacks.label = (ctx) => {
      const h = hours[ctx.dataIndex];
      return ctx.datasetIndex === 0
        ? ` Wasserstand ${fmt(h.seaLevel, 2)} m`
        : ` Strömung ${fmt(h.current, 1)} kn nach ${compass(h.currentDir)}`;
    };
    addChart(container, 'Wasserstand &amp; Strömung <span class="muted">· Modell, nur Tendenz · Pfeile: Strömung</span>', {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Wasserstand (Gezeiten + Wind)', data: hours.map((h) => h.seaLevel), borderColor: p.s1 },
          { label: 'Strömung', type: 'bar', data: hours.map((h) => h.current), backgroundColor: p.s3 + '66', yAxisID: 'y2', barPercentage: 0.6 },
        ],
      },
      options: tideOpts,
      plugins: [shade, directionArrows(hours.map((h) => h.currentDir), p.text, { from: false })],
    });
  }
}
