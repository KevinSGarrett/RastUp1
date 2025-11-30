export type UserStatus = 'pending' | 'active' | 'suspended' | 'closed';

export type UserRole = 'buyer' | 'provider' | 'admin' | 'support' | 'trust';

export interface UserAccountInput {
  externalId?: string | null;
  email: string;
  phoneE164?: string | null;
  passwordHash: string;
  passwordSalt: string;
  displayName: string;
  status?: UserStatus;
  roles: UserRole[];
  locale?: string;
  country: string;
  consent?: Record<string, unknown>;
  marketingOptIn?: boolean;
}

export interface UserAccount extends UserAccountInput {
  userId: string;
  createdAt: string;
  updatedAt: string;
  emailSha256: string;
  phoneSha256?: string | null;
  consent: Record<string, unknown>;
  marketingOptIn: boolean;
  status: UserStatus;
  locale: string;
}

export type ServiceRole = 'model' | 'photographer' | 'videographer' | 'creator' | 'fansub';

export type ServiceProfileStatus = 'draft' | 'pending_review' | 'published' | 'suspended';

export interface ServiceProfile {
  serviceProfileId: string;
  userId: string;
  role: ServiceRole;
  displayName: string;
  slug: string;
  status: ServiceProfileStatus;
  city: string;
  region?: string | null;
  country: string;
  latitude?: number | null;
  longitude?: number | null;
  aboutFields: Record<string, unknown>;
  pricingFields: unknown[];
  socialFields?: Record<string, unknown> | null;
  languages: string[];
  tags: string[];
  safeModeBand: number;
  completenessScore: number;
  instantBook: boolean;
  verification: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string | null;
  allowlistGenres?: string[];
}

export interface Studio {
  studioId: string;
  ownerUserId: string;
  name: string;
  slug: string;
  description?: string | null;
  city: string;
  region?: string | null;
  country: string;
  latitude?: number | null;
  longitude?: number | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  postalCode?: string | null;
  amenities: unknown[];
  depositRequired: boolean;
  verified: boolean;
  nsfwAllowed: boolean;
  createdAt: string;
  updatedAt: string;
}

export type BookingStatus = 'draft' | 'pending' | 'confirmed' | 'in_session' | 'completed' | 'cancelled';

export type BookingLegStatus = 'draft' | 'pending' | 'confirmed' | 'in_session' | 'completed' | 'cancelled';

export interface BookingOrder {
  bookingId: string;
  buyerUserId: string;
  buyerAccountId?: string | null;
  currency: string;
  status: BookingStatus;
  buyerTimezone: string;
  quoteSubtotalCents: number;
  quoteTaxCents: number;
  quoteFeesCents: number;
  quoteTotalCents: number;
  depositRequired: boolean;
  instantBook: boolean;
  docsBeforePay: boolean;
  cancellationPolicy: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string | null;
  completedAt?: string | null;
}

export interface BookingLeg {
  legId: string;
  bookingId: string;
  serviceProfileId: string;
  studioId?: string | null;
  sellerUserId: string;
  status: BookingLegStatus;
  sessionDate: string;
  startAt: string;
  endAt: string;
  bufferMin: number;
  subtotalCents: number;
  taxCents: number;
  feesCents: number;
  totalCents: number;
  payoutCents: number;
  currency: string;
  policySnapshot: Record<string, unknown>;
  availabilityJson?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface BookingLegAddon {
  addonId: string;
  legId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  subtotalCents: number;
}

export type PaymentStatus =
  | 'requires_payment_method'
  | 'requires_confirmation'
  | 'authorized'
  | 'captured'
  | 'refunded'
  | 'failed'
  | 'cancelled';

export interface PaymentIntentRecord {
  paymentIntentId: string;
  legId: string;
  provider: string;
  providerPaymentIntentId: string;
  status: PaymentStatus;
  amountCents: number;
  currency: string;
  captureMethod: string;
  receiptUrl?: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentTransactionRecord {
  paymentId: string;
  paymentIntentId: string;
  kind: 'authorization' | 'capture' | 'refund' | 'payout';
  status: PaymentStatus;
  amountCents: number;
  feeCents: number;
  currency: string;
  processedAt: string;
  externalId?: string | null;
  response: Record<string, unknown>;
}

export interface MessageThread {
  threadId: string;
  bookingId?: string | null;
  createdAt: string;
  subject?: string | null;
  lastMessageAt?: string | null;
}

export type MessageParticipantRole = 'buyer' | 'seller' | 'support' | 'system';

export interface MessageParticipant {
  threadId: string;
  userId: string;
  role: MessageParticipantRole;
  joinedAt: string;
}

export interface MessageRecord {
  messageId: string;
  threadId: string;
  senderId: string;
  body: string;
  bodyRendered?: string | null;
  attachments: unknown[];
  visibility: 'everyone' | 'internal' | 'system';
  safeModeBand: number;
  createdAt: string;
  redacted: boolean;
}

export type PrivacyTier = 'public' | 'tier1' | 'tier2' | 'restricted';

export interface EventMetadata {
  privacyTier: PrivacyTier;
  retentionClass: string;
  source: string;
  occurredAt?: string;
  emittedAt?: string;
  piiFields?: string[];
}

export interface EventEnvelope<TPayload> {
  event: string;
  version: number;
  occurredAt: string;
  emittedAt: string;
  source: string;
  privacyTier: PrivacyTier;
  retentionClass: string;
  piiFields: string[];
  payload: TPayload;
}

export interface CoreEventBuildOptions {
  source?: string;
  occurredAt?: string;
  emittedAt?: string;
}

export interface ServiceProfilePublishedPayload {
  service_profile_id: string;
  user_id: string;
  role: ServiceRole;
  display_name: string;
  slug: string;
  city: string;
  region?: string | null;
  country: string;
  safe_mode_band: number;
  completeness_score: number;
  instant_book: boolean;
  genres: string[];
  languages: string[];
  tags: string[];
  published_at: string;
  contact_email_hash: string;
  contact_phone_hash?: string | null;
}

export interface ServiceProfilePublishedEvent extends EventEnvelope<ServiceProfilePublishedPayload> {}

export interface StudioLocationVerifiedPayload {
  studio_id: string;
  owner_user_id: string;
  verified_by: string;
  verified_at: string;
  address: {
    line1: string;
    line2?: string | null;
    city: string;
    region?: string | null;
    postal_code?: string | null;
    country: string;
  };
  geo: {
    latitude: number;
    longitude: number;
  };
  amenities_hash: string;
  nsfw_allowed: boolean;
}

export interface StudioLocationVerifiedEvent extends EventEnvelope<StudioLocationVerifiedPayload> {}

export type PayoutMethod = 'standard' | 'instant';

export interface PaymentsPayoutReleasedPayload {
  payout_id: string;
  provider_user_id: string;
  booking_id: string;
  leg_id: string;
  amount_cents: number;
  currency: string;
  transfer_reference: string;
  bank_account_hash: string;
  released_at: string;
  payout_method: PayoutMethod;
  fees_cents: number;
}

export interface PaymentsPayoutReleasedEvent extends EventEnvelope<PaymentsPayoutReleasedPayload> {}

export interface StudioVerificationContext {
  studio: Studio;
  verifiedBy: string;
  verifiedAt: string;
}

export interface PayoutReleaseRecord {
  payoutId: string;
  providerUserId: string;
  bookingId: string;
  legId: string;
  amountCents: number;
  currency: string;
  transferReference: string;
  bankAccountReference: string;
  payoutMethod: PayoutMethod;
  feesCents: number;
  releasedAt: string;
}

