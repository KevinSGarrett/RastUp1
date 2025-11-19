import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDisputeRecord,
  appendEvidence,
  buildEvidenceKit,
  applyDisputeOutcome,
  shouldPausePayout,
  DisputeError
} from '../../services/booking/disputes.js';

test('createDisputeRecord populates defaults', () => {
  const dispute = createDisputeRecord({
    legId: 'leg_1',
    processor: 'stripe',
    reason: 'product not delivered',
    evidenceDueAt: '2025-11-30T00:00:00Z',
    nowIso: '2025-11-19T00:00:00Z'
  });
  assert.equal(dispute.status, 'needs_response');
  assert.equal(dispute.reason, 'product not delivered');
  assert.equal(dispute.evidence.length, 0);
});

test('appendEvidence normalizes entries', () => {
  const dispute = createDisputeRecord({ legId: 'leg_2', processor: 'stripe', reason: 'damage' });
  const updated = appendEvidence(dispute, [{ kind: 'photo', url: 'https://example.org/img.jpg' }]);
  assert.equal(updated.evidence.length, 1);
  assert.equal(updated.evidence[0].kind, 'photo');
});

test('buildEvidenceKit includes timeline when leg snapshot supplied', () => {
  const dispute = createDisputeRecord({ legId: 'leg_3', processor: 'stripe', reason: 'no show' });
  const enriched = buildEvidenceKit({
    dispute,
    legSnapshot: {
      startAt: '2025-11-20T10:00:00Z',
      endAt: '2025-11-20T12:00:00Z',
      policy: { bands: [] },
      totalCents: 50000
    },
    receipts: [{ url: 'https://example.org/receipt.pdf' }]
  });
  assert.equal(enriched.evidence.length >= 2, true);
  assert.equal(enriched.evidence[0].kind, 'timeline');
});

test('applyDisputeOutcome produces reserve directives', () => {
  const dispute = createDisputeRecord({ legId: 'leg_4', processor: 'stripe', reason: 'quality issue' });
  const result = applyDisputeOutcome({
    dispute,
    outcome: 'lost',
    reserveEntry: { entryId: 'res_1', reserveCents: 10000 }
  });
  assert.equal(result.dispute.status, 'lost');
  assert.equal(result.reserveDirective.action, 'FORFEIT');
});

test('shouldPausePayout reflects status', () => {
  assert.equal(shouldPausePayout('needs_response'), true);
  assert.equal(shouldPausePayout('won'), false);
});

test('normalize evidence rejects invalid records', () => {
  const dispute = createDisputeRecord({ legId: 'leg_5', processor: 'stripe', reason: 'invalid evidence' });
  assert.throws(
    () => appendEvidence(dispute, [{ kind: 'unsupported' }]),
    (error) => error instanceof DisputeError && error.code === 'EVIDENCE_KIND_UNSUPPORTED'
  );
});
