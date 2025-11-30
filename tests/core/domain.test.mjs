import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CoreDataValidationError,
  buildEventEnvelope,
  buildPaymentsPayoutReleasedEvent,
  buildServiceProfilePublishedEvent,
  buildStudioLocationVerifiedEvent,
  calculateServiceProfileCompleteness,
  enforceSafeMode,
  hashSha256,
  maskEmail,
  maskPhone,
  normalizeUserAccount,
  validateBookingLeg,
  validateBookingOrderTotals,
  validateEventEnvelope,
  validateServiceProfile
} from '../../services/core/domain.js';

const FIXED_NOW = '2025-11-27T04:45:00.000Z';
const clock = () => FIXED_NOW;

function sampleProfile(overrides = {}) {
  return {
    serviceProfileId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    role: 'model',
    displayName: 'Avery Harper',
    slug: 'avery-harper',
    status: 'published',
    city: 'Los Angeles',
    region: 'CA',
    country: 'US',
    aboutFields: {
      height_cm: 175,
      bio: 'Bio',
      genres: ['fashion', 'editorial'],
      experience_years: 3,
      hair_color: 'Brunette'
    },
    pricingFields: [{ package_id: 'pkg_123', price_cents: 20000 }],
    socialFields: { instagram: { handle: '@avery' } },
    languages: ['en'],
    tags: ['fashion', 'editorial', 'beauty'],
    safeModeBand: 0,
    completenessScore: 80,
    instantBook: true,
    verification: { idv: 'approved' },
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    publishedAt: FIXED_NOW,
    allowlistGenres: ['fashion', 'editorial'],
    ...overrides
  };
}

test('normalizeUserAccount lowercases email and hashes PII', () => {
  const account = normalizeUserAccount(
    {
      email: 'USER@example.com',
      phoneE164: '+15551234567',
      passwordHash: 'hash',
      passwordSalt: 'salt',
      displayName: 'User Example',
      roles: ['Buyer', 'provider'],
      country: 'us',
      marketingOptIn: true
    },
    clock
  );

  assert.equal(account.email, 'user@example.com');
  assert.equal(account.country, 'US');
  assert.equal(account.createdAt, FIXED_NOW);
  assert.equal(account.roles.length, 2);
  assert.equal(account.roles[0], 'buyer');
  assert.equal(account.roles[1], 'provider');
  assert.equal(account.marketingOptIn, true);
  assert.equal(account.emailSha256, hashSha256('user@example.com'));
  assert.equal(account.phoneSha256, hashSha256('+15551234567'));
});

test('normalizeUserAccount rejects invalid phone numbers', () => {
  assert.throws(
    () =>
      normalizeUserAccount(
        {
          email: 'user@example.com',
          phoneE164: '5551234567',
          passwordHash: 'hash',
          passwordSalt: 'salt',
          displayName: 'User',
          roles: ['buyer'],
          country: 'US'
        },
        clock
      ),
    (error) => error instanceof CoreDataValidationError && error.code === 'USER_PHONE_INVALID'
  );
});

test('validateServiceProfile enforces allowlists and constraints', () => {
  const profile = sampleProfile();
  assert.doesNotThrow(() => validateServiceProfile(profile));

  const invalidProfile = sampleProfile({ languages: ['english', 'es'] });
  assert.throws(
    () => validateServiceProfile(invalidProfile),
    (error) => error instanceof CoreDataValidationError && error.code === 'PROFILE_LANG_FORMAT'
  );
});

test('calculateServiceProfileCompleteness caps at 100', () => {
  const profile = sampleProfile({ tags: ['a', 'b', 'c', 'd', 'e'] });
  const completeness = calculateServiceProfileCompleteness(profile);
  assert.ok(completeness <= 100);
  assert.equal(completeness, 100);
});

