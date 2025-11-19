import { describeActionCard, isTerminalState } from './action_cards.mjs';

const DEFAULT_LOCALE = 'en-US';
const DEFAULT_TIMEZONE = 'UTC';
const DEFAULT_CURRENCY = 'USD';

const TYPE_TITLES = Object.freeze({
  RESCHEDULE: 'Reschedule request',
  REQUEST_EXTRA: 'Additional service request',
  OVERTIME_START: 'Overtime request',
  OVERTIME_STOP: 'Overtime wrap-up',
  DELIVERABLE_PROOF: 'Proof deliverable submitted',
  DELIVERABLE_FINAL: 'Final deliverable submitted',
  CANCEL_REQUEST: 'Cancellation request',
  REFUND_REQUEST: 'Refund request',
  ACCEPTANCE_ACK: 'Completion acknowledgement',
  DEPOSIT_CLAIM_OPEN: 'Deposit claim',
  DISPUTE_OPEN: 'Payment dispute'
});

const STATE_TONES = Object.freeze({
  PENDING: 'warning',
  SUBMITTED: 'warning',
  OPEN: 'warning',
  RUNNING: 'info',
  ESCALATED: 'warning',
  REVISION_REQUESTED: 'warning',
  ACCEPTED: 'success',
  APPROVED: 'success',
  ACKNOWLEDGED: 'success',
  COMPLETED: 'success',
  PAID: 'success',
  SETTLED: 'success',
  RESOLVED: 'success',
  STOPPED: 'info',
  DECLINED: 'danger',
  DENIED: 'danger',
  FAILED: 'danger',
  EXPIRED: 'danger',
  CANCELLED: 'danger'
});

const INTENT_LABEL_OVERRIDES = Object.freeze({
  accept: 'Accept',
  decline: 'Decline',
  approve: 'Approve',
  deny: 'Deny',
  acknowledge: 'Acknowledge',
  resubmit: 'Resubmit',
  cancel: 'Cancel',
  refund: 'Refund',
  settle: 'Settle',
  escalate: 'Escalate',
  resolve: 'Resolve',
  stop: 'Stop',
  confirm: 'Confirm',
  fail: 'Mark failed',
  start: 'Start',
  request_revisions: 'Request revisions',
  advance: 'Advance',
  pay: 'Mark paid',
  reopen: 'Reopen'
});

function toTitleCase(value) {
  if (!value) {
    return '';
  }
  return String(value)
    .replace(/[_\s]+/g, ' ')
    .toLowerCase()
    .replace(/(^|\s)\w/g, (match) => match.toUpperCase());
}

function mapStateTone(state) {
  if (!state) {
    return 'neutral';
  }
  return STATE_TONES[state] ?? 'neutral';
}

function formatActionCardStateLabel(state) {
  if (!state) {
    return 'Unknown';
  }
  return toTitleCase(state);
}

function formatMoney(amountCents, { currency, locale }) {
  if (!Number.isFinite(amountCents)) {
    return null;
  }
  try {
    const formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'symbol'
    });
    return formatter.format(amountCents / 100);
  } catch {
    return `${(amountCents / 100).toFixed(2)} ${currency}`;
  }
}

function formatDurationMinutes(minutes) {
  if (!Number.isFinite(minutes)) {
    return null;
  }
  const total = Math.max(0, minutes);
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours && mins) {
    return `${hours}h ${mins}m`;
  }
  if (hours) {
    return `${hours}h`;
  }
  return `${mins}m`;
}

function formatDateTime(iso, { locale, timezone }) {
  if (!iso) {
    return null;
  }
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return String(iso);
    }
    const formatter = new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone
    });
    return formatter.format(date);
  } catch {
    return String(iso);
  }
}

function normalizeRange(range) {
  if (!range || typeof range !== 'object') {
    return null;
  }
  const start =
    range.start ??
    range.startAt ??
    range.start_time ??
    range.begin ??
    range.from ??
    range.oldStart ??
    null;
  const end =
    range.end ??
    range.endAt ??
    range.end_time ??
    range.finish ??
    range.to ??
    range.oldEnd ??
    null;
  if (!start && !end) {
    return null;
  }
  return { start, end };
}

function formatDateRange(range, options) {
  const normalized = normalizeRange(range);
  if (!normalized) {
    return null;
  }
  const startLabel = normalized.start ? formatDateTime(normalized.start, options) : null;
  const endLabel = normalized.end ? formatDateTime(normalized.end, options) : null;
  if (startLabel && endLabel) {
    if (startLabel === endLabel) {
      return startLabel;
    }
    return `${startLabel} → ${endLabel}`;
  }
  return startLabel ?? endLabel ?? null;
}

