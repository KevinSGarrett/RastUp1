import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInboxState,
  applyInboxEvent,
  canStartConversation,
  recordConversationStart,
  acceptMessageRequest,
  declineMessageRequest,
  pruneExpiredRequests,
  getTotalUnread,
  selectThreads
} from '../../../tools/frontend/messaging/inbox_store.mjs';

const baseThreads = [
  {
    threadId: 'thr-1',
    kind: 'INQUIRY',
    lastMessageAt: '2025-11-19T04:00:00.000Z',
    unreadCount: 0,
    metadata: { displayName: 'Client Alice' }
  },
  {
    threadId: 'thr-2',
    kind: 'PROJECT',
    lastMessageAt: '2025-11-19T05:00:00.000Z',
    unreadCount: 2,
    pinned: true,
    muted: true,
    title: 'Project Sunrise'
  },
  {
    threadId: 'thr-3',
    kind: 'PROJECT',
    lastMessageAt: '2025-11-18T23:30:00.000Z',
    unreadCount: 5,
    archived: true,
    safeModeRequired: true,
    metadata: { displayName: 'Safety review' }
  }
];

test('createInboxState sorts threads by last message descending', () => {
  const state = createInboxState({ threads: baseThreads });
  assert.deepEqual(state.orderedThreadIds, ['thr-2', 'thr-1', 'thr-3']);
  assert.equal(state.pinnedThreadIds.length, 1);
  assert.equal(state.archivedThreadIds.length, 1);
  assert.equal(getTotalUnread(state), 7);
});

test('applyInboxEvent reorders thread when new message arrives', () => {
  let state = createInboxState({ threads: baseThreads });
  state = applyInboxEvent(state, {
    type: 'THREAD_MESSAGE_RECEIVED',
    payload: {
      threadId: 'thr-1',
      lastMessageAt: '2025-11-19T06:15:00.000Z'
    }
  });
  assert.deepEqual(state.orderedThreadIds, ['thr-1', 'thr-2', 'thr-3']);
  assert.equal(state.unreadByThreadId['thr-1'], 1);
});

test('rate limit rejects conversation start when over limit or credits low', () => {
  const now = Date.parse('2025-11-19T05:00:00.000Z');
  let state = createInboxState({
    threads: baseThreads,
    credits: { available: 1, costPerRequest: 2, floor: 0 },
    rateLimit: { windowMs: 60 * 60 * 1000, maxConversations: 2, initiations: [now - 1000, now - 2000] }
  });
  let result = canStartConversation(state, { now });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'INSUFFICIENT_CREDITS');

  state = createInboxState({
    threads: baseThreads,
    credits: { available: 5, costPerRequest: 2, floor: 0 },
    rateLimit: { windowMs: 60 * 60 * 1000, maxConversations: 2, initiations: [now - 1000, now - 2000] }
  });
  result = canStartConversation(state, { now });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'RATE_LIMIT_EXCEEDED');
  assert.ok(result.nextAllowedAt > now);
});

test('recordConversationStart consumes credits and prunes stale initiations', () => {
  const now = Date.parse('2025-11-19T07:00:00.000Z');
  const past = now - 2 * 60 * 60 * 1000;
  let state = createInboxState({
    threads: baseThreads,
    credits: { available: 5, costPerRequest: 2, floor: 0 },
    rateLimit: { windowMs: 60 * 60 * 1000, maxConversations: 3, initiations: [past] }
  });
  state = recordConversationStart(state, { now, creditsSpent: 3 });
  assert.equal(state.credits.available, 2);
  assert.equal(state.rateLimit.initiations.length, 1);
  assert.ok(state.rateLimit.initiations[0] >= now - state.rateLimit.windowMs);
});

test('acceptMessageRequest moves thread into inbox and deducts credits', () => {
  const now = Date.parse('2025-11-19T07:30:00.000Z');
  const state = createInboxState({
    threads: baseThreads,
    credits: { available: 10, costPerRequest: 2, floor: 0 },
    requests: [
      {
        requestId: 'req-1',
        threadId: 'thr-req',
        creditCost: 4,
        createdAt: '2025-11-19T07:00:00.000Z',
        expiresAt: '2025-11-19T08:00:00.000Z'
      }
    ]
  });
  const next = acceptMessageRequest(state, 'req-1', { now });
  assert.equal(next.credits.available, 6);
  assert.ok(next.orderedThreadIds.includes('thr-req'));
  assert.equal(next.requestOrder.length, 0);
});

