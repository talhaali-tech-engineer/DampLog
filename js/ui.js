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

/* ---------- the assistant: a small house with a face ---------- */

function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
}

/**
 * States (animated in CSS): 'idle' breathes, blinks and puffs from the chimney,
 * 'thinking' scans its eyes, 'talking' moves its mouth.
 */
export function bot(size = 40, state = 'idle') {
  const body = '#0f766e';
  const face = '#ecfdf5';
  const features = '#134e4a';
  return svg('svg', { viewBox: '0 0 64 64', width: size, height: size, class: `bot ${state}`, 'aria-hidden': 'true', focusable: 'false' },
    svg('circle', { class: 'bot-puff', cx: 45, cy: 7, r: 3, fill: '#99f6e4' }),
    svg('g', { class: 'bot-body' },
      svg('rect', { x: 41, y: 11, width: 7, height: 12, rx: 1.5, fill: '#115e59' }),
      svg('path', { d: 'M32 8.5 55 27v24.5a6 6 0 0 1-6 6H15a6 6 0 0 1-6-6V27z', fill: body, stroke: body, 'stroke-width': 3, 'stroke-linejoin': 'round' }),
      svg('rect', { x: 16, y: 30, width: 32, height: 21, rx: 7, fill: face }),
      svg('g', { class: 'bot-eyes' },
        svg('rect', { class: 'bot-eye', x: 23, y: 35, width: 5, height: 8, rx: 2.5, fill: features }),
        svg('rect', { class: 'bot-eye', x: 36, y: 35, width: 5, height: 8, rx: 2.5, fill: features })),
      svg('path', { class: 'bot-mouth', d: 'M29 46.5 Q32 48.6 35 46.5', stroke: features, 'stroke-width': 2, 'stroke-linecap': 'round', fill: 'none' })));
}

export function setBotState(el, state) {
  el?.setAttribute('class', `bot ${state}`);
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
