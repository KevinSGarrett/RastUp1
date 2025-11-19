const APPROVAL_STATUSES = new Set(['pending', 'approved', 'rejected', 'cancelled', 'expired']);
const APPROVAL_DECISIONS = new Set(['approve', 'reject', 'cancel']);

export class ApprovalError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ApprovalError';
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

function assertString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApprovalError('FIELD_REQUIRED', `${field} is required.`, { field, value });
  }
  return value.trim();
}

function toInt(value, field, { min = undefined, max = undefined } = {}) {
  if (!Number.isFinite(value)) {
    throw new ApprovalError('NUMBER_REQUIRED', `${field} must be a finite number.`, { field, value });
  }
  const intValue = Math.trunc(value);
  if (min !== undefined && intValue < min) {
    throw new ApprovalError('VALUE_BELOW_MIN', `${field} must be >= ${min}.`, { field, value });
  }
  if (max !== undefined && intValue > max) {
    throw new ApprovalError('VALUE_ABOVE_MAX', `${field} must be <= ${max}.`, { field, value });
  }
  return intValue;
}

function coerceExpiresAt({ expiresAt, expiresInHours, nowIso }) {
  if (expiresAt) {
    const ts = new Date(expiresAt);
    if (Number.isNaN(ts.getTime())) {
      throw new ApprovalError('INVALID_EXPIRES_AT', 'expiresAt must be a valid ISO timestamp.', { expiresAt });
    }
    return ts.toISOString();
  }
  if (typeof expiresInHours === 'number' && Number.isFinite(expiresInHours)) {
    const base = new Date(nowIso).getTime();
    if (Number.isNaN(base)) {
      throw new ApprovalError('INVALID_NOW', 'nowIso must be a valid ISO timestamp.', { nowIso });
    }
    const ms = Math.max(0, expiresInHours) * 60 * 60 * 1000;
    return new Date(base + ms).toISOString();
  }
  return null;
}

function normalizeContext(context) {
  if (context === null || context === undefined) {
    return {};
  }
  if (typeof context !== 'object' || Array.isArray(context)) {
    throw new ApprovalError('CONTEXT_INVALID', 'Context must be a JSON object.', { context });
  }
  return context;
}

function clone(object) {
  return JSON.parse(JSON.stringify(object));
}

export function createApprovalRequest({
  scope,
  referenceId,
  createdBy,
  approvalsRequired = 2,
  context = {},
  reason = null,
  nowIso = new Date().toISOString(),
  expiresAt = null,
  expiresInHours = null,
  idFactory = defaultIdFactory
}) {
  const approvalId = idFactory('apr');
  const createdAt = nowIso;
  const normalizedContext = normalizeContext(context);
  const normalizedReason = reason ?? null;
  const required = toInt(approvalsRequired, 'approvalsRequired', { min: 1, max: 10 });
  const computedExpiresAt = coerceExpiresAt({ expiresAt, expiresInHours, nowIso });

  return {
    approvalId,
    scope: assertString(scope, 'scope'),
    referenceId: assertString(referenceId, 'referenceId'),
    status: 'pending',
    approvalsRequired: required,
    approvalsObtained: 0,
    context: normalizedContext,
    reason: normalizedReason,
    createdBy: assertString(createdBy, 'createdBy'),
    createdAt,
    updatedAt: createdAt,
    expiresAt: computedExpiresAt,
    decisions: []
  };
}

function ensurePending(request, nowIso) {
  if (!request || request.status !== 'pending') {
    throw new ApprovalError('APPROVAL_FINALIZED', 'Approval request is no longer pending.', { request });
  }
  if (request.expiresAt) {
    const now = new Date(nowIso).getTime();
    const expiry = new Date(request.expiresAt).getTime();
    if (!Number.isNaN(expiry) && now >= expiry) {
      throw new ApprovalError('APPROVAL_EXPIRED', 'Approval request has expired.', {
        approvalId: request.approvalId,
        expiresAt: request.expiresAt
      });
    }
  }
}

function hasExistingDecision(decisions, approver) {
  return decisions.some((decision) => decision.approver === approver);
}

