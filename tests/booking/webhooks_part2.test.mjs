import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeStripeEvent, normalizeEvent, createWebhookDeduper } from '../../services/booking/webhooks.js';

test('normalizeStripeEvent maps metadata and leg ids', () => {
  const event = {
    id: 'evt_1',
    type: 'payment_intent.succeeded',
    created: 1700000000,
    data: {
      object: {
        id: 'pi_123',
        amount: 113000,
        metadata: {
          lbg_id: 'lbg_123',
          leg_ids: 'leg_a,leg_b'
        }
      }
    }
  };

  const normalized = normalizeStripeEvent(event);
  assert.equal(normalized.normalizedType, 'fin.charge.succeeded');
  assert.equal(normalized.lbgId, 'lbg_123');
  assert.deepEqual(normalized.legIds, ['leg_a', 'leg_b']);
});

test('normalizeEvent dispatches to provider-specific handlers', () => {
  const taxEvent = normalizeEvent('tax', { id: 'tax_evt_1', type: 'tax.quote', payload: { jurisdiction: 'NY' } });
  assert.equal(taxEvent.normalizedType, 'tax.quote');

  const docEvent = normalizeEvent('doc', {
    id: 'doc_evt_1',
    type: 'envelope.completed',
    payload: { lbgId: 'lbg_123', legIds: ['leg_a'] },
    completedAt: '2025-12-01T09:00:00Z'
  });
  assert.equal(docEvent.normalizedType, 'doc.envelope.completed');
});

test('createWebhookDeduper detects duplicates and preserves snapshot', () => {
  const deduper = createWebhookDeduper();
  const firstProcess = deduper.shouldProcess({ provider: 'stripe', eventId: 'evt_1' });
  const secondProcess = deduper.shouldProcess({ provider: 'stripe', eventId: 'evt_1' });

  assert.equal(firstProcess, true);
  assert.equal(secondProcess, false);

  const snapshot = deduper.snapshot();
  assert.deepEqual(snapshot, [{ provider: 'stripe', eventId: 'evt_1' }]);
});