test('validateBookingOrderTotals enforces arithmetic', () => {
  const order = {
    bookingId: 'b1',
    buyerUserId: 'u1',
    currency: 'USD',
    status: 'draft',
    buyerTimezone: 'America/Los_Angeles',
    quoteSubtotalCents: 10000,
    quoteTaxCents: 800,
    quoteFeesCents: 200,
    quoteTotalCents: 11000,
    depositRequired: false,
    instantBook: false,
    docsBeforePay: true,
    cancellationPolicy: {},
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW
  };
  assert.doesNotThrow(() => validateBookingOrderTotals(order));

  const invalid = { ...order, quoteTotalCents: 10001 };
  assert.throws(
    () => validateBookingOrderTotals(invalid),
    (error) => error instanceof CoreDataValidationError && error.code === 'BOOKING_TOTAL_MISMATCH'
  );
});

test('validateBookingLeg ensures time ordering', () => {
  const leg = {
    legId: 'l1',
    bookingId: 'b1',
    serviceProfileId: 'sp1',
    sellerUserId: 'u2',
    status: 'confirmed',
    sessionDate: '2025-12-01',
    startAt: '2025-12-01T10:00:00Z',
    endAt: '2025-12-01T12:00:00Z',
    bufferMin: 60,
    subtotalCents: 10000,
    taxCents: 800,
    feesCents: 200,
    totalCents: 11000,
    payoutCents: 9000,
    currency: 'USD',
    policySnapshot: {},
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW
  };
  assert.doesNotThrow(() => validateBookingLeg(leg));

  const invalid = { ...leg, endAt: '2025-12-01T09:00:00Z' };
  assert.throws(
    () => validateBookingLeg(invalid),
    (error) => error instanceof CoreDataValidationError && error.code === 'BOOKING_LEG_TIME_ORDER'
  );
});

test('buildEventEnvelope injects timestamps and retains payload clones', () => {
  const payload = { service_profile_id: 'spf_123', role: 'model' };
  const envelope = buildEventEnvelope(
    'profile.service_profile.published',
    1,
    payload,
    {
      privacyTier: 'tier2',
      retentionClass: 'profiles_core',
      source: 'core-service',
      piiFields: ['payload.contact_email_hash']
    },
    clock
  );

  assert.equal(envelope.occurredAt, FIXED_NOW);
  assert.equal(envelope.emittedAt, FIXED_NOW);
  assert.equal(envelope.privacyTier, 'tier2');
  assert.equal(envelope.piiFields.length, 1);
  assert.deepEqual(envelope.payload, payload);
  assert.notStrictEqual(envelope.payload, payload, 'payload should be cloned');
  validateEventEnvelope(envelope);
});

test('enforceSafeMode redacts unsafe messages', () => {
  const message = {
    messageId: 'msg1',
    threadId: 'th1',
    senderId: 'u1',
    body: 'Sensitive content',
    bodyRendered: '<p>Sensitive content</p>',
    attachments: [],
    visibility: 'everyone',
    safeModeBand: 1,
    createdAt: FIXED_NOW,
    redacted: false
  };
  const redacted = enforceSafeMode(message, 2);
  assert.equal(redacted.safeModeBand, 2);
  assert.equal(redacted.body, '[redacted: safe-mode]');
  assert.equal(redacted.bodyRendered, '[redacted]');
});

test('mask helpers produce deterministic hashes', () => {
  const email = maskEmail('user@example.com');
  assert.equal(email.hash, hashSha256('user@example.com'));
  assert.match(email.masked, /^us\*\*\*@/i);

  const phone = maskPhone('+15551234567');
  assert.ok(phone);
  assert.equal(phone.hash, hashSha256('15551234567'));
});

function stableHash(value) {
  const normalize = (input) => {
    if (Array.isArray(input)) {
      return input.map((item) => normalize(item));
    }
    if (input && typeof input === 'object') {
      return Object.keys(input)
        .sort()
        .reduce((acc, key) => {
          acc[key] = normalize(input[key]);
          return acc;
        }, {});
    }
    return input;
  };
  return hashSha256(JSON.stringify(normalize(value)));
}

