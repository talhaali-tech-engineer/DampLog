// Small DOM helpers shared by the screens. Everything builds elements with text
// nodes, never innerHTML, so notes typed into the log cannot inject markup.

import { ICONS } from './icons.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const c of children.flat(Infinity)) {
    if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  }
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  return el;
}

export function icon(name, size = 20) {
  const el = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({
    viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
    'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'icon',
  })) el.setAttribute(k, v);
  for (const d of ICONS[name] ?? []) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    el.append(path);
  }
  return el;
}

/* ---------- formatting ---------- */

export function fmtDate(iso, { weekday = false, year = true } = {}) {
  if (!iso) return '—';
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: weekday ? 'short' : undefined, day: 'numeric', month: 'short', year: year ? 'numeric' : undefined, timeZone: 'UTC',
  });
}

export function fmtTime(at, options) {
  if (!at) return '—';
  return at.length > 10 ? `${fmtDate(at, options)}, ${at.slice(11, 16)}` : fmtDate(at, options);
}

export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/* ---------- feedback ---------- */

const toastBox = () => document.getElementById('toast');

export function toast(message, kind = 'ok') {
  const item = h('div', { class: `toast ${kind}` }, icon(kind === 'bad' ? 'alert' : 'check', 18), h('span', {}, message));
  toastBox().append(item);
  setTimeout(() => item.remove(), kind === 'bad' ? 6500 : 3500);
}

export function download(filename, content, type) {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- Probe: the assistant, drawn as a damp meter ---------- */

function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
}

let probeCount = 0;

/**
 * A floating moisture meter with a glowing LCD face and two probe antennae.
 * Everything moves in CSS: it hovers over a breathing shadow, its antennae sway,
 * its eyes blink and glance around, and water droplets drift up beside it.
 * Moods: 'idle', 'thinking' (scan line and reading bars), 'talking' (moving
 * mouth) and 'alert' (an amber screen and a concerned, steady face when a landlord is late).
 */
