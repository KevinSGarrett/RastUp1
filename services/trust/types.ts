export type IdvStatusValue = 'pending' | 'passed' | 'failed' | 'expired' | 'requires_review';
export type BgStatusValue =
  | 'invited'
  | 'in_progress'
  | 'clear'
  | 'consider'
  | 'suspended'
  | 'disputed'
  | 'withdrawn'
  | 'expired';

export interface IdvStatus {
  status: IdvStatusValue;
  ageVerified: boolean;
  provider?: string;
  providerRef?: string;
  updatedAt?: string;
}

export interface BgStatus {
  status: BgStatusValue;
  adjudication?: string | null;
  provider?: string;
  providerRef?: string;
  updatedAt?: string;
}

export interface SocialStatus {
  platform: 'instagram' | 'tiktok' | 'youtube' | 'x';
  handle: string;
  verified: boolean;
  lastCheckedAt?: string;
}

export interface RiskMetrics {
  disputesOpened?: number;
  refundsAsked?: number;
  cancellations?: number;
  lateDelivery?: number;
  chargeFailures?: number;
  badClicks?: number;
  score?: number;
  computedAt?: string;
}

export interface TrustStatusAggregate {
  idVerified: boolean;
  ageVerified: boolean;
  trustedPro: boolean;
  socialVerified: boolean;
  riskScore: number;
  badges: string[];
  lastIdvAt?: string;
  lastBgAt?: string;
}

export interface EligibilityThresholds {
  instantBook?: number;
  promotions?: number;
  manualReview?: number;
  safeModeOverride?: number;
}

export interface EligibilityResult {
  canInstantBook: boolean;
  promotionEligible: boolean;
  requiresManualReview: boolean;
  safeModeOverrideAllowed: boolean;
}

export interface TwoPersonContext {
  action: string;
  severity?: 'low' | 'medium' | 'high';
  reason?: string;
}

export interface RecertificationRules {
  idvMonths?: number;
  bgMonths?: number;
  socialDays?: number;
}
