import crypto from 'node:crypto';

export class CoreDataValidationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CoreDataValidationError';
    this.code = code;
    this.details = details;
  }
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\+[1-9]\d{7,14}$/;
const ROLE_ALLOWLIST = new Set(['buyer', 'provider', 'admin', 'support', 'trust']);
const PROFILE_ROLE_ALLOWLIST = new Set(['model', 'photographer', 'videographer', 'creator', 'fansub']);
const GENRE_ALLOWLIST = new Set(['fashion', 'editorial', 'commercial', 'beauty', 'lifestyle', 'music', 'wedding', 'portrait', 'events']);

const MAX_LANGUAGES = 5;
const MAX_TAGS = 12;

function assert(condition, code, message, details = {}) {
  if (!condition) {
    throw new CoreDataValidationError(code, message, details);
  }
}

export function hashSha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizeForHash(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForHash(item));
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    return entries.reduce((acc, [key, val]) => {
      acc[key] = normalizeForHash(val);
      return acc;
    }, {});
  }

  return value;
}

function hashStructuredData(value) {
  const normalized = normalizeForHash(value);
  return hashSha256(JSON.stringify(normalized));
}

export function maskEmail(email) {
  const [local, domain] = email.split('@');
  const maskedLocal = local.length <= 2 ? `${local[0] ?? '*'}***` : `${local.slice(0, 2)}***`;
  const maskedDomain = domain ? domain.replace(/(^.).*(\..+$)/, (_match, first, tld) => `${first}***${tld}`) : '***';
  return {
    hash: hashSha256(email.toLowerCase()),
    masked: `${maskedLocal}@${maskedDomain}`
  };
}

export function maskPhone(phone) {
  if (!phone) {
    return null;
  }
  const digits = phone.replace(/\D/g, '');
  const masked = digits.length <= 4 ? `***${digits.slice(-2)}` : `***${digits.slice(-4)}`;
  return {
    hash: hashSha256(digits),
    masked: `***${masked}`
  };
}

function normalizeRoles(roles) {
  const unique = Array.from(new Set(roles.map((role) => role.toLowerCase())));
  unique.forEach((role) => {
    assert(ROLE_ALLOWLIST.has(role), 'USER_ROLE_INVALID', 'Unsupported user role provided.', { role });
  });
  return unique;
}

export function normalizeUserAccount(input, clock = () => new Date().toISOString()) {
  assert(EMAIL_REGEX.test(input.email), 'USER_EMAIL_INVALID', 'Email must be valid.', { email: input.email });
  assert(Array.isArray(input.roles) && input.roles.length > 0, 'USER_ROLES_REQUIRED', 'At least one user role is required.');

  const normalizedRoles = normalizeRoles(input.roles);

  if (input.phoneE164) {
    assert(PHONE_REGEX.test(input.phoneE164), 'USER_PHONE_INVALID', 'Phone number must be in E.164 format.', {
      phoneE164: input.phoneE164
    });
  }

  const now = clock();

  return {
    userId: crypto.randomUUID(),
    externalId: input.externalId ?? null,
    email: input.email.toLowerCase(),
    phoneE164: input.phoneE164 ?? null,
    passwordHash: input.passwordHash,
    passwordSalt: input.passwordSalt,
    displayName: input.displayName.trim(),
    status: input.status ?? 'pending',
    roles: normalizedRoles,
    locale: input.locale ?? 'en_US',
    country: input.country.toUpperCase(),
    createdAt: now,
    updatedAt: now,
    consent: input.consent ?? {},
    marketingOptIn: Boolean(input.marketingOptIn),
    emailSha256: hashSha256(input.email.toLowerCase()),
    phoneSha256: input.phoneE164 ? hashSha256(input.phoneE164) : null
  };
}

