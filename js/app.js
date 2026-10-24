// DampLog UI. Views render from in-memory state; every change is saved to
// IndexedDB first and only then applied in memory.

import * as core from './core.js';
import * as db from './db.js';
import * as ai from './ai.js';
import { LETTERS, buildLetter } from './letters.js';
import { preparePhoto, photoUrl, forgetPhotos, blobToDataUrl, dataUrlToBlob } from './photos.js';
import { sampleData, drawSample } from './sample.js';
import { recordContext, assistantSystem, SUGGESTIONS, nextSteps, splitActions, ACTION_IDS } from './assistant.js';
import { h, icon, probe, setProbeMood, renderMarkdown, fmtDate, fmtTime, plural, toast, download } from './ui.js';

const main = document.getElementById('main');
const rail = document.getElementById('rail');
const dock = document.getElementById('dock');
const mobileTop = document.getElementById('mobile-top');
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('damplog') : null;

let state = { home: core.cleanHome(), issues: [], entries: [], photos: [] };
let askedToPersist = false;
let aiConfig = ai.cleanAiConfig();

// Saving the whole record at once (sample, restore) must not drop the AI key.
const aiMeta = () => (aiConfig.provider ? [{ id: 'ai', ...aiConfig }] : []);

// The assistant conversation lives in memory only, so it survives moving between
// screens but is never saved.
const chat = { messages: [], busy: false, controller: null, calm: false };

/* ---------- helpers ---------- */

const today = () => ({ date: core.todayISO(), now: core.nowLocal() });
const ctx = () => ({ now: core.nowLocal(), newId });
const findIssue = (id) => state.issues.find((i) => i.id === id);
const findPhoto = (id) => state.photos.find((p) => p.id === id);
const summaryOf = (issue) => core.issueSummary(issue, state.entries, state.home.landlordType, today());
const summaries = () => core.sortSummaries(state.issues.map(summaryOf));
const issueSub = (issue) => [issue.room, core.KINDS[issue.kind].label].filter(Boolean).join(' · ');

function newId() {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function act(fn) {
  try {
    await fn();
  } catch (err) {
    console.error(err);
    toast(err.message || 'Something went wrong.', 'bad');
  }
}

function apply(put = {}, remove = {}) {
  const next = { ...state };
  for (const store of ['issues', 'entries', 'photos']) {
    const gone = new Set([...(remove[store] ?? []), ...(put[store] ?? []).map((x) => x.id)]);
    next[store] = [...state[store].filter((x) => !gone.has(x.id)), ...(put[store] ?? [])];
  }
  state = next;
}

async function commit(put, remove) {
  await db.save(put, { remove });
  apply(put, remove);
  channel?.postMessage('changed');
  if (!askedToPersist) {
    askedToPersist = true;
    navigator.storage?.persist?.();
  }
}

async function saveHome(changes) {
  const home = core.cleanHome({ ...state.home, ...changes });
  await db.saveHome(home);
  state = { ...state, home };
  channel?.postMessage('changed');
}

/* ---------- building blocks ---------- */

function btn(text, { icon: iconName, kind = '', size = '', href, onclick, type = 'button', disabled, title } = {}) {
  const cls = ['btn', kind, size].filter(Boolean).join(' ');
  const content = [iconName && icon(iconName, size === 'sm' ? 16 : 18), text && h('span', {}, text)];
  if (href) return h('a', { class: cls, href, title }, content);
  return h('button', { class: cls, type, onclick, disabled, title, 'aria-label': text ? null : title }, content);
}

const pageHead = (title, sub, actions = []) => h('header', { class: 'page-head' },
  h('div', {}, h('h1', {}, title), sub && h('p', { class: 'sub' }, sub)),
  actions.filter(Boolean).length > 0 && h('div', { class: 'page-actions' }, actions));

const card = (cls, ...children) => h('section', { class: `card ${cls}`.trim() }, ...children);

const cardHead = (title, { sub, iconName, actions = [] } = {}) => h('div', { class: 'card-head' },
  h('div', { class: 'card-title' },
    iconName && h('span', { class: 'card-icon' }, icon(iconName, 18)),
    h('div', {}, h('h2', {}, title), sub && h('p', { class: 'muted small' }, sub))),
  actions.filter(Boolean).length > 0 && h('div', { class: 'card-actions' }, actions));

const field = (text, control, hint) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, text), control, hint && h('small', { class: 'hint' }, hint));
// For controls that hold buttons or radios: a <label> would forward every tap to its first control.
const group = (text, control, hint) => h('div', { class: 'field', role: 'group', 'aria-label': text }, h('span', { class: 'field-label' }, text), control, hint && h('small', { class: 'hint' }, hint));
const badge = (tone, text) => h('span', { class: `badge ${tone}` }, text);
const notice = (tone, iconName, ...content) => h('div', { class: `notice ${tone}` }, icon(iconName, 18), h('div', {}, ...content));
const backLink = (href, text) => h('a', { class: 'back-link', href }, icon('back', 16), text);
const scopeNote = () => h('p', { class: 'scope-note' }, icon('info', 16),
  h('span', {}, 'DampLog helps you keep a record and write to your landlord. It is not legal advice. Deadlines follow the government\'s Awaab\'s Law guidance for social housing in England.'));

const emptyState = (iconName, title, text, ...actions) => h('div', { class: 'empty' },
  h('span', { class: 'empty-icon' }, icon(iconName, 24)), h('strong', {}, title), text && h('p', { class: 'muted' }, text),
  actions.length > 0 && h('div', { class: 'actions center' }, actions));

function select(name, options, value) {
  return h('select', { name }, Object.entries(options).map(([v, text]) => h('option', { value: v, selected: v === value }, text)));
}

/** A dialog that slides up from the bottom of the screen on phones. */
function openSheet(title, ...content) {
  const sheet = h('dialog', { class: 'dialog sheet', 'aria-label': title });
  const close = () => sheet.close();
  sheet.append(h('h2', {}, title), ...content.filter(Boolean).map((c) => (typeof c === 'function' ? c(close) : c)), btn('Cancel', { kind: 'ghost', onclick: close }));
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });
  sheet.addEventListener('close', () => sheet.remove());
  document.body.append(sheet);
  sheet.showModal();
}

const sheetOption = (href, iconName, title, text) => (close) => h('a', { class: 'sheet-option', href, onclick: close },
  h('span', { class: 'sheet-icon' }, icon(iconName, 20)), h('span', { class: 'sheet-text' }, h('strong', {}, title), text && h('small', {}, text)), icon('next', 16));