test('buildServiceProfilePublishedEvent emits hashed contact fields', () => {
  const profile = sampleProfile();
  const account = normalizeUserAccount(
    {
      email: 'publisher@example.com',
      phoneE164: '+15558675309',
      passwordHash: 'hash',
      passwordSalt: 'salt',
      displayName: 'Publisher',
      roles: ['provider'],
      country: 'us'
    },
    clock
  );
  account.userId = profile.userId;

  const envelope = buildServiceProfilePublishedEvent(profile, account, { source: 'core-service' }, clock);

  validateEventEnvelope(envelope);
  assert.equal(envelope.event, 'profile.service_profile.published');
  assert.equal(envelope.version, 1);
  assert.equal(envelope.occurredAt, profile.publishedAt);
  assert.equal(envelope.emittedAt, FIXED_NOW);
  assert.equal(envelope.privacyTier, 'tier2');
  assert.ok(envelope.piiFields.includes('payload.contact_email_hash'));
  assert.ok(envelope.piiFields.includes('payload.contact_phone_hash'));
  assert.equal(envelope.payload.contact_email_hash, account.emailSha256);
  assert.equal(envelope.payload.contact_phone_hash, account.phoneSha256);
});

test('buildStudioLocationVerifiedEvent hashes amenities deterministically', () => {
  const studio = {
    studioId: '33333333-3333-4333-8333-333333333333',
    ownerUserId: '22222222-2222-4222-8222-222222222222',
    name: 'Sunset Loft',
    slug: 'sunset-loft',
    city: 'Los Angeles',
    region: 'CA',
    country: 'US',
    latitude: 34.0522,
    longitude: -118.2437,
    addressLine1: '123 Sunset Blvd',
    addressLine2: 'Suite 400',
    postalCode: '90012',
    amenities: [{ name: 'Cyclorama', size: '20ft' }, 'WiFi', 'Parking'],
    depositRequired: true,
    verified: true,
    nsfwAllowed: false
  };

  const context = {
    studio,
    verifiedBy: '44444444-4444-4444-8444-444444444444',
    verifiedAt: FIXED_NOW
  };

  const envelope = buildStudioLocationVerifiedEvent(context, { source: 'core-trust' }, clock);
  validateEventEnvelope(envelope);

  assert.equal(envelope.event, 'studio.location.verified');
  assert.equal(envelope.privacyTier, 'tier1');
  assert.ok(envelope.piiFields.includes('payload.address.line1'));
  assert.ok(envelope.piiFields.includes('payload.amenities_hash'));
  assert.equal(
    envelope.payload.amenities_hash,
    stableHash(studio.amenities)
  );
  assert.equal(envelope.payload.address.postal_code, studio.postalCode);
});

test('buildPaymentsPayoutReleasedEvent hashes bank account reference', () => {
  const record = {
    payoutId: 'po_123',
    providerUserId: 'provider-1',
    bookingId: 'booking-1',
    legId: 'leg-1',
    amountCents: 12345,
    currency: 'usd',
    transferReference: 'tr_987',
    bankAccountReference: 'BA-001122',
    payoutMethod: 'instant',
    feesCents: 345,
    releasedAt: FIXED_NOW
  };

  const envelope = buildPaymentsPayoutReleasedEvent(record, { source: 'core-payments' }, clock);
  validateEventEnvelope(envelope);

  assert.equal(envelope.event, 'payments.payout.released');
  assert.equal(envelope.privacyTier, 'tier1');
  assert.deepEqual(envelope.piiFields, ['payload.bank_account_hash']);
  assert.equal(
    envelope.payload.bank_account_hash,
    hashSha256(record.bankAccountReference.trim().toLowerCase())
  );
  assert.equal(envelope.payload.currency, 'USD');
});
