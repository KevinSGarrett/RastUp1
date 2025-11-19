import { calculateRefundOutcome } from './policy.js';

const CANCELLABLE_STATUSES = new Set(['AWAITING_PAYMENT', 'CONFIRMED', 'IN_PROGRESS']);

export class CancellationExecutionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CancellationExecutionError';
    this.code = code;
    this.details = details;
  }
}

export function assertLegCancellable(leg) {
  if (!leg || typeof leg.legId !== 'string') {
    throw new CancellationExecutionError('LEG_REQUIRED', 'Leg snapshot is required for cancellation.', { leg });
  }
  if (!CANCELLABLE_STATUSES.has(leg.status)) {
    throw new CancellationExecutionError('LEG_STATUS_NOT_CANCELLABLE', 'Leg is not in a cancellable status.', {
      legId: leg.legId,
      status: leg.status
    });
  }
  return true;
}

export function quoteLegCancellation({ leg, policy, cancelAt = new Date().toISOString(), context = {} }) {
  assertLegCancellable(leg);
  const computationContext = { ...context, cancelAt };
  const outcome = calculateRefundOutcome({
    leg,
    policy: policy ?? leg.policy,
    context: computationContext
  });

  return {
    legId: leg.legId,
    refundCents: outcome.refundCents,
    sellerRetainedCents: outcome.sellerRetainedCents,
    taxRefundCents: outcome.taxRefundCents,
    policyVersion: outcome.policyVersion,
    overrideApplied: outcome.overrideApplied,
    hoursToStart: outcome.hoursToStart
  };
}

export function buildRefundCommand({ lbgId, legId, outcome, reason, idempotencyKey }) {
  if (!outcome || typeof outcome.refundCents !== 'number') {
    throw new CancellationExecutionError('REFUND_OUTCOME_REQUIRED', 'Refund outcome is required to build command.', { outcome });
  }
  if (!Number.isInteger(outcome.refundCents) || outcome.refundCents < 0) {
    throw new CancellationExecutionError('REFUND_AMOUNT_INVALID', 'Refund amount must be a non-negative integer.', outcome);
  }
  if (!idempotencyKey || typeof idempotencyKey !== 'string') {
    throw new CancellationExecutionError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency key is required.', { idempotencyKey });
  }

  return {
    lbgId,
    legId,
    amountCents: outcome.refundCents,
    taxRefundCents: outcome.taxRefundCents ?? 0,
    reason: reason ?? 'policy_cancel',
    metadata: {
      sellerRetainedCents: outcome.sellerRetainedCents,
      policyVersion: outcome.policyVersion,
      overrideApplied: outcome.overrideApplied
    },
    idempotencyKey
  };
}

export function summarizeRefundOutcomes(outcomes) {
  if (!Array.isArray(outcomes)) {
    return {
      totalRefundCents: 0,
      totalSellerRetainedCents: 0,
      totalTaxRefundCents: 0,
      legs: []
    };
  }

  return outcomes.reduce(
    (acc, outcome) => {
      acc.totalRefundCents += outcome.refundCents ?? 0;
      acc.totalSellerRetainedCents += outcome.sellerRetainedCents ?? 0;
      acc.totalTaxRefundCents += outcome.taxRefundCents ?? 0;
      acc.legs.push({
        legId: outcome.legId,
        refundCents: outcome.refundCents ?? 0,
        sellerRetainedCents: outcome.sellerRetainedCents ?? 0,
        taxRefundCents: outcome.taxRefundCents ?? 0
      });
      return acc;
    },
    {
      totalRefundCents: 0,
      totalSellerRetainedCents: 0,
      totalTaxRefundCents: 0,
      legs: []
    }
  );
}

export function derivePartialCancellationGuidance({ legs, cancelledLegId }) {
  if (!Array.isArray(legs)) {
    return { survivingLegs: [], groupStatus: 'UNKNOWN' };
  }
  const survivingLegs = legs.filter((leg) => leg.legId !== cancelledLegId);
  const hasConfirmedSurvivor = survivingLegs.some((leg) => ['CONFIRMED', 'IN_PROGRESS'].includes(leg.status));
  const groupStatus = hasConfirmedSurvivor ? 'PARTIAL_ACTIVE' : 'PENDING_DECISION';
  return { survivingLegs, groupStatus };
}

export function buildCancellationTimelineEvent({ lbgId, legId, outcome, reason, actor }) {
  return {
    lbgId,
    legId,
    eventType: 'booking.leg.cancelled',
    payload: {
      reason,
      actor,
      refundCents: outcome.refundCents,
      sellerRetainedCents: outcome.sellerRetainedCents,
      taxRefundCents: outcome.taxRefundCents,
      policyVersion: outcome.policyVersion,
      overrideApplied: outcome.overrideApplied
    },
    occurredAt: new Date().toISOString()
  };
}
