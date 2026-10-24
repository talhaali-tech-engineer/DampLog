import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addWorkingDays, workingDaysBetween, isWorkingDay, deadlines, issueSummary, sortSummaries,
  cleanEntry, cleanIssue, entryProblems, cleanHome, makeBackup, readBackup,
} from '../js/core.js';

let n = 0;
const ctx = { now: '2026-10-24T09:00', newId: () => `id${++n}` };
const today = (date, time = '12:00') => ({ date, now: `${date}T${time}` });
const issue = (kind = 'damp-mould') => cleanIssue({ id: 'i1', kind, room: 'Bedroom', firstNoticed: '2026-09-20' }, ctx);
const entry = (type, at, extra = {}) => cleanEntry({ issueId: 'i1', type, at, ...extra }, ctx);
const byKey = (d) => Object.fromEntries(d.steps.map((s) => [s.key, s]));

test('working days skip weekends and England and Wales bank holidays', () => {
  assert.equal(isWorkingDay('2026-10-24'), false); // Saturday
  assert.equal(isWorkingDay('2026-12-28'), false); // Boxing Day moved to Monday
  assert.equal(isWorkingDay('2026-10-26'), true);
  assert.equal(addWorkingDays('2026-10-23', 10), '2026-11-06');
  assert.equal(addWorkingDays('2026-12-23', 3), '2026-12-30');
  assert.equal(addWorkingDays('2027-03-25', 1), '2027-03-30'); // over Easter
  assert.equal(workingDaysBetween('2026-10-23', '2026-11-06'), 10);
  assert.equal(workingDaysBetween('2026-11-06', '2026-10-23'), -10);
});

test('the clock starts the day after the landlord is told', () => {
  // Told on a Thursday: day one is Friday, day ten is the Thursday two weeks on.
  const d = deadlines(issue(), [entry('reported', '2026-10-01T10:00')], 'social', today('2026-10-10'));
  assert.equal(byKey(d).investigation.due, '2026-10-15');
  assert.equal(byKey(d).investigation.status, 'pending');
  assert.equal(byKey(d).summary.status, 'waiting');
  assert.equal(d.next.key, 'investigation');
});

test('a missed investigation is overdue the day after its deadline', () => {
  const entries = [entry('reported', '2026-10-01T10:00')];
  assert.equal(byKey(deadlines(issue(), entries, 'social', today('2026-10-15'))).investigation.status, 'pending');
  const late = deadlines(issue(), entries, 'social', today('2026-10-16'));
  assert.equal(byKey(late).investigation.status, 'overdue');
  assert.deepEqual(late.overdue.map((s) => s.key), ['investigation']);
});

test('summary, make-safe and works deadlines run from the investigation', () => {
  const entries = [entry('reported', '2026-10-01T10:00'), entry('investigation', '2026-10-14T09:00')];
  const s = byKey(deadlines(issue(), entries, 'social', today('2026-10-24')));
  assert.equal(s.investigation.status, 'met');
  assert.equal(s.summary.due, '2026-10-19');
  assert.equal(s.summary.status, 'overdue');
  assert.equal(s['make-safe'].due, '2026-10-21');
  assert.equal(s['make-safe'].status, 'overdue');
  assert.equal(s.works.due, '2027-01-06');
  assert.equal(s.works.status, 'pending');
});

test('work done after its deadline is recorded as late, not met', () => {
  const entries = [entry('reported', '2026-10-01T10:00'), entry('investigation', '2026-10-20T09:00')];
  assert.equal(byKey(deadlines(issue(), entries, 'social', today('2026-10-24'))).investigation.status, 'late');
});

test('no make-safe deadline when the summary finds no significant hazard', () => {
  const entries = [
    entry('reported', '2026-10-01T10:00'), entry('investigation', '2026-10-09T09:00'),
    entry('summary', '2026-10-12T09:00', { outcome: 'no-hazard', text: 'Condensation only' }),
  ];
  const d = deadlines(issue(), entries, 'social', today('2026-10-24'));
  assert.equal(byKey(d)['make-safe'].status, 'not-needed');
  assert.equal(byKey(d).works, undefined);
  assert.equal(d.overdue.length, 0);
});

test('emergency hazards run on a 24-hour clock', () => {
  const told = [entry('reported', '2026-10-24T09:00')];
  const e = issue('emergency');
  assert.equal(byKey(deadlines(e, told, 'social', today('2026-10-24', '20:00')))['make-safe'].status, 'pending');
  assert.equal(byKey(deadlines(e, told, 'social', today('2026-10-25', '09:01')))['make-safe'].status, 'overdue');
  assert.equal(byKey(deadlines(e, [...told, entry('made-safe', '2026-10-25T08:00')], 'social', today('2026-10-26')))['make-safe'].status, 'met');
  assert.equal(byKey(deadlines(e, [...told, entry('made-safe', '2026-10-25T10:00')], 'social', today('2026-10-26')))['make-safe'].status, 'late');
});