function nextStatus({ decision, approvalsObtained, approvalsRequired }) {
  switch (decision) {
    case 'approve':
      return approvalsObtained >= approvalsRequired ? 'approved' : 'pending';
    case 'reject':
      return 'rejected';
    case 'cancel':
      return 'cancelled';
    default:
      return 'pending';
  }
}

export function recordApprovalDecision({
  request,
  approver,
  decision,
  reason = null,
  nowIso = new Date().toISOString(),
  idFactory = defaultIdFactory
}) {
  if (!request) {
    throw new ApprovalError('REQUEST_REQUIRED', 'Approval request is required.');
  }
  const normalizedDecision = String(decision ?? '').toLowerCase();
  if (!APPROVAL_DECISIONS.has(normalizedDecision)) {
    throw new ApprovalError('DECISION_INVALID', 'Decision is not supported.', { decision });
  }

  ensurePending(request, nowIso);
  const normalizedApprover = assertString(approver, 'approver');

  const existingDecisions = Array.isArray(request.decisions) ? request.decisions : [];
  if (hasExistingDecision(existingDecisions, normalizedApprover)) {
    throw new ApprovalError('APPROVER_DUPLICATE', 'Approver has already submitted a decision.', {
      approvalId: request.approvalId,
      approver: normalizedApprover
    });
  }

  const decisionId = idFactory('apd');
  const decidedAt = nowIso;
  const decisionRecord = {
    decisionId,
    approvalId: request.approvalId,
    approver: normalizedApprover,
    decision: normalizedDecision,
    reason: reason ?? null,
    decidedAt,
    createdAt: decidedAt
  };

  const approvalsObtained =
    normalizedDecision === 'approve' ? Math.min(request.approvalsObtained + 1, request.approvalsRequired) : request.approvalsObtained;
  const status = nextStatus({ decision: normalizedDecision, approvalsObtained, approvalsRequired: request.approvalsRequired });

  const updatedRequest = {
    ...request,
    approvalsObtained,
    status,
    updatedAt: nowIso,
    decisions: [...existingDecisions, decisionRecord]
  };

  if (!APPROVAL_STATUSES.has(updatedRequest.status)) {
    throw new ApprovalError('STATUS_INVALID', 'Computed status is not supported.', { status: updatedRequest.status });
  }

  return {
    request: updatedRequest,
    decision: decisionRecord
  };
}

export function evaluateApprovalExpiration(request, { nowIso = new Date().toISOString() } = {}) {
  if (!request || request.status !== 'pending' || !request.expiresAt) {
    return request;
  }
  const now = new Date(nowIso).getTime();
  const expiry = new Date(request.expiresAt).getTime();
  if (Number.isNaN(expiry) || Number.isNaN(now) || now < expiry) {
    return request;
  }
  return {
    ...request,
    status: 'expired',
    updatedAt: new Date(Math.max(now, expiry)).toISOString()
  };
}

export function serializeApprovalSnapshot(request) {
  if (!request) {
    return null;
  }
  const snapshot = { ...request };
  if (snapshot.decisions) {
    snapshot.decisions = snapshot.decisions.map((decision) => ({ ...decision }));
  }
  return snapshot;
}

export function buildFinanceActionLog({
  approval = null,
  decision = null,
  action,
  subjectReference = null,
  beforeState = null,
  afterState = null,
  actorAdmin,
  reason = null,
  nowIso = new Date().toISOString(),
  idFactory = defaultIdFactory
}) {
  const logId = idFactory('fal');
  const decisionSnapshot = decision ? { ...decision } : null;
  const approvalSnapshot = approval ? serializeApprovalSnapshot(approval) : null;
  return {
    logId,
    approvalId: approval?.approvalId ?? null,
    action: assertString(action, 'action'),
    subjectReference: subjectReference ?? approval?.referenceId ?? null,
    beforeState: beforeState ? clone(beforeState) : null,
    afterState: afterState ? clone(afterState) : null,
    actorAdmin: assertString(actorAdmin, 'actorAdmin'),
    reason: reason ?? decision?.reason ?? approval?.reason ?? null,
    metadata: {
      decision: decisionSnapshot,
      approvalSnapshot
    },
    decision: decisionSnapshot,
    approvalSnapshot,
    createdAt: nowIso
  };
}
