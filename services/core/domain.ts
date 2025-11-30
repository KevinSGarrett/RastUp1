import crypto from 'node:crypto';

import type {
  BookingLeg,
  BookingOrder,
  CoreEventBuildOptions,
  EventEnvelope,
  EventMetadata,
  MessageRecord,
  PayoutReleaseRecord,
  PaymentIntentRecord,
  PaymentsPayoutReleasedPayload,
  ServiceProfile,
  ServiceProfilePublishedPayload,
  StudioLocationVerifiedPayload,
  StudioVerificationContext,
  UserAccount,
  UserAccountInput,
  UserRole
} from './types.js';

export class CoreDataValidationError extends Error {
  public readonly code: string;
  public readonly details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'CoreDataValidationError';
    this.code = code;
    this.details = details;
  }
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\+[1-9]\d{7,14}$/;
const ROLE_ALLOWLIST: ReadonlySet<UserRole> = new Set(['buyer', 'provider', 'admin', 'support', 'trust']);
const PROFILE_ROLE_ALLOWLIST = new Set(['model', 'photographer', 'videographer', 'creator', 'fansub']);
const GENRE_ALLOWLIST = new Set([
  'fashion',
  'editorial',
  'commercial',
  'beauty',
  'lifestyle',
  'music',
  'wedding',
  'portrait',
  'events'
]);

const MAX_LANGUAGES = 5;
const MAX_TAGS = 12;

function assert(condition: unknown, code: string, message: string, details: Record<string, unknown> = {}): asserts condition {
  if (!condition) {
    throw new CoreDataValidationError(code, message, details);
  }
}

export function hashSha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizeForHash(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForHash(item));
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return entries.reduce<Record<string, unknown>>((acc, [key, val]) => {
      acc[key] = normalizeForHash(val);
      return acc;
    }, {});
  }

  return value;
}

function hashStructuredData(value: unknown): string {
  const normalized = normalizeForHash(value);
  return hashSha256(JSON.stringify(normalized));
}

export function maskEmail(email: string): { hash: string; masked: string } {
  const [local, domain] = email.split('@');
  const maskedLocal = local.length <= 2 ? `${local[0] ?? '*'}***` : `${local.slice(0, 2)}***`;
  const maskedDomain = domain ? domain.replace(/(^.).*(\..+$)/, (_match, first: string, tld: string) => `${first}***${tld}`) : '***';
  return {
    hash: hashSha256(email.toLowerCase()),
    masked: `${maskedLocal}@${maskedDomain}`
  };
}

export function maskPhone(phone?: string | null): { hash: string; masked: string } | null {
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

function normalizeRoles(roles: UserRole[]): UserRole[] {
  const unique = Array.from(new Set(roles.map((role) => role.toLowerCase() as UserRole)));
  unique.forEach((role) => {
    assert(ROLE_ALLOWLIST.has(role), 'USER_ROLE_INVALID', 'Unsupported user role provided.', { role });
  });
  return unique;
}

export function normalizeUserAccount(input: UserAccountInput, clock: () => string = () => new Date().toISOString()): UserAccount {
  assert(EMAIL_REGEX.test(input.email), 'USER_EMAIL_INVALID', 'Email must be valid.', { email: input.email });
  assert(input.roles.length > 0, 'USER_ROLES_REQUIRED', 'At least one user role is required.');

  const normalizedRoles = normalizeRoles(input.roles);

  if (input.phoneE164) {
    assert(PHONE_REGEX.test(input.phoneE164), 'USER_PHONE_INVALID', 'Phone number must be in E.164 format.', {
      phoneE164: input.phoneE164
    });
  }

  const now = clock();
  const emailHash = hashSha256(input.email.toLowerCase());
  const phoneHash = input.phoneE164 ? hashSha256(input.phoneE164) : null;

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
    emailSha256: emailHash,
    phoneSha256: phoneHash
  };
}

