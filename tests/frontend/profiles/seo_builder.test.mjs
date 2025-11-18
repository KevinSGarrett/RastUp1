import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildProfileJsonLd,
  buildHreflangLinks,
} from '../../../tools/frontend/profiles/seo_builder.mjs';

test('buildProfileJsonLd excludes unsafe media in Safe-Mode', () => {
  const profile = {
    slug: 'jane-smith',
    locale: 'en-US',
    displayName: 'Jane Smith',
    headline: 'Creative portrait photographer',
    roleType: 'Photographer',
    media: [
      { url: 'https://cdn.example.com/media/1-safe.jpg', safe: true },
      { url: 'https://cdn.example.com/media/2-unsafe.jpg', safe: false },
    ],
    verified: true,
    reviews: [{ rating: 5 }, { rating: 4 }],
  };

  const jsonLd = buildProfileJsonLd(profile, { safeMode: true, baseUrl: 'https://example.com' });
  const entity = jsonLd.find((node) => node['@id'] === 'https://example.com/en-us/jane-smith#entity');
  assert.ok(entity);
  assert.deepEqual(entity.image, ['https://cdn.example.com/media/1-safe.jpg']);
  assert.ok(entity.hasCredential);
  assert.equal(entity.aggregateRating.reviewCount, 2);
});

test('buildHreflangLinks generates alternate tags per locale', () => {
  const links = buildHreflangLinks({
    baseUrl: 'https://example.com',
    slug: 'jane-smith',
    locales: ['en-US', 'fr-FR'],
  });

  assert.deepEqual(links, [
    { rel: 'alternate', hreflang: 'en-US', href: 'https://example.com/en-us/jane-smith' },
    { rel: 'alternate', hreflang: 'fr-FR', href: 'https://example.com/fr-fr/jane-smith' },
  ]);
});
