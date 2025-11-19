export class ReconciliationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ReconciliationError';
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

function toCents(value, field) {
  if (!Number.isFinite(value)) {
    throw new ReconciliationError('AMOUNT_INVALID', `${field} must be numeric.`, { value });
  }
  return Math.trunc(value);
}

export function computeVarianceSummary({ chargeCapturedCents, refundTotalCents = 0, payoutTotalCents = 0, reserveHeldCents = 0, adjustmentsCents = 0 }) {
  const charges = toCents(chargeCapturedCents, 'chargeCapturedCents');
  const refunds = toCents(refundTotalCents, 'refundTotalCents');
  const payouts = toCents(payoutTotalCents, 'payoutTotalCents');
  const reserves = toCents(reserveHeldCents, 'reserveHeldCents');
  const adjustments = toCents(adjustmentsCents, 'adjustmentsCents');

  const expected = charges + adjustments - refunds;
  const actual = payouts + reserves;
  const variance = expected - actual;
  const magnitude = Math.abs(expected) > 0 ? Math.abs((variance / expected) * 10000) : 0;

  return {
    charges,
    refunds,
    payouts,
    reserves,
    adjustments,
    expected,
    actual,
    variance,
    varianceBps: Math.round(magnitude)
  };
}

export function evaluateCloseReadiness({ varianceSummary, toleranceBps = 50, outstandingItems = [] }) {
  if (!varianceSummary || typeof varianceSummary.variance !== 'number') {
    throw new ReconciliationError('SUMMARY_REQUIRED', 'Variance summary is required to evaluate readiness.', { varianceSummary });
  }
  if (!Array.isArray(outstandingItems)) {
    throw new ReconciliationError('OUTSTANDING_INVALID', 'Outstanding items must be an array.', { outstandingItems });
  }

  if (varianceSummary.varianceBps > toleranceBps) {
    return { ready: false, reason: 'VARIANCE_ABOVE_TOLERANCE' };
  }
  if (outstandingItems.length > 0) {
    return { ready: false, reason: 'OUTSTANDING_ITEMS', outstandingItems };
  }
  return { ready: true, reason: 'READY' };
}

export function createCloseSnapshot({ closeDate, actorAdmin, varianceSummary, items = [], nowIso = new Date().toISOString(), idFactory = defaultIdFactory }) {
  if (!closeDate) {
    throw new ReconciliationError('CLOSE_DATE_REQUIRED', 'closeDate is required.', { closeDate });
  }
  const closeId = idFactory('cls');
  const snapshotItems = items.map((item) => ({
    itemId: item.itemId ?? idFactory('cli'),
    category: item.category,
    expectedCents: item.expectedCents ?? null,
    actualCents: item.actualCents ?? null,
    varianceCents: item.varianceCents ?? null,
    context: item.context ?? {}
  }));

  return {
    closeId,
    closeDate,
    status: 'open',
    varianceCents: varianceSummary?.variance ?? 0,
    varianceSummary: varianceSummary ?? {},
    startedAt: nowIso,
    completedAt: null,
    actorAdmin: actorAdmin ?? null,
    items: snapshotItems
  };
}