export function validateServiceProfile(profile: ServiceProfile): void {
  assert(PROFILE_ROLE_ALLOWLIST.has(profile.role), 'PROFILE_ROLE_INVALID', 'Unsupported service profile role.', {
    role: profile.role
  });
  assert(profile.languages.length <= MAX_LANGUAGES, 'PROFILE_LANG_LIMIT', 'Too many languages assigned.', {
    languages: profile.languages
  });
  assert(profile.tags.length <= MAX_TAGS, 'PROFILE_TAG_LIMIT', 'Too many tags assigned.', { tags: profile.tags });

  profile.languages.forEach((lang) => {
    assert(/^[a-z]{2}$/i.test(lang), 'PROFILE_LANG_FORMAT', 'Language codes must be ISO 639-1.', { language: lang });
  });

  profile.tags.forEach((tag) => {
    assert(tag.length <= 32, 'PROFILE_TAG_LENGTH', 'Tag length exceeds maximum.', { tag });
  });

  if (profile.allowlistGenres) {
    profile.allowlistGenres.forEach((genre) => {
      assert(GENRE_ALLOWLIST.has(genre), 'PROFILE_GENRE_INVALID', 'Genre not in blueprint allowlist.', { genre });
    });
  }

  const aboutType = typeof profile.aboutFields;
  assert(aboutType === 'object' && profile.aboutFields !== null, 'PROFILE_ABOUT_OBJECT', 'aboutFields must be an object.');

  const pricingType = Array.isArray(profile.pricingFields);
  assert(pricingType, 'PROFILE_PRICING_ARRAY', 'pricingFields must be an array.');

  assert(
    Number.isInteger(profile.safeModeBand) && profile.safeModeBand >= 0 && profile.safeModeBand <= 2,
    'PROFILE_SAFE_MODE_RANGE',
    'safeModeBand must be between 0 and 2.',
    { safeModeBand: profile.safeModeBand }
  );
}

