import { filterMessageBody, getAttachmentDisplayState } from './safe_mode.mjs';

function resolveSafeMode(threadState, options = {}) {
  if (options.safeMode && typeof options.safeMode === 'object') {
    return {
      enabled: Boolean(options.safeMode.enabled),
      bandMax: Number.isInteger(options.safeMode.bandMax) ? options.safeMode.bandMax : 1
    };
  }
  const threadRequiresSafeMode = Boolean(threadState?.thread?.safeModeRequired);
  const controllerBandMax =
    Number.isInteger(threadState?.safeMode?.bandMax) && threadState.safeMode.bandMax >= 0
      ? threadState.safeMode.bandMax
      : 1;
  const controllerOverride = Boolean(threadState?.safeMode?.override);
  return {
    enabled: threadRequiresSafeMode || !controllerOverride,
    bandMax: controllerBandMax
  };
}

function getIntlFormatter(timeZone, options) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone, ...options });
  } catch {
    return new Intl.DateTimeFormat('en-US', options);
  }
}

function formatDayLabel(date, timeZone) {
  const formatter = getIntlFormatter(timeZone, {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  return formatter.format(date);
}

function dayKeyFromDate(date, timeZone) {
  const formatter = getIntlFormatter(timeZone, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  try {
    const parts = formatter.formatToParts(date);
    const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const year = lookup.year ?? '0000';
    const month = lookup.month ?? '01';
    const day = lookup.day ?? '01';
    return `${year}-${month}-${day}`;
  } catch {
    const iso = date.toISOString();
    return iso.slice(0, 10);
  }
}

function formatTimeLabel(date, timeZone) {
  const formatter = getIntlFormatter(timeZone, {
    hour: '2-digit',
    minute: '2-digit'
  });
  return formatter.format(date);
}

/**
 * Groups thread messages by calendar day, returning timeline metadata for UI rendering.
 * @param {ReturnType<import('./thread_store.mjs').createThreadState>} threadState
 * @param {{
 *   viewerUserId?: string;
 *   timezone?: string;
 *   safeMode?: { enabled: boolean; bandMax: number };
 * }} [options]
 */
export function groupMessagesByDay(threadState, options = {}) {
  if (!threadState || !Array.isArray(threadState.messageOrder)) {
    return [];
  }
  const timeZone = options.timezone ?? 'UTC';
  const safeMode = resolveSafeMode(threadState, options);
  const viewerUserId = options.viewerUserId ?? null;
  const groups = [];
  let currentGroupKey = null;
  let currentGroup = null;

  for (const messageId of threadState.messageOrder) {
    const message = threadState.messagesById?.[messageId];
    if (!message) continue;
    const createdAtIso = message.createdAt ?? new Date(0).toISOString();
    const createdAt = new Date(createdAtIso);
    if (!Number.isFinite(createdAt.getTime())) {
      continue;
    }
    const key = dayKeyFromDate(createdAt, timeZone);
    if (key !== currentGroupKey) {
      currentGroupKey = key;
      currentGroup = {
        dayKey: key,
        label: formatDayLabel(createdAt, timeZone),
        messages: []
      };
      groups.push(currentGroup);
    }
    const body = filterMessageBody(message.body ?? '', {
      safeMode,
      nsfwBand: message.nsfwBand ?? 0
    });
    const attachments = Array.isArray(message.attachments)
      ? message.attachments.map((attachment) => ({
          ...attachment,
          display: getAttachmentDisplayState({
            nsfwBand:
              Number.isInteger(attachment?.nsfwBand) && attachment.nsfwBand >= 0
                ? attachment.nsfwBand
                : Number.isInteger(message.nsfwBand)
                  ? message.nsfwBand
                  : 0,
            safeMode,
            status: attachment?.status ?? attachment?.state
          })
        }))
      : [];
    currentGroup.messages.push({
      messageId,
      createdAt: createdAtIso,
      timeLabel: formatTimeLabel(createdAt, timeZone),
      authorUserId: message.authorUserId ?? null,
      direction: viewerUserId && message.authorUserId === viewerUserId ? 'outgoing' : 'incoming',
      type: message.type ?? 'TEXT',
      body: body.body,
      redacted: body.redacted,
      attachments,
      deliveryState: message.deliveryState ?? 'SENT',
      optimistic: message.messageId?.startsWith('temp:') ?? false,
      action: message.action ?? null,
      nsfwBand: message.nsfwBand ?? 0
    });
  }

  return groups;
}

/**
 * Returns participant summary highlighting the viewer and other members.
 * @param {ReturnType<import('./thread_store.mjs').createThreadState>} threadState
 * @param {string|null} viewerUserId
 */
export function summarizeParticipants(threadState, viewerUserId = null) {
  const entries = threadState?.participantsById ?? {};
  const participants = Object.values(entries).map((participant) => ({
    userId: participant.userId ?? null,
    role: participant.role ?? 'GUEST',
    lastReadMsgId: participant.lastReadMsgId ?? null,
    lastReadAt: participant.lastReadAt ?? null
  }));
  const viewer = viewerUserId ? participants.find((p) => p.userId === viewerUserId) ?? null : null;
  const others = viewerUserId ? participants.filter((p) => p.userId !== viewerUserId) : participants;
  return {
    viewer,
    others
  };
}

/**
 * Summarises presence state into UI friendly descriptors.
 * @param {ReturnType<import('./thread_store.mjs').createThreadState>} threadState
 * @param {{ now?: number }} [options]
 */
export function summarizePresence(threadState, options = {}) {
  const now = options.now ?? Date.now();
  const presence = threadState?.presenceByUserId ?? {};
  return Object.entries(presence).map(([userId, value]) => {
    const lastSeenIso = value?.lastSeen ?? null;
    const lastSeenTs = lastSeenIso ? Date.parse(lastSeenIso) : NaN;
    const secondsSince = Number.isFinite(lastSeenTs) ? Math.max(0, Math.floor((now - lastSeenTs) / 1000)) : null;
    let status = 'offline';
    if (value?.typing) {
      status = 'typing';
    } else if (secondsSince !== null && secondsSince <= 30) {
      status = 'online';
    } else if (secondsSince !== null && secondsSince <= 60 * 60) {
      status = 'recent';
    }
    return {
      userId,
      typing: Boolean(value?.typing),
      lastSeenAt: lastSeenIso,
      secondsSinceLastSeen: secondsSince,
      status
    };
  });
}

export function formatRelativeTimestamp(iso, options = {}) {
  if (!iso) return '';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) {
    return '';
  }
  const now = options.now ? new Date(options.now) : new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.round(diffMs / 1000);
  if (diffSeconds < 45) {
    return 'Just now';
  }
  if (diffSeconds < 90) {
    return '1 min ago';
  }
  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes} min ago`;
  }
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} hr${diffHours === 1 ? '' : 's'} ago`;
  }
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) {
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  }
  const formatter = getIntlFormatter(options.timezone ?? undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
  return formatter.format(date);
}