export function validateServiceProfile(profile) {
  assert(PROFILE_ROLE_ALLOWLIST.has(profile.role), 'PROFILE_ROLE_INVALID', 'Unsupported service profile role.', {
    role: profile.role
  });
  assert(Array.isArray(profile.languages) && profile.languages.length <= MAX_LANGUAGES, 'PROFILE_LANG_LIMIT', 'Too many languages assigned.', {
    languages: profile.languages
  });
  assert(Array.isArray(profile.tags) && profile.tags.length <= MAX_TAGS, 'PROFILE_TAG_LIMIT', 'Too many tags assigned.', { tags: profile.tags });

  profile.languages.forEach((lang) => {
    assert(/^[a-z]{2}$/i.test(lang), 'PROFILE_LANG_FORMAT', 'Language codes must be ISO 639-1.', { language: lang });
  });

  profile.tags.forEach((tag) => {
    assert(typeof tag === 'string' && tag.length <= 32, 'PROFILE_TAG_LENGTH', 'Tag length exceeds maximum.', { tag });
  });

  if (profile.allowlistGenres) {
    profile.allowlistGenres.forEach((genre) => {
      assert(GENRE_ALLOWLIST.has(genre), 'PROFILE_GENRE_INVALID', 'Genre not in blueprint allowlist.', { genre });
    });
  }

  const aboutType = typeof profile.aboutFields;
  assert(aboutType === 'object' && profile.aboutFields !== null, 'PROFILE_ABOUT_OBJECT', 'aboutFields must be an object.');

  assert(Array.isArray(profile.pricingFields), 'PROFILE_PRICING_ARRAY', 'pricingFields must be an array.');

  assert(
    Number.isInteger(profile.safeModeBand) && profile.safeModeBand >= 0 && profile.safeModeBand <= 2,
    'PROFILE_SAFE_MODE_RANGE',
    'safeModeBand must be between 0 and 2.',
    { safeModeBand: profile.safeModeBand }
  );
}

export function calculateServiceProfileCompleteness(profile) {
  let score = 0;

  if (profile.aboutFields && Object.keys(profile.aboutFields).length >= 5) {
    score += 25;
  }
  if (Array.isArray(profile.pricingFields) && profile.pricingFields.length > 0) {
    score += 25;
  }
  if (profile.socialFields && Object.keys(profile.socialFields).length > 0) {
    score += 10;
  }
  if (Array.isArray(profile.languages) && profile.languages.length > 0) {
    score += 10;
  }
  if (Array.isArray(profile.tags) && profile.tags.length >= 3) {
    score += 10;
  }
  if (profile.instantBook) {
    score += 10;
  }
  if (profile.verification && Object.keys(profile.verification).length > 0) {
    score += 10;
  }

  return Math.min(100, score);
}

export function validateBookingOrderTotals(order) {
  const numericFields = ['quoteSubtotalCents', 'quoteTaxCents', 'quoteFeesCents', 'quoteTotalCents'];
  numericFields.forEach((field) => {
    const value = order[field];
    assert(Number.isInteger(value) && value >= 0, 'BOOKING_TOTAL_INVALID', 'Booking totals must be non-negative integers.', {
      field,
      value
    });
  });

  const computedTotal = order.quoteSubtotalCents + order.quoteTaxCents + order.quoteFeesCents;
  assert(
    computedTotal === order.quoteTotalCents,
    'BOOKING_TOTAL_MISMATCH',
    'quoteTotalCents must equal subtotal + tax + fees.',
    { computedTotal, totalCents: order.quoteTotalCents }
  );
}

export function validateBookingLeg(leg) {
  assert(Number.isInteger(leg.bufferMin) && leg.bufferMin >= 0 && leg.bufferMin <= 240, 'BOOKING_BUFFER_INVALID', 'Buffer minutes out of range.', {
    bufferMin: leg.bufferMin
  });
  const numericFields = ['subtotalCents', 'taxCents', 'feesCents', 'totalCents', 'payoutCents'];
  numericFields.forEach((field) => {
    const value = leg[field];
    assert(Number.isInteger(value) && value >= 0, 'BOOKING_LEG_AMOUNT_INVALID', 'Leg monetary amounts must be non-negative.', {
      field,
      value
    });
  });
  const start = Date.parse(leg.startAt);
  const end = Date.parse(leg.endAt);
  assert(Number.isFinite(start) && Number.isFinite(end), 'BOOKING_LEG_TIME_PARSE', 'Unable to parse leg timestamps.', {
    startAt: leg.startAt,
    endAt: leg.endAt
  });
  assert(end > start, 'BOOKING_LEG_TIME_ORDER', 'endAt must be later than startAt.', { startAt: leg.startAt, endAt: leg.endAt });
}

