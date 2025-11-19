const STRIPE_EVENT_MAP = new Map([
  ['payment_intent.succeeded', 'fin.charge.succeeded'],
  ['payment_intent.payment_failed', 'fin.charge.failed'],
  ['payment_intent.requires_action', 'fin.charge.requires_action'],
  ['charge.refunded', 'fin.refund.succeeded'],
  ['charge.refund.updated', 'fin.refund.updated'],
  ['charge.dispute.created', 'fin.dispute.opened'],
  ['charge.dispute.closed', 'fin.dispute.closed'],
  ['payout.paid', 'fin.payout.paid'],
  ['payout.failed', 'fin.payout.failed']
]);

const TAX_EVENT_MAP = new Map([
  ['tax.quote', 'tax.quote'],
  ['tax.commit', 'tax.commit'],
  ['tax.refund', 'tax.refund']
]);

const DOC_EVENT_MAP = new Map([
  ['envelope.completed', 'doc.envelope.completed'],
  ['envelope.declined', 'doc.envelope.declined'],
  ['envelope.voided', 'doc.envelope.voided']
]);

function parseStripeLegIds(metadata) {
  const raw = metadata?.leg_ids;
  if (typeof raw !== 'string') {
    return [];
  }
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function defaultNormalizedEvent({ provider, eventId, rawType, normalizedType, occurredAt, payload, lbgId, legIds, metadata }) {
  return {
    provider,
    eventId,
    rawType,
    normalizedType,
    occurredAt: occurredAt ?? null,
    lbgId: lbgId ?? null,
    legIds: Array.isArray(legIds) ? legIds : [],
    payload: payload ?? {},
    metadata: metadata ?? {}
  };
}

export function normalizeStripeEvent(event) {
  if (!event || typeof event.id !== 'string') {
    throw new Error('Stripe event must include an id.');
  }
  const normalizedType = STRIPE_EVENT_MAP.get(event.type) ?? `stripe.${event.type}`;
  const object = event.data?.object ?? {};
  const metadata = object.metadata ?? {};
  const legIds = parseStripeLegIds(metadata);
  const occurredAt =
    typeof event.created === 'number' ? new Date(event.created * 1000).toISOString() : event.created ?? new Date().toISOString();
  const lbgId = metadata.lbg_id ?? metadata.lbgId ?? null;

  return defaultNormalizedEvent({
    provider: 'stripe',
    eventId: event.id,
    rawType: event.type,
    normalizedType,
    occurredAt,
    payload: object,
    lbgId,
    legIds,
    metadata
  });
}

export function normalizeTaxEvent(event) {
  if (!event || typeof event.id !== 'string') {
    throw new Error('Tax event must include an id.');
  }
  const normalizedType = TAX_EVENT_MAP.get(event.type) ?? `tax.${event.type}`;
  return defaultNormalizedEvent({
    provider: 'tax',
    eventId: event.id,
    rawType: event.type,
    normalizedType,
    occurredAt: event.occurredAt ?? new Date().toISOString(),
    payload: event.payload ?? {},
    metadata: event.metadata ?? {}
  });
}

export function normalizeDocEvent(event) {
  if (!event || typeof event.id !== 'string') {
    throw new Error('Doc event must include an id.');
  }
  const normalizedType = DOC_EVENT_MAP.get(event.type) ?? `doc.${event.type}`;
  return defaultNormalizedEvent({
    provider: 'doc',
    eventId: event.id,
    rawType: event.type,
    normalizedType,
    occurredAt: event.completedAt ?? event.occurredAt ?? new Date().toISOString(),
    payload: event.payload ?? {},
    metadata: event.metadata ?? {},
    lbgId: event.payload?.lbgId ?? null,
    legIds: event.payload?.legIds ?? []
  });
}

export function normalizeEvent(provider, event) {
  switch (provider) {
    case 'stripe':
      return normalizeStripeEvent(event);
    case 'tax':
      return normalizeTaxEvent(event);
    case 'doc':
      return normalizeDocEvent(event);
    default:
      throw new Error(`Unsupported provider ${provider}`);
  }
}

export function createWebhookDeduper(initialSnapshot) {
  const seen = new Map();

  if (Array.isArray(initialSnapshot)) {
    for (const entry of initialSnapshot) {
      if (entry && entry.provider && entry.eventId) {
        if (!seen.has(entry.provider)) {
          seen.set(entry.provider, new Set());
        }
        seen.get(entry.provider).add(entry.eventId);
      }
    }
  }

  return {
    has(provider, eventId) {
      return seen.get(provider)?.has(eventId) ?? false;
    },
    remember(provider, eventId) {
      if (!seen.has(provider)) {
        seen.set(provider, new Set());
      }
      seen.get(provider).add(eventId);
    },
    shouldProcess({ provider, eventId }) {
      if (this.has(provider, eventId)) {
        return false;
      }
      this.remember(provider, eventId);
      return true;
    },
    snapshot() {
      const entries = [];
      for (const [provider, ids] of seen.entries()) {
        for (const eventId of ids) {
          entries.push({ provider, eventId });
        }
      }
      return entries;
    }
  };
}
