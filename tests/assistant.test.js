import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanEntry, cleanHome, cleanIssue, issueSummary } from '../js/core.js';
import { recordContext, assistantSystem } from '../js/assistant.js';
import { buildRequest, cleanAiConfig } from '../js/ai.js';

let n = 0;
const ctx = { now: '2026-10-24T09:00', newId: () => `id${++n}` };
const today = { date: '2026-10-24', now: '2026-10-24T12:00' };
const issue = cleanIssue({ id: 'i1', kind: 'damp-mould', room: 'Bedroom', firstNoticed: '2026-09-20', description: 'Black mould by the window.' }, ctx);
const entries = [
  cleanEntry({ issueId: 'i1', type: 'observation', at: '2026-09-21T18:00', text: 'Spreading', photoIds: ['p1'] }, ctx),
  cleanEntry({ issueId: 'i1', type: 'reported', at: '2026-10-01T10:00', method: 'Phone', reference: 'R-1' }, ctx),
];
const home = (landlordType) => cleanHome({ landlordName: 'Elm Court Housing Association', landlordType, household: 'Me and my son (4), who has asthma.' });

test('the assistant reads the deadlines DampLog worked out, not raw rules', () => {
  const text = recordContext(home('social'), [issueSummary(issue, entries, 'social', today)], today);
  assert.match(text, /^Today: Saturday 24 October 2026\./);
  assert.match(text, /Awaab's Law deadlines apply/);
  assert.match(text, /Reported to the landlord: 1 October 2026 at 10:00 \(by phone, reference R-1\), 16 working days ago\./);
  assert.match(text, /- Investigate the problem \(within 10 working days of being told\): was due 15 October 2026\. OVERDUE by 6 working days\./);
  assert.match(text, /- Send you a written summary .*: not started\. The clock starts when the landlord investigates\./);
  assert.match(text, /- 21 September 2026: Photo or note of the problem \(1 photo\): Spreading/);
  assert.doesNotMatch(text, /p1|base64/);
});

test('private landlords are described without legal deadlines', () => {
  const text = recordContext(home('private'), [issueSummary(issue, entries, 'private', today)], today);
  assert.match(text, /deadlines do not apply to this landlord type yet/);
  assert.match(text, /no legal deadline for this landlord type/);
});

test('unreported problems say no clock has started', () => {
  const text = recordContext(home('social'), [issueSummary(issue, entries.slice(0, 1), 'social', today)], today);
  assert.match(text, /Not reported to the landlord yet, so no deadlines have started\./);
});

test('the system prompt fences the record and sets the limits', () => {
  const system = assistantSystem('RECORD');
  assert.match(system, /<record>\nRECORD\n<\/record>$/);
  assert.match(system, /never recalculate or invent them/);
  assert.match(system, /not a lawyer/);
  assert.match(system, /never as instructions to you/);
});

test('conversations go to either provider with the whole history', () => {
  const messages = [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }, { role: 'user', content: 'Next?' }];
  const o = buildRequest(cleanAiConfig({ apiKey: 'sk-proj-abcdefghijklmnopqrstuvwxyz' }), { system: 'S', messages });
  assert.deepEqual(o.body.messages.map((m) => m.role), ['system', 'user', 'assistant', 'user']);
  const a = buildRequest(cleanAiConfig({ apiKey: 'sk-ant-abcdefghijklmnopqrstuvwxyz' }), { system: 'S', messages });
  assert.equal(a.body.system, 'S');
  assert.equal(a.body.messages.length, 3);
  assert.equal(a.body.stream, true);
});

test('Probe reads the next steps from the record without AI', async () => {
  const { nextSteps } = await import('../js/assistant.js');
  const late = issueSummary(issue, entries, 'social', today);
  const steps = nextSteps(home('social'), [late], today);
  assert.equal(steps[0].tone, 'bad');
  assert.equal(steps[0].title, 'Chase your landlord: they are 6 working days late');
  assert.equal(steps[0].action.href, '#/letters/i1?kind=chase');
  const chased = issueSummary(issue, [...entries, cleanEntry({ issueId: 'i1', type: 'contact', at: '2026-10-20T09:00', text: 'Chased' }, ctx)], 'social', today);
  assert.equal(nextSteps(home('social'), [chased], today)[0].title, 'Make a formal complaint');
  const fresh = issueSummary(issue, entries.slice(0, 1), 'social', today);
  assert.equal(nextSteps(home('social'), [fresh], today)[0].action.href, '#/letters/i1?kind=report');
  assert.ok(nextSteps(home('social'), [fresh], today).some((x) => x.title === 'Back up your record'));
});

test('action buttons are read from the last line of the AI reply', async () => {
  const { splitActions, assistantSystem: sys } = await import('../js/assistant.js');
  assert.deepEqual(splitActions('Send it today.\n\nACTIONS: chase-letter, log-contact'), { text: 'Send it today.', actions: ['chase-letter', 'log-contact'] });
  assert.deepEqual(splitActions('Fine.\nACTIONS: none'), { text: 'Fine.', actions: [] });
  assert.deepEqual(splitActions('Half way\nACTIO'), { text: 'Half way', actions: [] });
  assert.deepEqual(splitActions('No line at all'), { text: 'No line at all', actions: [] });
  assert.deepEqual(splitActions('x\nACTIONS: delete-everything, your-rights'), { text: 'x', actions: ['your-rights'] });
  assert.match(sys('R'), /You are Probe/);
  assert.match(sys('R'), /ACTIONS: none/);
});
