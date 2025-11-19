import { presentActionCard } from './action_card_presenter.mjs';

const DEFAULT_LOCALE = 'en-US';
const DEFAULT_TIMEZONE = 'UTC';
const DEFAULT_CURRENCY = 'USD';

function toStringId(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function toUpper(value, fallback = 'UNKNOWN') {
  if (typeof value === 'string' && value.trim()) {
    return value.trim().toUpperCase();
  }
  return fallback;
}

function toPlainObject(value) {
  if (!value || typeof value !== 'object') {
    return {};
  }
  if (Array.isArray(value)) {
    return {};
  }
  return { ...value };
}

function toIso(value) {
  if (!value && value !== 0) {
    return null;
  }
  if (value instanceof Date) {
    if (Number.isFinite(value.getTime())) {
      return value.toISOString();
    }
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
    return value;
  }
  return null;
}

const ACTION_CARD_CONTAINER_KEYS = Object.freeze([
  'items',
  'edges',
  'nodes',
  'cards',
  'list',
  'records',
  'entries',
  'open',
  'pending',
  'active',
  'resolved',
  'history',
  'closed'
]);

function isActionCardLike(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const type = value.type ?? value.actionType ?? value.kind;
  const state = value.state ?? value.status ?? value.actionState;
  return typeof type === 'string' && typeof state === 'string';
}

function collectCandidateNodes(source, seen = new WeakSet()) {
  if (!source) {
    return [];
  }
  const results = [];
  const stack = [source];

  while (stack.length) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index -= 1) {
        stack.push(current[index]);
      }
      continue;
    }
    if (typeof current !== 'object') {
      continue;
    }
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);

    if (isActionCardLike(current)) {
      results.push(current);
    }

    if (current.node) {
      stack.push(current.node);
    }
    if (current.action) {
      stack.push(current.action);
    }
    if (current.card) {
      stack.push(current.card);
    }

    for (const key of ACTION_CARD_CONTAINER_KEYS) {
      if (current[key]) {
        stack.push(current[key]);
      }
    }

    for (const value of Object.values(current)) {
      if (value && typeof value === 'object') {
        stack.push(value);
      }
    }
  }

  return results;
}

function normalizeActionCard(candidate, fallbackId) {
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }
  const actionId = toStringId(
    candidate.actionId ??
      candidate.id ??
      candidate.cardId ??
      candidate.action_id ??
      candidate.actionID ??
      null
  );
  const type = toUpper(candidate.type ?? candidate.actionType ?? candidate.kind);
  const state = toUpper(candidate.state ?? candidate.status ?? candidate.actionState);
  const payload =
    candidate.payload && typeof candidate.payload === 'object'
      ? { ...candidate.payload }
      : candidate.data && typeof candidate.data === 'object'
        ? { ...candidate.data }
        : {};
  const versionRaw = candidate.version ?? candidate.actionVersion ?? candidate.revision ?? 0;
  const version = Number.isFinite(versionRaw) ? Number(versionRaw) : Number(versionRaw) || 0;
  const createdAt =
    toIso(candidate.createdAt ?? candidate.insertedAt ?? candidate.timestamp ?? candidate.created_at) ??
    null;
  const updatedAt =
    toIso(
      candidate.updatedAt ??
        candidate.modifiedAt ??
        candidate.updated_at ??
        candidate.timestamp ??
        createdAt
    ) ?? createdAt;

  const normalized = {
    actionId: actionId ?? fallbackId,
    type,
    state,
    payload: toPlainObject(payload),
    version,
    createdAt,
    updatedAt
  };

  if (candidate.actorUserId ?? candidate.createdBy ?? candidate.authorUserId) {
    normalized.actorUserId =
      candidate.actorUserId ?? candidate.createdBy ?? candidate.authorUserId ?? null;
  }

  const intentsSource = candidate.availableIntents ?? candidate.intents ?? candidate.transitions;
  if (Array.isArray(intentsSource)) {
    const intents = [];
    for (const entry of intentsSource) {
      if (typeof entry === 'string' && entry.trim()) {
        intents.push(entry.trim());
      } else if (entry && typeof entry === 'object') {
        const intent = entry.intent ?? entry.name ?? entry.id;
        if (typeof intent === 'string' && intent.trim()) {
          intents.push(intent.trim());
        }
      }
    }
    if (intents.length) {
      normalized.availableIntents = Array.from(new Set(intents.map((intent) => intent.toLowerCase())));
    }
  }

  return normalized;
}

function compareCardsByRecency(a, b) {
  const aTs = Date.parse(a.updatedAt ?? '') || Date.parse(a.createdAt ?? '') || 0;
  const bTs = Date.parse(b.updatedAt ?? '') || Date.parse(b.createdAt ?? '') || 0;
  return bTs - aTs;
}

/**
 * Extracts normalized action cards from a project panel actions tab snapshot.
 * @param {unknown} tabValue
 * @returns {Array<{ actionId: string; type: string; state: string; payload: Record<string, any>; version: number; createdAt: string | null; updatedAt: string | null }>}
 */
export function collectProjectPanelActionCards(tabValue) {
  const candidates = collectCandidateNodes(tabValue);
  const map = new Map();
  let fallbackCounter = 0;

  for (const candidate of candidates) {
    const fallbackId = `anon-${fallbackCounter}`;
    const normalized = normalizeActionCard(candidate, fallbackId);
    if (!normalized) {
      continue;
    }
    const key = normalized.actionId ?? fallbackId;
    const existing = map.get(key);
    if (!existing) {
      fallbackCounter += 1;
      map.set(key, { ...normalized, actionId: key });
      continue;
    }

    const existingVersion = existing.version ?? 0;
    const nextVersion = normalized.version ?? 0;
    const existingTs = Date.parse(existing.updatedAt ?? '') || 0;
    const nextTs = Date.parse(normalized.updatedAt ?? '') || 0;

    if (nextVersion > existingVersion || nextTs > existingTs) {
      map.set(key, { ...normalized, actionId: key });
    }
  }

  const cards = Array.from(map.values());
  cards.sort(compareCardsByRecency);
  return cards;
}

/**
 * Presents project panel action cards using the shared action card presenter for UI consumption.
 * @param {unknown} tabValue
 * @param {{ locale?: string; timezone?: string; currency?: string }} [options]
 * @returns {Array<{ card: any; presentation: ReturnType<typeof presentActionCard> }>}
 */
export function presentProjectPanelActions(tabValue, options = {}) {
  const locale = options.locale ?? DEFAULT_LOCALE;
  const timezone = options.timezone ?? DEFAULT_TIMEZONE;
  const currency = options.currency ?? DEFAULT_CURRENCY;

  return collectProjectPanelActionCards(tabValue).map((card) => ({
    card,
    presentation: presentActionCard(card, { locale, timezone, currency })
  }));
}

/**
 * Summarises project panel tabs for high-level UI indicators.
 * Currently focuses on actions/pending counts.
 * @param {{ tabs?: Record<string, any> } | null | undefined} panel
 * @param {{ locale?: string; timezone?: string; currency?: string }} [options]
 */
export function summarizeProjectPanel(panel, options = {}) {
  const tabs = panel?.tabs ?? {};
  const actions = presentProjectPanelActions(tabs.actions, options);
  const pendingCount = actions.filter((entry) => entry.presentation.requiresAttention).length;
  return {
    actions: {
      total: actions.length,
      pending: pendingCount
    }
  };
}