function openPhoto(photo, caption) {
  const dialog = h('dialog', { class: 'dialog photo-dialog', 'aria-label': caption });
  dialog.append(h('img', { src: photoUrl(photo), alt: caption }), h('div', { class: 'photo-caption' }, h('span', {}, caption), btn('Close', { icon: 'close', size: 'sm', onclick: () => dialog.close() })));
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

function thumbs(ids, caption) {
  const list = ids.map(findPhoto).filter(Boolean);
  if (!list.length) return null;
  return h('div', { class: 'thumbs' }, list.map((p, i) => h('button', {
    type: 'button', class: 'thumb', 'aria-label': `Open photo ${i + 1}`, onclick: () => openPhoto(p, `${caption} · photo ${i + 1} · ${fmtTime(p.takenAt)}`),
  }, h('img', { src: photoUrl(p), alt: '', loading: 'lazy' }))));
}

/* ---------- status language ---------- */

function issueBadge(s) {
  if (s.fixed) return badge('ok', 'Fixed');
  if (s.deadlines.overdue.length) return badge('bad', 'Missed deadline');
  if (!s.deadlines.reportedAt) return badge('warn', 'Not reported yet');
  return badge('info', 'Waiting on landlord');
}

const STEP_TONE = { met: ['ok', 'On time'], late: ['warn', 'Late'], overdue: ['bad', 'Overdue'], pending: ['info', 'Due'], waiting: ['', 'Not started'], open: ['', 'No legal deadline'], 'not-needed': ['ok', 'Not needed'] };

function stepDetail(s, t) {
  const due = s.dueAt ?? s.due;
  if (s.status === 'met' || s.status === 'late') return `Done ${fmtTime(s.doneAt)}${s.status === 'late' ? ` · was due ${fmtTime(due)}` : ''}`;
  if (s.status === 'overdue') {
    if (s.dueAt) return `Was due ${fmtTime(s.dueAt)}`;
    const late = core.workingDaysBetween(s.due, t.date);
    return `Was due ${fmtDate(s.due, { weekday: true })}${late > 0 ? ` · ${plural(late, 'working day')} late` : ''}`;
  }
  if (s.status === 'pending') {
    if (s.dueAt) return `Due by ${fmtTime(s.dueAt, { weekday: true })}`;
    const left = core.workingDaysBetween(t.date, s.due);
    return `Due by ${fmtDate(s.due, { weekday: true })} · ${left === 0 ? 'last day today' : `${plural(left, 'working day')} left`}`;
  }
  if (s.status === 'waiting') return 'The clock starts when the landlord investigates';
  return s.rule ?? '';
}

const KIND_ICON = { 'damp-mould': 'droplet', leak: 'droplet', emergency: 'alert', other: 'tool' };

const STEP_ENTRY = { investigation: 'investigation', summary: 'summary', 'make-safe': 'made-safe', works: 'works' };

/* ---------- navigation chrome ---------- */

const NAV = [
  { view: 'home', text: 'Case', icon: 'home' },
  { view: 'new', text: 'Log', icon: 'plus' },
  { view: 'letters', text: 'Letters', icon: 'mail' },
  { view: 'rights', text: 'Rights', icon: 'scale' },
  { view: 'settings', text: 'Settings', icon: 'settings' },
];

// Desktop: a slim rail with Probe at the bottom. Phones: a floating dock with
// Probe raised in the middle, because asking it is the main thing you do there.
function renderChrome(active) {
  const alert = summaries().some((s) => !s.fixed && s.deadlines.overdue.length);
  const mood = alert ? 'alert' : 'idle';
  const item = (n, cls) => h('a', { href: `#/${n.view}`, class: cls, 'aria-current': n.view === active ? 'page' : null }, icon(n.icon, 22), h('span', {}, n.text));
  rail.replaceChildren(
    h('a', { class: 'rail-logo', href: '#/home', 'aria-label': 'DampLog' }, h('img', { src: 'icons/icon.svg', alt: '', width: 40, height: 40 })),
    ...NAV.map((n) => item(n, 'rail-item')),
    h('button', { type: 'button', class: 'rail-probe', onclick: () => openProbe(), 'aria-label': 'Ask Probe' }, probe(52, mood), h('span', {}, 'Probe'), alert && h('span', { class: 'dot-alert' })));
  dock.replaceChildren(
    item(NAV[0], 'dock-item'), item(NAV[1], 'dock-item'),
    h('button', { type: 'button', class: 'dock-probe', onclick: () => openProbe(), 'aria-label': 'Ask Probe' }, probe(54, mood), alert && h('span', { class: 'dot-alert' })),
    item(NAV[2], 'dock-item'), item(NAV[3], 'dock-item'));
  mobileTop.replaceChildren(...[
    h('a', { class: 'brand', href: '#/home' }, h('img', { src: 'icons/icon.svg', alt: '', width: 28, height: 28 }), h('span', {}, 'DampLog')),
    !navigator.onLine && h('span', { class: 'status-pill' }, icon('wifiOff', 14), 'Offline'),
    btn('', { icon: 'settings', kind: 'ghost', title: 'Settings', href: '#/settings' }),
  ].filter(Boolean));
}

function openQuickSheet() {
  const open = summaries().filter((s) => !s.fixed);
  const latest = open[0]?.issue;
  openSheet('Add to your record', (close) => h('div', { class: 'sheet-options' },
    latest && sheetOption(`#/add/${latest.id}?type=observation`, 'camera', 'Add a photo or note', latest.title)(close),
    latest && sheetOption(`#/add/${latest.id}?type=contact`, 'phone', 'Log contact with your landlord', latest.title)(close),
    open.length > 1 && sheetOption('#/home', 'home', 'Choose another problem', `${open.length} open problems`)(close),
    sheetOption('#/new', 'plus', 'Log a new problem', 'Damp, mould, leaks or other repairs')(close)));
}

/* ---------- welcome and setup ---------- */

function viewWelcome() {
  // A demo clock: ten days inside the deadline, then the days the landlord is late.
  const demo = Array.from({ length: 15 }, (_, i) => h('span', { class: `cell ${i < 10 ? 'used' : 'late'}${i === 9 ? ' due' : ''}${i === 14 ? ' today' : ''}` }));
  demo.forEach((c, i) => { c.style.animationDelay = `${i * 90}ms`; });
  const feature = (iconName, title, text) => h('div', { class: 'feature' }, h('span', { class: 'feature-icon' }, icon(iconName, 20)), h('strong', {}, title), h('p', {}, text));
  return h('div', { class: 'page welcome' },
    h('section', { class: 'hero' },
      h('div', {},
        h('span', { class: 'eyebrow' }, icon('droplet', 14), 'Damp, mould and repairs · England'),
        h('h1', {}, 'Your landlord\'s clock is ', h('em', {}, 'ticking.')),
        h('p', { class: 'lead' }, 'Under Awaab\'s Law, councils and housing associations have 10 working days to investigate damp and mould. DampLog counts every one of them, keeps your dated evidence, and writes the letters when they are late. Free, works offline, and your record never leaves your phone.'),
        h('div', { class: 'actions' },
          btn('Start my record', { icon: 'next', kind: 'primary', href: '#/setup' }),
          btn('See an example case', {
            icon: 'eye',
            onclick: (e) => {
              e.currentTarget.disabled = true;
              act(loadSample);
            },
          }))),
      h('div', { class: 'hero-demo' },
        h('div', { class: 'tile clock late' },
          h('div', { class: 'clock-head' }, h('div', {}, h('span', { class: 'kicker' }, 'Example · Bedroom'), h('h2', {}, 'Black mould in the bedroom')), badge('bad', 'Overdue')),
          h('div', { class: 'clock-count' },
            h('div', { class: 'count' }, h('span', { class: 'count-num' }, '15', h('small', {}, '/10')), h('span', { class: 'count-label' }, 'Working days since told')),
            h('div', { class: 'count late' }, h('span', { class: 'count-num' }, '+5'), h('span', { class: 'count-label' }, 'Days late'))),
          h('div', { class: 'strip animate' }, demo),
          h('div', { class: 'strip-labels' }, h('span', {}, 'Told 2 Oct'), h('span', { class: 'due-label' }, 'Deadline 16 Oct'), h('span', {}, 'Today'))),
        h('div', { class: 'probe-says' }, probe(96, 'alert'), h('div', { class: 'bubble-say' }, 'Reading: they are 5 working days late. Shall I start the chase letter?')))),
    h('div', { class: 'features' },
      feature('clock', 'The landlord\'s clock', 'Every working day counted the way the regulations count them, bank holidays included.'),
      feature('camera', 'Dated evidence', 'Photos, calls, visits and missed appointments in one timeline.'),
      feature('mail', 'Letters that land', 'Report, chase or complain in one tap, filled in from your record.'),
      feature('sparkle', 'Probe', 'A damp meter that reads your case and tells you the next move. Ask it anything with your own AI key.')),
    scopeNote());
}

async function loadSample() {
  const c = ctx();
  const data = sampleData(today().date, c);
  const photos = [];
  for (const p of data.photoPlan) {
    const blob = await new Promise((resolve) => drawSample(p.kind, p.seed).toBlob(resolve, 'image/jpeg', 0.82));
    photos.push({ id: p.id, issueId: p.issueId, blob, takenAt: p.takenAt, width: 1200, height: 900 });
  }
  const home = core.cleanHome({ ...data.home, sample: true });
  await db.save({ issues: data.issues, entries: data.entries, photos, meta: [{ id: 'home', ...home }, ...aiMeta()] }, { replace: true });
  forgetPhotos();
  state = { home, issues: data.issues, entries: data.entries, photos };
  channel?.postMessage('changed');
  toast('Sample data loaded. Clear it in Settings when you are ready to start.');
  location.hash = '#/home';
  render();
}

function homeForm({ submitText, onSaved }) {
  const s = state.home;
  const isNew = !s.address;
  const form = h('form', { class: 'form' },
    h('div', { class: 'row' },
      field('Your name', h('input', { name: 'tenantName', value: s.tenantName, autocomplete: 'name' })),
      field('Tenancy or account reference', h('input', { name: 'tenancyRef', value: s.tenancyRef }), 'Optional. It is on your tenancy agreement or rent statements.')),
    field('Your address', h('textarea', { name: 'address', rows: 2, required: true, autocomplete: 'street-address' }, s.address)),
    h('div', { class: 'row' },
      field('Landlord', h('input', { name: 'landlordName', value: s.landlordName, required: true, placeholder: 'e.g. the council or housing association' })),
      field('Landlord\'s repairs email', h('input', { name: 'landlordEmail', type: 'email', value: s.landlordEmail }), 'Optional. Used to start emails for you.')),
    field('Who is your landlord?', select('landlordType', core.LANDLORD_TYPES, isNew ? 'social' : s.landlordType),
      'Awaab\'s Law deadlines apply to councils and housing associations in England.'),
    field('Who lives in your home?', h('textarea', { name: 'household', rows: 2, placeholder: 'e.g. Me, my partner and our son (4), who has asthma.' }, s.household),
      'Optional. Landlords must consider who lives there, including children and health conditions. It only goes into letters you write.'),
    h('div', { class: 'actions' }, btn(submitText, { icon: 'check', kind: 'primary', type: 'submit' })));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    act(async () => {
      const data = Object.fromEntries(new FormData(form));
      await saveHome(data);
      onSaved();
    });
  });
  return form;
}

function viewSetup() {
  return h('div', { class: 'page narrow' },
    pageHead('About your home', 'These details go into your letters and evidence report. They stay on this device.'),
    card('', homeForm({ submitText: 'Save and continue', onSaved: () => { location.hash = state.issues.length ? '#/home' : '#/new'; } })));
}

/* ---------- overview: a bento of the case ---------- */

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

/** The landlord's clock for one problem: a big count and one cell per working day. */
function clockTile(s, t, { cls = '', link = true } = {}) {
  const c = core.caseClock(s, t);
  const { issue } = s;
  const head = h('div', { class: 'clock-head' },
    h('div', {}, h('span', { class: 'kicker' }, `${issue.room || 'Home'} · ${core.KINDS[issue.kind].label}`),
      h('h2', {}, link ? h('a', { href: `#/issue/${issue.id}` }, issue.title) : issue.title)),
    issueBadge(s));
  if (c.mode !== 'days') {
    const [title, text, action] = {
      'not-started': ['The clock has not started', 'Your landlord\'s deadlines start the day after they are told. Report it in writing.', btn('Write the report', { icon: 'mail', kind: 'primary', href: `#/letters/${issue.id}?kind=report` })],
      fixed: ['Fixed', `Closed on ${fmtDate(issue.closedAt)}. The record stays here as evidence.`, null],
      waiting: ['Waiting on the landlord', 'Every deadline so far has been met.', null],
      'no-deadlines': ['No legal deadlines yet', 'Private landlords are not covered by Awaab\'s Law yet. Keep the record going.', btn('Your rights', { icon: 'scale', href: '#/rights' })],
      long: [c.step?.title ?? '', c.step ? `${c.overdue ? 'Was due' : 'Due by'} ${fmtTime(c.due, { weekday: true })}` : '', null],
    }[c.mode];
    return h('section', { class: `tile clock ${cls} ${c.overdue ? 'late' : ''}`.trim() }, link && head,
      h('div', { class: 'clock-empty' }, h('strong', {}, title), h('span', { class: 'muted' }, text), action && h('div', { class: 'actions' }, action)));
  }
  const late = c.overdueBy > 0;
  const cells = c.days.map((d) => h('span', { class: `cell ${d.state}${d.due ? ' due' : ''}${d.today ? ' today' : ''}`, title: `${fmtDate(d.date, { weekday: true })}${d.due ? ' · deadline' : ''}` }));
  const what = c.step.title.charAt(0).toLowerCase() + c.step.title.slice(1);
  // On the problem page the title is already in the page header.
  return h('section', { class: `tile clock ${cls} ${late ? 'late' : ''}`.trim() },
    link && head,
    h('div', { class: 'clock-count' },
      h('div', { class: 'count' }, h('span', { class: 'count-num' }, String(c.elapsed), h('small', {}, `/${c.allowed}`)), h('span', { class: 'count-label' }, `Working days to ${what}`)),
      late
        ? h('div', { class: 'count late' }, h('span', { class: 'count-num' }, `+${c.overdueBy}`), h('span', { class: 'count-label' }, plural(c.overdueBy, 'day') + ' late'))
        : h('div', { class: 'count left' }, h('span', { class: 'count-num' }, String(c.allowed - c.elapsed)), h('span', { class: 'count-label' }, 'Days left'))),
    h('div', { class: 'strip', role: 'img', 'aria-label': `${c.elapsed} of ${c.allowed} working days used${late ? `, ${c.overdueBy} late` : ''}` }, cells),
    h('div', { class: 'strip-labels' },
      h('span', {}, `${c.truncated ? '… ' : ''}${c.step.key === 'investigation' ? 'Told' : 'Investigated'} ${fmtDate(c.start, { year: false })}`),
      h('span', { class: 'due-label' }, `Deadline ${fmtDate(c.due, { weekday: true, year: false })}`),
      h('span', {}, 'Today')),
    link && h('div', { class: 'clock-foot' },
      h('span', { class: 'muted small' }, late ? `Your landlord had to ${what} by ${fmtDate(c.due, { weekday: true })}.` : 'Keep adding dated photos while you wait.'),
      late ? btn('Chase them now', { icon: 'mail', kind: 'late', href: `#/letters/${issue.id}?kind=chase` }) : btn('Open the case', { icon: 'next', href: `#/issue/${issue.id}` })));
}

