const MS_PER_DAY = 24 * 60 * 60 * 1000;

export class PayoutComputationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PayoutComputationError';
    this.code = code;
    this.details = details;
  }
}

function defaultIdFactory(prefix) {
  const base =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  return `${prefix}_${base}`;
}

function toInt(value, { min = undefined, max = undefined, field }) {
  if (!Number.isFinite(value)) {
    throw new PayoutComputationError('VALUE_INVALID', `${field} must be a finite number.`, { value });
  }
  const intValue = Math.trunc(value);
  if (min !== undefined && intValue < min) {
    throw new PayoutComputationError('VALUE_BELOW_MIN', `${field} must be >= ${min}.`, { value });
  }
  if (max !== undefined && intValue > max) {
    throw new PayoutComputationError('VALUE_ABOVE_MAX', `${field} must be <= ${max}.`, { value });
  }
  return intValue;
}

function parseIso(iso, fallback = Date.now()) {
  if (!iso) {
    return fallback;
  }
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) {
    throw new PayoutComputationError('INVALID_TIMESTAMP', 'Unable to parse ISO timestamp.', { iso });
  }
  return time;
}

export function computeSellerBreakdown({
  totalCents,
  platformFeesCents = 0,
  refundCents = 0,
  adjustmentsCents = 0,
  chargebackReserveCents = 0
}) {
  const total = toInt(totalCents, { field: 'totalCents', min: 0 });
  const fees = toInt(platformFeesCents, { field: 'platformFeesCents', min: 0 });
  const refunds = toInt(refundCents, { field: 'refundCents', min: 0 });
  const adjustments = toInt(adjustmentsCents, { field: 'adjustmentsCents', min: -total });
  const chargebacks = toInt(chargebackReserveCents, { field: 'chargebackReserveCents', min: 0 });

  const gross = total - fees - refunds + adjustments;
  const sellerGross = Math.max(0, gross);
  const sellerNet = Math.max(0, sellerGross - chargebacks);

  return {
    sellerGross,
    sellerNet,
    platformFeesCents: fees,
    refundCents: refunds,
    adjustmentsCents: adjustments,
    chargebackReserveCents: chargebacks
  };
}

export function computeReservePlan({ sellerNet, reservePolicy, nowIso, reservePercentFallbackBps = 0 }) {
  const net = toInt(sellerNet, { field: 'sellerNet', min: 0 });
  if (net === 0) {
    return {
      reserveHoldCents: 0,
      transferNowCents: 0,
      sellerNetCents: 0,
      reserveReleaseAt: null,
      reserveReason: 'ZERO_NET'
    };
  }

  const policy = reservePolicy ?? {
    reserveBps: reservePercentFallbackBps,
    minimumCents: 0,
    rollingDays: 0,
    instantPayoutEnabled: false
  };

  const reserveBps = toInt(policy.reserveBps ?? reservePercentFallbackBps ?? 0, {
    field: 'reserveBps',
    min: 0,
    max: 10000
  });
  const minimum = toInt(policy.minimumCents ?? 0, { field: 'minimumCents', min: 0 });
  const rollingDays = toInt(policy.rollingDays ?? 0, { field: 'rollingDays', min: 0 });

  const percentageHold = Math.round((net * reserveBps) / 10000);
  const reserveHold = Math.min(net, Math.max(percentageHold, minimum));
  const transferNow = Math.max(0, net - reserveHold);

  const baseTime = parseIso(nowIso);
  const releaseAt = reserveHold > 0 && rollingDays > 0 ? new Date(baseTime + rollingDays * MS_PER_DAY).toISOString() : null;

  return {
    reserveHoldCents: reserveHold,
    transferNowCents: transferNow,
    sellerNetCents: net,
    reserveReleaseAt: releaseAt,
    reserveReason: reserveHold > 0 ? 'RESERVE_POLICY' : 'NO_RESERVE'
  };
}

