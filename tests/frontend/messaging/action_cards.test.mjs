import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getAllowedTransitions,
  transitionActionCard,
  isTerminalState,
  describeActionCard,
  DEFAULT_ACTION_CARD_DEFINITIONS
} from '../../../tools/frontend/messaging/action_cards.mjs';

test('getAllowedTransitions returns default mapping for RESCHEDULE', () => {
  const card = {
    actionId: 'act-1',
    type: 'RESCHEDULE',
    state: 'PENDING',
    version: 1
  };
  const transitions = getAllowedTransitions(card);
  const intents = transitions.map((entry) => entry.intent).sort();
  assert.deepEqual(intents, ['accept', 'decline', 'expire']);
});

test('transitionActionCard updates state, version, payload, and audit metadata', () => {
  const card = {
    actionId: 'act-2',
    type: 'REQUEST_EXTRA',
    state: 'PENDING',
    version: 1,
    payload: { name: 'Extra edits', priceCents: 2500 }
  };
  const { card: nextCard, auditEvent } = transitionActionCard(card, 'approve', {
    now: Date.parse('2025-11-19T08:00:00.000Z'),
    actorUserId: 'usr-123',
    threadId: 'thr-123',
    payloadPatch: { paymentIntentId: 'pi_test' },
    metadata: { approvedBy: 'usr-123' }
  });
  assert.equal(nextCard.state, 'PAID');
  assert.equal(nextCard.version, 2);
  assert.equal(nextCard.payload.paymentIntentId, 'pi_test');
  assert.equal(nextCard.metadata.approvedBy, 'usr-123');
  assert.ok(auditEvent);
  assert.equal(auditEvent.payload.intent, 'approve');
  assert.equal(auditEvent.payload.actionType, 'REQUEST_EXTRA');
  assert.equal(auditEvent.payload.actorUserId, 'usr-123');
});

test('transitionActionCard honours card-provided allowedTransitions', () => {
  const card = {
    actionId: 'act-custom',
    type: 'CUSTOM',
    state: 'STEP_ONE',
    version: 0,
    allowedTransitions: [
      { intent: 'advance', toState: 'STEP_TWO' },
      { intent: 'cancel', toState: 'CANCELLED' }
    ]
  };
  const { card: nextCard } = transitionActionCard(card, 'advance', {
    versionIncrement: 5
  });
  assert.equal(nextCard.state, 'STEP_TWO');
  assert.equal(nextCard.version, 5);
});

test('isTerminalState reflects default definitions', () => {
  const card = {
    type: 'DEPOSIT_CLAIM_OPEN',
    state: 'APPROVED'
  };
  assert.equal(isTerminalState(card), true);
});

test('describeActionCard surfaces category and pending flag', () => {
  const card = {
    type: 'RESCHEDULE',
    state: 'PENDING',
    createdAt: '2025-11-19T07:00:00.000Z'
  };
  const summary = describeActionCard(card);
  assert.equal(summary.category, DEFAULT_ACTION_CARD_DEFINITIONS.RESCHEDULE.category);
  assert.equal(summary.pending, true);
  assert.equal(summary.type, 'RESCHEDULE');
});

test('invalid transition throws descriptive error', () => {
  const card = {
    actionId: 'act-3',
    type: 'RESCHEDULE',
    state: 'PENDING'
  };
  assert.throws(() => {
    transitionActionCard(card, 'reject');
  }, /Invalid transition/);
});
