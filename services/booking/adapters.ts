import type {
  ChargeLegContext,
  PaymentIntentPayload,
  RefundOutcome
} from './types';

export interface PaymentAdapter {
  createOrUpdatePaymentIntent(payload: PaymentIntentPayload, opts: { idempotencyKey: string }): Promise<{ paymentIntentId: string; clientSecret?: string; status: string; requiresAction: boolean; }>;
  captureIncrementalAmount(intentId: string, amountCents: number, opts: { idempotencyKey: string }): Promise<{ status: string; capturedAmount: number; }>;
  createRefund(input: { chargeId: string; legId: string; amountCents: number; reason: string; idempotencyKey: string }): Promise<{ refundId: string; status: string; }>;
  recordChargeSplits?(chargeId: string, splits: ChargeLegContext[]): Promise<void>;
}

export interface TaxAdapter {
  quote(input: { legId: string; jurisdiction: string; amountCents: number }): Promise<{ quoteCents: number; breakdown: Record<string, number>; }>;
  commit(input: { legId: string; transactionId: string; amountCents: number }): Promise<void>;
  refund(input: { legId: string; transactionId: string; amountCents: number }): Promise<void>;
}

export interface DocPackAdapter {
  createPack(input: { lbgId: string; legIds: string[]; templates: string[]; locale: string }): Promise<{ packId: string; envelopeIds: string[]; expiresAt: string; }>;
  markEnvelopeSigned(input: { packId: string; envelopeId: string; signerId: string }): Promise<{ status: string; signedAt: string; hash: string; }>;
  fetchPackStatus(packId: string): Promise<{ status: string; envelopes: Array<{ envelopeId: string; status: string; signedAt?: string; hash?: string; }>; }>;
}

export interface RefundLedgerAdapter {
  persistOutcome(outcome: RefundOutcome & { lbgId: string; legId: string; refundId: string; reason: string }): Promise<void>;
}

export interface DepositAdapter {
  authorize(input: { legId: string; amountCents: number; paymentMethodId: string; idempotencyKey: string }): Promise<{ depositId: string; status: string; authorizedCents: number; }>;
  capture(input: { depositId: string; amountCents: number; reason: string; evidenceUrl?: string; idempotencyKey: string }): Promise<{ status: string; capturedCents: number; }>;
  void(input: { depositId: string; reason?: string }): Promise<{ status: string; }>;
}

