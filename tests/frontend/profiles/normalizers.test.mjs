import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeGraphqlProfile } from '../../../tools/frontend/profiles/index.mjs';

test('normalizeGraphqlProfile extracts core fields', () => {
  const payload = {
    serviceProfile: {
      id: 'srv_mdl_001',
      handle: 'avery',
      displayName: 'Avery Harper',
      headline: 'Fashion & editorial model',
      bio: 'Fashion model based in Austin.',
      role: 'MODEL',
      roles: ['MODEL', 'PHOTOGRAPHER'],
      location: { city: 'Austin', region: 'TX', country: 'US' },
      languages: ['English'],
      tags: ['fashion'],
      ratingAvg: 4.9,
      ratingCount: 42,
      heroImage: { url: 'https://images.stub/avery-hero.jpg', nsfwBand: 0 },
      media: [{ url: 'https://images.stub/avery-1.jpg', nsfwBand: 0 }],
      packages: [
        {
          packageId: 'pkg-1',
          name: 'Editorial Shoot',
          priceCents: 25000,
          includes: ['10 edited images'],
          addons: [{ name: 'Additional look', priceCents: 5000 }]
        }
      ],
      testimonials: [
        { id: 'rev-1', reviewer: 'Jordan', rating: 5, quote: 'Incredible collaborator!' }
      ],
      availabilityBuckets: ['2025-12-01'],
      completenessScore: 92,
      safeMode: { band: 0, override: false }
    }
  };

  const normalized = normalizeGraphqlProfile(payload);

  assert.equal(normalized.profile.displayName, 'Avery Harper');
  assert.equal(normalized.roles.length, 2);
  assert.equal(normalized.activeRole, 'MODEL');
  assert.equal(normalized.gallery.length, 1);
  assert.equal(normalized.packages[0].name, 'Editorial Shoot');
  assert.equal(normalized.testimonials.length, 1);
  assert.equal(normalized.completeness, 92);
  assert.equal(normalized.safeModeBand, 0);
  assert.ok(Array.isArray(normalized.seo?.jsonLd));
});
