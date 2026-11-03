// Gráfico de linha simples em SVG
import { h, fmtNum } from './util.js';

export function lineChart(points, { unit = '' } = {}) {
  if (!points.length) return h('div', { class: 'muted center pad' }, 'Sem dados para este gráfico');

  const W = 340, H = 200, pl = 42, pr = 14, pt = 16, pb = 28;
  const ys = points.map((p) => p.y);
  let min = Math.min(...ys), max = Math.max(...ys);
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  min -= span * 0.12; max += span * 0.12;
  if (min < 0 && Math.min(...ys) >= 0) min = 0;

  const x = (i) => points.length === 1 ? pl + (W - pl - pr) / 2 : pl + (i * (W - pl - pr)) / (points.length - 1);
  const y = (v) => pt + ((max - v) * (H - pt - pb)) / (max - min);

  let svg = '';
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = min + ((max - min) * i) / ticks;
    const yy = y(v).toFixed(1);
    svg += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${yy}" y2="${yy}"/>`;
    svg += `<text class="lbl" x="${pl - 6}" y="${yy}" text-anchor="end" dominant-baseline="middle">${fmtNum(v, v >= 100 ? 0 : 1)}</text>`;
  }

  const labelIdx = new Set([0, points.length - 1]);
  if (points.length > 4) labelIdx.add(Math.floor((points.length - 1) / 2));
  for (const i of labelIdx) {
    const anchor = points.length === 1 ? 'middle' : i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle';
    svg += `<text class="lbl" x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="${anchor}">${points[i].label}</text>`;
  }

  if (points.length > 1) {
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
    svg += `<path class="line" d="${d}"/>`;
  }
  points.forEach((p, i) => {
    svg += `<circle class="dot" cx="${x(i).toFixed(1)}" cy="${y(p.y).toFixed(1)}" r="3.5"><title>${p.label}: ${fmtNum(p.y)} ${unit}</title></circle>`;
  });

  return h('div', { class: 'chart', html: `<svg viewBox="0 0 ${W} ${H}" role="img">${svg}</svg>` });
}