function reading(step, compact = false) {
  return h('div', { class: `reading ${step.tone}` },
    h('strong', {}, step.title),
    !compact && h('p', {}, step.text),
    btn(step.action.label, { size: 'sm', kind: compact ? '' : step.tone === 'bad' ? 'late' : 'primary', href: step.action.href }));
}

function probeTile(t) {
  const steps = nextSteps(state.home, summaries(), t);
  const alert = steps[0]?.tone === 'bad';
  return h('section', { class: 'tile probe-tile row-2' },
    h('div', { class: 'probe-hero' }, probe(84, alert ? 'alert' : 'idle'),
      h('div', {}, h('span', { class: 'kicker' }, 'Probe · reading'), h('h2', {}, steps.length ? 'Your next move' : 'All quiet'))),
    steps.length ? reading(steps[0]) : h('p', { class: 'muted' }, 'Nothing needs doing right now. Add photos as things change.'),
    steps.slice(1, 3).map((s) => reading(s, true)),
    h('button', { type: 'button', class: 'ask-pill', onclick: () => openProbe({ focus: true }) }, icon('sparkle', 18),
      h('span', {}, aiConfig.provider ? 'Ask Probe about your case…' : 'Ask Probe · connect AI to chat')));
}

function evidenceTile() {
  const recent = [...state.photos].sort((a, b) => String(b.takenAt).localeCompare(String(a.takenAt))).slice(0, 4);
  return h('section', { class: 'tile' },
    h('div', {}, h('span', { class: 'kicker' }, 'Evidence'), h('div', { class: 'big-stat' }, String(state.photos.length)),
      h('span', { class: 'muted small' }, `photos · ${plural(state.entries.length, 'entry', 'entries')}`)),
    recent.length
      ? h('div', { class: 'mosaic' }, recent.map((p) => h('img', { src: photoUrl(p), alt: '', loading: 'lazy' })))
      : h('div', { class: 'mosaic-empty' }, 'No photos yet'));
}

function caseRow(s, t) {
  const { issue, deadlines: d } = s;
  const c = core.caseClock(s, t);
  const meta = s.fixed ? `Fixed ${fmtDate(issue.closedAt)}` : d.reportedAt ? `Told ${fmtDate(d.reportedAt)} · ${plural(s.workingDaysSinceReport, 'working day')} ago` : 'Not reported yet';
  return h('li', {}, h('a', { class: 'case', href: `#/issue/${issue.id}` },
    h('div', {}, h('h3', {}, issue.title), h('span', { class: 'case-meta' }, `${issueSub(issue)} · ${meta}`)),
    issueBadge(s),
    c.mode === 'days' && h('div', { class: 'mini-strip' }, c.days.map((x) => h('span', { class: `cell ${x.state}${x.due ? ' due' : ''}` })))));
}

function viewHome() {
  if (!state.issues.length && !core.homeReady(state.home)) return viewWelcome();
  const t = today();
  const list = summaries();
  const lead = list.find((s) => !s.fixed) ?? list[0];
  const first = state.home.tenantName.split(' ')[0];
  return h('div', { class: 'page' },
    state.home.sample && notice('info', 'info', h('strong', {}, 'This is an example case. '), 'Look around, then clear it in ', h('a', { href: '#/settings?section=erase' }, 'Settings'), ' to start your own record.'),
    h('header', { class: 'greeting' },
      h('div', {}, h('span', { class: 'kicker' }, state.home.address || 'Your home'), h('h1', {}, `${greeting()}${first ? `, ${first}` : ''}.`)),
      h('div', { class: 'actions' },
        btn('Add evidence', { icon: 'camera', kind: 'primary', onclick: openQuickSheet }),
        btn('New problem', { icon: 'plus', href: '#/new' }))),
    lead
      ? h('div', { class: 'bento' },
        clockTile(lead, t, { cls: 'span-3' }),
        probeTile(t),
        h('section', { class: 'tile span-2' },
          h('div', { class: 'card-head' }, h('div', {}, h('span', { class: 'kicker' }, 'Case files'), h('h2', {}, plural(list.length, 'problem')))),
          h('ul', { class: 'cases' }, list.map((s) => caseRow(s, t)))),
        evidenceTile())
      : h('div', { class: 'bento' },
        h('section', { class: 'tile span-3' }, emptyState('droplet', 'No problems logged yet', 'Log the first problem with a photo. The clock starts when you tell your landlord.', btn('Log a new problem', { icon: 'plus', kind: 'primary', href: '#/new' }))),
        probeTile(t)),
    state.home.landlordType !== 'social' && notice('', 'info', h('strong', {}, 'Private renting: '),
      'Awaab\'s Law deadlines do not apply to private landlords yet, so DampLog tracks the steps without legal due dates. ',
      h('a', { href: '#/rights' }, 'What you can do')),
    scopeNote());
}

/* ---------- new problem ---------- */

function photoPicker(chosen, onChange) {
  const grid = h('div', { class: 'thumbs picker' });
  const paint = () => {
    grid.replaceChildren(...chosen.map((c, i) => h('div', { class: 'thumb' },
      h('img', { src: c.url, alt: `Photo ${i + 1}` }),
      h('button', { type: 'button', class: 'thumb-remove', 'aria-label': `Remove photo ${i + 1}`, onclick: () => { URL.revokeObjectURL(c.url); chosen.splice(i, 1); paint(); onChange?.(); } }, icon('close', 14)))));
  };
  const add = (files) => act(async () => {
    for (const file of files) {
      const p = await preparePhoto(file);
      chosen.push({ ...p, url: URL.createObjectURL(p.blob) });
    }
    paint();
    onChange?.();
  });
  const camera = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: (e) => { add([...e.target.files]); e.target.value = ''; } });
  const library = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: (e) => { add([...e.target.files]); e.target.value = ''; } });
  paint();
  return h('div', { class: 'photo-picker' },
    h('div', { class: 'actions' },
      btn('Take a photo', { icon: 'camera', onclick: () => camera.click() }),
      btn('Choose photos', { icon: 'image', kind: 'ghost', onclick: () => library.click() }),
      camera, library),
    grid);
}

/** Saves chosen photos with their entry in one transaction. */
function photoRecords(chosen, issueId) {
  return chosen.map((c) => ({
    id: newId(), issueId, blob: c.blob, width: c.width, height: c.height,
    takenAt: c.lastModified ? core.nowLocal(new Date(c.lastModified)) : core.nowLocal(),
  }));
}

function viewNew() {
  if (!core.homeReady(state.home)) {
    location.replace('#/setup');
    return h('div');
  }
  const chosen = [];
  const reportedFields = h('div', { class: 'reported-fields', hidden: true },
    h('div', { class: 'row' },
      field('When did you tell them?', h('input', { type: 'datetime-local', name: 'reportedAt', value: core.nowLocal(), max: core.nowLocal() })),
      field('How?', select('method', Object.fromEntries(core.METHODS.map((m) => [m, m])), 'Phone'))),
    field('Reference number', h('input', { name: 'reference', placeholder: 'If they gave you one' })));
  const emergencyHint = notice('bad', 'alert', h('strong', {}, 'If anyone is in immediate danger, call 999. '),
    'If you smell gas, call the National Gas Emergency Service on 0800 111 999. Then call your landlord\'s emergency repairs line.');
  emergencyHint.hidden = true;

  const kindChoice = h('div', { class: 'choice-grid', role: 'radiogroup' }, Object.entries(core.KINDS).map(([value, k], i) => h('label', { class: 'choice' },
    h('input', { type: 'radio', name: 'kind', value, checked: i === 0, onchange: () => { emergencyHint.hidden = value !== 'emergency'; } }),
    h('span', {}, h('strong', {}, k.label), h('small', {}, {
      'damp-mould': 'Black spots, damp patches, condensation, musty smell',
      leak: 'Water coming through a ceiling, wall, roof or pipe',
      emergency: 'An immediate risk to someone\'s health or safety',
      other: 'Anything else your landlord should repair',
    }[value])))));

  const form = h('form', { class: 'form' },
    group('What is the problem?', kindChoice),
    emergencyHint,
    h('div', { class: 'row' },
      field('Where is it?', select('room', Object.fromEntries(core.ROOMS.map((r) => [r, r])), 'Bedroom')),
      field('When did you first notice it?', h('input', { type: 'date', name: 'firstNoticed', max: today().date }))),
    field('Describe it', h('textarea', { name: 'description', rows: 4, placeholder: 'Where exactly is it, how big is it, is it spreading? What do you think is causing it?' })),
    group('Photos', photoPicker(chosen), 'Take photos from a distance and close up. They are dated and kept on this device.'),
    group('Have you told your landlord yet?', h('div', { class: 'choice-row' },
      h('label', { class: 'choice compact' }, h('input', { type: 'radio', name: 'told', value: 'no', checked: true, onchange: () => { reportedFields.hidden = true; } }), h('span', {}, 'Not yet')),
      h('label', { class: 'choice compact' }, h('input', { type: 'radio', name: 'told', value: 'yes', onchange: () => { reportedFields.hidden = false; } }), h('span', {}, 'Yes, I have told them')))),
    reportedFields,
    h('div', { class: 'actions' }, btn('Save problem', { icon: 'check', kind: 'primary', type: 'submit' }), btn('Cancel', { kind: 'ghost', href: '#/home' })));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    act(async () => {
      const data = Object.fromEntries(new FormData(form));
      const c = ctx();
      const issue = core.cleanIssue(data, c);
      const photos = photoRecords(chosen, issue.id);
      const entries = [];
      // Photos taken when the problem is logged start the timeline, dated by the earliest photo.
      if (photos.length) {
        const takenFirst = photos.map((p) => p.takenAt).sort()[0];
        entries.push(core.cleanEntry({ issueId: issue.id, type: 'observation', at: takenFirst < c.now ? takenFirst : c.now, text: 'Photos taken when the problem was logged.', photoIds: photos.map((p) => p.id) }, c));
      }
      if (data.told === 'yes') {
        entries.push(core.cleanEntry({ issueId: issue.id, type: 'reported', at: data.reportedAt, method: data.method, reference: data.reference }, c));
      }
      await commit({ issues: [issue], entries, photos });
      chosen.forEach((x) => URL.revokeObjectURL(x.url));
      toast('Problem saved.');
      location.hash = `#/issue/${issue.id}`;
    });
  });

  return h('div', { class: 'page narrow' },
    backLink('#/home', 'Overview'),
    pageHead('Log a new problem', 'Start the record now. You can add photos, calls and visits as things happen.'),
    card('', form));
}

/* ---------- one problem ---------- */

