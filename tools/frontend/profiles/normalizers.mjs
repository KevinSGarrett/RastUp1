import { buildProfileJsonLd } from './seo_builder.mjs';

/**
 * Converts a GraphQL service profile payload into the profile store shape.
 * @param {object} payload
 */
export function normalizeGraphqlProfile(payload = {}) {
  if (!payload || typeof payload !== 'object') {
    return {};
  }

  const profile = payload.profile ?? payload.serviceProfile ?? payload;
  const heroImage = profile.heroImage ?? profile.media?.[0] ?? null;
  const gallery =
    Array.isArray(profile.gallery) && profile.gallery.length
      ? profile.gallery
      : Array.isArray(profile.media)
      ? profile.media
      : [];

  const packages = Array.isArray(profile.packages)
    ? profile.packages.map((pkg) => ({
        packageId: pkg.packageId ?? pkg.id ?? null,
        name: pkg.name ?? 'Package',
        description: pkg.description ?? null,
        priceCents: pkg.priceCents ?? pkg.price ?? null,
        durationMinutes: pkg.durationMinutes ?? pkg.duration ?? null,
        includes: Array.isArray(pkg.includes) ? pkg.includes : [],
        addons: Array.isArray(pkg.addons) ? pkg.addons : []
      }))
    : [];

  const testimonials = Array.isArray(profile.testimonials)
    ? profile.testimonials
    : Array.isArray(profile.reviews)
    ? profile.reviews.map((review) => ({
        id: review.id ?? null,
        reviewer: review.reviewer ?? review.author ?? null,
        rating: review.rating ?? null,
        quote: review.quote ?? review.comment ?? null,
        createdAt: review.createdAt ?? null
      }))
    : [];

  const addOns = Array.isArray(profile.addOns)
    ? profile.addOns
    : packages.flatMap((pkg) => pkg.addons ?? []);

  const seoJsonLd = buildProfileJsonLd({
    slug: profile.slug ?? profile.handle ?? profile.id ?? 'profile',
    locale: profile.locale ?? 'en-US',
    displayName: profile.displayName ?? profile.name ?? 'Unknown profile',
    headline: profile.headline ?? profile.tagline ?? null,
    roleType: profile.role ?? profile.roleType ?? null,
    location: profile.location ?? {
      city: profile.city ?? null,
      region: profile.region ?? null,
      country: profile.country ?? null
    },
    media: gallery,
    safeModeActive: Boolean(profile.safeMode?.enabled ?? profile.safeModeActive),
    packages,
    reviews: testimonials
  });

  return {
    profile: {
      id: profile.id ?? profile.serviceProfileId ?? null,
      handle: profile.handle ?? null,
      displayName: profile.displayName ?? profile.name ?? 'Unknown profile',
      headline: profile.headline ?? profile.tagline ?? null,
      bio: profile.bio ?? '',
      location: profile.location ?? {
        city: profile.city ?? null,
        region: profile.region ?? null,
        country: profile.country ?? null
      },
      languages: Array.isArray(profile.languages) ? profile.languages : [],
      tags: Array.isArray(profile.tags) ? profile.tags : [],
      stats: {
        ratingAvg: profile.ratingAvg ?? profile.reviewStats?.ratingAvg ?? null,
        ratingCount: profile.ratingCount ?? profile.reviewStats?.ratingCount ?? null,
        bookings: profile.stats?.bookings ?? null,
        responseTime: profile.stats?.responseTime ?? null
      },
      social: profile.social ?? {}
    },
    roles: Array.isArray(profile.roles) ? profile.roles : profile.role ? [profile.role] : [],
    activeRole: profile.activeRole ?? profile.role ?? null,
    hero: heroImage ? { ...heroImage } : null,
    gallery,
    packages,
    testimonials,
    addOns,
    availability: Array.isArray(profile.availabilityBuckets)
      ? profile.availabilityBuckets
      : Array.isArray(profile.availability)
      ? profile.availability
      : [],
    completeness: profile.completeness ?? profile.completenessScore ?? null,
    completenessSegments: profile.completenessSegments ?? null,
    safeModeBand: profile.safeMode?.band ?? profile.safeModeBand ?? 0,
    safeModeOverride: profile.safeMode?.override ?? profile.safeModeOverride ?? false,
    seo: {
      jsonLd: seoJsonLd,
      canonicalUrl: profile.canonicalUrl ?? null,
      metaDescription:
        profile.metaDescription ??
        (profile.bio ? profile.bio.slice(0, 200) : `View ${profile.displayName ?? 'profile'} on RastUp`)
    }
  };
}
