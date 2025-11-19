import test from 'node:test';
import assert from 'node:assert/strict';

import {
  presentActionCard,
  formatActionCardIntentLabel
} from '../../../tools/frontend/messaging/action_card_presenter.mjs';

test('presentActionCard formats reschedule cards with schedule metadata', () => {
  const card = {
    actionId: 'act-reschedule',
    type: 'RESCHEDULE',
    state: 'PENDING',
    payload: {
      old: { start: '2025-11-20T15:00:00Z', end: '2025-11-20T16:00:00Z' },
      proposed: { start: '2025-11-21T18:30:00Z', end: '2025-11-21T19:30:00Z' },
      reason: 'Weather delay'
    }
  };

  const presentation = presentActionCard(card, { locale: 'en-US', timezone: 'UTC' });

  assert.equal(presentation.title, 'Reschedule request');
  assert.equal(presentation.requiresAttention, true);
  assert.equal(presentation.stateTone, 'warning');
  assert.ok(
    presentation.metadata.some((entry) => entry.label === 'Proposed schedule' && typeof entry.value === 'string'),
    'expected proposed schedule metadata'
  );
  assert.ok(
    presentation.metadata.some((entry) => entry.label === 'Reason' && entry.value.includes('Weather')),
    'expected reason metadata to include payload reason'
  );
});

test('presentActionCard formats additional service requests with cost', () => {
  const card = {
    actionId: 'act-extra',
    type: 'REQUEST_EXTRA',
    state: 'PENDING',
    payload: {
      name: 'Additional lighting',
      priceCents: 25000,
      note: 'Includes gels and stands'
    }
  };

  const presentation = presentActionCard(card, { locale: 'en-US', currency: 'USD' });

  assert.equal(presentation.title, 'Additional service request');
  assert.equal(presentation.stateTone, 'warning');
  const costRow = presentation.metadata.find((entry) => entry.label === 'Cost');
  assert.ok(costRow, 'expected cost metadata');
  assert.ok(costRow.value.includes('$250'), 'expected cost to contain formatted currency');
  assert.ok(presentation.summary.toLowerCase().includes('additional service'), 'summary should mention additional service');
});

test('presentActionCard includes evidence attachments for deposit claims', () => {
  const card = {
    actionId: 'act-deposit',
    type: 'DEPOSIT_CLAIM_OPEN',
    state: 'PENDING',
    payload: {
      amountCents: 5000,
      evidence: ['photo-1', 'invoice-2'],
      reason: 'Damaged equipment'
    }
  };

  const presentation = presentActionCard(card, { locale: 'en-US', currency: 'USD' });

  assert.equal(presentation.stateTone, 'warning');
  assert.ok(
    presentation.metadata.some((entry) => entry.label === 'Claim amount' && entry.value.includes('50.00')),
    'expected formatted claim amount'
  );
  assert.equal(presentation.attachments.length, 2);
  assert.ok(
    presentation.attachments.every((entry) => entry.label === 'Evidence'),
    'expected attachments to be labeled as evidence'
  );
});

test('presentActionCard marks completed cards as not requiring attention', () => {
  const card = {
    actionId: 'act-complete',
    type: 'REQUEST_EXTRA',
    state: 'PAID',
    payload: {
      name: 'Travel',
      priceCents: 1500
    }
  };

  const presentation = presentActionCard(card, { locale: 'en-US', currency: 'USD' });
  assert.equal(presentation.requiresAttention, false);
  assert.equal(presentation.stateTone, 'success');
});

test('formatActionCardIntentLabel produces human readable labels', () => {
  assert.equal(formatActionCardIntentLabel('request_revisions'), 'Request revisions');
  assert.equal(formatActionCardIntentLabel('approve'), 'Approve');
  assert.equal(formatActionCardIntentLabel('custom_action'), 'Custom Action');
});