function viewIssue(id) {
  const issue = findIssue(id);
  if (!issue) return notFound();
  const t = today();
  const s = summaryOf(issue);
  const d = s.deadlines;

  const addSheet = () => openSheet('Add to the record', (close) => h('div', { class: 'sheet-options' },
    Object.entries(core.ENTRY_TYPES).map(([type, e]) => sheetOption(`#/add/${issue.id}?type=${type}`, e.icon, e.label, null)(close))));

  const reopen = () => act(async () => {
    await commit({ issues: [{ ...issue, closedAt: null }] });
    toast('Problem reopened.');
    render();
  });

  const deleteIssue = () => act(async () => {
    if (!confirm(`Delete "${issue.title}" and everything in its record, including ${plural(s.photos, 'photo')}? This cannot be undone.`)) return;
    const photoIds = state.photos.filter((p) => p.issueId === issue.id).map((p) => p.id);
    await commit({}, { issues: [issue.id], entries: s.entries.map((e) => e.id), photos: photoIds });
    forgetPhotos(photoIds);
    toast('Problem deleted.');
    location.hash = '#/home';
  });

  return h('div', { class: 'page' },
    backLink('#/home', 'Overview'),
    pageHead(issue.title, `${issueSub(issue)}${issue.firstNoticed ? ` · first noticed ${fmtDate(issue.firstNoticed)}` : ''}`, [
      btn('Add to the record', { icon: 'plus', kind: 'primary', onclick: addSheet }),
      btn('Letters', { icon: 'mail', href: `#/letters/${issue.id}` }),
      btn('Evidence report', { icon: 'report', href: `#/report/${issue.id}` }),
    ]),
    h('div', { class: 'badges spaced' }, issueBadge(s), d.reportedAt && badge('', `Reported ${fmtDate(d.reportedAt)}`), s.photos > 0 && badge('', plural(s.photos, 'photo'))),
    d.reportedAt && !s.fixed && clockTile(s, t, { link: false }),
    !d.reportedAt && !s.fixed && notice('warn', 'alert',
      h('strong', {}, 'Your landlord has not been told yet, as far as this record shows. '),
      'The deadlines only start once they know. Report it in writing if you can, so there is proof.',
      h('div', { class: 'actions inline' },
        btn('Write the report', { icon: 'mail', size: 'sm', kind: 'primary', href: `#/letters/${issue.id}?kind=report` }),
        btn('I have reported it', { icon: 'check', size: 'sm', href: `#/add/${issue.id}?type=reported` }))),
    h('div', { class: 'grid-2 wide-left' },
      timelineCard(issue, s),
      h('div', { class: 'stack' },
        deadlinesCard(issue, s, t),
        card('',
          cardHead('About this problem', { iconName: 'info' }),
          issue.description ? h('p', { class: 'prewrap' }, issue.description) : h('p', { class: 'muted' }, 'No description yet.'),
          state.home.household && h('p', { class: 'muted small' }, h('strong', {}, 'Household: '), state.home.household),
          h('div', { class: 'actions' },
            s.fixed ? btn('Reopen', { icon: 'refresh', size: 'sm', onclick: reopen }) : btn('Mark as fixed', { icon: 'check', size: 'sm', href: `#/add/${issue.id}?type=fixed` }),
            btn('Delete', { icon: 'trash', size: 'sm', kind: 'ghost', onclick: deleteIssue }))))));
}

function deadlinesCard(issue, s, t) {
  const d = s.deadlines;
  const sub = d.statutory
    ? issue.kind === 'emergency' ? 'Awaab\'s Law · emergency hazard' : 'Awaab\'s Law · social housing in England'
    : 'No legal deadlines for this landlord type yet';
  let body;
  if (!d.reportedAt) {
    body = h('p', { class: 'muted' }, 'Deadlines appear here once you record that you reported the problem.');
  } else {
    body = h('ol', { class: 'steps' }, d.steps.map((step) => {
      const [tone, label] = STEP_TONE[step.status];
      const canRecord = ['pending', 'overdue', 'open'].includes(step.status) && !s.fixed;
      return h('li', { class: `step ${step.status}` },
        h('span', { class: `step-dot ${tone}` }, icon(step.status === 'met' || step.status === 'not-needed' ? 'check' : step.status === 'overdue' ? 'alert' : 'clock', 14)),
        h('div', { class: 'step-text' },
          h('div', { class: 'step-title' }, h('strong', {}, step.title), badge(tone, label)),
          h('span', { class: 'muted small' }, stepDetail(step, t)),
          step.rule && step.status !== 'not-needed' && h('span', { class: 'step-rule' }, step.rule),
          canRecord && STEP_ENTRY[step.key] && h('a', { class: 'step-link', href: `#/add/${issue.id}?type=${STEP_ENTRY[step.key]}` }, 'Record that this happened')));
    }));
  }
  return card('deadlines-card',
    cardHead('Landlord deadlines', { iconName: 'clock', sub }),
    d.reportedAt && h('p', { class: 'small' }, `Told ${fmtTime(d.reportedAt)} · ${plural(s.workingDaysSinceReport, 'working day')} ago`),
    body,
    d.overdue.length > 0 && btn('Chase your landlord', { icon: 'mail', kind: 'primary', href: `#/letters/${issue.id}?kind=chase` }));
}

function timelineCard(issue, s) {
  const items = [...s.entries].reverse();
  return card('timeline-card',
    cardHead('Timeline', { iconName: 'list', sub: 'Everything on the record, newest first' }),
    items.length
      ? h('ol', { class: 'timeline' }, items.map((e) => {
        const type = core.ENTRY_TYPES[e.type];
        const meta = [e.method, e.reference && `Ref ${e.reference}`, e.outcome === 'no-hazard' && 'No significant hazard found', e.outcome === 'hazard' && 'Hazard found'].filter(Boolean).join(' · ');
        return h('li', { class: `tl-item tl-${e.type}` },
          h('span', { class: 'tl-dot' }, icon(type.icon, 14)),
          h('div', { class: 'tl-body' },
            h('div', { class: 'tl-head' },
              h('strong', {}, type.label),
              h('time', { datetime: e.at }, fmtTime(e.at, { weekday: true })),
              h('span', { class: 'tl-tools' },
                btn('', { icon: 'edit', size: 'sm', kind: 'ghost', title: 'Edit entry', href: `#/add/${issue.id}?entry=${e.id}` }))),
            meta && h('span', { class: 'tl-meta' }, meta),
            e.text && h('p', { class: 'prewrap' }, e.text),
            thumbs(e.photoIds, `${issue.title} · ${fmtTime(e.at)}`)));
      }))
      : emptyState('camera', 'Nothing on the record yet', 'Add a photo or a note to start the timeline.'));
}

/* ---------- add or edit an entry ---------- */

const PLACEHOLDERS = {
  observation: 'What can you see? Where is it, how big is it, has it spread?',
  reported: 'What did you tell them, and what did they say?',
  contact: 'Who did you speak to, and what was said?',
  investigation: 'Who came or called, what did they look at, and what did they say?',
  summary: 'What does the written summary say? Copy the key points and any dates.',
  'made-safe': 'What was done to make it safe?',
  works: 'What work started, and who did it?',
  missed: 'Who was meant to come, and when? Did anyone tell you they were not coming?',
  health: 'Who is affected and how? Include any GP or hospital visits.',
  complaint: 'What did you complain about? Note the complaint stage and any reference.',
  fixed: 'What was done to fix it?',
};

function viewAdd(issueId, params) {
  const issue = findIssue(issueId);
  if (!issue) return notFound();
  const editing = params.get('entry') ? state.entries.find((e) => e.id === params.get('entry')) : null;
  const t = today();
  const keptPhotos = [...(editing?.photoIds ?? [])];
  const chosen = [];
  let type = editing?.type ?? (core.ENTRY_TYPES[params.get('type')] ? params.get('type') : 'observation');
  let dateTouched = Boolean(editing);

  const typeSelect = select('type', Object.fromEntries(Object.entries(core.ENTRY_TYPES).map(([k, v]) => [k, v.label])), type);
  const at = h('input', { type: 'datetime-local', name: 'at', value: editing?.at ?? t.now, max: t.now, required: true, oninput: () => { dateTouched = true; } });
  const dateHint = h('small', { class: 'hint' }, 'When it happened, not when you are writing it down.');
  const methodField = field('How?', select('method', Object.fromEntries([['', 'Choose…'], ...core.METHODS.map((m) => [m, m])]), editing?.method ?? ''));
  const refField = field('Reference number', h('input', { name: 'reference', value: editing?.reference ?? '' }));
  const outcomeField = field('What did it say?', select('outcome', { '': 'Choose…', hazard: 'A hazard was found and work is needed', 'no-hazard': 'No significant hazard was found' }, editing?.outcome ?? ''));
  const textArea = h('textarea', { name: 'text', rows: 4 }, editing?.text ?? params.get('note') ?? '');
  const problems = h('div', { class: 'problems' });

  // AI help: describe the photos, then the tenant edits and accepts the text into the notes.
  const aiBox = h('div', { class: 'ai-slot' });
  const describe = (e) => act(async () => {
    aiReady();
    const blobs = [...keptPhotos.map(findPhoto).filter(Boolean).map((p) => p.blob), ...chosen.map((c) => c.blob)];
    if (!blobs.length) throw new Error('Add a photo first, then ask AI to describe it.');
    const button = e.currentTarget;
    button.disabled = true;
    aiBox.replaceChildren(aiPanel('Describing your photos', `${plural(Math.min(blobs.length, 4), 'photo')} sent to ${ai.PROVIDERS[aiConfig.provider].name}`, aiWorking('Looking at the photos…')));
    try {
      const images = await Promise.all(blobs.slice(0, 4).map(async (b) => ({ mediaType: b.type || 'image/jpeg', base64: await ai.blobToBase64(b) })));
      const out = h('textarea', { class: 'ai-text', rows: 4, readonly: true, 'aria-label': 'AI description' });
      aiBox.replaceChildren(aiPanel('Suggested description', 'Check every word against your photos. Change anything that is not right.', out));
      const text = await ai.stream(aiConfig, ai.describeInput({ images, kind: core.KINDS[issue.kind].label, room: issue.room, note: textArea.value }), (t) => { out.value = t; });
      out.value = text;
      out.readOnly = false;
      out.rows = Math.min(8, Math.max(4, Math.ceil(text.length / 70)));
      out.closest('.ai-review').append(h('div', { class: 'actions' },
        btn('Add to my notes', { icon: 'check', kind: 'primary', size: 'sm', onclick: () => {
          textArea.value = [textArea.value.trim(), out.value.trim()].filter(Boolean).join('\n\n');
          aiBox.replaceChildren();
          toast('Added to your notes. Read them once more before saving.');
        } }),
        btn('Discard', { kind: 'ghost', size: 'sm', onclick: () => aiBox.replaceChildren() })));
    } catch (err) {
      aiBox.replaceChildren(notice('bad', 'alert', err.message));
    } finally {
      button.disabled = false;
    }
  });
  const aiRow = aiConfig.provider
    ? h('div', { class: 'ai-row' }, btn('Describe photos with AI', { icon: 'sparkle', size: 'sm', onclick: describe }), h('small', { class: 'hint' }, 'A short, factual description for the record. You check it first.'))
    : h('small', { class: 'hint ai-row' }, 'Tip: connect ', h('a', { href: '#/settings?section=ai' }, 'AI help'), ' to have your photos described for the record.');

  const kept = h('div', { class: 'thumbs' });
  const paintKept = () => kept.replaceChildren(...keptPhotos.map(findPhoto).filter(Boolean).map((p, i) => h('div', { class: 'thumb' },
    h('img', { src: photoUrl(p), alt: `Saved photo ${i + 1}` }),
    h('button', { type: 'button', class: 'thumb-remove', 'aria-label': `Remove saved photo ${i + 1}`, onclick: () => { keptPhotos.splice(keptPhotos.indexOf(p.id), 1); paintKept(); } }, icon('close', 14)))));
  paintKept();

  const picker = photoPicker(chosen, () => {
    // A photo's own date is the best guess for when an observation was made.
    if (dateTouched || !chosen.length) return;
    const first = chosen.map((c) => c.lastModified).filter(Boolean).sort((a, b) => a - b)[0];
    if (first && first < Date.now()) {
      at.value = core.nowLocal(new Date(first));
      dateHint.textContent = 'Taken from the photo. Change it if that is not right.';
    }
  });

  const methodRow = h('div', { class: 'row' }, methodField, refField);
  const sync = () => {
    type = typeSelect.value;
    methodRow.hidden = !['reported', 'contact', 'complaint'].includes(type);
    outcomeField.hidden = type !== 'summary';
    textArea.placeholder = PLACEHOLDERS[type];
  };
  typeSelect.addEventListener('change', sync);
  sync();

  const form = h('form', { class: 'form' },
    h('div', { class: 'row' }, field('What happened?', typeSelect), h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Date and time'), at, dateHint)),
    methodRow,
    outcomeField,
    field('Notes', textArea),
    group('Photos', h('div', { class: 'stack tight' }, keptPhotos.length > 0 && kept, picker)),
    aiRow,
    aiBox,
    problems,
    h('div', { class: 'actions' },
      btn(editing ? 'Save changes' : 'Add to the record', { icon: 'check', kind: 'primary', type: 'submit' }),
      btn('Cancel', { kind: 'ghost', href: `#/issue/${issue.id}` }),
      editing && btn('Delete entry', { icon: 'trash', kind: 'ghost', onclick: () => act(async () => {
        if (!confirm('Delete this entry and its photos? This cannot be undone.')) return;
        await commit({}, { entries: [editing.id], photos: editing.photoIds });
        forgetPhotos(editing.photoIds);
        toast('Entry deleted.');
        location.hash = `#/issue/${issue.id}`;
      }) })));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    act(async () => {
      const data = Object.fromEntries(new FormData(form));
      const c = ctx();
      const photos = photoRecords(chosen, issue.id);
      const entry = core.cleanEntry({ ...data, id: editing?.id, issueId: issue.id, photoIds: [...keptPhotos, ...photos.map((p) => p.id)] }, c);
      const others = state.entries.filter((x) => x.issueId === issue.id);
      const found = core.entryProblems(entry, others, today());
      if (found.length) {
        problems.replaceChildren(notice('bad', 'alert', h('ul', {}, found.map((p) => h('li', {}, p)))));
        return;
      }
      const dropped = (editing?.photoIds ?? []).filter((id) => !keptPhotos.includes(id));
      const put = { entries: [entry], photos };
      if (entry.type === 'fixed' && !issue.closedAt) put.issues = [{ ...issue, closedAt: core.dateOf(entry.at) }];
      await commit(put, { photos: dropped });
      forgetPhotos(dropped);
      chosen.forEach((x) => URL.revokeObjectURL(x.url));
      toast(editing ? 'Entry updated.' : 'Added to the record.');
      location.hash = `#/issue/${issue.id}`;
    });
  });

  return h('div', { class: 'page narrow' },
    backLink(`#/issue/${issue.id}`, issue.title),
    pageHead(editing ? 'Edit entry' : 'Add to the record', issue.title),
    card('', form));
}