test('declineMessageRequest marks status without removing immediately', () => {
  let state = createInboxState({
    threads: baseThreads,
    requests: [
      {
        requestId: 'req-2',
        threadId: 'thr-x',
        creditCost: 1,
        createdAt: '2025-11-19T07:00:00.000Z',
        expiresAt: '2025-11-20T07:00:00.000Z'
      }
    ]
  });
  state = declineMessageRequest(state, 'req-2');
  assert.equal(state.requestsById['req-2'].status, 'DECLINED');
  state = declineMessageRequest(state, 'req-2', { block: true });
  assert.equal(state.requestsById['req-2'].status, 'BLOCKED');
});

test('pruneExpiredRequests removes expired and non-pending requests', () => {
  let state = createInboxState({
    threads: baseThreads,
    requests: [
      {
        requestId: 'req-3',
        threadId: 'thr-y',
        creditCost: 1,
        createdAt: '2025-11-19T07:00:00.000Z',
        expiresAt: '2025-11-19T07:15:00.000Z'
      }
    ]
  });
  state = declineMessageRequest(state, 'req-3');
  const pruned = pruneExpiredRequests(state, Date.parse('2025-11-19T08:00:00.000Z'));
  assert.equal(pruned.requestOrder.length, 0);
  assert.ok(!pruned.requestsById['req-3']);
});

test('selectThreads filters folders correctly', () => {
  const state = createInboxState({ threads: baseThreads });
  assert.equal(selectThreads(state, { folder: 'pinned' }).length, 1);
  assert.equal(selectThreads(state, { folder: 'archived' }).length, 1);
  assert.equal(selectThreads(state, { includeArchived: true }).length, 3);
  assert.equal(selectThreads(state, { folder: 'default' }).length, 2);
});

test('selectThreads applies unread and kind filters', () => {
  const state = createInboxState({ threads: baseThreads });
  const unreadProjects = selectThreads(state, { onlyUnread: true, kinds: ['PROJECT'] });
  assert.equal(unreadProjects.length, 1);
  assert.equal(unreadProjects[0].threadId, 'thr-2');
});

test('selectThreads filters by muted state', () => {
  const state = createInboxState({ threads: baseThreads });
  const mutedOnly = selectThreads(state, { muted: true });
  assert.equal(mutedOnly.length, 1);
  assert.equal(mutedOnly[0].threadId, 'thr-2');
  const unmutedOnly = selectThreads(state, { muted: false });
  assert.equal(unmutedOnly.length, 1);
  assert.equal(unmutedOnly[0].threadId, 'thr-1');
});

test('selectThreads filters by safe-mode requirement', () => {
  const state = createInboxState({ threads: baseThreads });
  const safeModeThreads = selectThreads(state, { safeModeRequired: true, includeArchived: true });
  assert.equal(safeModeThreads.length, 1);
  assert.equal(safeModeThreads[0].threadId, 'thr-3');
});

test('selectThreads matches query against metadata and title', () => {
  const state = createInboxState({ threads: baseThreads });
  const byMetadata = selectThreads(state, { query: 'alice' });
  assert.equal(byMetadata.length, 1);
  assert.equal(byMetadata[0].threadId, 'thr-1');
  const byTitle = selectThreads(state, { query: 'sunrise' });
  assert.equal(byTitle.length, 1);
  assert.equal(byTitle[0].threadId, 'thr-2');
});

test('selectThreads uses custom query matcher when provided', () => {
  const state = createInboxState({ threads: baseThreads });
  const custom = selectThreads(state, {
    query: 'sunset',
    queryMatcher: (thread, normalized) => thread.threadId === 'thr-2' && normalized === 'sunset'
  });
  assert.equal(custom.length, 1);
  assert.equal(custom[0].threadId, 'thr-2');
});

test('selectThreads filters requests by query', () => {
  const state = createInboxState({
    threads: baseThreads,
    requests: [
      {
        requestId: 'req-1',
        threadId: 'thr-req',
        creditCost: 2,
        createdAt: '2025-11-19T07:00:00.000Z',
        expiresAt: '2025-11-19T08:00:00.000Z'
      },
      {
        requestId: 'req-2',
        threadId: 'thr-keep',
        creditCost: 4,
        createdAt: '2025-11-19T07:05:00.000Z',
        expiresAt: '2025-11-19T08:05:00.000Z'
      }
    ]
  });
  const filtered = selectThreads(state, { folder: 'requests', query: 'keep' });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].threadId, 'thr-keep');
});