export function validatePaymentIntentRecord(record) {
  assert(record.amountCents > 0, 'PAYMENT_AMOUNT_REQUIRED', 'Payment intent amount must be greater than zero.', {
    amountCents: record.amountCents
  });
  assert(/^[A-Z]{3}$/.test(record.currency), 'PAYMENT_CURRENCY_INVALID', 'Currency must be ISO-4217 uppercase code.', {
    currency: record.currency
  });
  assert(typeof record.provider === 'string' && record.provider.trim().length > 0, 'PAYMENT_PROVIDER_REQUIRED', 'Payment provider is required.');
  assert(
    typeof record.providerPaymentIntentId === 'string' && record.providerPaymentIntentId.trim().length > 0,
    'PAYMENT_PROVIDER_ID_REQUIRED',
    'Provider intent id is required.'
  );
}

export function enforceSafeMode(message, profileSafeModeBand) {
  const safeBand = Math.max(message.safeModeBand, profileSafeModeBand);
  return {
    ...message,
    safeModeBand: safeBand,
    body: safeBand > 1 ? '[redacted: safe-mode]' : message.body,
    bodyRendered: safeBand > 1 ? '[redacted]' : message.bodyRendered ?? null
  };
}

export function buildEventEnvelope(event, version, payload, metadata, clock = () => new Date().toISOString()) {
  assert(event && event.includes('.'), 'EVENT_NAME_INVALID', 'Event name must follow domain.action format.', { event });
  assert(Number.isInteger(version) && version > 0, 'EVENT_VERSION_INVALID', 'Event version must be a positive integer.', { version });

  const occurredAt = metadata.occurredAt ?? clock();
  const emittedAt = metadata.emittedAt ?? clock();
  const piiFields = metadata.piiFields ?? [];

  assert(/^[a-z0-9._-]+$/.test(metadata.source), 'EVENT_SOURCE_INVALID', 'Source must be lowercase slug.', { source: metadata.source });
  assert(piiFields.every((field) => /^[a-zA-Z0-9_.]+$/.test(field)), 'EVENT_PII_FIELD_INVALID', 'piiFields must be dot separated paths.', {
    piiFields
  });

  const lowerPayload = JSON.parse(JSON.stringify(payload));

  return {
    event,
    version,
    occurredAt,
    emittedAt,
    source: metadata.source,
    privacyTier: metadata.privacyTier,
    retentionClass: metadata.retentionClass,
    piiFields,
    payload: lowerPayload
  };
}

export function validateEventEnvelope(envelope) {
  assert(Boolean(envelope.event), 'EVENT_EVENT_REQUIRED', 'Event name required.');
  assert(Number.isInteger(envelope.version) && envelope.version > 0, 'EVENT_VERSION_REQUIRED', 'Event version must be positive.');
  assert(Boolean(envelope.occurredAt), 'EVENT_OCCURRED_REQUIRED', 'occurredAt required.');
  assert(Boolean(envelope.emittedAt), 'EVENT_EMITTED_REQUIRED', 'emittedAt required.');
  assert(
    Array.isArray(envelope.piiFields) && envelope.piiFields.every((field) => /^[a-zA-Z0-9_.]+$/.test(field)),
    'EVENT_PII_FIELD_INVALID',
    'Invalid piiFields present.',
    {
      piiFields: envelope.piiFields
    }
  );
}

