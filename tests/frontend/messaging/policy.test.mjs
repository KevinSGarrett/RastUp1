import test from 'node:test';
import assert from 'node:assert/strict';

import { createPolicyState, evaluateText, evaluateWithAudit } from '../../../tools/frontend/messaging/policy.mjs';

test('evaluateText allows clean messages', () => {
  const state = createPolicyState();
  const result = evaluateText(state, 'Looking forward to working with you!');
  assert.equal(result.status, 'ALLOW');
  assert.equal(result.matches.length, 0);
});

test('evaluateText blocks hard violations immediately', () => {
  const state = createPolicyState();
  const result = evaluateText(state, 'Email me at user@gmail.com', { now: 0 });
  assert.equal(result.status, 'BLOCK');
  assert.equal(result.matches[0].severity, 'HARD');
});

test('evaluateText nudges first soft violation and blocks after escalation', () => {
  let state = createPolicyState();
  let result = evaluateText(state, 'Let us talk off-platform', { now: 0 });
  assert.equal(result.status, 'NUDGE');
  state = result.state;

  result = evaluateText(state, 'Please text me for details', { now: 1000 });
  assert.equal(result.status, 'BLOCK');
  assert.ok(result.matches.some((m) => m.severity === 'SOFT'));
});

test('evaluateText resets soft escalation after window expires', () => {
  const state = createPolicyState();
  let result = evaluateText(state, 'Let us talk off-platform', { now: 0, softEscalationWindowMs: 1000 });
  assert.equal(result.status, 'NUDGE');
  result = evaluateText(result.state, 'Let us talk off-platform again', { now: 5000, softEscalationWindowMs: 1000 });
  assert.equal(result.status, 'NUDGE', 'window expired so should be nudge, not block');
});

test('evaluateWithAudit emits audit for violations', () => {
  const state = createPolicyState();
  const result = evaluateWithAudit(state, 'Email me user@gmail.com', {
    threadId: 'thr-1',
    userId: 'usr-1'
  });
  assert.equal(result.status, 'BLOCK');
  assert.ok(result.auditEvent);
  assert.equal(result.auditEvent.payload.threadId, 'thr-1');
});
