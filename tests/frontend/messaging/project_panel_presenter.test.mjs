import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectProjectPanelActionCards,
  presentProjectPanelActions
} from '../../../tools/frontend/messaging/project_panel_presenter.mjs';

test('collectProjectPanelActionCards normalizes casing and prefers newest version', () => {
  const cards = collectProjectPanelActionCards([
    {
      actionId: 'act-1',
      type: 'request_extra',
      state: 'pending',
      version: 1,
      updatedAt: '2025-11-18T10:00:00Z',
      payload: { priceCents: 1000 }
    },
    {
      id: 'act-1',
      actionType: 'REQUEST_EXTRA',
      status: 'paid',
      actionVersion: 2,
      updated_at: '2025-11-18T11:00:00Z',
      payload: { priceCents: 2000 }
    },
    {
      actionId: 'act-2',
      actionType: 'DISPUTE_OPEN',
      status: 'open',
      payload: { amountCents: 5000 }
    }
  ]);

  assert.equal(cards.length, 2);
  const first = cards.find((card) => card.actionId === 'act-1');
  assert(first);
  assert.equal(first.type, 'REQUEST_EXTRA');
  assert.equal(first.state, 'PAID');
  assert.equal(first.version, 2);
  assert.equal(first.payload.priceCents, 2000);
});

test('collectProjectPanelActionCards traverses nested containers and sorts by recency', () => {
  const cards = collectProjectPanelActionCards({
    open: [
      {
        actionId: 'act-open',
        type: 'RESCHEDULE',
        state: 'PENDING',
        updatedAt: '2025-11-19T14:30:00Z',
        payload: { proposed: { start: '2025-11-22T18:00:00Z' } }
      }
    ],
    history: {
      edges: [
        {
          node: {
            actionId: 'act-history',
            type: 'refund_request',
            state: 'completed',
            updatedAt: '2025-11-19T13:00:00Z',
            payload: { amountCents: 1500 }
          }
        }
      ]
    },
    misc: [
      {
        status: 'declined',
        actionType: 'cancel_request',
        updatedAt: '2025-11-18T10:00:00Z'
      }
    ]
  });

  assert.equal(cards.length, 3);
  assert.equal(cards[0].actionId, 'act-open');
  assert.equal(cards[1].actionId, 'act-history');
  assert.equal(cards[2].type, 'CANCEL_REQUEST');
  assert(cards[0].updatedAt && cards[1].updatedAt);
});

test('collectProjectPanelActionCards generates fallback IDs when missing', () => {
  const cards = collectProjectPanelActionCards([
    { type: 'CANCEL_REQUEST', state: 'OPEN' },
    { type: 'CANCEL_REQUEST', state: 'RESOLVED', updatedAt: '2025-11-18T12:00:00Z' }
  ]);

  assert.equal(cards.length, 2);
  assert.notEqual(cards[0].actionId, cards[1].actionId);
  assert.equal(cards[0].state, 'RESOLVED');
  assert.equal(cards[1].state, 'OPEN');
});

test('presentProjectPanelActions produces presenter metadata', () => {
  const result = presentProjectPanelActions(
    [
      {
        actionId: 'act-extra',
        type: 'REQUEST_EXTRA',
        state: 'PENDING',
        payload: { name: 'Additional lighting', priceCents: 25000 }
      }
    ],
    { locale: 'en-US', currency: 'USD', timezone: 'UTC' }
  );

  assert.equal(result.length, 1);
  const entry = result[0];
  assert(entry.presentation);
  assert.equal(entry.presentation.title, 'Additional service request');
  assert(entry.presentation.requiresAttention);
  assert.ok(
    entry.presentation.metadata.some((meta) => meta.label === 'Cost' && meta.value.includes('$250')),
    'expected cost metadata to include formatted currency'
  );
});