export function calculateServiceProfileCompleteness(profile: ServiceProfile): number {
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
  if (profile.languages.length > 0) {
    score += 10;
  }
  if (profile.tags.length >= 3) {
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

export function validateBookingOrderTotals(order: BookingOrder): void {
  const numericFields: Array<keyof Pick<BookingOrder, 'quoteSubtotalCents' | 'quoteTaxCents' | 'quoteFeesCents' | 'quoteTotalCents'>> = [
    'quoteSubtotalCents',
    'quoteTaxCents',
    'quoteFeesCents',
    'quoteTotalCents'
  ];

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

export function validateBookingLeg(leg: BookingLeg): void {
  assert(Number.isInteger(leg.bufferMin) && leg.bufferMin >= 0 && leg.bufferMin <= 240, 'BOOKING_BUFFER_INVALID', 'Buffer minutes out of range.', {
    bufferMin: leg.bufferMin
  });

  const numericFields: Array<keyof Pick<BookingLeg, 'subtotalCents' | 'taxCents' | 'feesCents' | 'totalCents' | 'payoutCents'>> = [
    'subtotalCents',
    'taxCents',
    'feesCents',
    'totalCents',
    'payoutCents'
  ];

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

export function validatePaymentIntentRecord(record: PaymentIntentRecord): void {
  assert(record.amountCents > 0, 'PAYMENT_AMOUNT_REQUIRED', 'Payment intent amount must be greater than zero.', {
    amountCents: record.amountCents
  });
  assert(/^[A-Z]{3}$/.test(record.currency), 'PAYMENT_CURRENCY_INVALID', 'Currency must be ISO-4217 uppercase code.', {
    currency: record.currency
  });
  assert(record.provider.trim().length > 0, 'PAYMENT_PROVIDER_REQUIRED', 'Payment provider is required.');
  assert(record.providerPaymentIntentId.trim().length > 0, 'PAYMENT_PROVIDER_ID_REQUIRED', 'Provider intent id is required.');
}

export function enforceSafeMode(message: MessageRecord, profileSafeModeBand: number): MessageRecord {
  const safeBand = Math.max(message.safeModeBand, profileSafeModeBand);
  return {
    ...message,
    safeModeBand: safeBand,
    body: safeBand > 1 ? '[redacted: safe-mode]' : message.body,
    bodyRendered: safeBand > 1 ? '[redacted]' : message.bodyRendered ?? null
  };
}

export function buildEventEnvelope<TPayload>(
  event: string,
  version: number,
  payload: TPayload,
  metadata: EventMetadata,
  clock: () => string = () => new Date().toISOString()
): EventEnvelope<TPayload> {
  assert(event && event.includes('.'), 'EVENT_NAME_INVALID', 'Event name must follow domain.action format.', { event });
  assert(Number.isInteger(version) && version > 0, 'EVENT_VERSION_INVALID', 'Event version must be a positive integer.', { version });

  const occurredAt = metadata.occurredAt ?? clock();
  const emittedAt = metadata.emittedAt ?? clock();
  const piiFields = metadata.piiFields ?? [];

  assert(/^[a-z0-9._-]+$/.test(metadata.source), 'EVENT_SOURCE_INVALID', 'Source must be lowercase slug.', { source: metadata.source });
  assert(piiFields.every((field) => /^[a-zA-Z0-9_.]+$/.test(field)), 'EVENT_PII_FIELD_INVALID', 'piiFields must be dot separated paths.', {
    piiFields
  });

  const lowerPayload = JSON.parse(JSON.stringify(payload)) as TPayload;

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

export function validateEventEnvelope<TPayload>(envelope: EventEnvelope<TPayload>): void {
  assert(Boolean(envelope.event), 'EVENT_EVENT_REQUIRED', 'Event name required.');
  assert(envelope.version > 0, 'EVENT_VERSION_REQUIRED', 'Event version must be positive.');
  assert(Boolean(envelope.occurredAt), 'EVENT_OCCURRED_REQUIRED', 'occurredAt required.');
  assert(Boolean(envelope.emittedAt), 'EVENT_EMITTED_REQUIRED', 'emittedAt required.');
  assert(envelope.piiFields.every((field) => /^[a-zA-Z0-9_.]+$/.test(field)), 'EVENT_PII_FIELD_INVALID', 'Invalid piiFields present.', {
    piiFields: envelope.piiFields
  });
}

function resolveEventTimestamps(options: CoreEventBuildOptions | undefined, fallbackOccurredAt: string, clock: () => string) {
  const occurredAt = options?.occurredAt ?? fallbackOccurredAt;
  const emittedAt = options?.emittedAt ?? clock();
  return { occurredAt, emittedAt };
}

function resolveEventSource(options: CoreEventBuildOptions | undefined, defaultSource: string): string {
  return (options?.source ?? defaultSource).trim() || defaultSource;
}

export function buildServiceProfilePublishedEvent(
  profile: ServiceProfile,
  account: Pick<UserAccount, 'userId' | 'emailSha256' | 'phoneSha256'>,
  options?: CoreEventBuildOptions,
  clock: () => string = () => new Date().toISOString()
): EventEnvelope<ServiceProfilePublishedPayload> {
  assert(profile.status === 'published', 'PROFILE_NOT_PUBLISHED', 'Service profile must be published to emit event.', {
    serviceProfileId: profile.serviceProfileId,
    status: profile.status
  });
  const publishedAt = profile.publishedAt ?? options?.occurredAt ?? clock();
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

  const genres = profile.allowlistGenres ?? [];
  const phoneHash = account.phoneSha256 ?? null;
  const payload: ServiceProfilePublishedPayload = {
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

export function buildStudioLocationVerifiedEvent(
  context: StudioVerificationContext,
  options?: CoreEventBuildOptions,
  clock: () => string = () => new Date().toISOString()
): EventEnvelope<StudioLocationVerifiedPayload> {
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

  const payload: StudioLocationVerifiedPayload = {
    studio_id: studio.studioId,
    owner_user_id: studio.ownerUserId,
    verified_by: verifiedBy,
    verified_at: verifiedAt,
    address: {
      line1: addressLine1 as string,
      line2: addressLine2 ?? null,
      city: city as string,
      region: region ?? null,
      postal_code: postalCode ?? null,
      country: country as string
    },
    geo: {
      latitude,
      longitude
    },
    amenities_hash: amenitiesHash,
    nsfw_allowed: Boolean(studio.nsfwAllowed)
  };

  const piiFields = new Set<string>(['payload.address.line1', 'payload.address.city', 'payload.address.country', 'payload.amenities_hash']);
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

export function buildPaymentsPayoutReleasedEvent(
  record: PayoutReleaseRecord,
  options?: CoreEventBuildOptions,
  clock: () => string = () => new Date().toISOString()
): EventEnvelope<PaymentsPayoutReleasedPayload> {
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
  const payload: PaymentsPayoutReleasedPayload = {
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

