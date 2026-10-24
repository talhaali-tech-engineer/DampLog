import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanEntry, cleanHome, cleanIssue, issueSummary } from '../js/core.js';
import { buildLetter, longDate } from '../js/letters.js';

let n = 0;
const ctx = { now: '2026-10-24T09:00', newId: () => `id${++n}` };
const home = (landlordType = 'social') => cleanHome({
  tenantName: 'Sam Carter', address: '14 Elm Court, London E1 1AA', landlordName: 'Riverside Homes', landlordType, tenancyRef: 'T-2231',
  household: 'Me, my partner and our son (4), who has asthma.',
});
const issue = cleanIssue({ id: 'i1', kind: 'damp-mould', room: 'Bedroom', firstNoticed: '2026-09-20', description: 'Black mould behind the wardrobe.' }, ctx);
const entries = [
  cleanEntry({ issueId: 'i1', type: 'observation', at: '2026-09-21T18:00', text: 'Mould spreading', photoIds: ['p1', 'p2'] }, ctx),
  cleanEntry({ issueId: 'i1', type: 'reported', at: '2026-10-01T10:00', method: 'Phone', reference: 'R-5521' }, ctx),
  cleanEntry({ issueId: 'i1', type: 'health', at: '2026-10-05T08:00', text: 'Our son needed his inhaler more at night.' }, ctx),
];
const summary = (type) => issueSummary(issue, entries, type, { date: '2026-10-24', now: '2026-10-24T12:00' });

test('dates are written out in full', () => {
  assert.equal(longDate('2026-10-01'), '1 October 2026');
});

test('a social tenant\'s report cites Awaab\'s Law and its deadlines', () => {
  const { subject, body } = buildLetter('report', { home: home(), summary: summary('social'), today: '2026-10-24' });
  assert.equal(subject, 'Report of damp and mould at 14 Elm Court, London E1 1AA');
  assert.match(body, /^24 October 2026/);
  assert.match(body, /Dear Riverside Homes,/);
  assert.match(body, /damp and mould in the bedroom of my home/);
  assert.match(body, /Awaab's Law/);
  assert.match(body, /within 10 working days/);
  assert.match(body, /needed his inhaler/);
  assert.match(body, /2 photographs/);
  assert.match(body, /Sam Carter/);
});

test('a private tenant\'s report makes no Awaab\'s Law claim', () => {
  const { body } = buildLetter('report', { home: home('private'), summary: summary('private'), today: '2026-10-24' });
  assert.doesNotMatch(body, /Awaab/);
  assert.match(body, /fit to live in/);
});

test('the chase letter names each missed deadline and its date', () => {
  const { subject, body } = buildLetter('chase', { home: home(), summary: summary('social'), today: '2026-10-24' });
  assert.match(subject, /^Missed deadlines/);
  assert.match(body, /on 1 October 2026 by phone \(reference R-5521\)/);
  assert.match(body, /Investigate the problem: this was due by 15 October 2026 and has not happened/);
  assert.match(body, /Housing Ombudsman/);
});

test('the complaint carries the whole timeline', () => {
  const { body } = buildLetter('complaint', { home: home(), summary: summary('social'), today: '2026-10-24' });
  assert.match(body, /formal complaint under your complaints procedure/);
  assert.match(body, /- 21 September 2026: Photo or note of the problem \(2 photos\): Mould spreading/);
  assert.match(body, /- 1 October 2026: Reported to the landlord \(by phone, reference R-5521\)/);
  assert.match(body, /The problem has still not been fixed/);
});

test('whole-home problems read naturally', () => {
  const whole = cleanIssue({ id: 'i1', kind: 'damp-mould', room: 'Whole home' }, ctx);
  const s = issueSummary(whole, [], 'social', { date: '2026-10-24', now: '2026-10-24T12:00' });
  assert.match(buildLetter('report', { home: home(), summary: s, today: '2026-10-24' }).body, /report damp and mould in my home at/);
});
