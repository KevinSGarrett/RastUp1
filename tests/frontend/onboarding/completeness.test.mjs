import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateCompleteness,
} from '../../../tools/frontend/onboarding/completeness.mjs';

test('provider without portfolio is blocked from publish', () => {
  const completeness = evaluateCompleteness({
    role: 'provider',
    provider: {
      identity: { legalName: 'Jane Smith', displayName: 'Jane', location: 'Los Angeles' },
      roles: ['photographer'],
      portfolio: { approvedCount: 2, minimumApproved: 6, sfwCompliant: true },
      pricing: { packages: [{ name: 'Standard', price: 200 }] },
      availability: { weeklyTemplate: true, timezone: 'America/Los_Angeles', meetsMinHours: true },
      verification: { status: 'submitted' },
      payout: { status: 'ready' },
    },
  });

  assert.equal(completeness.eligible.publish, false);
  assert.ok(completeness.blocks.includes('portfolio_insufficient'));
});

test('studio meeting criteria becomes Instant Book eligible', () => {
  const completeness = evaluateCompleteness({
    role: 'host',
    host: {
      basics: { name: 'Studio 7', city: 'NYC', capacity: 20, mapPinVerified: true },
      policies: { cancellation: '48h', reschedule: '24h' },
      pricing: { hourlyMin: 150, hourlyMax: 400, depositPolicy: 'configured' },
      availability: { calendarSynced: true, buffersConfigured: true },
      verification: { status: 'verified' },
      insurance: { status: 'approved' },
    },
  });

  assert.ok(completeness.score >= 80, 'score should meet Instant Book threshold');
  assert.equal(completeness.eligible.instantBook, true);
  assert.equal(completeness.blocks.length, 0);
});
