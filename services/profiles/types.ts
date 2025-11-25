export type RoleType = 'model' | 'photographer' | 'videographer' | 'creator' | 'fansub';

export interface PricingPackage {
  packageId: string;
  name: string;
  priceCents: number;
  durationMin: number;
  includes?: string[];
  addons?: Array<{ name: string; priceCents: number }>;
  licensing?: { type: string; notes?: string };
}

export interface ServiceProfileInput {
  role: RoleType;
  displayName: string;
  slug: string;
  city: string;
  region?: string | null;
  country: string;
  aboutFields: Record<string, unknown>;
  pricingFields: PricingPackage[];
  socialFields?: Record<string, unknown>;
  languages: string[];
  tags: string[];
  safeModeBand?: number;
  verification?: Record<string, unknown>;
  instantBook?: boolean;
}

export interface ValidationIssue {
  code: string;
  message: string;
  path: string[];
  meta?: Record<string, unknown>;
  severity?: 'error' | 'warning';
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  warnings: ValidationIssue[];
  normalized: ServiceProfileInput;
}

export interface CompletenessSignals {
  hasIdVerification?: boolean;
  hasBackgroundCheck?: boolean;
  portfolioCount?: number;
  primaryMediaApproved?: boolean;
  pricingCoverage?: number;
  availabilityDays?: number;
  reviewCount?: number;
  reviewAverage?: number;
  hasInstantBook?: boolean;
  hasStudioLink?: boolean;
  socialFollowers?: number;
  docStatus?: 'draft' | 'signed';
  payoutOnboarded?: boolean;
}

export interface CompletenessBreakdown {
  score: number;
  capped: boolean;
  components: Record<string, number>;
}

export interface PublishReadiness {
  publishable: boolean;
  blockingReasons: ValidationIssue[];
  warnings: ValidationIssue[];
  score: CompletenessBreakdown;
  recommendedActions: string[];
  safeModeBand: number;
}

export interface MediaItem {
  id: string;
  url: string;
  nsfwBand?: number;
  safePlaceholder?: string;
  [key: string]: unknown;
}

export interface SafeModeOptions {
  safeModeEnabled: boolean;
  allowedBand?: number;
  defaultPlaceholder?: string;
  blurVariantKey?: string;
}

export interface SafeModeResult {
  visible: MediaItem[];
  filtered: MediaItem[];
  reason?: string;
}
