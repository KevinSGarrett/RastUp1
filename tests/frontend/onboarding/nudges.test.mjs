import test from 'node:test';
import assert from 'node:assert/strict';

import { generateNudges } from '../../../tools/frontend/onboarding/nudges.mjs';

test('generateNudges prioritises highest severity blocks', () => {
  const completeness = {
    score: 55,
    blocks: ['pricing_missing', 'portfolio_insufficient', 'availability_missing'],
  };
  const nudges = generateNudges({ completeness, maxNudges: 2 });

  assert.equal(nudges.length, 2);
  assert.equal(nudges[0].id, 'upload_portfolio');
  assert.equal(nudges[1].id, 'set_pricing');
});

test('fallback nudge appears when no specific blocks exist', () => {
  const completeness = {
    score: 85,
    blocks: [],
  };
  const nudges = generateNudges({ completeness });
  assert.equal(nudges[0].id, 'share_profile');
});
