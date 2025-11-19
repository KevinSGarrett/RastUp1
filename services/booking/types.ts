export type LegType = 'TALENT' | 'STUDIO';

export type LegStatus =
  | 'DRAFT'
  | 'AWAITING_DOCS'
  | 'AWAITING_PAYMENT'
  | 'CONFIRMED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED';

export type LbgStatus =
  | 'DRAFT'
  | 'AWAITING_DOCS'
  | 'AWAITING_PAYMENT'
  | 'CONFIRMED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED';

export type ChargeStatus =
  | 'REQUIRES_ACTION'
  | 'AUTHORIZED'
  | 'CAPTURED'
  | 'SUCCEEDED'
  | 'CANCELED'
  | 'FAILED';

export type DepositStatus =
  | 'REQUIRES_ACTION'
  | 'AUTHORIZED'
  | 'CAPTURED'
  | 'VOIDED'
  | 'EXPIRED';

export interface CancellationBand {
  fromHours: number;
  toHours?: number | null;
  buyerRefundPct: number;
  sellerPayoutPct: number;
}

export interface CancellationPolicy {
  version: number;
  bands: CancellationBand[];
  providerCancelFullRefund?: boolean;
  adminOverrideAllowed?: boolean;
  platformFeeRefundable?: boolean;
}

export interface BookingLegSnapshot {
  legId: string;
  type: LegType;
  status: LegStatus;
  title: string;
  startAt: string;
  endAt: string;
  subtotalCents: number;
  taxCents: number;
  feesCents: number;
  totalCents: number;
  currency: string;
  policy: CancellationPolicy;
  docsSigned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LinkedBookingGroupSnapshot {
  lbgId: string;
  status: LbgStatus;
  city: string;
  startAt: string;
  endAt: string;
  acceptanceUntil?: string | null;
  currency: string;
  legs: BookingLegSnapshot[];
  createdAt: string;
  updatedAt: string;
}

export interface AmendmentDelta {
  deltaSubtotalCents: number;
  deltaTaxCents: number;
  deltaFeesCents: number;
  deltaTotalCents: number;
}

export interface RefundOverride {
  refundCents?: number;
  sellerRetainedCents?: number;
  taxRefundCents?: number;
  approvedBy?: string;
  note?: string;
}

export interface RefundComputationContext {
  cancelAt: string;
  reason?: string;
  providerCancelled?: boolean;
  override?: RefundOverride;
  feesRefundable?: boolean;
  taxBehavior?: 'FULL' | 'PARTIAL' | 'NONE';
  depositCapturedCents?: number;
}

export interface RefundOutcome {
  refundCents: number;
  sellerRetainedCents: number;
  taxRefundCents: number;
  overrideApplied: boolean;
  policyVersion: number;
  hoursToStart: number;
}

export interface ChargeSplit {
  legId: string;
  amountCents: number;
}

export interface ChargeLegContext extends ChargeSplit {
  sellerUserId: string;
  connectAccountId?: string;
  reservePercent?: number;
}

export interface PaymentIntentRequest {
  amount: number;
  currency: string;
  payment_method_types: string[];
  customer?: string;
  payment_method?: string;
  setup_future_usage?: 'on_session' | 'off_session';
  confirm?: boolean;
  capture_method?: 'automatic' | 'manual';
  metadata: Record<string, string>;
  description?: string;
  transfer_group?: string;
  on_behalf_of?: string;
  application_fee_amount?: number;
}

export interface PaymentIntentContext {
  lbgId: string;
  chargeId?: string;
  currency: string;
  legs: ChargeLegContext[];
  paymentMethodKind: 'CARD' | 'ACH_DEBIT';
  customerId?: string;
  paymentMethodId?: string;
  saveForFutureUse?: boolean;
  confirm?: boolean;
  transferDelayDays?: number;
  idempotencyKey?: string;
}

export interface PaymentIntentPayload {
  amountCents: number;
  splits: ChargeSplit[];
  request: PaymentIntentRequest;
  metadata: Record<string, string>;
}