/* ---------- letters ---------- */

function pickIssue(title, sub, hrefFor) {
  const list = summaries();
  return h('div', { class: 'page narrow' },
    pageHead(title, sub),
    card('table-card', list.length
      ? h('ul', { class: 'issue-list' }, list.map((s) => h('li', {}, h('a', { class: 'issue-row', href: hrefFor(s.issue) },
        h('span', { class: 'issue-icon' }, icon(KIND_ICON[s.issue.kind], 18)),
        h('span', { class: 'issue-text' }, h('strong', {}, s.issue.title), h('span', {}, issueSub(s.issue))),
        h('span', { class: 'issue-side' }, issueBadge(s)), icon('next', 16)))))
      : h('div', { class: 'card-pad' }, emptyState('droplet', 'No problems logged yet', 'Log a problem first, then come back to write to your landlord.', btn('Log a new problem', { icon: 'plus', kind: 'primary', href: '#/new' })))));
}

function viewLetters(id, params) {
  if (!id) {
    const open = summaries().filter((s) => !s.fixed);
    if (open.length === 1) {
      location.replace(`#/letters/${open[0].issue.id}`);
      return h('div');
    }
    return pickIssue('Letters', 'Choose the problem you are writing about.', (i) => `#/letters/${i.id}`);
  }
  const issue = findIssue(id);
  if (!issue) return notFound();
  const s = summaryOf(issue);
  const suggested = s.deadlines.reportedAt ? 'chase' : 'report';
  const kind = LETTERS[params.get('kind')] ? params.get('kind') : suggested;
  const letter = buildLetter(kind, { home: state.home, summary: s, today: today().date });
  const subject = h('input', { value: letter.subject, 'aria-label': 'Subject' });
  const body = h('textarea', { class: 'letter-body', rows: 22, 'aria-label': 'Letter' }, letter.body);
  const whole = () => `${subject.value}\n\n${body.value}`;
  const logType = kind === 'report' ? 'reported' : kind === 'complaint' ? 'complaint' : 'contact';

  const copy = () => act(async () => {
    await navigator.clipboard.writeText(whole());
    toast('Letter copied. Paste it into an email or your landlord\'s online form.');
  });
  // Built on click, so edits to the letter go into the email.
  const email = state.home.landlordEmail && (() => {
    location.href = `mailto:${encodeURIComponent(state.home.landlordEmail)}?subject=${encodeURIComponent(subject.value)}&body=${encodeURIComponent(body.value)}`;
  });

  // AI help: a tighter version, shown word by word against the original and checked
  // in code for dropped or invented dates, references, names and legal claims.
  const aiBox = h('div', { class: 'ai-slot' });
  const tighten = (e) => act(async () => {
    aiReady();
    const original = body.value;
    const button = e.currentTarget;
    button.disabled = true;
    const out = h('div', { class: 'ai-diff' });
    aiBox.replaceChildren(aiPanel('Tightening your letter', `Sent to ${ai.PROVIDERS[aiConfig.provider].name}`, aiWorking('Rewriting…'), out));
    try {
      const revised = await ai.stream(aiConfig, ai.tightenInput(original), (t) => { out.textContent = t; });
      const keep = [state.home.tenantName, state.home.address, state.home.landlordName, state.home.tenancyRef].filter(Boolean);
      const check = ai.checkLetter(original, revised, keep);
      out.replaceChildren(...ai.diffWords(original, revised).map((d) => (d.type === 'same' ? d.text : h(d.type === 'add' ? 'ins' : 'del', {}, d.text))));
      const problemsFound = [
        ...check.missing.map((f) => `Left out: ${f}`),
        ...check.added.map((f) => `Added: ${f}`),
        ...check.claims.map((w) => `New legal wording: "${w}"`),
      ];
      const use = () => {
        body.value = revised;
        aiBox.replaceChildren();
        toast('Letter updated. Read it once more before you send it.');
      };
      aiBox.replaceChildren(aiPanel('Suggested changes', 'Green is added, red is removed. Check every change before you use it.',
        check.ok
          ? notice('ok', 'check', 'Every date, reference and name in your letter is still there, and nothing new was added.')
          : notice('bad', 'alert', h('strong', {}, 'Check these before using this version:'), h('ul', {}, problemsFound.map((p) => h('li', {}, p)))),
        out,
        h('div', { class: 'actions' },
          btn(check.ok ? 'Use this version' : 'Use it anyway', { icon: 'check', kind: check.ok ? 'primary' : '', size: 'sm', onclick: use }),
          btn('Keep my version', { kind: check.ok ? 'ghost' : 'primary', size: 'sm', onclick: () => aiBox.replaceChildren() }))));
    } catch (err) {
      aiBox.replaceChildren(notice('bad', 'alert', err.message));
    } finally {
      button.disabled = false;
    }
  });
  const printLetter = () => {
    const sheet = h('div', { class: 'print-letter' }, h('pre', {}, body.value));
    document.body.append(sheet);
    document.body.classList.add('printing-letter');
    window.print();
    document.body.classList.remove('printing-letter');
    sheet.remove();
  };

  return h('div', { class: 'page' },
    backLink(`#/issue/${issue.id}`, issue.title),
    pageHead('Letters', `${issue.title} · to ${state.home.landlordName || 'your landlord'}`),
    !core.homeReady(state.home) && notice('warn', 'alert', 'Add your address and landlord in ', h('a', { href: '#/settings' }, 'Settings'), ' so the letter is complete.'),
    h('div', { class: 'letter-kinds', role: 'tablist' }, Object.entries(LETTERS).map(([k, l]) => h('a', {
      class: 'letter-kind', role: 'tab', href: `#/letters/${issue.id}?kind=${k}`, 'aria-selected': String(k === kind),
    }, h('strong', {}, l.title), h('small', {}, l.sub)))),
    h('div', { class: 'grid-2 wide-left' },
      card('letter-card',
        field('Subject', subject),
        field('Letter', body, 'Edit anything that is not right before you send it.'),
        h('div', { class: 'actions' },
          email && btn('Open in email', { icon: 'mail', kind: 'primary', onclick: email }),
          btn('Copy', { icon: 'copy', kind: email ? '' : 'primary', onclick: copy }),
          btn('Download', { icon: 'download', onclick: () => download(`damplog-${kind}-${today().date}.txt`, whole(), 'text/plain') }),
          btn('Print', { icon: 'print', onclick: printLetter }),
          aiConfig.provider && btn('Tighten with AI', { icon: 'sparkle', kind: 'ghost', onclick: tighten })),
        !aiConfig.provider && h('small', { class: 'hint' }, 'Tip: connect ', h('a', { href: '#/settings?section=ai' }, 'AI help'), ' to make your letter clearer, with every change shown for you to check.'),
        aiBox),
      h('div', { class: 'stack' },
        card('',
          cardHead('After you send it', { iconName: 'check' }),
          h('p', { class: 'muted' }, 'Add it to the record with the date, how you sent it and any reference. That is your proof the landlord was told.'),
          btn('Log that I sent this', { icon: 'plus', href: `#/add/${issue.id}?type=${logType}&note=${encodeURIComponent(`Sent: ${subject.value}`)}` })),
        card('',
          cardHead('Tips', { iconName: 'info' }),
          h('ul', { class: 'tips' },
            h('li', {}, 'Email or the landlord\'s online form leaves a dated record. If you phone, follow up in writing.'),
            h('li', {}, 'Attach your photos, or offer to send them.'),
            h('li', {}, 'Keep it factual. Dates, what you saw, who it affects.'),
            kind === 'complaint' && h('li', {}, 'Ask for the complaint reference, and note it in your record.'))),
        notice('', 'info', 'This is a template, not legal advice. For advice, contact Citizens Advice, Shelter or a housing solicitor.'))));
}