export function computePayout({ nowIso = new Date().toISOString(), payoutDelayDays = 1, instantPayoutRequested = false, supportsInstantPayout = false, reservePolicy = null, currency = 'USD', ...rest }) {
  if (!rest || typeof rest.legId !== 'string' || rest.legId.length === 0) {
    throw new PayoutComputationError('LEG_ID_REQUIRED', 'legId is required to compute payout.', { rest });
  }
  if (!rest.sellerUserId || typeof rest.sellerUserId !== 'string') {
    throw new PayoutComputationError('SELLER_REQUIRED', 'sellerUserId is required to compute payout.', { rest });
  }

  const breakdown = computeSellerBreakdown(rest);
  const reservePlan = computeReservePlan({
    sellerNet: breakdown.sellerNet,
    reservePolicy,
    nowIso
  });

  const baseTime = parseIso(nowIso);
  const delayDays = Math.max(0, payoutDelayDays ?? 0);
  const scheduledFor = new Date(baseTime + delayDays * MS_PER_DAY).toISOString();

  const instantEligible = Boolean(supportsInstantPayout && (reservePolicy?.instantPayoutEnabled ?? false) && reservePlan.reserveHoldCents === 0);
  const executeInstant = instantEligible && instantPayoutRequested;
  const payoutScheduledFor = executeInstant ? new Date(baseTime).toISOString() : scheduledFor;
  const payoutAmountCents = reservePlan.transferNowCents;
  const instantFeeCents = executeInstant ? Math.round(payoutAmountCents * 0.01) : 0;

  return {
    ...reservePlan,
    payoutAmountCents,
    payoutScheduledFor,
    instantFeeCents,
    instantPayoutEligible: instantEligible,
    currency: currency ?? 'USD'
  };
}

export function createPayoutInstruction(context, { payoutId, idempotencyKey, idFactory = defaultIdFactory } = {}) {
  const result = computePayout(context);
  const instructionId = payoutId ?? idFactory('pay');
  const key = idempotencyKey ?? `payout:${context.legId}:${instructionId}`;
  return {
    payoutId: instructionId,
    legId: context.legId,
    sellerUserId: context.sellerUserId,
    amountCents: result.payoutAmountCents,
    currency: result.currency ?? 'USD',
    scheduledFor: result.payoutScheduledFor,
    reserveHoldCents: result.reserveHoldCents,
    instantPayoutEligible: result.instantPayoutEligible,
    idempotencyKey: key,
    metadata: {
      reserve_release_at: result.reserveReleaseAt,
      reserve_reason: result.reserveReason,
      instant_fee_cents: result.instantFeeCents,
      platform_fees_cents: context.platformFeesCents ?? 0,
      refund_cents: context.refundCents ?? 0
    }
  };
}

export function buildReserveLedgerEntry({ reserveHoldCents, sellerUserId, legId, payoutId = null, releaseAt, notes = null, idFactory = defaultIdFactory }) {
  if (!sellerUserId || reserveHoldCents <= 0) {
    return null;
  }
  const entryId = idFactory('res');
  return {
    entryId,
    sellerUserId,
    legId: legId ?? null,
    payoutId: payoutId ?? null,
    reserveCents: reserveHoldCents,
    status: 'held',
    heldAt: new Date().toISOString(),
    releaseAfter: releaseAt ?? null,
    releasedAt: null,
    notes: notes ?? undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export function evaluateReserveRelease(entry, { nowIso = new Date().toISOString() } = {}) {
  if (!entry || typeof entry.entryId !== 'string') {
    throw new PayoutComputationError('RESERVE_ENTRY_REQUIRED', 'Reserve ledger entry is required to evaluate release.', { entry });
  }
  if (entry.status !== 'held' && entry.status !== 'pending_release') {
    return { shouldRelease: false, reason: 'STATUS_NOT_HELD' };
  }
  if (!entry.releaseAfter) {
    return { shouldRelease: entry.status === 'pending_release', reason: entry.status === 'pending_release' ? 'MANUAL_RELEASE' : 'NO_SCHEDULE' };
  }
  const now = parseIso(nowIso);
  const releaseAt = parseIso(entry.releaseAfter);
  if (now >= releaseAt) {
    return { shouldRelease: true, reason: 'SCHEDULE_REACHED' };
  }
  return { shouldRelease: false, reason: 'SCHEDULE_NOT_MET', secondsRemaining: Math.ceil((releaseAt - now) / 1000) };
}

export function applyPayoutWebhookStatus(currentStatus, eventType) {
  switch (eventType) {
    case 'payout.paid':
      return 'paid';
    case 'payout.failed':
      return currentStatus === 'paid' ? 'paid' : 'failed';
    case 'payout.canceled':
      return 'canceled';
    case 'payout.pending':
      return currentStatus === 'queued' ? 'queued' : currentStatus;
    default:
      return currentStatus;
  }
}
