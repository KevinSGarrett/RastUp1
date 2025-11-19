const CLAIM_STATUSES = new Set(['pending', 'approved', 'denied', 'captured', 'voided']);

export class DepositClaimError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DepositClaimError';
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

function normalizeEvidence(evidenceRefs) {
  if (!evidenceRefs) {
    return [];
  }
  if (!Array.isArray(evidenceRefs)) {
    throw new DepositClaimError('EVIDENCE_INVALID', 'Evidence references must be an array of strings.', { evidenceRefs });
  }
  return evidenceRefs.filter((value) => typeof value === 'string' && value.trim().length > 0);
}

export function assertDepositClaimable({ deposit, leg, nowIso = new Date().toISOString(), claimWindowHours = 72 }) {
  if (!deposit || typeof deposit.depositId !== 'string') {
    throw new DepositClaimError('DEPOSIT_REQUIRED', 'Deposit snapshot is required for claim processing.', { deposit });
  }
  if (deposit.status !== 'AUTHORIZED' && deposit.status !== 'CAPTURED') {
    throw new DepositClaimError('DEPOSIT_STATUS_INVALID', 'Deposit is not in a claimable status.', {
      depositId: deposit.depositId,
      status: deposit.status
    });
  }
  if (!leg || typeof leg.legId !== 'string') {
    throw new DepositClaimError('LEG_REQUIRED', 'Leg snapshot is required for claim processing.', { leg });
  }

  const now = new Date(nowIso).getTime();
  const endAt = new Date(leg.endAt ?? leg.startAt).getTime();
  if ([now, endAt].some(Number.isNaN)) {
    throw new DepositClaimError('CLAIM_TIME_PARSE', 'Unable to parse timestamps for claim window validation.', {
      nowIso,
      legEndAt: leg.endAt
    });
  }

  const windowMs = claimWindowHours * 60 * 60 * 1000;
  if (now > endAt + windowMs) {
    throw new DepositClaimError('DEPOSIT_CLAIM_WINDOW_EXPIRED', 'Claim filed after the allowed window elapsed.', {
      depositId: deposit.depositId,
      legId: leg.legId,
      nowIso
    });
  }

  if (deposit.expiresAt) {
    const expiresAt = new Date(deposit.expiresAt).getTime();
    if (!Number.isNaN(expiresAt) && now > expiresAt) {
      throw new DepositClaimError('DEPOSIT_AUTH_EXPIRED', 'Deposit authorization already expired.', {
        depositId: deposit.depositId,
        expiresAt: deposit.expiresAt
      });
    }
  }

  return true;
}

export function computeAvailableDeposit(deposit) {
  const authorized = deposit?.authorizedCents ?? 0;
  const captured = deposit?.capturedCents ?? 0;
  if (!Number.isInteger(authorized) || authorized < 0) {
    throw new DepositClaimError('DEPOSIT_AUTH_INVALID', 'Authorized amount must be a non-negative integer.', { deposit });
  }
  if (!Number.isInteger(captured) || captured < 0) {
    throw new DepositClaimError('DEPOSIT_CAPTURE_INVALID', 'Captured amount must be a non-negative integer.', { deposit });
  }
  return Math.max(0, authorized - captured);
}

export function createDepositClaimRecord({
  deposit,
  leg,
  amountCents,
  reason,
  evidenceRefs,
  submittedBy,
  nowIso = new Date().toISOString(),
  claimWindowHours = 72,
  idFactory = defaultIdFactory
}) {
  assertDepositClaimable({ deposit, leg, nowIso, claimWindowHours });

  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new DepositClaimError('CLAIM_AMOUNT_INVALID', 'Claim amount must be a positive integer.', { amountCents });
  }

  const remaining = computeAvailableDeposit(deposit);
  if (amountCents > remaining) {
    throw new DepositClaimError('CLAIM_AMOUNT_EXCEEDS_AUTH', 'Claim amount exceeds remaining authorized funds.', {
      amountCents,
      remaining
    });
  }

  if (typeof reason !== 'string' || reason.trim().length === 0) {
    throw new DepositClaimError('CLAIM_REASON_REQUIRED', 'Claim reason is required.', { reason });
  }

  if (typeof submittedBy !== 'string' || submittedBy.trim().length === 0) {
    throw new DepositClaimError('CLAIM_SUBMITTER_REQUIRED', 'Submitting actor is required.', { submittedBy });
  }

  const evidence = normalizeEvidence(evidenceRefs);

  return {
    claimId: idFactory('dcl'),
    depositId: deposit.depositId,
    legId: leg.legId,
    status: 'pending',
    amountCents,
    capturedCents: 0,
    reason: reason.trim(),
    evidence,
    submittedBy,
    createdAt: nowIso,
    updatedAt: nowIso,
    claimWindowExpiresAt: new Date(new Date(leg.endAt ?? leg.startAt).getTime() + claimWindowHours * 60 * 60 * 1000).toISOString()
  };
}

