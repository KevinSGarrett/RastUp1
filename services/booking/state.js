const LEG_TRANSITIONS = new Map([
  ['DRAFT', ['AWAITING_DOCS', 'CANCELLED', 'FAILED']],
  ['AWAITING_DOCS', ['AWAITING_PAYMENT', 'CANCELLED', 'FAILED']],
  ['AWAITING_PAYMENT', ['CONFIRMED', 'CANCELLED', 'FAILED']],
  ['CONFIRMED', ['IN_PROGRESS', 'CANCELLED', 'FAILED']],
  ['IN_PROGRESS', ['COMPLETED', 'CANCELLED', 'FAILED']],
  ['COMPLETED', []],
  ['CANCELLED', []],
  ['FAILED', []]
]);

const LBG_PRIORITY = [
  'FAILED',
  'CANCELLED',
  'IN_PROGRESS',
  'CONFIRMED',
  'AWAITING_PAYMENT',
  'AWAITING_DOCS',
  'DRAFT',
  'COMPLETED'
];

const VALID_CHARGE_STATUSES = new Set(['AUTHORIZED', 'CAPTURED', 'SUCCEEDED']);

export class StateInvariantError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'StateInvariantError';
    this.code = code;
    this.details = details;
  }
}

export function isValidLegTransition(fromStatus, toStatus) {
  if (fromStatus === toStatus) {
    return true;
  }
  const allowed = LEG_TRANSITIONS.get(fromStatus);
  return Array.isArray(allowed) && allowed.includes(toStatus);
}

export function assertLegTransition(fromStatus, toStatus) {
  if (!isValidLegTransition(fromStatus, toStatus)) {
    throw new StateInvariantError('INVALID_LEG_TRANSITION', `Cannot transition leg from ${fromStatus} to ${toStatus}`, {
      fromStatus,
      toStatus
    });
  }
}

export function transitionLegStatus(leg, toStatus) {
  assertLegTransition(leg.status, toStatus);
  return {
    ...leg,
    status: toStatus,
    updatedAt: new Date().toISOString()
  };
}

export function deriveLbgStatus(legs) {
  if (!Array.isArray(legs) || legs.length === 0) {
    return 'DRAFT';
  }

  const statuses = new Set(legs.map((leg) => leg.status));

  if (statuses.has('FAILED')) {
    return 'FAILED';
  }
  if (statuses.size === 1 && statuses.has('CANCELLED')) {
    return 'CANCELLED';
  }
  if (statuses.has('IN_PROGRESS')) {
    return 'IN_PROGRESS';
  }
  if (Array.from(statuses).every((status) => status === 'COMPLETED')) {
    return 'COMPLETED';
  }
  if (Array.from(statuses).every((status) => status === 'CONFIRMED')) {
    return 'CONFIRMED';
  }
  if (statuses.has('AWAITING_PAYMENT')) {
    return 'AWAITING_PAYMENT';
  }
  if (statuses.has('AWAITING_DOCS') || statuses.has('DRAFT')) {
    return statuses.has('AWAITING_DOCS') ? 'AWAITING_DOCS' : 'DRAFT';
  }
  if (statuses.has('CANCELLED')) {
    return 'CANCELLED';
  }
  if (statuses.has('FAILED')) {
    return 'FAILED';
  }

  return LBG_PRIORITY.find((candidate) => statuses.has(candidate)) ?? 'DRAFT';
}

export function ensureDocsBeforePayment(legs) {
  return legs.every((leg) => leg.docsSigned === true);
}

export function ensureAtomicConfirmation({ legs, docsSigned, chargeStatus }) {
  if (!Array.isArray(legs) || legs.length === 0) {
    throw new StateInvariantError('BOOKING_NO_LEGS', 'Cannot confirm an empty booking.');
  }
  if (!docsSigned || !ensureDocsBeforePayment(legs)) {
    throw new StateInvariantError('DOCS_NOT_SIGNED', 'All legs must have signed documents before payment.');
  }

  const invalidLegs = legs.filter(
    (leg) => !['AWAITING_PAYMENT', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(leg.status)
  );
  if (invalidLegs.length > 0) {
    throw new StateInvariantError('BOOKING_LEG_NOT_READY', 'All legs must be ready for confirmation.', {
      legIds: invalidLegs.map((leg) => leg.legId),
      statuses: invalidLegs.map((leg) => leg.status)
    });
  }

  if (!VALID_CHARGE_STATUSES.has(chargeStatus)) {
    throw new StateInvariantError('CHARGE_NOT_READY', 'Charge must be authorized or captured before confirmation.', {
      chargeStatus
    });
  }

  return true;
}

export function applyAmendmentToLeg(leg, amendment) {
  const nextSubtotal = leg.subtotalCents + amendment.deltaSubtotalCents;
  const nextTax = leg.taxCents + amendment.deltaTaxCents;
  const nextFees = leg.feesCents + amendment.deltaFeesCents;
  const nextTotal = leg.totalCents + amendment.deltaTotalCents;

  if (nextTotal < 0 || nextSubtotal < 0 || nextTax < 0 || nextFees < 0) {
    throw new StateInvariantError('NEGATIVE_TOTAL', 'Amendment would result in negative monetary values.', {
      legId: leg.legId,
      amendment
    });
  }

  if (nextSubtotal + nextTax + nextFees !== nextTotal) {
    throw new StateInvariantError('TOTAL_MISMATCH', 'Totals must remain internally consistent after amendment.', {
      legId: leg.legId,
      amendment,
      totals: {
        subtotal: nextSubtotal,
        tax: nextTax,
        fees: nextFees,
        total: nextTotal
      }
    });
  }

  return {
    ...leg,
    subtotalCents: nextSubtotal,
    taxCents: nextTax,
    feesCents: nextFees,
    totalCents: nextTotal,
    updatedAt: new Date().toISOString()
  };
}

export function calculateAggregateTotals(legs) {
  return legs.reduce(
    (acc, leg) => {
      acc.subtotalCents += leg.subtotalCents;
      acc.taxCents += leg.taxCents;
      acc.feesCents += leg.feesCents;
      acc.totalCents += leg.totalCents;
      return acc;
    },
    { subtotalCents: 0, taxCents: 0, feesCents: 0, totalCents: 0 }
  );
}

export function computeAcceptanceDeadline(startAt, windowHours = 24) {
  const start = new Date(startAt).getTime();
  if (Number.isNaN(start)) {
    throw new StateInvariantError('INVALID_START', 'startAt is not a valid ISO timestamp.', { startAt });
  }
  const ms = windowHours * 60 * 60 * 1000;
  return new Date(start + ms).toISOString();
}

export function canAutoComplete(legs, nowIso) {
  const now = new Date(nowIso ?? new Date().toISOString()).getTime();
  const incomplete = legs.filter((leg) => !['COMPLETED', 'CANCELLED', 'FAILED'].includes(leg.status));
  if (incomplete.length > 0) {
    return false;
  }
  return legs.every((leg) => {
    const end = new Date(leg.endAt).getTime();
    return !Number.isNaN(end) && end <= now;
  });
}

export function normalizeStatus(status) {
  const upper = String(status ?? '').toUpperCase();
  return LBG_PRIORITY.includes(upper) || upper === 'COMPLETED' ? upper : status;
}
