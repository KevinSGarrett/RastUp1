import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_COMPLETENESS_THRESHOLD,
  SAFE_MODE_ALLOWED_BAND,
  applySafeMode,
  computeCompletenessScore,
  determinePublishReadiness,
  validateServiceProfile
} from '../../services/profiles/domain.js';

function buildValidProfile(overrides = {}) {
  return {
    role: 'model',
    displayName: 'Alex Example',
    slug: 'alex-example',
    city: 'Austin',
    region: 'TX',
    country: 'US',
    aboutFields: {
      bio: 'Professional fashion model with extensive editorial experience.',
      height_cm: 178,
      bust_cm: 86,
      waist_cm: 63,
      hips_cm: 91,
      genres: ['fashion', 'editorial'],
      experience_years: 5
    },
    pricingFields: [
      {
        package_id: 'pkg_2hr',
        name: '2-Hour Shoot',
        price_cents: 25000,
        duration_min: 120,
        includes: ['10 edited photos'],
        addons: [{ name: 'Extra retouch', price_cents: 1500 }]
      }
    ],
    socialFields: {
      instagram: {
        handle: '@alex',
        followers: 120000,
        engagement_rate: 0.03
      }
    },
    languages: ['English', 'Spanish'],
    tags: ['fashion', 'editorial', 'verified'],
    safeModeBand: 0,
    verification: { id: true, background: true },
    instantBook: true,
    ...overrides
  };
}

test('validateServiceProfile rejects missing essentials', () => {
  const candidate = buildValidProfile({
    displayName: '',
    pricingFields: []
  });

  const result = validateServiceProfile(candidate);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'DISPLAY_NAME_REQUIRED'));
  assert.ok(result.issues.some((issue) => issue.code === 'PRICING_REQUIRED'));
});

test('validateServiceProfile returns normalized data and warnings for trimming', () => {
  const candidate = buildValidProfile({
    languages: ['English', 'Spanish', 'French', 'Italian', 'German', 'Japanese']
  });

  const result = validateServiceProfile(candidate);
  assert.equal(result.ok, true);
  assert.equal(result.normalized.languages.length, 5);
  assert.ok(result.warnings.some((warning) => warning.code === 'LANGUAGE_TRIMMED'));
});

test('computeCompletenessScore aggregates signals and caps at 100', () => {
  const candidate = buildValidProfile();
  const signals = {
    hasIdVerification: true,
    hasBackgroundCheck: true,
    portfolioCount: 24,
    primaryMediaApproved: true,
    availabilityDays: 14,
    reviewCount: 30,
    reviewAverage: 4.9,
    hasInstantBook: true,
    hasStudioLink: true,
    socialFollowers: 500000,
    docStatus: 'signed',
    payoutOnboarded: true
  };

  const result = computeCompletenessScore(candidate, signals);
  assert.equal(result.score, 100);
  assert.equal(result.capped, true);
  assert.ok(result.components.identity >= 20);
});

test('determinePublishReadiness surfaces blocking reasons for score and safe-mode', () => {
  const candidate = buildValidProfile({
    pricingFields: [], // force validation error
    safeModeBand: 2
  });
  const signals = { hasIdVerification: false };

  const readiness = determinePublishReadiness(candidate, signals, { minScore: DEFAULT_COMPLETENESS_THRESHOLD });

  assert.equal(readiness.publishable, false);
  assert.ok(readiness.blockingReasons.some((reason) => reason.code === 'PRICING_REQUIRED'));
  assert.ok(readiness.blockingReasons.some((reason) => reason.code === 'LOW_COMPLETENESS'));
  assert.ok(
    readiness.blockingReasons.some(
      (reason) => reason.code === 'SAFE_MODE_BLOCK' && reason.meta?.allowedBand === SAFE_MODE_ALLOWED_BAND
    )
  );
});

test('applySafeMode blurs band-1 media and filters higher bands', () => {
  const mediaItems = [
    { id: 'safe', url: 'https://cdn/safe.jpg', nsfwBand: 0 },
    { id: 'blur', url: 'https://cdn/blur.jpg', nsfwBand: 1, blurUrl: 'https://cdn/blurred.jpg' },
    { id: 'blocked', url: 'https://cdn/nsfw.jpg', nsfwBand: 2 }
  ];

  const { visible, filtered, reason } = applySafeMode(mediaItems, 0, {
    safeModeEnabled: true,
    allowedBand: 1
  });

  assert.equal(visible.length, 2);
  assert.equal(filtered.length, 1);
  assert.equal(reason, 'SAFE_MODE_FILTERED');
  const blurItem = visible.find((item) => item.id === 'blur');
  assert.equal(blurItem.url, 'https://cdn/blurred.jpg');
  assert.equal(blurItem.safeModeApplied, true);
});