/* ---------- evidence report ---------- */

function viewReport(id) {
  if (!id) return pickIssue('Evidence report', 'Choose the problem for the report.', (i) => `#/report/${i.id}`);
  const issue = findIssue(id);
  if (!issue) return notFound();
  const t = today();
  const s = summaryOf(issue);
  const d = s.deadlines;
  const home = state.home;
  const reported = s.entries.find((e) => e.type === 'reported');
  const allPhotos = s.entries.flatMap((e) => e.photoIds.map((pid) => ({ entry: e, photo: findPhoto(pid) }))).filter((x) => x.photo);
  const photoNumber = new Map(allPhotos.map((x, i) => [x.photo.id, i + 1]));
  const row = (k, v) => v && h('tr', {}, h('th', { scope: 'row' }, k), h('td', {}, v));

  return h('div', { class: 'page report' },
    h('div', { class: 'report-tools' },
      backLink(`#/issue/${issue.id}`, issue.title),
      h('div', { class: 'actions' }, btn('Print or save as PDF', { icon: 'print', kind: 'primary', onclick: () => window.print() }))),
    h('article', { class: 'report-sheet' },
      h('header', { class: 'report-head' },
        h('div', {}, h('span', { class: 'report-eyebrow' }, 'Evidence report'), h('h1', {}, issue.title), h('p', { class: 'muted' }, `Prepared by ${home.tenantName || 'the tenant'} on ${fmtDate(t.date)}`)),
        h('div', { class: 'report-brand' }, h('img', { src: 'icons/icon.svg', alt: '', width: 28, height: 28 }), h('span', {}, 'DampLog'))),
      h('section', {},
        h('h2', {}, 'Summary'),
        h('table', { class: 'kv' }, h('tbody', {},
          row('Address', home.address),
          row('Tenant', home.tenantName),
          row('Landlord', [home.landlordName, home.landlordType !== 'unknown' && `(${core.LANDLORD_TYPES[home.landlordType].toLowerCase()})`].filter(Boolean).join(' ')),
          row('Tenancy reference', home.tenancyRef),
          row('Problem', issueSub(issue)),
          row('First noticed', issue.firstNoticed && fmtDate(issue.firstNoticed)),
          row('Reported to landlord', reported && `${fmtTime(reported.at)}${reported.method ? ` by ${reported.method.toLowerCase()}` : ''}${reported.reference ? `, reference ${reported.reference}` : ''}`),
          row('Working days since report', d.reportedAt && String(s.workingDaysSinceReport)),
          row('Status', s.fixed ? 'Fixed' : d.overdue.length ? `Open. ${plural(d.overdue.length, 'deadline')} missed` : 'Open'),
          row('Household', home.household)))),
      issue.description && h('section', {}, h('h2', {}, 'Description'), h('p', { class: 'prewrap' }, issue.description)),
      d.steps.length > 0 && h('section', {},
        h('h2', {}, d.statutory ? 'Deadlines under Awaab\'s Law' : 'Landlord\'s progress'),
        h('table', { class: 'grid' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Step'), h('th', {}, 'Rule'), h('th', {}, 'Due by'), h('th', {}, 'Happened'), h('th', {}, 'Status'))),
          h('tbody', {}, d.steps.map((step) => h('tr', { class: step.status },
            h('td', {}, step.title),
            h('td', {}, step.rule ?? '—'),
            h('td', {}, step.dueAt ? fmtTime(step.dueAt) : step.due ? fmtDate(step.due) : '—'),
            h('td', {}, step.doneAt ? fmtTime(step.doneAt) : '—'),
            h('td', {}, STEP_TONE[step.status][1])))))),
      h('section', {},
        h('h2', {}, 'Timeline'),
        h('table', { class: 'grid timeline-table' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th', {}, 'What happened'), h('th', {}, 'Details'))),
          h('tbody', {}, s.entries.map((e) => h('tr', {},
            h('td', { class: 'nowrap' }, fmtTime(e.at)),
            h('td', {}, core.ENTRY_TYPES[e.type].label),
            h('td', {},
              [e.method, e.reference && `Ref ${e.reference}`, e.outcome === 'no-hazard' && 'No significant hazard found', e.outcome === 'hazard' && 'Hazard found'].filter(Boolean).join(' · '),
              e.text && h('div', { class: 'prewrap' }, e.text),
              e.photoIds.length > 0 && h('div', { class: 'muted small' }, `See photo ${e.photoIds.map((pid) => photoNumber.get(pid)).filter(Boolean).join(', ')}`))))))),
      allPhotos.length > 0 && h('section', { class: 'report-photos' },
        h('h2', {}, 'Photos'),
        h('div', { class: 'photo-grid' }, allPhotos.map(({ entry, photo }, i) => h('figure', {},
          h('img', { src: photoUrl(photo), alt: `Photo ${i + 1}` }),
          h('figcaption', {}, h('strong', {}, `Photo ${i + 1}. `), `${fmtTime(photo.takenAt)} · ${core.ENTRY_TYPES[entry.type].short}${issue.room ? ` · ${issue.room}` : ''}`))))),
      h('footer', { class: 'report-foot' },
        `Generated by DampLog on ${fmtDate(t.date)}. Entries and photo dates were recorded by the tenant. Deadlines are counted in working days (excluding weekends and bank holidays in England and Wales) from the day after the landlord was told, following the Hazards in Social Housing (Prescribed Requirements) (England) Regulations 2025.`)));
}

/* ---------- Probe: the case assistant ---------- */

// Probe lives in a panel that slides in over any screen. Its readings come from
// the record with no AI; with an AI key it also answers questions, and each
// answer can carry buttons that open the right screen.
let probePanel = null;

function openProbe({ focus = false, ask } = {}) {
  if (!probePanel) {
    probePanel = h('dialog', { class: 'probe-panel', 'aria-label': 'Probe, your case assistant', tabindex: '-1' });
    probePanel.addEventListener('click', (e) => { if (e.target === probePanel) probePanel.close(); });
    document.body.append(probePanel);
  }
  paintProbe();
  if (!probePanel.open) {
    probePanel.showModal();
    // Start focus on the panel itself, not on its first button.
    probePanel.focus({ preventScroll: true });
  }
  if (ask) askProbe(ask);
  else if (focus) probePanel.querySelector('textarea:not([disabled])')?.focus();
}

function goFromProbe(href) {
  probePanel?.close();
  location.hash = href;
}

function fillReply(m) {
  if (!m.el) return;
  const { text, actions } = splitActions(m.content);
  const urgent = summaries().find((s) => !s.fixed) ?? summaries()[0];
  if (m.error) m.el.replaceChildren(notice('bad', 'alert', m.error));
  else if (!text) m.el.replaceChildren(h('span', { class: 'typing', 'aria-label': 'Probe is taking a reading' }, h('i'), h('i'), h('i')));
  else {
    m.el.replaceChildren(...[renderMarkdown(text),
      !m.pending && urgent && actions.length > 0 && h('div', { class: 'msg-actions' },
        actions.map((id) => btn(ACTION_IDS[id].label, { size: 'sm', icon: 'next', onclick: () => goFromProbe(ACTION_IDS[id].path(urgent.issue.id)) })))].filter(Boolean));
  }
  const mood = m.pending ? (text ? 'talking' : 'thinking') : 'idle';
  setProbeMood(m.face, mood);
  if (m.pending) setProbeMood(chat.face, mood);
}

function bubble(m) {
  if (m.role === 'user') return h('div', { class: 'msg user' }, m.content);
  m.face = probe(36);
  m.el = h('div', { class: 'msg-body' });
  fillReply(m);
  return h('div', { class: 'msg ai' }, m.face, m.el);
}

const MAX_QUESTION = 1500;

// The panel has two states: a "lab" with Probe on a holographic stage and big
// action cards, and, once a conversation starts, the thread with Probe docked
// in the header. The case bar and composer stay the same in both.
function paintProbe() {
  if (!probePanel) return;
  const t = today();
  const list = summaries();
  const steps = nextSteps(state.home, list, t);
  const lead = list.find((s) => !s.fixed) ?? list[0];
  const late = lead?.deadlines.overdue[0];
  const lateDays = late && !late.dueAt ? core.workingDaysBetween(late.due, t.date) : 0;
  const mood = chat.busy ? 'thinking' : late ? 'alert' : 'idle';
  const talking = chat.messages.length > 0;
  chat.face = probe(talking ? 40 : 172, mood);
  probePanel.classList.toggle('calm', Boolean(chat.calm));

  const status = chat.busy ? 'Taking a reading…'
    : !aiConfig.provider ? 'Readings only · connect AI to chat'
      : late ? `Record loaded · ${plural(lead.deadlines.overdue.length, 'deadline')} missed` : 'Record loaded · Ready to help';
  const head = h('header', { class: 'pp-head' },
    h('span', { class: 'pp-avatar' }, talking ? chat.face : probe(34, mood)),
    h('div', { class: 'pp-title' },
      h('span', { class: 'kicker' }, 'DampLog / Probe'),
      h('h2', {}, 'Case assistant'),
      h('span', { class: `pp-status ${late ? 'bad' : ''}` }, h('i'), status)),
    h('div', { class: 'pp-tools' },
      talking && !chat.busy && btn('', { icon: 'refresh', title: 'New chat', onclick: () => { chat.messages = []; paintProbe(); } }),
      btn('', { icon: chat.calm ? 'play' : 'pause', title: chat.calm ? 'Play animations' : 'Pause animations', onclick: () => { chat.calm = !chat.calm; paintProbe(); } }),
      btn('', { icon: 'close', title: 'Close', onclick: () => probePanel.close() })));

  const context = lead && h('div', { class: 'pp-context' },
    icon('file', 18),
    h('div', {}, h('span', { class: 'kicker' }, 'Case file'), h('strong', {}, lead.issue.title, h('span', {}, ` · ${state.home.address || 'your home'}`))),
    h('span', { class: `pp-pill ${late ? 'bad' : ''}` }, late ? (lateDays ? `${lateDays} days late` : 'Late') : plural(list.length, 'problem')));

  let body;
  if (talking) {
    body = h('div', { class: 'thread', 'aria-live': 'polite' }, chat.messages.map(bubble));
  } else {
    const cards = [];
    if (steps[0]) cards.push({ icon: steps[0].tone === 'bad' ? 'alert' : 'next', tone: steps[0].tone, title: steps[0].action.label, sub: steps[0].title, run: () => goFromProbe(steps[0].action.href) });
    if (aiConfig.provider) {
      cards.push(
        { icon: 'list', title: 'Plan my next steps', sub: 'Start with what matters most', run: () => askProbe(SUGGESTIONS[0]) },
        { icon: 'clock', title: 'Explain my deadlines', sub: 'In plain English, from your record', run: () => askProbe(SUGGESTIONS[2]) },
        { icon: 'flag', title: 'Prepare a complaint', sub: 'What to include, with your dates', run: () => askProbe(SUGGESTIONS[3]) });
    } else {
      cards.push({ icon: 'sparkle', title: 'Connect AI help', sub: 'Ask Probe your own questions', run: () => goFromProbe('#/settings?section=ai') });
    }
    body = h('div', { class: 'pp-lab' },
      h('div', { class: `pp-stage ${late ? 'alert' : ''}` },
        h('span', { class: 'pp-orbit o1' }), h('span', { class: 'pp-orbit o2' }), h('span', { class: 'pp-orbit o3' }),
        h('span', { class: 'pp-spark s1' }), h('span', { class: 'pp-spark s2' }), h('span', { class: 'pp-spark s3' }),
        chat.face,
        h('span', { class: 'pp-tag' }, 'PB-01'),
        h('span', { class: 'pp-meter' }, h('span', { class: 'pp-bars' }, h('i'), h('i'), h('i'), h('i'), h('i')), late ? `+${lateDays || '!'}D` : 'OK')),
      h('div', { class: 'pp-intro' },
        h('span', { class: 'kicker' }, 'Your case assistant'),
        h('h3', {}, late ? 'Let\'s get them moving.' : steps.length ? 'Let\'s keep your case on track.' : 'All quiet on your case.'),
        h('p', {}, steps[0]?.text ?? 'Ask me anything about your record. I know your dates and the deadlines.'),
        h('div', { class: 'pp-chips' },
          h('span', {}, icon('clock', 14), 'Knows your deadlines'),
          h('span', {}, icon('shield', 14), 'Never sees your photos'))),
      h('div', { class: 'pp-cards' }, cards.map((c) => h('button', { type: 'button', class: `pp-card ${c.tone ?? ''}`, onclick: c.run },
        h('span', { class: 'pp-card-icon' }, icon(c.icon, 18)),
        h('span', { class: 'pp-card-text' }, h('strong', {}, c.title), h('small', {}, c.sub)),
        icon('arrowUpRight', 16)))));
  }

  const input = h('textarea', {
    rows: 2, maxlength: MAX_QUESTION, disabled: !aiConfig.provider, 'aria-label': 'Your question',
    placeholder: !aiConfig.provider ? 'Connect AI help to ask your own questions' : late ? 'What should I do about the late investigation?' : 'What should I do next?',
  });
  const count = h('span', { class: 'pp-count' }, `0 / ${MAX_QUESTION.toLocaleString('en-GB')}`);
  input.addEventListener('input', () => {
    count.textContent = `${input.value.length} / ${MAX_QUESTION.toLocaleString('en-GB')}`;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  });
  const form = h('form', { class: 'pp-composer' }, input,
    h('div', { class: 'pp-composer-foot' },
      h('span', { class: `pp-model ${aiConfig.provider ? 'on' : ''}` }, h('i'), aiConfig.provider ? aiConfig.model : 'AI off'),
      count,
      chat.busy
        ? btn('', { icon: 'stop', title: 'Stop', onclick: () => chat.controller?.abort() })
        : btn('', { icon: 'send', kind: 'primary', title: 'Send', type: 'submit', disabled: !aiConfig.provider })));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const question = input.value;
    input.value = '';
    askProbe(question);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  probePanel.replaceChildren(...[
    head,
    context,
    h('div', { class: 'panel-body' }, body),
    h('div', { class: 'panel-foot' }, form,
      h('div', { class: 'pp-hints' }, h('span', {}, 'Enter to send · Shift + Enter for a new line'), h('span', {}, 'AI answers · Check before you act')),
      h('p', { class: 'fineprint' }, aiConfig.provider
        ? `Your question and case record go to ${ai.PROVIDERS[aiConfig.provider].name} only when you send a message. Never your photos.`
        : 'Probe\'s readings are worked out on this device. Nothing is sent anywhere.')),
  ].filter(Boolean));
  const scroller = probePanel.querySelector('.panel-body');
  if (talking) requestAnimationFrame(() => { scroller.scrollTop = scroller.scrollHeight; });
}

async function askProbe(text) {
  const question = text.trim();
  if (!question || chat.busy) return;
  try {
    aiReady();
  } catch (err) {
    toast(err.message, 'bad');
    return;
  }
  const history = chat.messages.filter((m) => !m.error).map(({ role, content }) => ({ role, content }));
  chat.messages.push({ role: 'user', content: question });
  const reply = { role: 'assistant', content: '', pending: true };
  chat.messages.push(reply);
  chat.busy = true;
  chat.controller = new AbortController();
  paintProbe();
  try {
    // The record is read fresh for every question, so answers follow new entries.
    const system = assistantSystem(recordContext(state.home, summaries(), today()));
    await ai.stream(aiConfig, { system, messages: [...history, { role: 'user', content: question }] }, (t) => {
      reply.content = t;
      fillReply(reply);
    }, { signal: chat.controller.signal });
  } catch (err) {
    if (err?.name === 'AbortError') reply.content ||= 'Stopped.';
    else reply.error = err.message;
  } finally {
    reply.pending = false;
    chat.busy = false;
    chat.controller = null;
    paintProbe();
  }
}

/* ---------- your rights ---------- */

function viewRights() {
  const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener' }, text);
  return h('div', { class: 'page narrow' },
    pageHead('Your rights', 'A plain-English summary of Awaab\'s Law and what to do if your landlord does not act.'),
    notice('bad', 'alert', h('strong', {}, 'In an emergency, call 999. '), 'If you smell gas, call the National Gas Emergency Service on 0800 111 999.'),
    card('',
      cardHead('Awaab\'s Law', { iconName: 'scale', sub: 'In force since 27 October 2025' }),
      h('p', {}, 'Councils and housing associations in England must now investigate and fix damp and mould, and emergency hazards, within fixed deadlines. It is named after Awaab Ishak, a two-year-old who died in 2020 after long exposure to mould in his family\'s housing association flat.'),
      h('p', { class: 'muted' }, 'The government plans to bring in more hazards in 2026 and 2027, such as excess cold, fire and electrical hazards.'),
      h('table', { class: 'grid rights-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Your landlord must'), h('th', {}, 'Deadline'))),
        h('tbody', {},
          h('tr', {}, h('td', {}, 'Investigate an emergency hazard and make it safe'), h('td', {}, 'Within 24 hours')),
          h('tr', {}, h('td', {}, 'Investigate significant damp and mould'), h('td', {}, 'Within 10 working days of being told')),
          h('tr', {}, h('td', {}, 'Send you a written summary of what they found'), h('td', {}, 'Within 3 working days of the investigation')),
          h('tr', {}, h('td', {}, 'Make the home safe'), h('td', {}, 'Within 5 working days of the investigation')),
          h('tr', {}, h('td', {}, 'Start any further repair works'), h('td', {}, 'Within 12 weeks at the latest')),
          h('tr', {}, h('td', {}, 'Offer you somewhere safe to stay, at their cost, if the home cannot be made safe in time'), h('td', {}, 'When the deadline is missed')))),
      h('p', { class: 'muted small' }, 'Working days leave out weekends and bank holidays. Day one is the day after your landlord was told.')),
    card('',
      cardHead('If your landlord does not act', { iconName: 'flag' }),
      h('ol', { class: 'route' },
        h('li', {}, h('strong', {}, 'Make a formal complaint. '), 'Use your landlord\'s complaints procedure. They must not treat you unfairly for complaining.'),
        h('li', {}, h('strong', {}, 'Go to the Housing Ombudsman. '), 'If you are unhappy with the final response, or the landlord is not responding. It is free and independent: 0300 111 3000.'),
        h('li', {}, h('strong', {}, 'Consider legal action. '), 'Awaab\'s Law is part of your tenancy agreement, so you can take your landlord to court for breach of contract. The Pre-Action Protocol for Housing Conditions Claims comes first.'),
        h('li', {}, h('strong', {}, 'Get free advice. '), 'Citizens Advice, Shelter, or Civil Legal Advice on 0345 345 4345. Legal aid may cover disrepair where there is a serious risk to health.'))),
    card('',
      cardHead('Renting privately?', { iconName: 'home' }),
      h('p', {}, 'Awaab\'s Law does not cover private renting yet. The government plans to extend it under the Renters\' Rights Act 2025. Until then, your landlord must still keep the home in repair and fit to live in.'),
      h('p', {}, 'Report problems in writing and keep a record. If nothing happens, your council\'s environmental health team can inspect your home and make the landlord act.')),
    card('',
      cardHead('Sources', { iconName: 'file' }),
      h('ul', { class: 'tips' },
        h('li', {}, link('https://www.gov.uk/government/publications/awaabs-law-guidance-for-tenants-in-social-housing', 'Awaab\'s Law: guidance for tenants in social housing (GOV.UK)')),
        h('li', {}, link('https://www.gov.uk/government/publications/awaabs-law-guidance-for-social-landlords', 'Awaab\'s Law: guidance for social landlords (GOV.UK)')),
        h('li', {}, link('https://www.legislation.gov.uk/uksi/2025/1042/contents/made', 'The Hazards in Social Housing (Prescribed Requirements) (England) Regulations 2025')),
        h('li', {}, link('https://www.housing-ombudsman.org.uk/', 'Housing Ombudsman Service')))),
    scopeNote());
}

