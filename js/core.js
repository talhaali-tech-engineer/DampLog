// DampLog's rules, kept free of the DOM so they can be tested in Node.
// Dates are 'YYYY-MM-DD' strings and times are local 'YYYY-MM-DDTHH:MM' strings,
// so a record means the same day wherever it is opened.

/* ---------- dates and working days ---------- */

// Bank holidays in England and Wales, from https://www.gov.uk/bank-holidays.json.
// The regulations count working days as every day except weekends, Christmas Day,
// Good Friday and these bank holidays.
export const BANK_HOLIDAYS = new Set([
  '2025-01-01', '2025-04-18', '2025-04-21', '2025-05-05', '2025-05-26', '2025-08-25', '2025-12-25', '2025-12-26',
  '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25', '2026-08-31', '2026-12-25', '2026-12-28',
  '2027-01-01', '2027-03-26', '2027-03-29', '2027-05-03', '2027-05-31', '2027-08-30', '2027-12-27', '2027-12-28',
  '2028-01-03', '2028-04-14', '2028-04-17', '2028-05-01', '2028-05-29', '2028-08-28', '2028-12-25', '2028-12-26',
]);

const DAY = 86400000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const toUTC = (iso) => Date.parse(`${iso}T00:00:00Z`);
const fromUTC = (ms) => new Date(ms).toISOString().slice(0, 10);

export const isDate = (s) => typeof s === 'string' && ISO_DATE.test(s) && !Number.isNaN(toUTC(s)) && fromUTC(toUTC(s)) === s;

