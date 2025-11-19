function toIso(value, fallback = new Date().toISOString()) {
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  return fallback;
}

function toStringId(value) {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function normalizeSeverity(value, fallback = 'MEDIUM') {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim().toUpperCase();
  if (!normalized) {
    return fallback;
  }
  return normalized;
}

function normalizeStatus(value, fallback = 'PENDING') {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim().toUpperCase();
  if (!normalized) {
    return fallback;
  }
  return normalized;
}

function normalizeCaseType(value, fallback = 'MESSAGE') {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim().toUpperCase();
  if (normalized === 'THREAD' || normalized === 'MESSAGE') {
    return normalized;
  }
  return fallback;
}

function normalizeDecision(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const actorId = toStringId(entry.actorId ?? entry.userId);
  const decision = typeof entry.decision === 'string' ? entry.decision.trim().toUpperCase() : null;
  if (!decision) {
    return null;
  }
  return {
    actorId,
    actorRole: entry.actorRole ?? entry.role ?? null,
    decision,
    notes: entry.notes ?? null,
    decidedAt: entry.decidedAt ? toIso(entry.decidedAt) : null
  };
}

function cloneMetadata(value) {
  if (!value || typeof value !== 'object') {
    return {};
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeResolution(resolution) {
  if (!resolution || typeof resolution !== 'object') {
    return null;
  }
  return {
    outcome:
      typeof resolution.outcome === 'string' && resolution.outcome.trim().length > 0
        ? resolution.outcome.trim().toUpperCase()
        : null,
    notes: resolution.notes ?? null,
    resolvedBy: resolution.resolvedBy ?? null,
    resolvedAt: resolution.resolvedAt ? toIso(resolution.resolvedAt) : null
  };
}

function normalizeCase(input) {
  if (!input || typeof input !== 'object') {
    return null;
  }
  const caseId = toStringId(input.caseId ?? input.id);
  if (!caseId) {
    return null;
  }
  const createdAt = toIso(input.createdAt ?? input.reportedAt ?? new Date().toISOString());
  const reportedAt = toIso(input.reportedAt ?? createdAt, createdAt);
  const status = normalizeStatus(input.status);
  const severity = normalizeSeverity(input.severity);
  const type = normalizeCaseType(input.type ?? input.caseType);
  const approvals = Array.isArray(input.approvals)
    ? input.approvals.map(normalizeDecision).filter(Boolean)
    : [];
  const resolution = normalizeResolution(input.resolution);

  return {
    caseId,
    type,
    threadId: toStringId(input.threadId ?? input.thread?.threadId),
    messageId: toStringId(input.messageId ?? input.message?.messageId),
    status,
    severity,
    reason: input.reason ?? input.category ?? null,
    reportedBy: input.reportedBy ?? input.reporter ?? null,
    reportedAt,
    auditTrailId: input.auditTrailId ?? null,
    requiresDualApproval: Boolean(input.requiresDualApproval ?? input.dualApproval),
    approvals,
    metadata: cloneMetadata(input.metadata),
    source: cloneMetadata(input.source),
    createdAt,
    lastUpdatedAt: toIso(input.lastUpdatedAt ?? reportedAt, reportedAt),
    resolution
  };
}

function cloneCase(entry) {
  return {
    ...entry,
    approvals: entry.approvals ? entry.approvals.map((approval) => ({ ...approval })) : [],
    metadata: cloneMetadata(entry.metadata),
    source: cloneMetadata(entry.source),
    resolution: entry.resolution ? { ...entry.resolution } : null
  };
}

function cloneState(state) {
  return {
    casesById: Object.fromEntries(
      Object.entries(state.casesById ?? {}).map(([caseId, entry]) => [caseId, cloneCase(entry)])
    ),
    order: Array.isArray(state.order) ? [...state.order] : [],
    stats: { ...state.stats },
    lastUpdatedAt: state.lastUpdatedAt ?? Date.now()
  };
}

function computeStats(casesById) {
  let pending = 0;
  let dualApproval = 0;
  let awaitingSecond = 0;
  let resolved = 0;
  for (const entry of Object.values(casesById)) {
    if (!entry) continue;
    const status = entry.status ?? 'PENDING';
    if (status === 'RESOLVED') {
      resolved += 1;
      continue;
    }
    pending += 1;
    if (entry.requiresDualApproval) {
      dualApproval += 1;
    }
    if (status === 'AWAITING_SECOND_APPROVAL') {
      awaitingSecond += 1;
    }
  }
  return { pending, dualApproval, awaitingSecond, resolved };
}

function updateStats(state) {
  state.stats = computeStats(state.casesById);
  state.lastUpdatedAt = Date.now();
  return state;
}

function mapDecisionOutcome(decision) {
  if (typeof decision !== 'string') {
    return null;
  }
  const normalized = decision.trim().toUpperCase();
  switch (normalized) {
    case 'APPROVE':
    case 'APPROVED':
      return 'APPROVED';
    case 'REJECT':
    case 'REJECTED':
    case 'DENY':
    case 'DENIED':
      return 'REJECTED';
    case 'ESCALATE':
    case 'ESCALATED':
      return 'ESCALATED';
    case 'OVERRIDE':
    case 'OVERRIDDEN':
      return 'OVERRIDDEN';
    default:
      return normalized;
  }
}

function countUniqueApprovals(approvals = []) {
  const seen = new Set();
  for (const entry of approvals) {
    if (!entry) continue;
    if (entry.actorId) {
      seen.add(entry.actorId);
      continue;
    }
    if (entry.decision && entry.decidedAt) {
      seen.add(`${entry.decision}:${entry.decidedAt}`);
      continue;
    }
    seen.add(JSON.stringify(entry));
  }
  return seen.size;
}

/**
 * Creates a moderation queue state.
 * @param {{ cases?: Array<any> }} [input]
 */
export function createModerationQueue(input = {}) {
  const cases = Array.isArray(input.cases) ? input.cases : [];
  const casesById = {};
  const order = [];
  for (const entry of cases) {
    const normalized = normalizeCase(entry);
    if (!normalized) continue;
    casesById[normalized.caseId] = normalized;
    order.push(normalized.caseId);
  }
  return updateStats({
    casesById,
    order,
    stats: { pending: 0, dualApproval: 0, awaitingSecond: 0, resolved: 0 },
    lastUpdatedAt: Date.now()
  });
}

/**
 * Returns a single moderation case.
 * @param {ReturnType<typeof createModerationQueue>} state
 * @param {string} caseId
 */
export function getCase(state, caseId) {
  const entry = state?.casesById?.[caseId];
  return entry ? cloneCase(entry) : null;
}

/**
 * Enqueues a new moderation case.
 * @param {ReturnType<typeof createModerationQueue>} state
 * @param {any} caseInput
 * @param {{ append?: boolean }} [options]
 */
export function enqueueCase(state, caseInput, options = {}) {
  const normalized = normalizeCase(caseInput);
  if (!normalized) {
    return state;
  }
  const next = cloneState(state);
  next.casesById[normalized.caseId] = normalized;
  next.order = next.order.filter((id) => id !== normalized.caseId);
  if (options.append) {
    next.order.push(normalized.caseId);
  } else {
    next.order.unshift(normalized.caseId);
  }
  return updateStats(next);
}

/**
 * Updates an existing moderation case.
 * @param {ReturnType<typeof createModerationQueue>} state
 * @param {string} caseId
 * @param {any} patch
 */
export function updateCase(state, caseId, patch = {}) {
  if (!caseId || !state.casesById?.[caseId]) {
    return state;
  }
  const next = cloneState(state);
  const current = next.casesById[caseId];
  const mergedApprovals = Array.isArray(patch.approvals)
    ? patch.approvals.map(normalizeDecision).filter(Boolean)
    : current.approvals;
  const resolution =
    patch.resolution !== undefined ? normalizeResolution(patch.resolution) : current.resolution;
  next.casesById[caseId] = {
    ...current,
    ...patch,
    type: patch.type ? normalizeCaseType(patch.type, current.type) : current.type,
    status: patch.status ? normalizeStatus(patch.status, current.status) : current.status,
    severity: patch.severity ? normalizeSeverity(patch.severity, current.severity) : current.severity,
    threadId: patch.threadId !== undefined ? toStringId(patch.threadId) : current.threadId,
    messageId: patch.messageId !== undefined ? toStringId(patch.messageId) : current.messageId,
    reportedAt: patch.reportedAt ? toIso(patch.reportedAt) : current.reportedAt,
    lastUpdatedAt: toIso(patch.lastUpdatedAt ?? Date.now()),
    approvals: mergedApprovals,
    metadata:
      patch.metadata !== undefined ? cloneMetadata(patch.metadata) : cloneMetadata(current.metadata),
    source: patch.source !== undefined ? cloneMetadata(patch.source) : cloneMetadata(current.source),
    resolution
  };
  next.casesById[caseId].requiresDualApproval =
    patch.requiresDualApproval !== undefined
      ? Boolean(patch.requiresDualApproval)
      : current.requiresDualApproval;
  next.order = next.order.filter((id) => id !== caseId);
  next.order.unshift(caseId);
  return updateStats(next);
}

/**
 * Records an approval/decision for a moderation case.
 * @param {ReturnType<typeof createModerationQueue>} state
 * @param {string} caseId
 * @param {{ actorId?: string; decision?: string; notes?: string; actorRole?: string; decidedAt?: string|Date }} decisionInput
 * @param {{ requiredApprovals?: number }} [options]
 */
export function submitDecision(state, caseId, decisionInput = {}, options = {}) {
  if (!caseId || !state.casesById?.[caseId]) {
    return state;
  }
  const normalizedDecision = normalizeDecision(decisionInput);
  if (!normalizedDecision) {
    return state;
  }
  const next = cloneState(state);
  const entry = next.casesById[caseId];
  const approvals = Array.isArray(entry.approvals) ? [...entry.approvals] : [];
  const decidedAtIso =
    normalizedDecision.decidedAt ?? (decisionInput.decidedAt ? toIso(decisionInput.decidedAt) : toIso(Date.now()));
  const sanitizedDecision = {
    ...normalizedDecision,
    notes:
      normalizedDecision.notes ?? (typeof decisionInput.notes === 'string' ? decisionInput.notes : null),
    decidedAt: decidedAtIso
  };
  const existingIndex = approvals.findIndex(
    (item) => item?.actorId && sanitizedDecision.actorId && item.actorId === sanitizedDecision.actorId
  );
  if (existingIndex >= 0) {
    approvals[existingIndex] = sanitizedDecision;
  } else {
    approvals.push(sanitizedDecision);
  }
  entry.approvals = approvals;
  entry.lastUpdatedAt = decidedAtIso;

  const outcome = mapDecisionOutcome(sanitizedDecision.decision);
  const isTerminalOutcome =
    outcome === 'REJECTED' || outcome === 'ESCALATED' || outcome === 'OVERRIDDEN' || outcome === 'BLOCKED';
  const requiredApprovals =
    typeof options.requiredApprovals === 'number' && options.requiredApprovals > 0 ? options.requiredApprovals : 2;
  const approvalCount = countUniqueApprovals(approvals);

  const finalize = (finalOutcome) => {
    const resolvedOutcome = finalOutcome ?? 'RESOLVED';
    entry.status = 'RESOLVED';
    entry.requiresDualApproval = false;
    entry.resolution = {
      outcome: resolvedOutcome,
      notes: sanitizedDecision.notes ?? null,
      resolvedBy: sanitizedDecision.actorId ?? null,
      resolvedAt: decidedAtIso
    };
    next.order = next.order.filter((id) => id !== caseId);
    next.order.push(caseId);
  };

  if (isTerminalOutcome) {
    finalize(outcome);
  } else if (entry.requiresDualApproval) {
    if (approvalCount >= requiredApprovals) {
      finalize(outcome ?? 'APPROVED');
    } else {
      entry.status = 'AWAITING_SECOND_APPROVAL';
      entry.resolution = null;
      next.order = next.order.filter((id) => id !== caseId);
      next.order.unshift(caseId);
    }
  } else {
    finalize(outcome ?? 'APPROVED');
  }

  return updateStats(next);
}

/**
 * Marks a case as resolved.
 * @param {ReturnType<typeof createModerationQueue>} state
 * @param {string} caseId
 * @param {{ outcome?: string; notes?: string; resolvedBy?: string; resolvedAt?: string|Date }} [resolution]
 */
export function resolveCase(state, caseId, resolution = {}) {
  if (!caseId || !state.casesById?.[caseId]) {
    return state;
  }
  const normalizedResolution = normalizeResolution({
    ...resolution,
    outcome: resolution.outcome ?? 'RESOLVED',
    resolvedAt: resolution.resolvedAt ?? Date.now()
  }) ?? {
    outcome: 'RESOLVED',
    notes: null,
    resolvedBy: resolution.resolvedBy ?? null,
    resolvedAt: toIso(Date.now())
  };
  const next = cloneState(state);
  const current = next.casesById[caseId];
  next.casesById[caseId] = {
    ...current,
    status: 'RESOLVED',
    lastUpdatedAt: normalizedResolution.resolvedAt ?? toIso(Date.now()),
    resolution: normalizedResolution,
    requiresDualApproval: false
  };
  next.order = next.order.filter((id) => id !== caseId);
  next.order.push(caseId);
  return updateStats(next);
}

/**
 * Removes a case from the queue.
 * @param {ReturnType<typeof createModerationQueue>} state
 * @param {string} caseId
 */
export function removeCase(state, caseId) {
  if (!caseId || !state.casesById?.[caseId]) {
    return state;
  }
  const next = cloneState(state);
  delete next.casesById[caseId];
  next.order = next.order.filter((id) => id !== caseId);
  return updateStats(next);
}

/**
 * Returns cases filtered by options.
 * @param {ReturnType<typeof createModerationQueue>} state
 * @param {{
 *   status?: string|string[];
 *   severity?: string|string[];
 *   type?: string|string[];
 *   requiresDualApproval?: boolean;
 *   threadId?: string;
 * }} [filters]
 */
export function selectCases(state, filters = {}) {
  if (!state) {
    return [];
  }
  const statusSet = normalizeFilterSet(filters.status);
  const severitySet = normalizeFilterSet(filters.severity);
  const typeSet = normalizeFilterSet(filters.type);
  const requiresDualApproval = filters.requiresDualApproval;
  const threadId = filters.threadId ? toStringId(filters.threadId) : null;

  const results = [];
  for (const caseId of state.order) {
    const entry = state.casesById[caseId];
    if (!entry) continue;
    if (statusSet && !statusSet.has(entry.status)) {
      continue;
    }
    if (severitySet && !severitySet.has(entry.severity)) {
      continue;
    }
    if (typeSet && !typeSet.has(entry.type)) {
      continue;
    }
    if (typeof requiresDualApproval === 'boolean' && entry.requiresDualApproval !== requiresDualApproval) {
      continue;
    }
    if (threadId && entry.threadId !== threadId) {
      continue;
    }
    results.push(cloneCase(entry));
  }
  return results;
}

function normalizeFilterSet(value) {
  if (!value) return null;
  const iterable = Array.isArray(value) ? value : [value];
  const set = new Set();
  for (const entry of iterable) {
    if (typeof entry === 'string' && entry.trim().length > 0) {
      set.add(entry.trim().toUpperCase());
    }
  }
  return set.size > 0 ? set : null;
}

/**
 * Returns pending cases.
 * @param {ReturnType<typeof createModerationQueue>} state
 */
export function getPendingCases(state) {
  return selectCases(state, { status: 'PENDING' });
}

/**
 * Returns queue statistics.
 * @param {ReturnType<typeof createModerationQueue>} state
 */
export function getQueueStats(state) {
  return state?.stats ? { ...state.stats } : { pending: 0, dualApproval: 0, awaitingSecond: 0, resolved: 0 };
}
