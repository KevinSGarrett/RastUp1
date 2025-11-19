const MS_PER_HOUR = 1000 * 60 * 60;

export class PolicyInvariantError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PolicyInvariantError';
    this.code = code;
    this.details = details;
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizePolicy(policy) {
  if (!policy || !Array.isArray(policy.bands) || policy.bands.length === 0) {
    throw new PolicyInvariantError('POLICY_INVALID', 'Policy must supply at least one refund band.', { policy });
  }
  const normalized = {
    version: policy.version ?? 1,
    providerCancelFullRefund: policy.providerCancelFullRefund !== false,
    adminOverrideAllowed: policy.adminOverrideAllowed !== false,
    platformFeeRefundable: policy.platformFeeRefundable !== false,
    bands: [...policy.bands].map((band) => ({
      fromHours: band.fromHours ?? 0,
      toHours: band.toHours ?? null,
      buyerRefundPct: clamp(band.buyerRefundPct ?? 0, 0, 100),
      sellerPayoutPct: clamp(band.sellerPayoutPct ?? 0, 0, 100)
    }))
  };

  normalized.bands.sort((a, b) => (b.fromHours ?? 0) - (a.fromHours ?? 0));
  return normalized;
}

export function calculateHoursToStart(startAt, cancelAt) {
  const start = new Date(startAt).getTime();
  const cancel = new Date(cancelAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(cancel)) {
    throw new PolicyInvariantError('INVALID_TIMESTAMP', 'startAt and cancelAt must be ISO timestamps.', {
      startAt,
      cancelAt
    });
  }
  return (start - cancel) / MS_PER_HOUR;
}

function selectBand(policy, hoursToStart) {
  for (const band of policy.bands) {
    const lower = band.fromHours ?? Number.NEGATIVE_INFINITY;
    const upper = band.toHours ?? Number.POSITIVE_INFINITY;
    if (hoursToStart >= lower && hoursToStart < upper) {
      return band;
    }
  }
  return policy.bands[policy.bands.length - 1];
}

function computeTaxRefund(taxCents, totalCents, refundCents, taxBehavior) {
  if (!taxCents || taxBehavior === 'NONE') {
    return 0;
  }
  if (taxBehavior === 'FULL') {
    return taxCents;
  }
  if (totalCents <= 0) {
    return 0;
  }
  const ratio = refundCents / totalCents;
  return Math.min(taxCents, Math.round(taxCents * ratio));
}

export function calculateRefundOutcome({ leg, policy, context }) {
  if (!leg) {
    throw new PolicyInvariantError('LEG_REQUIRED', 'Leg snapshot is required to compute refund outcome.');
  }
  if (!context || !context.cancelAt) {
    throw new PolicyInvariantError('CANCEL_TS_REQUIRED', 'Cancellation timestamp is required.', { legId: leg.legId });
  }

  const normalizedPolicy = normalizePolicy(policy);
  const hoursToStart = calculateHoursToStart(leg.startAt, context.cancelAt);

  let refundCents = 0;
  let sellerRetainedCents = leg.totalCents;
  let overrideApplied = false;

  if (context.override && typeof context.override.refundCents === 'number') {
    overrideApplied = true;
    refundCents = clamp(Math.trunc(context.override.refundCents), 0, leg.totalCents);
    sellerRetainedCents = clamp(
      typeof context.override.sellerRetainedCents === 'number'
        ? Math.trunc(context.override.sellerRetainedCents)
        : leg.totalCents - refundCents,
      0,
      leg.totalCents
    );
  } else if (context.providerCancelled && normalizedPolicy.providerCancelFullRefund) {
    refundCents = leg.totalCents;
    sellerRetainedCents = 0;
  } else {
    const band = selectBand(normalizedPolicy, hoursToStart);
    const buyerPct = clamp(band.buyerRefundPct, 0, 100);
    refundCents = Math.round((leg.totalCents * buyerPct) / 100);
    refundCents = clamp(refundCents, 0, leg.totalCents);
    sellerRetainedCents = leg.totalCents - refundCents;
  }

  if (context.depositCapturedCents) {
    sellerRetainedCents = clamp(sellerRetainedCents + context.depositCapturedCents, 0, leg.totalCents);
    refundCents = leg.totalCents - sellerRetainedCents;
  }

  let taxRefundCents;
  if (overrideApplied && typeof context.override?.taxRefundCents === 'number') {
    taxRefundCents = clamp(Math.trunc(context.override.taxRefundCents), 0, leg.taxCents);
  } else {
    taxRefundCents = computeTaxRefund(leg.taxCents, leg.totalCents, refundCents, context.taxBehavior ?? 'PARTIAL');
  }

  return {
    refundCents,
    sellerRetainedCents,
    taxRefundCents,
    overrideApplied,
    policyVersion: normalizedPolicy.version,
    hoursToStart
  };
}

export function quoteCancellationOutcome({ leg, policy, context }) {
  return calculateRefundOutcome({ leg, policy, context });
}

export function summarizeBands(policy) {
  const normalizedPolicy = normalizePolicy(policy);
  return normalizedPolicy.bands.map((band) => ({
    window: [band.fromHours, band.toHours],
    buyerRefundPct: band.buyerRefundPct,
    sellerPayoutPct: band.sellerPayoutPct
  }));
}