test('private landlords get milestones without legal deadlines', () => {
  const d = deadlines(issue(), [entry('reported', '2026-09-01T10:00')], 'private', today('2026-10-24'));
  assert.equal(d.statutory, false);
  assert.ok(d.steps.every((s) => s.status === 'open' && s.due === null && s.rule === null));
  assert.equal(d.overdue.length, 0);
});

test('nothing is due before the problem is reported', () => {
  const d = deadlines(issue(), [entry('observation', '2026-10-01T10:00', { text: 'Black mould by window' })], 'social', today('2026-10-24'));
  assert.deepEqual(d.steps, []);
  assert.equal(d.reportedAt, null);
});

test('the overview puts missed deadlines first and fixed problems last', () => {
  const a = cleanIssue({ id: 'a', kind: 'leak', room: 'Kitchen' }, ctx);
  const b = cleanIssue({ id: 'b', kind: 'damp-mould', room: 'Bedroom' }, ctx);
  const c = cleanIssue({ id: 'c', kind: 'other', room: 'Hallway', closedAt: '2026-10-20' }, ctx);
  const entries = [
    cleanEntry({ issueId: 'b', type: 'reported', at: '2026-09-01T10:00' }, ctx),
    cleanEntry({ issueId: 'a', type: 'observation', at: '2026-10-20T10:00', text: 'Drip' }, ctx),
  ];
  const sorted = sortSummaries([a, b, c].map((i) => issueSummary(i, entries, 'social', today('2026-10-24'))));
  assert.deepEqual(sorted.map((s) => s.issue.id), ['b', 'a', 'c']);
  assert.equal(sorted[0].workingDaysSinceReport, 38);
});

test('entries are cleaned and checked before saving', () => {
  const odd = cleanEntry({ issueId: 'i1', type: 'nonsense', at: 'yesterday', text: '  hi  ' }, ctx);
  assert.equal(odd.type, 'observation');
  assert.equal(odd.at, ctx.now);
  assert.equal(odd.text, 'hi');
  const reported = entry('reported', '2026-10-10T10:00');
  assert.deepEqual(entryProblems(entry('investigation', '2026-10-09T10:00'), [reported], today('2026-10-24')),
    ['This is dated before you reported the problem. Check the date, or move the report earlier.']);
  assert.deepEqual(entryProblems(entry('observation', '2026-10-30T10:00', { text: 'x' }), [], today('2026-10-24')), ['The date is in the future.']);
  assert.equal(entryProblems(entry('health', '2026-10-20T10:00'), [], today('2026-10-24')).length, 1);
});

test('home details fall back safely', () => {
  const home = cleanHome({ landlordType: 'castle', address: '  1 High St  ' });
  assert.equal(home.landlordType, 'unknown');
  assert.equal(home.address, '1 High St');
});

test('backups round-trip and reject anything else', () => {
  const i = issue();
  const photo = { id: 'p1', issueId: 'i1', dataUrl: 'data:image/jpeg;base64,AAAA', takenAt: '2026-10-01T10:00' };
  const bad = { id: 'p2', issueId: 'i1', dataUrl: 'data:text/html;base64,PHNjcmlwdD4=' };
  const e = entry('observation', '2026-10-01T10:00', { photoIds: ['p1', 'p2'], text: 'Mould' });
  const json = JSON.stringify(makeBackup({ home: { address: '1 High St', landlordType: 'social' }, issues: [i], entries: [e], photos: [photo, bad] }, ctx.now));
  const back = readBackup(json, ctx);
  assert.equal(back.issues[0].id, 'i1');
  assert.deepEqual(back.photos.map((p) => p.id), ['p1']);
  assert.deepEqual(back.entries[0].photoIds, ['p1']);
  assert.equal(back.home.address, '1 High St');
  assert.throws(() => readBackup('{"format":"other"}', ctx), /not a DampLog backup/);
  assert.throws(() => readBackup('nope', ctx), /not valid JSON/);
});

test('issues get a readable title when none is given', () => {
  assert.equal(cleanIssue({ kind: 'leak', room: 'Bathroom' }, ctx).title, 'Leak in the bathroom');
  assert.equal(cleanIssue({ kind: 'damp-mould', room: 'Whole home' }, ctx).title, 'Damp and mould in the home');
  assert.equal(cleanIssue({ kind: 'other', title: 'Broken boiler' }, ctx).title, 'Broken boiler');
});