function resolveEventTimestamps(options, fallbackOccurredAt, clock) {
  const occurredAt = (options === null || options === void 0 ? void 0 : options.occurredAt) ?? fallbackOccurredAt;
  const emittedAt = (options === null || options === void 0 ? void 0 : options.emittedAt) ?? clock();
  return { occurredAt, emittedAt };
}

function resolveEventSource(options, defaultSource) {
  var _a;
  const candidate = ((_a = options === null || options === void 0 ? void 0 : options.source) !== null && _a !== void 0 ? _a : defaultSource).trim();
  return candidate || defaultSource;
}

export function buildServiceProfilePublishedEvent(profile, account, options, clock = () => new Date().toISOString()) {
  assert(profile.status === 'published', 'PROFILE_NOT_PUBLISHED', 'Service profile must be published to emit event.', {
    serviceProfileId: profile.serviceProfileId,
    status: profile.status
  });
  const publishedAt = profile.publishedAt ?? (options === null || options === void 0 ? void 0 : options.occurredAt) ?? clock();
  assert(Boolean(publishedAt), 'PROFILE_PUBLISHED_AT_REQUIRED', 'publishedAt timestamp required for published event.', {
    serviceProfileId: profile.serviceProfileId
  });
  assert(
    account.userId === profile.userId,
    'PROFILE_USER_MISMATCH',
    'Provided user account does not own the service profile.',
    { profileUserId: profile.userId, accountUserId: account.userId }
  );
  assert(account.emailSha256, 'PROFILE_EMAIL_HASH_REQUIRED', 'User account must include emailSha256 hash.', {
    userId: account.userId
  });

  const genres = Array.isArray(profile.allowlistGenres) ? [...profile.allowlistGenres] : [];
  const phoneHash = (account === null || account === void 0 ? void 0 : account.phoneSha256) ?? null;
  const payload = {
    service_profile_id: profile.serviceProfileId,
    user_id: profile.userId,
    role: profile.role,
    display_name: profile.displayName,
    slug: profile.slug,
    city: profile.city,
    region: profile.region ?? null,
    country: profile.country,
    safe_mode_band: profile.safeModeBand,
    completeness_score: profile.completenessScore,
    instant_book: profile.instantBook,
    genres,
    languages: profile.languages,
    tags: profile.tags,
    published_at: publishedAt,
    contact_email_hash: account.emailSha256,
    contact_phone_hash: phoneHash
  };

  const piiFields = ['payload.contact_email_hash'];
  if (phoneHash) {
    piiFields.push('payload.contact_phone_hash');
  }

  const { occurredAt, emittedAt } = resolveEventTimestamps(options, publishedAt, clock);
  const source = resolveEventSource(options, 'core-service');

  return buildEventEnvelope(
    'profile.service_profile.published',
    1,
    payload,
    {
      privacyTier: 'tier2',
      retentionClass: 'profiles_core',
      source,
      occurredAt,
      emittedAt,
      piiFields
    },
    clock
  );
}

