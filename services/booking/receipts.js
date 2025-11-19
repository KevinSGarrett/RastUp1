import { calculateAggregateTotals } from './state.js';

export class ReceiptBuilderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ReceiptBuilderError';
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

const toArray = (value) => (Array.isArray(value) ? value : value ? [value] : []);

export function buildLegReceiptPayload({ leg, amendments = [], refunds = [], docHashes = [] }) {
  if (!leg || typeof leg.legId !== 'string') {
    throw new ReceiptBuilderError('LEG_REQUIRED', 'Leg snapshot is required to build receipt.', { leg });
  }
  if (!Number.isInteger(leg.totalCents)) {
    throw new ReceiptBuilderError('LEG_TOTAL_REQUIRED', 'Leg must include totalCents.', { legId: leg.legId });
  }

  const normalizedAmendments = amendments.map((amendment) => ({
    amendmentId: amendment.amendmentId ?? null,
    kind: amendment.kind ?? null,
    deltaSubtotalCents: amendment.deltaSubtotalCents ?? 0,
    deltaTaxCents: amendment.deltaTaxCents ?? 0,
    deltaFeesCents: amendment.deltaFeesCents ?? 0,
    deltaTotalCents: amendment.deltaTotalCents ?? 0,
    createdAt: amendment.createdAt ?? null,
    createdBy: amendment.createdBy ?? null,
    line: amendment.lineJson ?? amendment.line ?? null
  }));

  const normalizedRefunds = refunds.map((refund) => ({
    refundId: refund.refundId ?? null,
    status: refund.status ?? null,
    amountCents: refund.amountCents ?? 0,
    processor: refund.processor ?? null,
    processorRefundId: refund.processorRefund ?? refund.processorRefundId ?? null,
    createdAt: refund.createdAt ?? null
  }));

  return {
    legId: leg.legId,
    title: leg.title,
    totalCents: leg.totalCents,
    taxCents: leg.taxCents ?? 0,
    feesCents: leg.feesCents ?? 0,
    currency: leg.currency ?? 'USD',
    policy: leg.policy ?? null,
    amendments: normalizedAmendments,
    refunds: normalizedRefunds,
    docHashes: toArray(docHashes)
  };
}

export function buildGroupReceiptPayload({ lbg, legs, charge, docHashes = [], issuedAt = new Date().toISOString() }) {
  if (!lbg || typeof lbg.lbgId !== 'string') {
    throw new ReceiptBuilderError('LBG_REQUIRED', 'Linked booking group snapshot required.', { lbg });
  }
  const totals = calculateAggregateTotals(legs ?? []);

  return {
    lbgId: lbg.lbgId,
    status: lbg.status ?? null,
    legs: (legs ?? []).map((leg) => leg.legId),
    currency: lbg.currency ?? 'USD',
    subtotalCents: totals.subtotalCents,
    taxCents: totals.taxCents,
    feesCents: totals.feesCents,
    totalCents: totals.totalCents,
    charge: charge
      ? {
          chargeId: charge.chargeId ?? null,
          processor: charge.processor ?? 'stripe',
          processorIntent: charge.processorIntent ?? null,
          amountCents: charge.amountCents ?? totals.totalCents,
          status: charge.status ?? null,
          capturedAt: charge.capturedAt ?? null,
          paymentMethod: charge.paymentMethod ?? null
        }
      : null,
    issuedAt,
    docHashes: toArray(docHashes)
  };
}

export function createReceiptManifests({
  lbg,
  legs,
  charge,
  amendmentsByLeg = new Map(),
  refundsByLeg = new Map(),
  legDocHashes = new Map(),
  groupDocHashes = [],
  generatedAt = new Date().toISOString(),
  idFactory = defaultIdFactory,
  storageUrlFactory = () => null
}) {
  if (!Array.isArray(legs)) {
    throw new ReceiptBuilderError('LEGS_REQUIRED', 'Leg collection is required.', { legs });
  }

  const legReceipts = legs.map((leg) =>
    buildLegReceiptPayload({
      leg,
      amendments: amendmentsByLeg.get(leg.legId) ?? [],
      refunds: refundsByLeg.get(leg.legId) ?? [],
      docHashes: legDocHashes.get(leg.legId) ?? []
    })
  );

  const groupReceipt = buildGroupReceiptPayload({
    lbg,
    legs,
    charge,
    docHashes: groupDocHashes,
    issuedAt: generatedAt
  });

  const manifests = [
    ...legReceipts.map((receipt) => ({
      receiptId: idFactory('rcpt'),
      lbgId: lbg.lbgId,
      legId: receipt.legId,
      kind: 'leg',
      docHashes: receipt.docHashes,
      payload: receipt,
      storageUrl: storageUrlFactory('leg', receipt.legId),
      renderedAt: null,
      createdAt: generatedAt
    })),
    {
      receiptId: idFactory('rcpt'),
      lbgId: lbg.lbgId,
      legId: null,
      kind: 'group',
      docHashes: groupReceipt.docHashes,
      payload: groupReceipt,
      storageUrl: storageUrlFactory('group', null),
      renderedAt: null,
      createdAt: generatedAt
    }
  ];

  return { manifests, legReceipts, groupReceipt };
}
