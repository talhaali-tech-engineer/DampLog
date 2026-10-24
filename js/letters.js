// Letter templates built from the record. Plain text, so they paste into an
// email, a landlord's online form or a printed letter. Not legal advice.

import { ENTRY_TYPES, KINDS, dateOf } from './core.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function longDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function longTime(at) {
  return at?.length > 10 ? `${longDate(at)} at ${at.slice(11, 16)}` : longDate(at);
}

const lines = (...parts) => parts.filter((p) => p != null && p !== false && p !== '').join('\n\n');
function place(issue) {
  if (issue.room === 'Outside') return ' outside my home';
  if (!issue.room || issue.room === 'Whole home') return ' in my home';
  return ` in the ${issue.room.toLowerCase()} of my home`;
}

function head(home) {
  return [home.landlordName ? `Dear ${home.landlordName},` : 'Dear Sir or Madam,'];
}

function signOff(home) {
  return ['Yours sincerely,', home.tenantName || '[Your name]', home.address].filter(Boolean).join('\n');
}

function ref(home) {
  return home.tenancyRef ? `Tenancy reference: ${home.tenancyRef}` : '';
}

function reportedLine(entry) {
  const how = entry.method ? ` by ${entry.method.toLowerCase()}` : '';
  const number = entry.reference ? ` (reference ${entry.reference})` : '';
  return `on ${longDate(dateOf(entry.at))}${how}${number}`;
}

/** One line per entry, oldest first, for chronologies. */
export function chronology(entries) {
  return entries.map((e) => {
    const extra = [e.method && `by ${e.method.toLowerCase()}`, e.reference && `reference ${e.reference}`].filter(Boolean).join(', ');
    const photos = e.photoIds?.length ? ` (${e.photoIds.length} photo${e.photoIds.length === 1 ? '' : 's'})` : '';
    const note = e.text ? `: ${e.text.replace(/\s+/g, ' ')}` : '';
    return `- ${longDate(dateOf(e.at))}: ${ENTRY_TYPES[e.type].label}${extra ? ` (${extra})` : ''}${photos}${note}`;
  }).join('\n');
}

function missedLines(summary) {
  return summary.deadlines.steps
    .filter((s) => s.status === 'overdue' || s.status === 'late')
    .map((s) => (s.status === 'overdue'
      ? `- ${s.title}: this was due by ${longTime(s.dueAt ?? s.due)} and has not happened.`
      : `- ${s.title}: this was due by ${longTime(s.dueAt ?? s.due)} but happened on ${longDate(dateOf(s.doneAt))}.`));
}

export const LETTERS = {
  report: {
    title: 'Report the problem',
    sub: 'Tell your landlord in writing, so the deadlines start and there is a record.',
  },
  chase: {
    title: 'Chase your landlord',
    sub: 'Ask for action when a deadline has passed or nothing has happened.',
  },
  complaint: {
    title: 'Make a formal complaint',
    sub: 'Start the landlord\'s complaints procedure, with the full timeline.',
  },
};

/**
 * @param {'report' | 'chase' | 'complaint'} kind
 * @param {{ home: object, summary: object, today: string }} input summary is core.issueSummary()
 * @returns {{ subject: string, body: string }}
 */
export function buildLetter(kind, { home, summary, today }) {
  const { issue, entries, deadlines: d } = summary;
  const social = home.landlordType === 'social';
  const noun = KINDS[issue.kind].noun;
  const address = home.address || '[your address]';
  const reported = entries.find((e) => e.type === 'reported');
  const health = entries.filter((e) => e.type === 'health' && e.text).map((e) => e.text.replace(/\s+/g, ' '));
  const date = longDate(today);

  if (kind === 'report') {
    const legal = social
      ? issue.kind === 'emergency'
        ? 'Please treat this as a report of a potential emergency hazard under the Hazards in Social Housing (Prescribed Requirements) (England) Regulations 2025 (Awaab\'s Law). Please investigate it and make the home safe within 24 hours.'
        : 'Please treat this as a report of a potential hazard under the Hazards in Social Housing (Prescribed Requirements) (England) Regulations 2025 (Awaab\'s Law). Please investigate within 10 working days, and send me a written summary of what you find within 3 working days of the investigation.'
      : 'As my landlord, you are responsible for keeping the home in repair and fit to live in. Please arrange for someone to inspect the problem and fix it, and let me know when they will come.';
    return {
      subject: `Report of ${noun} at ${address}`,
      body: lines(
        date,
        ...head(home),
        ref(home),
        `I am writing to report ${noun}${place(issue)} at ${address}.${issue.firstNoticed ? ` I first noticed it on ${longDate(issue.firstNoticed)}.` : ''}`,
        issue.description,
        home.household && `The people who live here are: ${home.household}`,
        health.length > 0 && `The problem is affecting our health:\n${health.map((t) => `- ${t}`).join('\n')}`,
        summary.photos > 0 && `I have ${summary.photos} photograph${summary.photos === 1 ? '' : 's'} of the problem and can send them to you.`,
        legal,
        'Please confirm that you have received this report and give me a reference number.',
        signOff(home),
      ),
    };
  }

  if (kind === 'chase') {
    const missed = missedLines(summary);
    return {
      subject: missed.length ? `Missed deadlines: ${noun} at ${address}` : `Update needed: ${noun} at ${address}`,
      body: lines(
        date,
        ...head(home),
        ref(home),
        reported
          ? `I reported ${noun}${place(issue)} ${reportedLine(reported)}.`
          : `I am writing about ${noun}${place(issue)} at ${address}.`,
        missed.length
          ? `The following has not been done in the time required:\n${missed.join('\n')}`
          : 'I have not had an update on when the problem will be fixed.',
        'Please contact me within 2 working days to arrange this, and confirm in writing what you will do and when.',
        social
          ? 'If I do not hear from you, I will make a formal complaint and may contact the Housing Ombudsman.'
          : 'If I do not hear from you, I will ask the council\'s environmental health team for help.',
        signOff(home),
      ),
    };
  }

  const wrong = missedLines(summary);
  if (!summary.fixed) wrong.push('- The problem has still not been fixed.');
  return {
    subject: `Formal complaint: ${noun} at ${address}`,
    body: lines(
      date,
      ...head(home),
      ref(home),
      `Please treat this letter as a formal complaint under your complaints procedure, about ${noun}${place(issue)} at ${address}.`,
      `What has happened\n${chronology(entries)}`,
      wrong.length > 0 && `What has gone wrong\n${wrong.join('\n')}`,
      `What I would like you to do\n- Make the home safe and fix the cause of the problem as soon as possible.\n- Send me a written summary of what you found, the work you will do, and when it will start and finish.\n- Explain how you will put things right for the time this has taken.`,
      'Please acknowledge this complaint and reply within the timescales in your complaints policy.',
      social
        ? 'If I am not satisfied with your final response, I may refer my complaint to the Housing Ombudsman.'
        : 'If the problem is not fixed, I may ask the council\'s environmental health team to inspect my home.',
      signOff(home),
    ),
  };
}
