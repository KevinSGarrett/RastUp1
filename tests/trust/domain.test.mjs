import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_THRESHOLDS,
  computeEligibilityGates,
  computeRiskScore,
  deriveTrustBadges,
  evaluateTrustStatus,
  nextRecertificationAt,
  requiresTwoPersonApproval
} from '../../services/trust/domain.js';

test('computeRiskScore subtracts weighted incidents and clamps to zero', () => {
  const metrics = {
    disputesOpened: 3,
    refundsAsked: 2,
    cancellations: 1,
    lateDelivery: 1,
    chargeFailures: 0,
    badClicks: 4
  };

  const score = computeRiskScore(metrics);
  assert.equal(score, 100 - (3 * 10 + 2 * 8 + 1 * 5 + 1 * 4 + 4 * 3));
  assert.equal(computeRiskScore({ score: 132 }), 100);
  assert.equal(computeRiskScore({ score: -10 }), 0);
});

test('evaluateTrustStatus aggregates IDV, BG, social, and risk signals', () => {
  const status = evaluateTrustStatus({
    idv: { status: 'passed', ageVerified: true, updatedAt: '2025-01-01T00:00:00Z' },
    bg: { status: 'clear', adjudication: null, updatedAt: '2025-01-10T00:00:00Z' },
    socials: [
      { platform: 'instagram', handle: '@example', verified: true },
      { platform: 'tiktok', handle: '@example_tt', verified: false }
    ],
    riskMetrics: { disputesOpened: 0 }
  });

  assert.equal(status.idVerified, true);
  assert.equal(status.trustedPro, true);
  assert.equal(status.socialVerified, true);
  assert.ok(status.badges.includes('trusted_pro'));
  assert.equal(status.lastIdvAt, '2025-01-01T00:00:00Z');
  assert.equal(status.lastBgAt, '2025-01-10T00:00:00Z');
});

test('deriveTrustBadges returns badges for enabled signals', () => {
  const badges = deriveTrustBadges({ idVerified: true, trustedPro: false, socialVerified: true });
  assert.deepEqual(badges, ['id_verified', 'social_verified']);
});

test('computeEligibilityGates reflects configured thresholds', () => {
  const trustStatus = {
    idVerified: true,
    trustedPro: false,
    socialVerified: true,
    riskScore: DEFAULT_THRESHOLDS.promotions,
    badges: []
  };

  const eligibility = computeEligibilityGates(trustStatus);
  assert.equal(eligibility.canInstantBook, true);
  assert.equal(eligibility.promotionEligible, true);
  assert.equal(eligibility.requiresManualReview, false);
  assert.equal(eligibility.safeModeOverrideAllowed, trustStatus.riskScore >= DEFAULT_THRESHOLDS.safeModeOverride);
});

test('requiresTwoPersonApproval enforces policy set', () => {
  assert.equal(requiresTwoPersonApproval({ action: 'override_safe_mode', severity: 'medium' }), true);
  assert.equal(requiresTwoPersonApproval({ action: 'trust_badge_revoke' }), true);
  assert.equal(requiresTwoPersonApproval({ action: 'note', severity: 'low' }), false);
  assert.equal(requiresTwoPersonApproval({ action: 'other', severity: 'high' }), true);
});

test('nextRecertificationAt computes future timestamps', () => {
  const idvRecert = nextRecertificationAt({ updatedAt: '2025-01-01T00:00:00Z' }, 'idv', { idvMonths: 12 });
  assert.ok(idvRecert.startsWith('2026-01'));

  const bgRecert = nextRecertificationAt({ updated_at: '2025-03-15T00:00:00Z' }, 'bg');
  assert.ok(bgRecert.startsWith('2026-03'));

  const socialRecert = nextRecertificationAt({ updatedAt: '2025-05-01T00:00:00Z' }, 'social', { socialDays: 7 });
  assert.ok(socialRecert.startsWith('2025-05-0'));

  assert.equal(nextRecertificationAt({}, 'idv'), null);
});
