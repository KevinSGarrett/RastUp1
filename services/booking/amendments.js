import { applyAmendmentToLeg, StateInvariantError } from './state.js';
import { shouldUseIncrementalCapture } from './payments.js';

const AMENDMENT_KINDS = new Set(['change_order', 'overtime', 'admin_adjustment', 'refund_line']);

export class AmendmentInvariantError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AmendmentInvariantError';
    this.code = code;
    this.details = details;
  }
}

function assertPositiveInteger(value, code, field) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new AmendmentInvariantError(code, `${field} must be a positive integer.`, { field, value });
  }
}

function defaultIdFactory(prefix) {
  const base =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  return `${prefix}_${base}`;
}

export function buildChangeOrderLine({ name, quantity = 1, unitPriceCents, notes }) {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new AmendmentInvariantError('AMENDMENT_LINE_NAME_REQUIRED', 'Change order name is required.', { name });
  }
  assertPositiveInteger(quantity, 'AMENDMENT_LINE_QUANTITY_INVALID', 'quantity');
  assertPositiveInteger(unitPriceCents, 'AMENDMENT_LINE_UNIT_PRICE_INVALID', 'unitPriceCents');

  return {
    name: name.trim(),
    quantity,
    unitPriceCents,
    totalCents: quantity * unitPriceCents,
    notes: notes ?? undefined
  };
}

export function buildOvertimeLine({ minutes, ratePerMinuteCents, notes }) {
  assertPositiveInteger(minutes, 'AMENDMENT_LINE_MINUTES_INVALID', 'minutes');
  assertPositiveInteger(ratePerMinuteCents, 'AMENDMENT_LINE_RATE_INVALID', 'ratePerMinuteCents');

  const totalCents = minutes * ratePerMinuteCents;
  return {
    name: `Overtime (${minutes}m)`,
    quantity: 1,
    unitPriceCents: totalCents,
    totalCents,
    notes: notes ?? undefined
  };
}

export function calculateAmendmentDelta({ line, taxCents = 0, feesCents = 0 }) {
  if (!line || typeof line.totalCents !== 'number') {
    throw new AmendmentInvariantError('AMENDMENT_LINE_REQUIRED', 'Amendment line with totalCents is required.', { line });
  }
  if (!Number.isInteger(taxCents) || taxCents < 0) {
    throw new AmendmentInvariantError('AMENDMENT_TAX_INVALID', 'Tax cents must be a non-negative integer.', { taxCents });
  }
  if (!Number.isInteger(feesCents) || feesCents < 0) {
    throw new AmendmentInvariantError('AMENDMENT_FEES_INVALID', 'Fee cents must be a non-negative integer.', { feesCents });
  }

  const subtotalCents = line.totalCents;
  const totalCents = subtotalCents + taxCents + feesCents;

  return {
    deltaSubtotalCents: subtotalCents,
    deltaTaxCents: taxCents,
    deltaFeesCents: feesCents,
    deltaTotalCents: totalCents
  };
}

export function ensureAmendmentWindow({ leg, kind, nowIso = new Date().toISOString(), overtimeGraceMinutes = 120 }) {
  if (!leg || !leg.startAt || !leg.endAt) {
    throw new AmendmentInvariantError('LEG_TIMESTAMP_REQUIRED', 'Leg start and end times are required.', { leg });
  }
  if (!AMENDMENT_KINDS.has(kind)) {
    throw new AmendmentInvariantError('AMENDMENT_KIND_UNSUPPORTED', 'Unsupported amendment kind.', { kind });
  }

  const now = new Date(nowIso).getTime();
  const start = new Date(leg.startAt).getTime();
  const end = new Date(leg.endAt).getTime();
  if ([now, start, end].some(Number.isNaN)) {
    throw new AmendmentInvariantError('AMENDMENT_TIME_PARSE', 'Unable to parse timestamps.', { nowIso, startAt: leg.startAt, endAt: leg.endAt });
  }

  if (kind === 'change_order' && now >= start) {
    throw new AmendmentInvariantError('AMENDMENT_NOT_ALLOWED_WINDOW', 'Change orders must be confirmed before the session starts.', {
      legId: leg.legId,
      nowIso
    });
  }

  if (kind === 'overtime') {
    if (now < start) {
      throw new AmendmentInvariantError('AMENDMENT_NOT_ALLOWED_WINDOW', 'Overtime can only be added once the session has started.', {
        legId: leg.legId,
        nowIso
      });
    }
    const graceMs = overtimeGraceMinutes * 60 * 1000;
    if (now > end + graceMs) {
      throw new AmendmentInvariantError('AMENDMENT_NOT_ALLOWED_WINDOW', 'Overtime request is outside the allowed post-session window.', {
        legId: leg.legId,
        nowIso
      });
    }
  }

  return true;
}

export function createAmendmentDraft({
  leg,
  kind,
  line,
  taxCents = 0,
  feesCents = 0,
  createdBy,
  idFactory = defaultIdFactory,
  nowIso
}) {
  if (!leg || typeof leg.legId !== 'string') {
    throw new AmendmentInvariantError('LEG_REQUIRED', 'Leg snapshot is required.', { leg });
  }
  ensureAmendmentWindow({ leg, kind, nowIso });

  const deltas = calculateAmendmentDelta({ line, taxCents, feesCents });
  const draft = {
    amendmentId: idFactory('amd'),
    legId: leg.legId,
    kind,
    lineJson: line,
    ...deltas,
    createdBy,
    createdAt: new Date().toISOString()
  };

  let updatedLeg;
  try {
    updatedLeg = applyAmendmentToLeg(leg, deltas);
  } catch (error) {
    if (error instanceof StateInvariantError) {
      throw new AmendmentInvariantError(error.code ?? 'AMENDMENT_APPLY_FAILED', error.message, error.details);
    }
    throw error;
  }

  return { draft, updatedLeg, deltas };
}

export function determinePaymentStrategy({ charge, paymentMethodKind, deltaTotalCents }) {
  if (!Number.isInteger(deltaTotalCents) || deltaTotalCents <= 0) {
    throw new AmendmentInvariantError('AMENDMENT_DELTA_REQUIRED', 'Positive amendment total is required to determine payment strategy.', {
      deltaTotalCents
    });
  }

  if (paymentMethodKind === 'ACH_DEBIT') {
    return { strategy: 'NEW_INTENT', reason: 'ACH requires new PaymentIntent for deltas.' };
  }

  if (shouldUseIncrementalCapture(charge, deltaTotalCents)) {
    return { strategy: 'INCREMENTAL_CAPTURE', reason: 'Charge supports incremental capture for requested delta.' };
  }

  return { strategy: 'NEW_INTENT', reason: 'Charge cannot support incremental capture for requested delta.' };
}

export function summarizeAmendments(amendments) {
  if (!Array.isArray(amendments)) {
    return { subtotalCents: 0, taxCents: 0, feesCents: 0, totalCents: 0 };
  }
  return amendments.reduce(
    (acc, amendment) => {
      acc.subtotalCents += amendment.deltaSubtotalCents ?? 0;
      acc.taxCents += amendment.deltaTaxCents ?? 0;
      acc.feesCents += amendment.deltaFeesCents ?? 0;
      acc.totalCents += amendment.deltaTotalCents ?? 0;
      return acc;
    },
    { subtotalCents: 0, taxCents: 0, feesCents: 0, totalCents: 0 }
  );
}