/* ---------- settings ---------- */

function viewSettings() {
  const restoreInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: (e) => restore(e.target.files[0]) });

  const backup = () => act(async () => {
    const photos = [];
    for (const p of state.photos) photos.push({ id: p.id, issueId: p.issueId, takenAt: p.takenAt, width: p.width, height: p.height, dataUrl: await blobToDataUrl(p.blob) });
    const now = new Date().toISOString();
    const data = core.makeBackup({ home: state.home, issues: state.issues, entries: state.entries, photos }, now);
    download(`damplog-backup-${today().date}.json`, JSON.stringify(data), 'application/json');
    await saveHome({ lastBackup: now });
    toast('Backup downloaded. Keep it somewhere safe, such as your email or cloud storage.');
    render();
  });

  const restore = (file) => act(async () => {
    if (!file) return;
    const data = core.readBackup(await file.text(), ctx());
    if (!confirm(`Replace everything on this device with the backup (${plural(data.issues.length, 'problem')}, ${plural(data.photos.length, 'photo')})?`)) return;
    const photos = data.photos.map((p) => ({ id: p.id, issueId: p.issueId, takenAt: p.takenAt, width: p.width, height: p.height, blob: dataUrlToBlob(p.dataUrl) }));
    await db.save({ issues: data.issues, entries: data.entries, photos, meta: [{ id: 'home', ...data.home }, ...aiMeta()] }, { replace: true });
    forgetPhotos();
    state = { home: data.home, issues: data.issues, entries: data.entries, photos };
    channel?.postMessage('changed');
    toast('Backup restored.');
    location.hash = '#/home';
  });

  const erase = () => act(async () => {
    const wasSample = state.home.sample;
    const what = wasSample ? 'Clear the sample data?' : 'Erase your whole record from this device, including every photo and your AI key? This cannot be undone.\n\nDownload a backup first if you might need it.';
    if (!confirm(what)) return;
    await db.save({ meta: wasSample ? aiMeta() : [] }, { replace: true });
    if (!wasSample) aiConfig = ai.cleanAiConfig();
    forgetPhotos();
    state = { home: core.cleanHome(), issues: [], entries: [], photos: [] };
    channel?.postMessage('changed');
    toast(wasSample ? 'Sample data cleared.' : 'Everything erased.');
    location.hash = '#/home';
  });

  const section = (id, cls, ...children) => {
    const el = card(cls, ...children);
    el.id = id;
    return el;
  };
  const last = state.home.lastBackup;

  return h('div', { class: 'page' },
    pageHead('Settings', 'Everything is stored in this browser on this device. Nothing is uploaded.'),
    h('div', { class: 'grid-2' },
      h('div', { class: 'stack' },
        section('home', '', cardHead('Your home', { iconName: 'home', sub: 'Used in letters and the evidence report' }),
          homeForm({ submitText: 'Save', onSaved: () => { toast('Saved.'); render(); } })),
        aiSettingsCard()),
      h('div', { class: 'stack' },
        section('backup', '',
          cardHead('Backup', { iconName: 'shield', sub: last ? `Last backup ${fmtDate(last.slice(0, 10))}` : 'No backup yet' }),
          h('p', { class: 'muted' }, 'Your record only lives on this device. Download a backup, with every photo, and keep it somewhere safe. You can restore it on a new phone.'),
          h('div', { class: 'actions' },
            btn('Download backup', { icon: 'download', kind: 'primary', onclick: backup }),
            btn('Restore', { icon: 'upload', onclick: () => restoreInput.click() }),
            restoreInput)),
        section('privacy', '',
          cardHead('Privacy', { iconName: 'shield' }),
          h('ul', { class: 'tips' },
            h('li', {}, 'No account, no server, no tracking. DampLog is a web page that saves to your browser.'),
            h('li', {}, 'Photos are shrunk and stored on this device only.'),
            h('li', {}, 'Letters only leave the device when you send them yourself.'),
            h('li', {}, 'AI help is optional. A photo or letter is only sent to your AI provider when you press an AI button.'))),
        section('erase', 'danger-zone',
          cardHead(state.home.sample ? 'Clear sample data' : 'Erase everything', { iconName: 'trash' }),
          h('p', { class: 'muted' }, state.home.sample ? 'Removes the sample problems so you can start your own record.' : 'Removes every problem, entry and photo, and your AI key, from this device.'),
          btn(state.home.sample ? 'Clear sample data' : 'Erase all data', { icon: 'trash', kind: 'danger', onclick: erase })))),
    scopeNote());
}