export function buildStudioLocationVerifiedEvent(context, options, clock = () => new Date().toISOString()) {
  const { studio, verifiedBy, verifiedAt } = context;
  assert(Boolean(studio.studioId), 'STUDIO_ID_REQUIRED', 'Studio identifier is required.', {});
  assert(Boolean(verifiedBy), 'STUDIO_VERIFIED_BY_REQUIRED', 'verifiedBy is required.');
  assert(Boolean(verifiedAt), 'STUDIO_VERIFIED_AT_REQUIRED', 'verifiedAt timestamp is required.');

  const { addressLine1, addressLine2, city, region, postalCode, country, latitude, longitude } = studio;
  assert(Boolean(addressLine1), 'STUDIO_ADDRESS_LINE1_REQUIRED', 'Address line1 is required for studio verification.', {
    studioId: studio.studioId
  });
  assert(Boolean(city), 'STUDIO_CITY_REQUIRED', 'City is required for studio verification.', { studioId: studio.studioId });
  assert(Boolean(country), 'STUDIO_COUNTRY_REQUIRED', 'Country is required for studio verification.', {
    studioId: studio.studioId
  });
  assert(
    typeof latitude === 'number' && typeof longitude === 'number',
    'STUDIO_GEO_REQUIRED',
    'Studio latitude and longitude must be provided.',
    { studioId: studio.studioId, latitude, longitude }
  );

  const amenities = Array.isArray(studio.amenities) ? studio.amenities : [];
  const amenitiesHash = hashStructuredData(amenities);

  const payload = {
    studio_id: studio.studioId,
    owner_user_id: studio.ownerUserId,
    verified_by: verifiedBy,
    verified_at: verifiedAt,
    address: {
      line1: addressLine1,
      line2: addressLine2 ?? null,
      city,
      region: region ?? null,
      postal_code: postalCode ?? null,
      country
    },
    geo: {
      latitude,
      longitude
    },
    amenities_hash: amenitiesHash,
    nsfw_allowed: Boolean(studio.nsfwAllowed)
  };

  const piiFields = new Set(['payload.address.line1', 'payload.address.city', 'payload.address.country', 'payload.amenities_hash']);
  if (payload.address.line2) {
    piiFields.add('payload.address.line2');
  }
  if (payload.address.postal_code) {
    piiFields.add('payload.address.postal_code');
  }

  const { occurredAt, emittedAt } = resolveEventTimestamps(options, verifiedAt, clock);
  const source = resolveEventSource(options, 'core-service');

  return buildEventEnvelope(
    'studio.location.verified',
    1,
    payload,
    {
      privacyTier: 'tier1',
      retentionClass: 'studios_core',
      source,
      occurredAt,
      emittedAt,
      piiFields: Array.from(piiFields)
    },
    clock
  );
}

export function buildPaymentsPayoutReleasedEvent(record, options, clock = () => new Date().toISOString()) {
  assert(record.amountCents >= 0, 'PAYOUT_AMOUNT_INVALID', 'Payout amount must be non-negative.', {
    payoutId: record.payoutId,
    amountCents: record.amountCents
  });
  assert(record.feesCents >= 0, 'PAYOUT_FEES_INVALID', 'Payout feesCents must be non-negative.', {
    payoutId: record.payoutId,
    feesCents: record.feesCents
  });
  assert(/^[A-Z]{3}$/.test(record.currency.toUpperCase()), 'PAYOUT_CURRENCY_INVALID', 'Currency must be ISO-4217 uppercase code.', {
    currency: record.currency
  });
  assert(
    record.payoutMethod === 'standard' || record.payoutMethod === 'instant',
    'PAYOUT_METHOD_INVALID',
    'Payout method must be standard or instant.',
    { payoutMethod: record.payoutMethod }
  );
  assert(record.transferReference.trim().length > 0, 'PAYOUT_TRANSFER_REFERENCE_REQUIRED', 'transferReference is required.', {
    payoutId: record.payoutId
  });
  assert(record.bankAccountReference.trim().length > 0, 'PAYOUT_BANK_REFERENCE_REQUIRED', 'bankAccountReference is required.', {
    payoutId: record.payoutId
  });

  const bankAccountHash = hashSha256(record.bankAccountReference.trim().toLowerCase());
  const payload = {
    payout_id: record.payoutId,
    provider_user_id: record.providerUserId,
    booking_id: record.bookingId,
    leg_id: record.legId,
    amount_cents: record.amountCents,
    currency: record.currency.toUpperCase(),
    transfer_reference: record.transferReference,
    bank_account_hash: bankAccountHash,
    released_at: record.releasedAt,
    payout_method: record.payoutMethod,
    fees_cents: record.feesCents
  };

  const { occurredAt, emittedAt } = resolveEventTimestamps(options, record.releasedAt, clock);
  const source = resolveEventSource(options, 'core-service');

  return buildEventEnvelope(
    'payments.payout.released',
    1,
    payload,
    {
      privacyTier: 'tier1',
      retentionClass: 'payments_core',
      source,
      occurredAt,
      emittedAt,
      piiFields: ['payload.bank_account_hash']
    },
    clock
  );
}
