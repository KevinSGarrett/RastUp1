const PAYMENT_METHOD_TYPE_MAP = {
  CARD: 'card',
  ACH_DEBIT: 'us_bank_account'
};

export class PaymentInvariantError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PaymentInvariantError';
    this.code = code;
    this.details = details;
  }
}

export function allocateChargeSplits(legs) {
  if (!Array.isArray(legs) || legs.length === 0) {
    throw new PaymentInvariantError('SPLIT_LEGS_REQUIRED', 'At least one leg is required to allocate charge splits.');
  }
  return legs.map((leg) => {
    if (typeof leg.legId !== 'string') {
      throw new PaymentInvariantError('LEG_ID_REQUIRED', 'Each leg must include a legId.', { leg });
    }
    if (!Number.isInteger(leg.totalCents) || leg.totalCents < 0) {
      throw new PaymentInvariantError('LEG_TOTAL_INVALID', 'Leg total must be a non-negative integer.', { leg });
    }
    return {
      legId: leg.legId,
      amountCents: leg.totalCents
    };
  });
}

export function sumSplits(splits) {
  return splits.reduce((acc, split) => acc + split.amountCents, 0);
}

export function validateChargeAmount({ legs, expectedAmount }) {
  const splits = allocateChargeSplits(legs);
  const computed = sumSplits(splits);
  if (computed !== expectedAmount) {
    throw new PaymentInvariantError('AMOUNT_MISMATCH', 'Charge amount does not equal sum of leg totals.', {
      expectedAmount,
      computed,
      legs: legs.map((leg) => leg.legId)
    });
  }
  return true;
}

export function preparePaymentIntentPayload(context) {
  if (!context || typeof context.lbgId !== 'string') {
    throw new PaymentInvariantError('LBG_ID_REQUIRED', 'lbgId is required to prepare a payment intent.', { context });
  }

  const splits = allocateChargeSplits(context.legs);
  const amountCents = sumSplits(splits);
  if (amountCents <= 0) {
    throw new PaymentInvariantError('AMOUNT_REQUIRED', 'Charge amount must be greater than zero.', { amountCents });
  }

  const paymentMethodType = PAYMENT_METHOD_TYPE_MAP[context.paymentMethodKind];
  if (!paymentMethodType) {
    throw new PaymentInvariantError('PAYMENT_METHOD_UNSUPPORTED', 'Unsupported payment method kind.', {
      paymentMethodKind: context.paymentMethodKind
    });
  }

  const metadata = {
    lbg_id: context.lbgId,
    leg_ids: splits.map((split) => split.legId).join(','),
    version: '1',
    charge_id: context.chargeId ?? ''
  };

  const request = {
    amount: amountCents,
    currency: String(context.currency ?? 'usd').toLowerCase(),
    payment_method_types: [paymentMethodType],
    metadata,
    transfer_group: `lbg_${context.lbgId}`
  };

  if (context.customerId) {
    request.customer = context.customerId;
  }
  if (context.paymentMethodId) {
    request.payment_method = context.paymentMethodId;
  }
  if (context.saveForFutureUse) {
    request.setup_future_usage = 'off_session';
  }
  if (context.confirm === true) {
    request.confirm = true;
  }
  request.capture_method = 'automatic';

  return {
    amountCents,
    splits,
    request,
    metadata
  };
}

export function shouldUseIncrementalCapture(charge, deltaCents) {
  if (!charge || deltaCents <= 0) {
    return false;
  }
  if (charge.paymentMethod !== 'CARD') {
    return false;
  }
  if (!['AUTHORIZED', 'CAPTURED'].includes(charge.status)) {
    return false;
  }
  if (charge.supportsIncrementalCapture !== true) {
    return false;
  }
  const remaining =
    typeof charge.remainingAuthorizedCents === 'number'
      ? charge.remainingAuthorizedCents
      : Math.max(0, (charge.authorizedCents ?? 0) - (charge.capturedCents ?? 0));
  return deltaCents <= remaining;
}

export function buildTransferMetadata(legs) {
  return legs.map((leg) => ({
    legId: leg.legId,
    amountCents: leg.totalCents,
    sellerUserId: leg.sellerUserId,
    connectAccountId: leg.connectAccountId ?? null,
    reservePercent: leg.reservePercent ?? 0
  }));
}

