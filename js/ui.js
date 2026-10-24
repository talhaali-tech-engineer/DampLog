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

/**
 * A moisture meter with an LCD face and two metal probes. Moods (animated in CSS):
 * 'idle' blinks and pulses its probe tips, 'thinking' takes a reading with bouncing
 * bars, 'talking' shows a waveform mouth, and 'alert' turns the screen red when a
 * landlord is late. Colours live in CSS so the screen can change with the mood.
 */
export function probe(size = 44, mood = 'idle') {
  return svg('svg', { viewBox: '0 0 64 64', width: size, height: size, class: `probe ${mood}`, 'aria-hidden': 'true', focusable: 'false' },
    svg('g', { class: 'probe-body' },
      svg('rect', { class: 'probe-pin', x: 22.4, y: 4, width: 3.6, height: 13, rx: 1.8 }),
      svg('rect', { class: 'probe-pin', x: 38, y: 4, width: 3.6, height: 13, rx: 1.8 }),
      svg('circle', { class: 'probe-tip', cx: 24.2, cy: 4.4, r: 2.6 }),
      svg('circle', { class: 'probe-tip late', cx: 39.8, cy: 4.4, r: 2.6 }),
      svg('rect', { class: 'probe-case', x: 9, y: 14.5, width: 46, height: 46, rx: 13 }),
      svg('rect', { class: 'probe-screen', x: 15, y: 20.5, width: 34, height: 23, rx: 6 }),
      svg('g', { class: 'probe-face' },
        svg('rect', { class: 'probe-eye ink', x: 22.5, y: 25.5, width: 5, height: 7.5, rx: 2.5 }),
        svg('rect', { class: 'probe-eye ink', x: 36.5, y: 25.5, width: 5, height: 7.5, rx: 2.5 }),
        svg('path', { class: 'probe-mouth line', d: 'M27.5 37.4 Q32 40 36.5 37.4' })),
      svg('g', { class: 'probe-bars' },
        svg('rect', { class: 'ink', x: 23, y: 26, width: 4, height: 13, rx: 2 }),
        svg('rect', { class: 'ink', x: 30, y: 26, width: 4, height: 13, rx: 2 }),
        svg('rect', { class: 'ink', x: 37, y: 26, width: 4, height: 13, rx: 2 })),
      svg('circle', { class: 'probe-knob', cx: 22.5, cy: 52, r: 3.4 }),
      svg('rect', { class: 'probe-knob', x: 30, y: 49.6, width: 16, height: 4.8, rx: 2.4 })));
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
