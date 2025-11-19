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
  platformFeesCents?: number;
  refundCents?: number;
  adjustmentsCents?: number;
  reservePolicy?: ReservePolicy | null;
  supportsInstantPayout?: boolean;
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

export type AmendmentKind = 'change_order' | 'overtime' | 'refund_line' | 'admin_adjustment';

export interface AmendmentLine {
  name: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  notes?: string;
}

export interface AmendmentDraft {
  amendmentId: string;
  legId: string;
  kind: AmendmentKind;
  lineJson: AmendmentLine;
  deltaSubtotalCents: number;
  deltaTaxCents: number;
  deltaFeesCents: number;
  deltaTotalCents: number;
  createdBy: string;
  createdAt: string;
}

export type AmendmentPaymentStrategy = 'INCREMENTAL_CAPTURE' | 'NEW_INTENT';

export interface RefundCommand {
  lbgId?: string;
  legId: string;
  amountCents: number;
  taxRefundCents: number;
  reason: string;
  metadata: Record<string, unknown>;
  idempotencyKey: string;
}

export interface RefundSummaryLeg {
  legId: string;
  refundCents: number;
  sellerRetainedCents: number;
  taxRefundCents: number;
}

export interface RefundSummary {
  totalRefundCents: number;
  totalSellerRetainedCents: number;
  totalTaxRefundCents: number;
  legs: RefundSummaryLeg[];
}

export interface DepositAuthSnapshot {
  depositId: string;
  legId: string;
  status: DepositStatus;
  authorizedCents: number;
  capturedCents: number;
  expiresAt?: string | null;
}

export type DepositClaimStatus = 'pending' | 'approved' | 'denied' | 'captured' | 'voided';

export interface DepositClaimRecord {
  claimId: string;
  depositId: string;
  legId: string;
  status: DepositClaimStatus;
  amountCents: number;
  capturedCents: number;
  reason: string;
  evidence: string[];
  submittedBy: string;
  approvedBy?: string;
  decisionReason?: string;
  decidedAt?: string;
  claimWindowExpiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReceiptLegPayload {
  legId: string;
  title: string;
  totalCents: number;
  taxCents: number;
  feesCents: number;
  currency: string;
  policy: unknown;
  amendments: AmendmentDraft[];
  refunds: Array<{
    refundId: string | null;
    status: string | null;
    amountCents: number;
    processor: string | null;
    processorRefundId: string | null;
    createdAt: string | null;
  }>;
  docHashes: string[];
}

export interface GroupReceiptPayload {
  lbgId: string;
  status: LbgStatus | null;
  legs: string[];
  currency: string;
  subtotalCents: number;
  taxCents: number;
  feesCents: number;
  totalCents: number;
  charge: {
    chargeId: string | null;
    processor: string | null;
    processorIntent: string | null;
    amountCents: number;
    status: string | null;
    capturedAt: string | null;
    paymentMethod: string | null;
  } | null;
  issuedAt: string;
  docHashes: string[];
}

export type ReceiptKind = 'leg' | 'group' | 'refund';

export interface ReceiptManifestEntry {
  receiptId: string;
  lbgId: string;
  legId: string | null;
  kind: ReceiptKind;
  docHashes: string[];
  payload: ReceiptLegPayload | GroupReceiptPayload | Record<string, unknown>;
  storageUrl: string | null;
  renderedAt: string | null;
  createdAt: string;
}

export interface NormalizedWebhookEvent {
  provider: string;
  eventId: string;
  rawType: string;
  normalizedType: string;
  occurredAt: string | null;
  lbgId: string | null;
  legIds: string[];
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export type ReserveStatus = 'held' | 'pending_release' | 'released' | 'forfeited';

export interface ReservePolicy {
  policyId: string;
  sellerUserId: string;
  reserveBps: number;
  minimumCents: number;
  rollingDays: number;
  instantPayoutEnabled: boolean;
  updatedAt: string;
  createdAt: string;
}

export interface ReserveLedgerEntry {
  entryId: string;
  sellerUserId: string;
  legId: string | null;
  payoutId: string | null;
  reserveCents: number;
  status: ReserveStatus;
  heldAt: string;
  releaseAfter?: string | null;
  releasedAt?: string | null;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReserveComputationResult {
  reserveHoldCents: number;
  transferNowCents: number;
  sellerNetCents: number;
  reserveReleaseAt?: string | null;
  reserveReason?: string;
}

export interface PayoutInstruction {
  payoutId: string;
  legId: string;
  sellerUserId: string;
  amountCents: number;
  currency: string;
  scheduledFor: string;
  reserveHoldCents: number;
  instantPayoutEligible: boolean;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
}

export interface PayoutComputationContext {
  legId: string;
  sellerUserId: string;
  totalCents: number;
  platformFeesCents?: number;
  refundCents?: number;
  adjustmentsCents?: number;
  currency?: string;
  reservePolicy?: ReservePolicy | null;
  chargebackReserveCents?: number;
  supportsInstantPayout?: boolean;
  nowIso?: string;
  payoutDelayDays?: number;
  instantPayoutRequested?: boolean;
}

export interface PayoutComputationResult extends ReserveComputationResult {
  payoutAmountCents: number;
  payoutScheduledFor: string;
  instantFeeCents?: number;
}

export type FinanceCloseStatus = 'open' | 'in_progress' | 'succeeded' | 'failed';

export interface FinanceDailyCloseItem {
  itemId: string;
  category: string;
  expectedCents?: number | null;
  actualCents?: number | null;
  varianceCents?: number | null;
  context: Record<string, unknown>;
}

export interface FinanceDailyCloseSnapshot {
  closeId: string;
  closeDate: string;
  status: FinanceCloseStatus;
  varianceCents: number;
  varianceSummary: Record<string, unknown>;
  startedAt: string;
  completedAt?: string | null;
  actorAdmin?: string | null;
  items: FinanceDailyCloseItem[];
}

export interface DisputeEvidenceItem {
  kind: 'doc' | 'message' | 'photo' | 'receipt' | 'timeline' | 'custom';
  label?: string;
  url?: string;
  content?: string;
  capturedAt?: string;
}

export interface DisputeRecord {
  disputeId: string;
  legId: string;
  processor: string;
  processorDispute?: string | null;
  status: string;
  reason: string;
  evidenceDueAt?: string | null;
  createdAt: string;
  updatedAt?: string;
  evidence?: DisputeEvidenceItem[];
}

export interface IdempotencyRecord {
  scope: string;
  key: string;
  status: string;
  response?: Record<string, unknown>;
  createdAt: string;
  expiresAt?: string | null;
}