function aiSettingsCard() {
  const keyInput = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'Paste your API key', value: aiConfig.apiKey, 'aria-label': 'API key' });
  const toggle = btn('', { icon: 'eye', kind: 'ghost', title: 'Show or hide the key', onclick: () => { keyInput.type = keyInput.type === 'password' ? 'text' : 'password'; } });
  const detected = h('small', { class: 'hint' });
  const modelInput = h('input', { list: 'ai-models', autocomplete: 'off', spellcheck: 'false', value: aiConfig.model, 'aria-label': 'Model' });
  const models = h('datalist', { id: 'ai-models' });
  const status = h('div', { 'aria-live': 'polite' });

  const sync = () => {
    const raw = keyInput.value.trim();
    const p = ai.detectProvider(raw);
    detected.textContent = p ? `${ai.PROVIDERS[p].name} key.` : raw ? 'This does not look like an OpenAI key (sk-…) or a Claude key (sk-ant-…).' : 'Works with OpenAI and Claude keys.';
    detected.className = `hint${raw && !p ? ' error' : ''}`;
    models.replaceChildren(...(p ? ai.PROVIDERS[p].models : []).map((m) => h('option', { value: m })));
    if (p && (!modelInput.value.trim() || !ai.modelFits(p, modelInput.value))) modelInput.value = ai.PROVIDERS[p].defaultModel;
  };
  keyInput.addEventListener('input', sync);
  sync();

  const read = () => {
    if (!ai.detectProvider(keyInput.value)) throw new RangeError('Paste an OpenAI key (it starts with sk-) or a Claude key (it starts with sk-ant-).');
    return ai.cleanAiConfig({ apiKey: keyInput.value, model: modelInput.value });
  };
  const save = () => act(async () => {
    const cfg = read();
    await db.saveAi(cfg);
    aiConfig = cfg;
    channel?.postMessage('changed');
    toast('AI help connected. The key is saved only in this browser.');
    render();
  });
  const test = () => act(async () => {
    const cfg = read();
    status.replaceChildren(h('div', { class: 'notice' }, h('span', { class: 'spinner sm' }), h('div', {}, `Testing ${cfg.model}…`)));
    try {
      await ai.testConnection(cfg);
      status.replaceChildren(notice('ok', 'check', `Connected to ${ai.PROVIDERS[cfg.provider].name} (${cfg.model}). Save to use it.`));
    } catch (err) {
      status.replaceChildren(notice('bad', 'alert', err.message));
    }
  });
  const remove = () => act(async () => {
    await db.save({}, { remove: { meta: ['ai'] } });
    aiConfig = ai.cleanAiConfig();
    channel?.postMessage('changed');
    toast('AI key removed from this browser.');
    render();
  });

  const el = card('ai-settings',
    cardHead('AI help', { iconName: 'sparkle', sub: aiConfig.provider ? `On · ${ai.PROVIDERS[aiConfig.provider].name} · ${aiConfig.model}` : 'Optional · off' }),
    h('p', { class: 'muted' }, 'AI can describe your photos for the record and tighten your letters. You check every word before anything is saved or sent.'),
    h('div', { class: 'form plain' },
      h('div', { class: 'field' },
        h('span', { class: 'field-label' }, 'API key'),
        h('div', { class: 'input-group' }, keyInput, toggle),
        detected),
      field('Model', modelInput, 'The default is a good choice. Change it only if your account uses a different model.'),
      models,
      h('div', { class: 'actions' },
        btn('Save', { icon: 'check', kind: 'primary', onclick: save }),
        btn('Test connection', { icon: 'refresh', onclick: test }),
        aiConfig.provider && btn('Remove key', { icon: 'trash', kind: 'ghost', onclick: remove })),
      status),
    h('div', { class: 'privacy' },
      h('strong', {}, 'How it works'),
      h('ul', {},
        h('li', {}, 'Your key is saved only in this browser. It is never put in backups and never sent anywhere except your AI provider.'),
        h('li', {}, 'Only when you press an AI button, the photos of that entry, or the letter on screen, go straight to your provider. Usage is billed to your account.'),
        h('li', {}, 'Nothing the AI writes is saved or sent until you have checked it.')),
      h('p', { class: 'small' }, 'Get a key: ',
        h('a', { href: ai.PROVIDERS.openai.keysUrl, target: '_blank', rel: 'noopener noreferrer' }, 'OpenAI'), ' or ',
        h('a', { href: ai.PROVIDERS.anthropic.keysUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Claude'), '.')));
  el.id = 'ai';
  return el;
}

/** The box where AI output waits for the tenant's decision. */
function aiPanel(title, sub, ...content) {
  return h('div', { class: 'ai-review' },
    h('div', { class: 'ai-review-head' }, h('span', { class: 'ai-tag' }, 'AI'), h('div', {}, h('strong', {}, title), h('small', {}, sub))),
    ...content);
}

const aiWorking = (text) => h('div', { class: 'thinking' }, h('span', { class: 'spinner sm' }), h('span', {}, text));

function aiReady() {
  if (!aiConfig.provider) throw new Error('Connect AI help in Settings first.');
  if (!navigator.onLine) throw new Error('You are offline. AI help needs an internet connection.');
}

function notFound() {
  return h('div', { class: 'page' }, card('', emptyState('alert', 'Not found', 'That problem is not on this device.', btn('Back to overview', { href: '#/home' }))));
}

/* ---------- routing ---------- */

const VIEWS = { home: viewHome, setup: viewSetup, new: viewNew, issue: viewIssue, add: viewAdd, letters: viewLetters, report: viewReport, assistant: viewProbeLink, rights: viewRights, settings: viewSettings };
const TITLES = { home: 'Overview', setup: 'About your home', new: 'New problem', issue: 'Problem', add: 'Add to the record', letters: 'Letters', report: 'Evidence report', assistant: 'Assistant', rights: 'Your rights', settings: 'Settings' };
const NAV_FOR = { setup: 'settings', issue: 'home', add: 'home', report: 'home', assistant: 'home' };

// Old links to the assistant page open Probe over the overview.
function viewProbeLink() {
  setTimeout(() => openProbe({ focus: true }));
  return viewHome();
}

function currentRoute() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [name, arg = ''] = path.split('/');
  let decoded = '';
  try {
    decoded = decodeURIComponent(arg);
  } catch {
    // A mangled link just shows the overview.
  }
  return VIEWS[name] ? { name, arg: decoded, params: new URLSearchParams(query) } : { name: 'home', arg: '', params: new URLSearchParams() };
}

function render() {
  const { name, arg, params } = currentRoute();
  renderChrome(NAV_FOR[name] ?? name);
  main.replaceChildren(VIEWS[name](arg, params));
  // The overview's heading is a sentence about the case, so it keeps its plain title.
  const heading = name === 'home' ? null : main.querySelector('h1');
  document.title = `${heading?.textContent ?? TITLES[name]} · DampLog`;
}

function afterNavigate() {
  render();
  main.classList.remove('enter');
  void main.offsetWidth; // restart the entrance animation
  main.classList.add('enter');
  const section = currentRoute().params.get('section');
  if (section) requestAnimationFrame(() => document.getElementById(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  else window.scrollTo(0, 0);
}

window.addEventListener('hashchange', afterNavigate);
window.addEventListener('online', () => renderChrome(currentRoute().name));
window.addEventListener('offline', () => renderChrome(currentRoute().name));

// Another tab saved something: reload so this tab never shows a stale record.
channel?.addEventListener('message', () => act(async () => {
  state = await loadState();
  const { name } = currentRoute();
  if (['home', 'issue', 'report'].includes(name)) render();
}));

async function loadState() {
  const data = await db.loadAll();
  aiConfig = ai.cleanAiConfig(data.ai);
  return { home: core.cleanHome(data.home), issues: data.issues, entries: data.entries, photos: data.photos };
}

async function start() {
  try {
    state = await loadState();
  } catch (err) {
    main.replaceChildren(notice('bad', 'alert',
      h('strong', {}, 'DampLog cannot open its storage. '),
      'Private browsing or blocked site data can cause this. Open DampLog in a normal window. ',
      h('small', {}, `(${err.message})`)));
    return;
  }
  if (!location.hash.startsWith('#/')) history.replaceState(null, '', '#/home');
  afterNavigate();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Offline mode unavailable:', err));
  }
}

start();