export function approveDepositClaim({ claim, deposit, amountCents, approvedBy, decisionReason, nowIso = new Date().toISOString() }) {
  if (!claim || typeof claim.claimId !== 'string') {
    throw new DepositClaimError('CLAIM_REQUIRED', 'Claim record is required for approval.', { claim });
  }
  if (!deposit || claim.depositId !== deposit.depositId) {
    throw new DepositClaimError('DEPOSIT_MISMATCH', 'Claim does not belong to provided deposit.', { claim, deposit });
  }
  if (!CLAIM_STATUSES.has(claim.status)) {
    throw new DepositClaimError('CLAIM_STATUS_INVALID', 'Claim is in an unknown status.', { status: claim.status });
  }
  if (claim.status !== 'pending' && claim.status !== 'approved') {
    throw new DepositClaimError('CLAIM_NOT_APPROVABLE', 'Claim is not in a state that can be approved.', { status: claim.status });
  }
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new DepositClaimError('CLAIM_CAPTURE_INVALID', 'Capture amount must be a non-negative integer.', { amountCents });
  }
  if (typeof approvedBy !== 'string' || approvedBy.trim().length === 0) {
    throw new DepositClaimError('CLAIM_APPROVER_REQUIRED', 'Approver identifier is required.', { approvedBy });
  }

  const remaining = computeAvailableDeposit(deposit);
  if (amountCents > remaining) {
    throw new DepositClaimError('CLAIM_AMOUNT_EXCEEDS_AUTH', 'Approval amount exceeds remaining authorized funds.', {
      amountCents,
      remaining
    });
  }

  const capturedCents = amountCents;
  const nextStatus = capturedCents > 0 ? 'captured' : 'approved';

  return {
    claim: {
      ...claim,
      status: nextStatus,
      capturedCents,
      approvedBy,
      decisionReason: decisionReason ?? undefined,
      decidedAt: nowIso,
      updatedAt: nowIso
    },
    deposit: {
      ...deposit,
      capturedCents: (deposit.capturedCents ?? 0) + capturedCents,
      status: capturedCents > 0 ? 'CAPTURED' : deposit.status
    }
  };
}

export function denyDepositClaim({ claim, approvedBy, decisionReason, nowIso = new Date().toISOString() }) {
  if (!claim || typeof claim.claimId !== 'string') {
    throw new DepositClaimError('CLAIM_REQUIRED', 'Claim record is required for denial.', { claim });
  }
  if (claim.status !== 'pending') {
    throw new DepositClaimError('CLAIM_NOT_DENIABLE', 'Only pending claims can be denied.', { status: claim.status });
  }
  if (typeof approvedBy !== 'string' || approvedBy.trim().length === 0) {
    throw new DepositClaimError('CLAIM_APPROVER_REQUIRED', 'Approver identifier is required.', { approvedBy });
  }

  return {
    ...claim,
    status: 'denied',
    approvedBy,
    decisionReason: decisionReason ?? undefined,
    decidedAt: nowIso,
    updatedAt: nowIso
  };
}

export function voidDepositClaim({ claim, approvedBy, decisionReason, nowIso = new Date().toISOString() }) {
  if (!claim || typeof claim.claimId !== 'string') {
    throw new DepositClaimError('CLAIM_REQUIRED', 'Claim record is required for void.', { claim });
  }
  if (!['pending', 'approved'].includes(claim.status)) {
    throw new DepositClaimError('CLAIM_NOT_VOIDABLE', 'Only pending/approved claims can be voided.', { status: claim.status });
  }
  if (typeof approvedBy !== 'string' || approvedBy.trim().length === 0) {
    throw new DepositClaimError('CLAIM_APPROVER_REQUIRED', 'Approver identifier is required.', { approvedBy });
  }

  return {
    ...claim,
    status: 'voided',
    approvedBy,
    decisionReason: decisionReason ?? undefined,
    decidedAt: nowIso,
    updatedAt: nowIso
  };
}