export function probe(size = 44, mood = 'idle') {
  const id = `pb${++probeCount}`;
  const drop = (cls, x, y, s) => svg('path', { class: `probe-drop ${cls}`, d: `M${x} ${y - 3.2 * s}c${1.8 * s} ${2.4 * s} ${2.6 * s} ${3.6 * s} ${2.6 * s} ${4.8 * s}a${2.6 * s} ${2.6 * s} 0 0 1-${5.2 * s} 0c0-${1.2 * s} ${0.8 * s}-${2.4 * s} ${2.6 * s}-${4.8 * s}z` });
  return svg('svg', { viewBox: '0 0 80 80', width: size, height: size, class: `probe ${mood}`, 'aria-hidden': 'true', focusable: 'false' },
    svg('defs', {},
      svg('linearGradient', { id: `${id}-case`, x1: 0, y1: 0, x2: 0.3, y2: 1 },
        svg('stop', { offset: 0, 'stop-color': '#3c5166' }), svg('stop', { offset: 0.55, 'stop-color': '#223040' }), svg('stop', { offset: 1, 'stop-color': '#141c25' })),
      svg('linearGradient', { id: `${id}-screen`, x1: 0, y1: 0, x2: 0, y2: 1 },
        svg('stop', { offset: 0, 'stop-color': '#0d3d33' }), svg('stop', { offset: 1, 'stop-color': '#041611' })),
      svg('clipPath', { id: `${id}-clip` }, svg('rect', { x: 20, y: 27, width: 40, height: 26, rx: 8 }))),
    svg('ellipse', { class: 'probe-shadow', cx: 40, cy: 75, rx: 17, ry: 3.2 }),
    svg('g', { class: 'probe-drops' }, drop('d1', 11, 52, 1), drop('d2', 69, 44, 0.8), drop('d3', 64, 64, 0.65)),
    svg('g', { class: 'probe-float' },
      svg('g', { class: 'probe-shake' },
        svg('g', { class: 'probe-ant left' },
          svg('rect', { class: 'probe-pin', x: 29.6, y: 9, width: 3.4, height: 13, rx: 1.7 }),
          svg('circle', { class: 'probe-tip', cx: 31.3, cy: 8.5, r: 3.4 })),
        svg('g', { class: 'probe-ant right' },
          svg('rect', { class: 'probe-pin', x: 47, y: 9, width: 3.4, height: 13, rx: 1.7 }),
          svg('circle', { class: 'probe-tip', cx: 48.7, cy: 8.5, r: 3.4 })),
        svg('rect', { class: 'probe-case', x: 13, y: 20, width: 54, height: 50, rx: 17, fill: `url(#${id}-case)` }),
        svg('path', { class: 'probe-gloss', d: 'M22 26.5 Q28 22.6 37 22.4' }),
        svg('rect', { class: 'probe-screen', x: 20, y: 27, width: 40, height: 26, rx: 8, fill: `url(#${id}-screen)` }),
        svg('g', { 'clip-path': `url(#${id}-clip)` },
          svg('rect', { class: 'probe-scan', x: 20, y: 25, width: 40, height: 3 }),
          svg('g', { class: 'probe-face' },
            svg('g', { class: 'probe-eyes' },
              svg('rect', { class: 'probe-eye ink', x: 28, y: 32.5, width: 6, height: 9.5, rx: 3 }),
              svg('rect', { class: 'probe-eye ink', x: 46, y: 32.5, width: 6, height: 9.5, rx: 3 })),
            svg('path', { class: 'probe-brows line', d: 'M27.5 31.2 Q30.5 29.4 33.5 29.6 M52.5 31.2 Q49.5 29.4 46.5 29.6' }),
            svg('path', { class: 'probe-mouth line', d: 'M35 46.2 Q40 49.8 45 46.2' })),
          svg('g', { class: 'probe-bars' },
            svg('rect', { class: 'ink', x: 30.5, y: 33, width: 4.6, height: 15, rx: 2.3 }),
            svg('rect', { class: 'ink', x: 37.7, y: 33, width: 4.6, height: 15, rx: 2.3 }),
            svg('rect', { class: 'ink', x: 44.9, y: 33, width: 4.6, height: 15, rx: 2.3 }))),
        svg('circle', { class: 'probe-knob', cx: 27, cy: 61.5, r: 3.8 }),
        svg('rect', { class: 'probe-knob', x: 35, y: 59, width: 18, height: 5, rx: 2.5 }),
        svg('circle', { class: 'probe-led', cx: 59, cy: 61.5, r: 2 }))));
}

export function setProbeMood(el, mood) {
  el?.setAttribute('class', `probe ${mood}`);
}

/* ---------- markdown for AI replies ---------- */

function inline(text) {
  const out = document.createDocumentFragment();
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.append(text.slice(last, m.index));
    out.append(m[1] != null ? h('strong', {}, m[1]) : h('code', {}, m[2]));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.append(text.slice(last));
  return out;
}

const BULLET = /^\s*[-*•]\s+(.*)/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)/;
const HEADING = /^\s*#{1,6}\s+(.*)/;
const isItem = (l) => BULLET.test(l) || NUMBERED.test(l);
const itemText = (l) => l.match(BULLET)?.[1] ?? l.match(NUMBERED)?.[2];

/** Renders the small subset of Markdown the AI uses: headings, lists, bold and code. */
export function renderMarkdown(text) {
  const root = h('div', { class: 'md' });
  const lines = String(text).replace(/\r/g, '').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if (!line.trim()) {
      i++;
    } else if ((m = line.match(HEADING))) {
      root.append(h('h4', {}, inline(m[1])));
      i++;
    } else if (isItem(line)) {
      const numbered = !BULLET.test(line);
      const list = h(numbered ? 'ol' : 'ul');
      const first = Number(line.match(NUMBERED)?.[1]);
      if (numbered && first > 1) list.start = first;
      while (i < lines.length && (isItem(lines[i]) || (!lines[i].trim() && isItem(lines[i + 1] ?? '')))) {
        if (lines[i].trim()) list.append(h('li', {}, inline(itemText(lines[i]))));
        i++;
      }
      root.append(list);
    } else {
      const para = [];
      while (i < lines.length && lines[i].trim() && !isItem(lines[i]) && !HEADING.test(lines[i])) para.push(lines[i++].trim());
      root.append(h('p', {}, inline(para.join(' '))));
    }
  }
  return root;
}
