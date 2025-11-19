const ALLOWED_EVIDENCE_KINDS = new Set(['doc', 'message', 'photo', 'receipt', 'timeline', 'custom']);

export class DisputeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DisputeError';
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
    throw new DisputeError('FIELD_REQUIRED', `${field} is required.`, { field, value });
  }
  return value.trim();
}

export function createDisputeRecord({
  legId,
  processor,
  processorDispute = null,
  reason,
  evidenceDueAt = null,
  nowIso = new Date().toISOString(),
  idFactory = defaultIdFactory
}) {
  const disputeId = idFactory('dsp');
  return {
    disputeId,
    legId: assertString(legId, 'legId'),
    processor: assertString(processor, 'processor'),
    processorDispute: processorDispute ?? null,
    status: 'needs_response',
    reason: assertString(reason, 'reason'),
    evidenceDueAt: evidenceDueAt ?? null,
    createdAt: nowIso,
    updatedAt: nowIso,
    evidence: []
  };
}

export function normalizeEvidenceItem(item) {
  if (!item || typeof item !== 'object') {
    throw new DisputeError('EVIDENCE_INVALID', 'Evidence item must be an object.', { item });
  }
  const kind = item.kind ?? 'custom';
  if (!ALLOWED_EVIDENCE_KINDS.has(kind)) {
    throw new DisputeError('EVIDENCE_KIND_UNSUPPORTED', 'Unsupported evidence kind.', { kind });
  }
  return {
    kind,
    label: item.label ?? null,
    url: item.url ?? null,
    content: item.content ?? null,
    capturedAt: item.capturedAt ?? null
  };
}

export function appendEvidence(dispute, items) {
  if (!dispute || typeof dispute.disputeId !== 'string') {
    throw new DisputeError('DISPUTE_REQUIRED', 'Dispute record is required.', { dispute });
  }
  const normalizedItems = (Array.isArray(items) ? items : [items]).map((entry) => normalizeEvidenceItem(entry));
  return {
    ...dispute,
    evidence: [...(dispute.evidence ?? []), ...normalizedItems],
    updatedAt: new Date().toISOString()
  };
}

export function buildEvidenceKit({ dispute, legSnapshot, receipts = [], documents = [], messages = [], photos = [] }) {
  if (!dispute || typeof dispute.disputeId !== 'string') {
    throw new DisputeError('DISPUTE_REQUIRED', 'Dispute record is required to assemble kit.', { dispute });
  }
  const kit = [];
  const pushItems = (items, defaultKind) => {
    for (const item of items) {
      if (!item) continue;
      kit.push(
        normalizeEvidenceItem({
          kind: item.kind ?? defaultKind,
          label: item.label ?? item.title ?? defaultKind,
          url: item.url ?? item.href ?? null,
          content: item.content ?? item.body ?? null,
          capturedAt: item.capturedAt ?? item.createdAt ?? null
        })
      );
    }
  };

  if (legSnapshot) {
    kit.push(
      normalizeEvidenceItem({
        kind: 'timeline',
        label: 'Booking Timeline',
        content: JSON.stringify({
          startAt: legSnapshot.startAt,
          endAt: legSnapshot.endAt,
          policy: legSnapshot.policy,
          totalCents: legSnapshot.totalCents
        })
      })
    );
  }

  pushItems(receipts, 'receipt');
  pushItems(documents, 'doc');
  pushItems(messages, 'message');
  pushItems(photos, 'photo');

  return appendEvidence(dispute, kit);
}

export function shouldPausePayout(disputeStatus) {
  return disputeStatus === 'needs_response' || disputeStatus === 'under_review';
}

export function applyDisputeOutcome({ dispute, outcome, occurredAt = new Date().toISOString(), reserveEntry = null }) {
  if (!dispute || typeof dispute.disputeId !== 'string') {
    throw new DisputeError('DISPUTE_REQUIRED', 'Dispute record is required to apply outcome.', { dispute });
  }
  const normalizedOutcome = outcome.toLowerCase();
  const allowedOutcomes = new Set(['won', 'lost', 'warning_closed']);
  if (!allowedOutcomes.has(normalizedOutcome)) {
    throw new DisputeError('OUTCOME_UNSUPPORTED', 'Unsupported dispute outcome.', { outcome });
  }
  const nextStatus = normalizedOutcome === 'warning_closed' ? 'warning_closed' : normalizedOutcome;

  let reserveDirective = null;
  if (reserveEntry && typeof reserveEntry === 'object') {
    if (nextStatus === 'won') {
      reserveDirective = { action: 'RELEASE', reserveEntryId: reserveEntry.entryId, reason: 'DISPUTE_WON' };
    } else if (nextStatus === 'lost') {
      reserveDirective = {
        action: 'FORFEIT',
        reserveEntryId: reserveEntry.entryId,
        reason: 'DISPUTE_LOST',
        amountCents: reserveEntry.reserveCents
      };
    }
  }

  return {
    dispute: {
      ...dispute,
      status: nextStatus,
      updatedAt: occurredAt
    },
    reserveDirective
  };
}
