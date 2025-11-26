import { normalizeGraphqlProfile } from '../../../tools/frontend/profiles/index.mjs';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const structuredCloneFn =
  typeof globalThis.structuredClone === 'function'
    ? globalThis.structuredClone.bind(globalThis)
    : undefined;

function clone(value) {
  if (structuredCloneFn) {
    return structuredCloneFn(value);
  }
  return JSON.parse(JSON.stringify(value));
}

const STUB_PROFILE = Object.freeze({
  serviceProfile: {
    id: 'srv_mdl_avery',
    handle: 'avery-harper',
    slug: 'avery-harper',
    displayName: 'Avery Harper',
    headline: 'Fashion & Editorial Model · Creative Director',
    bio:
      'Austin-based model and creative director with 6+ years of runway, editorial, and campaign experience. Comfortable leading teams and co-creating moodboards for shoots.',
    role: 'MODEL',
    roles: ['MODEL', 'PHOTOGRAPHER'],
    location: { city: 'Austin', region: 'TX', country: 'US' },
    languages: ['English', 'Spanish'],
    tags: ['fashion', 'editorial', 'creative direction'],
    ratingAvg: 4.9,
    ratingCount: 42,
    stats: { bookings: 128, responseTime: 'under 1 hour' },
    heroImage: {
      url: 'https://images.rastup.stub/avery-hero.jpg',
      alt: 'Portrait of Avery Harper',
      nsfwBand: 0
    },
    media: [
      {
        url: 'https://images.rastup.stub/avery-1.jpg',
        alt: 'Editorial shot for Luxe Magazine',
        nsfwBand: 0
      },
      {
        url: 'https://images.rastup.stub/avery-2.jpg',
        alt: 'Runway show with monochrome outfit',
        nsfwBand: 0
      },
      {
        url: 'https://images.rastup.stub/avery-3.jpg',
        alt: 'Creative direction on set',
        nsfwBand: 1
      }
    ],
    packages: [
      {
        packageId: 'pkg-avery-editorial',
        name: 'Editorial Half Day',
        description: '4-hour editorial/lifestyle shoot with up to 3 looks.',
        priceCents: 45000,
        durationMinutes: 240,
        includes: ['3 looks', 'Creative direction support', 'Usage license 12 months digital'],
        addons: [
          { name: 'Additional look', priceCents: 7500 },
          { name: 'Concept moodboard', priceCents: 5000 }
        ]
      },
      {
        packageId: 'pkg-avery-runway',
        name: 'Runway & Events',
        priceCents: 30000,
        durationMinutes: 180,
        includes: ['2 rehearsals', 'Event walkthrough', 'Social amplification']
      }
    ],
    testimonials: [
      {
        id: 'rev-11',
        reviewer: 'Jordan Lee · Art Director',
        rating: 5,
        quote:
          'Avery anticipates creative needs and keeps the team calm. We finished ahead of schedule with better shots than planned.',
        createdAt: new Date(Date.now() - ONE_DAY_MS * 30).toISOString()
      },
      {
        id: 'rev-12',
        reviewer: 'Maria Chen · Photographer',
        rating: 5,
        quote:
          'Avery brings concepts to life and contributes ideas that elevate the brief. Stellar collaborator.',
        createdAt: new Date(Date.now() - ONE_DAY_MS * 90).toISOString()
      }
    ],
    availabilityBuckets: [
      new Date(Date.now() + ONE_DAY_MS * 2).toISOString().slice(0, 10),
      new Date(Date.now() + ONE_DAY_MS * 4).toISOString().slice(0, 10)
    ],
    completenessScore: 92,
    safeMode: { band: 1, override: false },
    social: {
      instagram: { handle: '@averyharper', followers: 182000 },
      tiktok: { handle: '@averyharper', followers: 520000 }
    }
  }
});

export const PROFILE_QUERY = `
  query Profile($handle: String!, $role: RoleCategory) {
    profile(handle: $handle, role: $role) {
      id
      handle
      slug
      displayName
      headline
      bio
      roles
      role
      location {
        city
        region
        country
      }
      languages
      tags
      stats {
        bookings
        responseTime
      }
      ratingAvg
      ratingCount
      heroImage {
        url
        alt
        nsfwBand
      }
      media {
        url
        alt
        nsfwBand
      }
      packages {
        packageId
        name
        description
        priceCents
        durationMinutes
        includes
        addons {
          name
          priceCents
        }
      }
      testimonials {
        id
        reviewer
        rating
        quote
        createdAt
      }
      availabilityBuckets
      completenessScore
      completenessSegments {
        about
        portfolio
        packages
        verification
      }
      safeMode {
        band
        override
      }
      social {
        instagram {
          handle
          followers
        }
        tiktok {
          handle
          followers
        }
      }
    }
  }
`;

export function createProfileDataSource({ executeQuery } = {}) {
  async function fetchProfile({ handle, role, safeMode = true } = {}) {
    if (typeof executeQuery === 'function') {
      const response = await executeQuery({
        query: PROFILE_QUERY,
        variables: {
          handle,
          role
        }
      });
      const normalized = normalizeGraphqlProfile(response?.data ?? response);
      if (safeMode) {
        normalized.gallery = normalized.gallery.filter(
          (item) => (item?.nsfwBand ?? 0) <= 1
        );
      }
      return normalized;
    }

    const stub = clone(STUB_PROFILE);
    if (role && stub.serviceProfile.roles.includes(role)) {
      stub.serviceProfile.role = role;
      stub.serviceProfile.activeRole = role;
    }
    if (!safeMode) {
      stub.serviceProfile.safeMode = { band: 2, override: false };
    }
    const normalized = normalizeGraphqlProfile(stub);
    if (safeMode) {
      normalized.gallery = normalized.gallery.filter((item) => (item?.nsfwBand ?? 0) <= 1);
    }
    return normalized;
  }

  return {
    fetchProfile
  };
}