export function todayISO(now = new Date()) {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function nowLocal(now = new Date()) {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export const dateOf = (at) => String(at ?? '').slice(0, 10);
export const addDays = (iso, n) => fromUTC(toUTC(iso) + n * DAY);
export const daysBetween = (from, to) => Math.round((toUTC(to) - toUTC(from)) / DAY);

export function isWorkingDay(iso) {
  const weekday = new Date(toUTC(iso)).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !BANK_HOLIDAYS.has(iso);
}

/** The date of the nth working day after `iso`. The start day itself is day zero. */
export function addWorkingDays(iso, n) {
  let day = iso;
  let left = n;
  while (left > 0) {
    day = addDays(day, 1);
    if (isWorkingDay(day)) left--;
  }
  return day;
}

/** Working days after `from`, up to and including `to`. Negative when `to` is earlier. */
export function workingDaysBetween(from, to) {
  if (to < from) return -workingDaysBetween(to, from);
  let count = 0;
  for (let day = addDays(from, 1); day <= to; day = addDays(day, 1)) if (isWorkingDay(day)) count++;
  return count;
}

/* ---------- vocabulary ---------- */

export const KINDS = {
  'damp-mould': { label: 'Damp and mould', short: 'Damp and mould', noun: 'damp and mould' },
  leak: { label: 'Leak or water coming in', short: 'Leak', noun: 'a leak' },
  emergency: { label: 'Emergency hazard', short: 'Emergency hazard', noun: 'an emergency hazard' },
  other: { label: 'Other disrepair', short: 'Repair needed', noun: 'a repair problem' },
};

export const ROOMS = ['Bedroom', 'Second bedroom', 'Child\'s bedroom', 'Living room', 'Kitchen', 'Bathroom', 'Hallway', 'Whole home', 'Outside'];

export const LANDLORD_TYPES = {
  social: 'Council or housing association',
  private: 'Private landlord or letting agent',
  unknown: 'Not sure',
};

// What can go on an issue's record. `clock` marks the entries the deadlines read.
export const ENTRY_TYPES = {
  observation: { label: 'Photo or note of the problem', short: 'Evidence', icon: 'camera' },
  reported: { label: 'Reported to the landlord', short: 'Reported', icon: 'send', clock: true },
  contact: { label: 'Other contact with the landlord', short: 'Contact', icon: 'phone' },
  investigation: { label: 'Landlord investigated', short: 'Investigated', icon: 'search', clock: true },
  summary: { label: 'Written summary received', short: 'Summary', icon: 'file', clock: true },
  'made-safe': { label: 'Made safe', short: 'Made safe', icon: 'shield', clock: true },
  works: { label: 'Repair works started', short: 'Works started', icon: 'tool', clock: true },
  missed: { label: 'Missed appointment', short: 'Missed visit', icon: 'clock' },
  health: { label: 'Effect on health', short: 'Health', icon: 'heart' },
  complaint: { label: 'Formal complaint', short: 'Complaint', icon: 'flag' },
  fixed: { label: 'Problem fixed', short: 'Fixed', icon: 'check' },
};

export const METHODS = ['Phone', 'Email', 'Online portal or app', 'Letter', 'In person', 'Text message'];

/* ---------- deadlines ---------- */

const byTime = (a, b) => String(a.at).localeCompare(String(b.at));
const first = (entries, type) => entries.filter((e) => e.type === type).sort(byTime)[0];

// Statuses: met, late (done after the deadline), overdue, pending (due later),
// waiting (its clock starts after an earlier step), open (no legal deadline).
function step(key, title, rule, due, doneAt, today, { dueAt = null, statutory = true } = {}) {
  let status;
  if (doneAt) status = (dueAt ? doneAt > dueAt : due && dateOf(doneAt) > due) ? 'late' : 'met';
  else if (!statutory) status = 'open';
  else if (!due) status = 'waiting';
  else if (dueAt ? today.now > dueAt : today.date > due) status = 'overdue';
  else status = 'pending';
  return { key, title, rule: statutory ? rule : null, due, dueAt, doneAt: doneAt ?? null, status };
}

/**
 * The landlord's deadlines for one issue, from the entries on its record.
 * Social landlords in England must meet the timeframes in the Hazards in Social
 * Housing (Prescribed Requirements) (England) Regulations 2025 ("Awaab's Law").
 * Other landlords get the same milestones without legal due dates.
 *
 * @param {{ kind: string }} issue
 * @param {Array} entries this issue's entries
 * @param {'social' | 'private' | 'unknown'} landlordType
 * @param {{ date: string, now: string }} today local date and time
 */
export function deadlines(issue, entries, landlordType, today) {
  const reported = first(entries, 'reported');
  const statutory = landlordType === 'social';
  const at = (type) => first(entries, type)?.at ?? null;
  if (!reported) return { statutory, reportedAt: null, steps: [], overdue: [], next: null };

  const aware = dateOf(reported.at);
  const steps = [];
  if (issue.kind === 'emergency') {
    // 24 hours from the moment the landlord was told, not the end of a working day.
    const dueAt = statutory ? nowLocal(new Date(Date.parse(reported.at) + DAY)) : null;
    steps.push(step('make-safe', 'Investigate and make safe', 'Within 24 hours of being told', dueAt && dateOf(dueAt), at('made-safe'), today, { dueAt, statutory }));
  } else {
    const investigated = at('investigation');
    const ended = investigated && dateOf(investigated);
    const noHazard = first(entries, 'summary')?.outcome === 'no-hazard';
    const opts = { statutory };
    steps.push(step('investigation', 'Investigate the problem', 'Within 10 working days of being told',
      statutory ? addWorkingDays(aware, 10) : null, investigated, today, opts));
    steps.push(step('summary', 'Send you a written summary', 'Within 3 working days of the investigation',
      statutory && ended ? addWorkingDays(ended, 3) : null, at('summary'), today, opts));
    if (noHazard) {
      steps.push({ key: 'make-safe', title: 'Make the home safe', rule: 'The summary says no significant hazard was found', due: null, dueAt: null, doneAt: null, status: 'not-needed' });
    } else {
      steps.push(step('make-safe', 'Make the home safe', 'Within 5 working days of the investigation',
        statutory && ended ? addWorkingDays(ended, 5) : null, at('made-safe'), today, opts));
      steps.push(step('works', 'Start any further repair works', 'Within 12 weeks of the investigation at the latest',
        statutory && ended ? addDays(ended, 84) : null, at('works'), today, opts));
    }
  }
  const overdue = steps.filter((s) => s.status === 'overdue');
  const next = steps.filter((s) => s.status === 'pending').sort((a, b) => (a.dueAt ?? a.due).localeCompare(b.dueAt ?? b.due))[0] ?? null;
  return { statutory, reportedAt: reported.at, steps, overdue, next };
}

/** Everything the overview needs about one issue. */
export function issueSummary(issue, entries, landlordType, today) {
  const mine = entries.filter((e) => e.issueId === issue.id).sort(byTime);
  const d = deadlines(issue, mine, landlordType, today);
  const fixed = Boolean(issue.closedAt);
  const photos = mine.reduce((n, e) => n + (e.photoIds?.length ?? 0), 0);
  return {
    issue,
    entries: mine,
    deadlines: d,
    fixed,
    photos,
    lastEntry: mine.at(-1) ?? null,
    daysOpen: daysBetween(issue.firstNoticed || dateOf(issue.createdAt), today.date),
    workingDaysSinceReport: d.reportedAt ? workingDaysBetween(dateOf(d.reportedAt), today.date) : null,
  };
}

/** Open issues first, those with missed deadlines at the top. */
export function sortSummaries(list) {
  const rank = (s) => (s.fixed ? 3 : s.deadlines.overdue.length ? 0 : !s.deadlines.reportedAt ? 1 : 2);
  return [...list].sort((a, b) => rank(a) - rank(b) || String(b.lastEntry?.at ?? b.issue.createdAt).localeCompare(String(a.lastEntry?.at ?? a.issue.createdAt)));
}

/* ---------- settings ---------- */

export const DEFAULT_HOME = {
  tenantName: '', address: '', landlordName: '', landlordEmail: '', landlordType: 'social', tenancyRef: '', household: '', lastBackup: null, sample: false,
};

const text = (v, max = 2000) => String(v ?? '').replace(/\r/g, '').trim().slice(0, max);

export function cleanHome(input = {}) {
  return {
    tenantName: text(input.tenantName, 120),
    address: text(input.address, 400),
    landlordName: text(input.landlordName, 160),
    landlordEmail: text(input.landlordEmail, 200),
    landlordType: LANDLORD_TYPES[input.landlordType] ? input.landlordType : 'unknown',
    tenancyRef: text(input.tenancyRef, 80),
    household: text(input.household, 1000),
    lastBackup: typeof input.lastBackup === 'string' ? input.lastBackup : null,
    sample: input.sample === true,
  };
}

export const homeReady = (home) => Boolean(home.address && home.landlordName);

/* ---------- records ---------- */

export function cleanIssue(input, { now, newId }) {
  const kind = KINDS[input.kind] ? input.kind : 'damp-mould';
  const room = text(input.room, 60);
  const where = !room ? '' : room === 'Whole home' ? ' in the home' : room === 'Outside' ? ' outside' : ` in the ${room.toLowerCase()}`;
  const title = text(input.title, 120) || `${KINDS[kind].short}${where}`;
  return {
    id: input.id || newId(),
    title,
    kind,
    room,
    firstNoticed: isDate(input.firstNoticed) ? input.firstNoticed : null,
    description: text(input.description, 4000),
    createdAt: input.createdAt || now,
    closedAt: isDate(input.closedAt) ? input.closedAt : null,
  };
}

const LOCAL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export function cleanEntry(input, { now, newId }) {
  const type = ENTRY_TYPES[input.type] ? input.type : 'observation';
  const at = LOCAL_TIME.test(input.at ?? '') && isDate(input.at.slice(0, 10)) ? input.at : now;
  const entry = { id: input.id || newId(), issueId: input.issueId, type, at, text: text(input.text, 4000), photoIds: [...(input.photoIds ?? [])] };
  if (['reported', 'contact', 'complaint'].includes(type)) {
    entry.method = METHODS.includes(input.method) ? input.method : '';
    entry.reference = text(input.reference, 80);
  }
  if (type === 'summary' || type === 'investigation') entry.outcome = ['hazard', 'no-hazard'].includes(input.outcome) ? input.outcome : '';
  return entry;
}

/** Checks a new entry against the issue's record before it is saved. Returns problems as sentences. */
export function entryProblems(entry, entries, today) {
  const problems = [];
  if (entry.at.slice(0, 10) > today.date) problems.push('The date is in the future.');
  const reported = first(entries.filter((e) => e.id !== entry.id), 'reported');
  if (['investigation', 'summary', 'made-safe', 'works'].includes(entry.type) && reported && entry.at < reported.at) {
    problems.push('This is dated before you reported the problem. Check the date, or move the report earlier.');
  }
  if (entry.type === 'summary') {
    const inv = first(entries, 'investigation');
    if (inv && entry.at < inv.at) problems.push('The summary is dated before the investigation.');
  }
  if (!entry.text && !entry.photoIds.length && !['reported', 'investigation', 'made-safe', 'works', 'fixed', 'missed'].includes(entry.type)) {
    problems.push('Add a note or a photo so this entry says something.');
  }
  return problems;
}

/* ---------- backups ---------- */

export const BACKUP_FORMAT = 'damplog-backup';

/** Photos travel inside the backup as data URLs, so one file restores everything. */
export function makeBackup({ home, issues, entries, photos }, exportedAt) {
  return { format: BACKUP_FORMAT, version: 1, exportedAt, home: cleanHome(home), issues, entries, photos };
}

export function readBackup(json, ctx) {
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('That file is not a DampLog backup (it is not valid JSON).');
  }
  if (data?.format !== BACKUP_FORMAT) throw new Error('That file is not a DampLog backup.');
  if (!Array.isArray(data.issues) || !Array.isArray(data.entries) || !Array.isArray(data.photos)) throw new Error('The backup is incomplete.');
  const issues = data.issues.map((i) => cleanIssue(i, ctx));
  const ids = new Set(issues.map((i) => i.id));
  const photos = data.photos.filter((p) => p && typeof p.id === 'string' && ids.has(p.issueId) && /^data:image\/(jpeg|png|webp);base64,/.test(p.dataUrl ?? ''));
  const photoIds = new Set(photos.map((p) => p.id));
  const entries = data.entries.filter((e) => ids.has(e?.issueId)).map((e) => {
    const clean = cleanEntry(e, ctx);
    clean.photoIds = clean.photoIds.filter((id) => photoIds.has(id));
    return clean;
  });
  return { home: cleanHome(data.home), issues, entries, photos };
}

/* ---------- the landlord's clock ---------- */

const MAX_CELLS = 30;

/**
 * The deadline that matters now for one problem, as a strip of working days:
 * 'used' days are inside the deadline, 'left' days are still to come, and 'late'
 * days have passed the deadline. Emergency hazards and the 12-week works step are
 * not counted in working days, so they come back without a strip.
 */
export function caseClock(summary, today) {
  const d = summary.deadlines;
  if (summary.fixed) return { mode: 'fixed' };
  if (!d.reportedAt) return { mode: 'not-started' };
  const step = d.overdue[0] ?? d.next;
  if (!step) return { mode: d.statutory ? 'waiting' : 'no-deadlines' };
  if (step.dueAt || step.key === 'works') return { mode: 'long', step, due: step.dueAt ?? step.due, overdue: step.status === 'overdue' };

  const investigated = summary.entries.find((e) => e.type === 'investigation');
  const start = step.key === 'investigation' ? dateOf(d.reportedAt) : dateOf(investigated.at);
  const allowed = workingDaysBetween(start, step.due);
  const elapsed = Math.max(0, workingDaysBetween(start, today.date));
  const end = step.due > today.date ? step.due : today.date;
  let days = [];
  for (let day = addDays(start, 1); day <= end; day = addDays(day, 1)) {
    if (!isWorkingDay(day)) continue;
    days.push({ date: day, state: day > today.date ? 'left' : day > step.due ? 'late' : 'used', due: day === step.due, today: day === today.date });
  }
  const truncated = days.length > MAX_CELLS;
  if (truncated) days = days.slice(-MAX_CELLS);
  return { mode: 'days', step, start, due: step.due, allowed, elapsed, overdueBy: Math.max(0, elapsed - allowed), days, truncated };
}

/* ---------- deadlines as calendar events ---------- */

const icsText = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const encoder = new TextEncoder();

// Calendar lines may be at most 75 bytes; longer ones carry on after a line break and a space.
function fold(line) {
  const parts = [];
  let rest = line;
  let limit = 75;
  while (encoder.encode(rest).length > limit) {
    let cut = limit;
    while (encoder.encode(rest.slice(0, cut)).length > limit) cut--;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
    limit = 74;
  }
  parts.push(rest);
  return parts.join('\r\n ');
}

/**
 * The landlord's upcoming deadlines as an iCalendar file, so a phone calendar can
 * remind the tenant. Each deadline is an all-day event (or a timed one for the
 * 24-hour emergency clock) with a reminder before it. Returns null if nothing is due.
 * @param {string} stamp ISO time the file is made
 */
export function deadlineCalendar(home, summaries, stamp) {
  const utc = new Date(stamp).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const events = [];
  for (const s of summaries) {
    if (s.fixed) continue;
    for (const step of s.deadlines.steps) {
      if (step.status !== 'pending' || !step.due) continue;
      const who = home.landlordName || 'Your landlord';
      const what = step.title.charAt(0).toLowerCase() + step.title.slice(1);
      events.push('BEGIN:VEVENT', `UID:${s.issue.id}-${step.key}@damplog`, `DTSTAMP:${utc}`);
      if (step.dueAt) {
        const at = `${step.dueAt.replace(/[-:]/g, '')}00`;
        events.push(`DTSTART:${at}`, `DTEND:${at}`);
      } else {
        events.push(`DTSTART;VALUE=DATE:${step.due.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${addDays(step.due, 1).replace(/-/g, '')}`);
      }
      events.push(
        `SUMMARY:${icsText(`Deadline: ${who} must ${what} (${s.issue.title})`)}`,
        `DESCRIPTION:${icsText(`${step.rule}. If it has not happened by the end of the day, open DampLog and send a chase letter.`)}`,
        'BEGIN:VALARM', 'ACTION:DISPLAY',
        `DESCRIPTION:${icsText(`${step.dueAt ? 'In 2 hours' : 'Tomorrow'}: ${who} must ${what}`)}`,
        step.dueAt ? 'TRIGGER:-PT2H' : 'TRIGGER:-PT15H',
        'END:VALARM', 'END:VEVENT');
    }
  }
  if (!events.length) return null;
  return `${['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DampLog//Landlord deadlines//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:DampLog deadlines', ...events, 'END:VCALENDAR'].map(fold).join('\r\n')}\r\n`;
}
