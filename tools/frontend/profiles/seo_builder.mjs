const DEFAULT_BASE_URL = 'https://rastup.com';

/**
 * Builds JSON-LD fragments for a public profile.
 * @param {object} profile
 * @param {string} profile.slug
 * @param {string} profile.locale
 * @param {string} profile.displayName
 * @param {string} [profile.headline]
 * @param {string} [profile.roleType] - e.g. 'Model', 'Photographer'
 * @param {object} [profile.location]
 * @param {string} [profile.location.city]
 * @param {string} [profile.location.region]
 * @param {string} [profile.location.country]
 * @param {boolean} [profile.verified]
 * @param {Array<object>} [profile.media]
 * @param {boolean} [profile.safeModeActive]
 * @param {Array<object>} [profile.reviews]
 * @param {object} [options]
 * @param {string} [options.baseUrl]
 * @param {boolean} [options.safeMode]
 * @returns {Array<object>}
 */
export function buildProfileJsonLd(profile, options = {}) {
  if (!profile?.slug) return [];
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const locale = profile.locale ?? 'en-US';
  const safeMode = options.safeMode ?? profile.safeModeActive ?? false;
  const url = `${baseUrl}/${locale.toLowerCase()}/${profile.slug}`;
  const schemaType = profile.schemaType ?? (profile.isStudio ? 'LocalBusiness' : 'Person');

  const media = Array.isArray(profile.media) ? profile.media : [];
  const filteredImages = media
    .filter((item) => {
      if (!item || !item.url) return false;
      if (safeMode) {
        return item.safe === true;
      }
      return item.safe !== false;
    })
    .map((item) => item.url);

  const aggregateRating = buildAggregateRating(profile.reviews);
  const structuredMedia = filteredImages.slice(0, 10);

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': schemaType,
      '@id': `${url}#entity`,
      url,
      name: profile.displayName,
      description: profile.headline,
      image: structuredMedia.length ? structuredMedia : undefined,
      jobTitle: schemaType === 'Person' ? profile.roleType : undefined,
      priceRange: profile.priceRange ?? undefined,
      knowsLanguage: profile.languages ?? undefined,
      sameAs: buildSameAs(profile.links),
      address: buildAddress(profile.location),
      areaServed: profile.serviceAreas ?? undefined,
      aggregateRating: aggregateRating ?? undefined,
      makesOffer: buildOffers(profile.packages),
      hasCredential: profile.verified ? { '@type': 'EducationalOccupationalCredential', name: 'Verified' } : undefined,
    },
  ];

  if (profile.isStudio && profile.studioDetails) {
    jsonLd.push({
      '@context': 'https://schema.org',
      '@type': 'Place',
      '@id': `${url}#place`,
      name: profile.displayName,
      url,
      address: buildAddress(profile.studioDetails?.address ?? profile.location),
      geo: buildGeo(profile.studioDetails?.geo),
      amenityFeature: buildAmenities(profile.studioDetails?.amenities),
    });
  }

  if (profile.faq) {
    const faqItems = buildFaq(profile.faq);
    if (faqItems.length) {
      jsonLd.push({
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faqItems,
      });
    }
  }

  return jsonLd.filter(Boolean);
}

export function buildHreflangLinks({ baseUrl = DEFAULT_BASE_URL, locales = [], slug }) {
  if (!slug || !Array.isArray(locales)) return [];
  return locales.map((locale) => ({
    rel: 'alternate',
    hreflang: locale,
    href: `${baseUrl}/${locale.toLowerCase()}/${slug}`,
  }));
}

function buildAddress(location = {}) {
  if (!location.city && !location.country) return undefined;
  return {
    '@type': 'PostalAddress',
    addressLocality: location.city ?? undefined,
    addressRegion: location.region ?? undefined,
    addressCountry: location.country ?? undefined,
  };
}

function buildSameAs(links) {
  if (!Array.isArray(links)) return undefined;
  const urls = links
    .map((link) => link?.url)
    .filter((url) => typeof url === 'string' && url.startsWith('http'));
  return urls.length ? urls : undefined;
}

function buildAggregateRating(reviews) {
  if (!Array.isArray(reviews) || !reviews.length) return null;
  const validReviews = reviews.filter((review) => typeof review.rating === 'number');
  if (!validReviews.length) return null;
  const total = validReviews.reduce((sum, review) => sum + review.rating, 0);
  const average = total / validReviews.length;
  return {
    '@type': 'AggregateRating',
    ratingValue: Number(average.toFixed(2)),
    reviewCount: validReviews.length,
  };
}

function buildOffers(packages) {
  if (!Array.isArray(packages) || packages.length === 0) return undefined;
  const offers = packages
    .filter((pkg) => pkg?.name && pkg?.price)
    .map((pkg) => ({
      '@type': 'Offer',
      name: pkg.name,
      price: pkg.price,
      priceCurrency: pkg.currency ?? 'USD',
      availability: pkg.available ? 'https://schema.org/InStock' : undefined,
    }));
  return offers.length ? offers : undefined;
}

function buildGeo(geo) {
  if (!geo || typeof geo.latitude !== 'number' || typeof geo.longitude !== 'number') return undefined;
  return {
    '@type': 'GeoCoordinates',
    latitude: geo.latitude,
    longitude: geo.longitude,
  };
}

function buildAmenities(amenities) {
  if (!Array.isArray(amenities) || amenities.length === 0) return undefined;
  return amenities.slice(0, 10).map((amenity) => ({
    '@type': 'LocationFeatureSpecification',
    name: amenity.name ?? amenity,
    value: true,
  }));
}

function buildFaq(faq) {
  if (!Array.isArray(faq)) return [];
  return faq
    .filter((item) => item?.question && item?.answer)
    .map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    }));
}

export const SEO_BUILDER_DEFAULTS = {
  baseUrl: DEFAULT_BASE_URL,
};