function pushMetadata(list, label, value) {
  if (!label) {
    return;
  }
  if (value === null || value === undefined || value === '') {
    return;
  }
  list.push({
    label,
    value: typeof value === 'string' ? value : JSON.stringify(value)
  });
}

function pushAttachment(list, label, value) {
  if (!label) {
    return;
  }
  if (!value) {
    return;
  }
  list.push({
    label,
    value: String(value)
  });
}

function defaultSummary(stateLabel, pending) {
  if (pending) {
    return 'Pending decision.';
  }
  if (!stateLabel) {
    return 'No further action required.';
  }
  return `Marked as ${stateLabel.toLowerCase()}.`;
}

function getDeadline(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  return payload.deadlineAt ?? payload.dueAt ?? payload.expiresAt ?? null;
}

function getReason(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  return payload.reason ?? payload.message ?? null;
}

/**
 * Presents an action card in a UI-friendly structure.
 * @param {{ type?: string; state?: string; payload?: Record<string, any>; updatedAt?: string; createdAt?: string }} card
 * @param {{ locale?: string; timezone?: string; currency?: string }} [options]
 */
export function presentActionCard(card, options = {}) {
  const locale = options.locale ?? DEFAULT_LOCALE;
  const timezone = options.timezone ?? DEFAULT_TIMEZONE;
  const currency = options.currency ?? DEFAULT_CURRENCY;

  const payload = card?.payload && typeof card.payload === 'object' ? card.payload : {};
  const described = describeActionCard(card, options);
  const stateLabel = formatActionCardStateLabel(card?.state);
  const metadata = [];
  const attachments = [];

  const deadline = getDeadline(payload);
  if (deadline) {
    pushMetadata(metadata, 'Deadline', formatDateTime(deadline, { locale, timezone }));
  }

  let title = TYPE_TITLES[card?.type] ?? toTitleCase(card?.type ?? 'Action card');
  let summary = defaultSummary(stateLabel, described.pending);

  switch (card?.type) {
    case 'RESCHEDULE': {
      title = TYPE_TITLES.RESCHEDULE;
      summary = described.pending
        ? 'Awaiting response to proposed schedule change.'
        : `Reschedule ${stateLabel.toLowerCase()}.`;
      const currentRange = formatDateRange(payload.old ?? payload.current ?? payload.previous, {
        locale,
        timezone
      });
      const proposedRange = formatDateRange(payload.proposed ?? payload.next ?? payload.new, {
        locale,
        timezone
      });
      pushMetadata(metadata, 'Current schedule', currentRange);
      pushMetadata(metadata, 'Proposed schedule', proposedRange);
      pushMetadata(metadata, 'Reason', getReason(payload));
      break;
    }
    case 'REQUEST_EXTRA': {
      title = TYPE_TITLES.REQUEST_EXTRA;
      const amount = formatMoney(payload.priceCents ?? payload.amountCents, { currency, locale });
      summary = payload.name
        ? `Additional service "${payload.name}" requested.`
        : 'Additional service requested.';
      pushMetadata(metadata, 'Name', payload.name ?? 'Extra');
      pushMetadata(metadata, 'Cost', amount);
      pushMetadata(metadata, 'Notes', payload.note ?? payload.description ?? null);
      break;
    }
    case 'OVERTIME_START': {
      title = TYPE_TITLES.OVERTIME_START;
      const duration = formatDurationMinutes(payload.minutes ?? payload.durationMinutes);
      summary = described.pending ? 'Overtime pending confirmation.' : `Overtime ${stateLabel.toLowerCase()}.`;
      pushMetadata(metadata, 'Requested duration', duration);
      pushMetadata(metadata, 'Reason', getReason(payload));
      break;
    }
    case 'OVERTIME_STOP': {
      title = TYPE_TITLES.OVERTIME_STOP;
      summary = described.pending ? 'Confirm overtime stop to close billing.' : `Overtime ${stateLabel.toLowerCase()}.`;
      pushMetadata(metadata, 'Reported minutes', formatDurationMinutes(payload.minutes ?? payload.durationMinutes));
      break;
    }
    case 'DELIVERABLE_PROOF': {
      title = TYPE_TITLES.DELIVERABLE_PROOF;
      summary = described.pending
        ? 'Proof deliverable requires review.'
        : `Proof deliverable ${stateLabel.toLowerCase()}.`;
      pushAttachment(attachments, 'Manifest reference', payload.manifestRef ?? payload.manifestId);
      pushMetadata(metadata, 'Note', payload.note ?? payload.description);
      break;
    }
    case 'DELIVERABLE_FINAL': {
      title = TYPE_TITLES.DELIVERABLE_FINAL;
      summary = described.pending
        ? 'Final deliverable awaiting acknowledgement.'
        : `Final deliverable ${stateLabel.toLowerCase()}.`;
      pushAttachment(attachments, 'Manifest reference', payload.manifestRef ?? payload.manifestId);
      pushMetadata(metadata, 'Note', payload.note ?? payload.description);
      break;
    }
    case 'CANCEL_REQUEST': {
      title = TYPE_TITLES.CANCEL_REQUEST;
      summary = described.pending
        ? 'Cancellation request pending review.'
        : `Cancellation ${stateLabel.toLowerCase()}.`;
      pushMetadata(metadata, 'Reason', getReason(payload));
      if (payload.refundQuoteCents || payload.refundCents) {
        pushMetadata(metadata, 'Refund estimate', formatMoney(payload.refundQuoteCents ?? payload.refundCents, { currency, locale }));
      }
      if (payload.penaltyCents) {
        pushMetadata(metadata, 'Penalty', formatMoney(payload.penaltyCents, { currency, locale }));
      }
      break;
    }
    case 'REFUND_REQUEST': {
      title = TYPE_TITLES.REFUND_REQUEST;
      summary = described.pending
        ? 'Refund request pending review.'
        : `Refund ${stateLabel.toLowerCase()}.`;
      if (payload.amountCents ?? payload.refundCents) {
        pushMetadata(metadata, 'Requested amount', formatMoney(payload.amountCents ?? payload.refundCents, { currency, locale }));
      }
      pushMetadata(metadata, 'Reason', getReason(payload));
      break;
    }
    case 'ACCEPTANCE_ACK': {
      title = TYPE_TITLES.ACCEPTANCE_ACK;
      summary = described.pending
        ? 'Awaiting buyer acknowledgement of completion.'
        : `Completion ${stateLabel.toLowerCase()}.`;
      break;
    }
    case 'DEPOSIT_CLAIM_OPEN': {
      title = TYPE_TITLES.DEPOSIT_CLAIM_OPEN;
      summary = described.pending
        ? 'Deposit claim pending decision.'
        : `Deposit claim ${stateLabel.toLowerCase()}.`;
      if (payload.amountCents) {
        pushMetadata(metadata, 'Claim amount', formatMoney(payload.amountCents, { currency, locale }));
      }
      if (Array.isArray(payload.evidence)) {
        for (const evidence of payload.evidence) {
          pushAttachment(attachments, 'Evidence', evidence);
        }
      }
      pushMetadata(metadata, 'Reason', getReason(payload));
      break;
    }
    case 'DISPUTE_OPEN': {
      title = TYPE_TITLES.DISPUTE_OPEN;
      summary = described.pending
        ? 'Payment dispute in progress.'
        : `Dispute ${stateLabel.toLowerCase()}.`;
      if (payload.amountCents) {
        pushMetadata(metadata, 'Disputed amount', formatMoney(payload.amountCents, { currency, locale }));
      }
      pushMetadata(metadata, 'Reason', getReason(payload));
      if (Array.isArray(payload.evidence)) {
        for (const evidence of payload.evidence) {
          pushAttachment(attachments, 'Evidence', evidence);
        }
      }
      break;
    }
    default: {
      pushMetadata(metadata, 'Details', payload.summary ?? payload.description ?? null);
      pushMetadata(metadata, 'Reason', getReason(payload));
      break;
    }
  }

  const notes = payload.notes;
  if (Array.isArray(notes)) {
    for (const note of notes) {
      pushMetadata(metadata, 'Note', note);
    }
  }

  return {
    title,
    summary,
    stateLabel,
    stateTone: mapStateTone(card?.state),
    requiresAttention: !isTerminalState(card, options),
    metadata,
    attachments,
    category: described.category ?? null,
    lastUpdatedAt: described.lastUpdatedAt ?? null,
    deadline: deadline ?? null
  };
}

/**
 * Formats an action card intent into a user-facing label.
 * @param {string} intent
 */
export function formatActionCardIntentLabel(intent) {
  if (!intent) {
    return '';
  }
  const normalized = String(intent).toLowerCase();
  return INTENT_LABEL_OVERRIDES[normalized] ?? toTitleCase(normalized);
}
