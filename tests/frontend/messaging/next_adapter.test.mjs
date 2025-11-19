import test from 'node:test';
import assert from 'node:assert/strict';

import { createMessagingNextAdapter } from '../../../tools/frontend/messaging/next_adapter.mjs';

const SAMPLE_INBOX_PAYLOAD = {
  threads: [
    {
      threadId: 'thr_alpha',
      kind: 'PROJECT',
      lastMessageAt: '2025-11-18T12:00:00Z',
      unreadCount: 2,
      pinned: true,
      archived: false,
      muted: false,
      safeModeRequired: false
    }
  ],
  messageRequests: [],
  rateLimit: {
    windowMs: 60 * 60 * 1000,
    maxConversations: 3,
    initiations: []
  },
  credits: {
    available: 10,
    costPerRequest: 1,
    floor: 0
  }
};

function createSampleThreadPayload(threadId) {
  return {
    thread: {
      threadId,
      kind: 'PROJECT',
      status: 'OPEN',
      safeModeRequired: false,
      lastMessageAt: '2025-11-18T12:05:00Z'
    },
    messages: [
      {
        messageId: 'msg_1',
        createdAt: '2025-11-18T12:03:00Z',
        authorUserId: 'usr_buyer',
        type: 'TEXT',
        body: 'Hello from buyer',
        attachments: []
      }
    ],
    actionCards: [],
    participants: [
      { userId: 'usr_buyer', role: 'BUYER', lastReadMsgId: 'msg_1', lastReadAt: '2025-11-18T12:04:00Z' },
      { userId: 'usr_seller', role: 'SELLER', lastReadMsgId: null, lastReadAt: null }
    ],
    projectPanel: {
      version: 1,
      tabs: {
        brief: { title: 'Sample project' }
      }
    },
    safeMode: { bandMax: 1, override: false },
    presenceTtlMs: 60_000
  };
}

const SAMPLE_MODERATION_QUEUE = {
  cases: [
    {
      caseId: 'case-1',
      type: 'THREAD',
      threadId: 'thr_alpha',
      status: 'PENDING',
      severity: 'HIGH',
      reason: 'HARASSMENT',
      reportedBy: 'usr_support',
      reportedAt: '2025-11-18T12:10:00Z',
      metadata: {}
    }
  ]
};

test('createMessagingNextAdapter.prefetch hydrates inbox and thread payloads', async () => {
  let inboxCalls = 0;
  const threadCalls = [];
  const adapter = createMessagingNextAdapter({
    fetchInbox: async () => {
      inboxCalls += 1;
      return SAMPLE_INBOX_PAYLOAD;
    },
    fetchThread: async (threadId) => {
      threadCalls.push(threadId);
      return createSampleThreadPayload(threadId);
    },
    fetchModerationQueue: async () => SAMPLE_MODERATION_QUEUE
  });

    const result = await adapter.prefetch({
      viewerUserId: 'usr_buyer',
      threadIds: ['thr_alpha'],
      includeModerationQueue: true
    });

  assert.equal(inboxCalls, 1);
  assert.deepEqual(threadCalls, ['thr_alpha']);
  assert.equal(result.viewerUserId, 'usr_buyer');
    assert.ok(result.initialInbox);
    assert.equal(result.initialInbox.threads[0].threadId, 'thr_alpha');
    assert.equal(result.initialThreads.length, 1);
    assert.equal(result.initialThreads[0].thread.threadId, 'thr_alpha');
    const initialQueue = result.initialModerationQueue;
    assert.ok(initialQueue);
    assert.equal(Array.isArray(initialQueue.cases), true);
    assert.equal(initialQueue.cases[0]?.caseId, 'case-1');
    assert.equal(initialQueue.cases[0]?.threadId, 'thr_alpha');
  assert.deepEqual(result.hydratedThreadIds, ['thr_alpha']);
  assert.deepEqual(result.errors, []);
});

test('createMessagingNextAdapter.createProviderProps merges config and defaults', async () => {
  const adapter = createMessagingNextAdapter({
    fetchInbox: async () => SAMPLE_INBOX_PAYLOAD,
    fetchThread: async (threadId) => createSampleThreadPayload(threadId),
    fetchModerationQueue: async () => SAMPLE_MODERATION_QUEUE,
    subscribeInbox: () => () => {},
    subscribeThread: () => () => {},
    mutations: {
      sendMessage: async () => ({ message: { messageId: 'msg_ack', createdAt: new Date().toISOString() } })
    }
  });

  const initialData = await adapter.prefetch({
    viewerUserId: 'usr_buyer',
    threadIds: ['thr_alpha'],
    includeModerationQueue: true
  });

  const providerProps = adapter.createProviderProps(initialData, {
    autoStartInbox: false,
    autoRefreshInbox: false
  });

  assert.equal(providerProps.viewerUserId, 'usr_buyer');
  assert.equal(providerProps.autoStartInbox, false);
  assert.equal(providerProps.autoRefreshInbox, false);
  assert.deepEqual(providerProps.autoSubscribeThreadIds, ['thr_alpha']);
  assert.ok(providerProps.clientConfig.initialInbox);
  assert.ok(providerProps.clientConfig.initialThreads);
  assert.ok(providerProps.clientConfig.initialModerationQueue);
  assert.equal(typeof providerProps.clientConfig.fetchInbox, 'function');
  assert.equal(typeof providerProps.clientConfig.fetchThread, 'function');
  assert.equal(typeof providerProps.clientConfig.fetchModerationQueue, 'function');
  assert.equal(typeof providerProps.clientConfig.subscribeInbox, 'function');
  assert.equal(typeof providerProps.clientConfig.subscribeThread, 'function');
  assert.equal(typeof providerProps.clientConfig.mutations.sendMessage, 'function');
});

test('createMessagingNextAdapter.createRuntime rehydrates controller state', async () => {
  const adapter = createMessagingNextAdapter({
    fetchInbox: async () => SAMPLE_INBOX_PAYLOAD,
    fetchThread: async (threadId) => createSampleThreadPayload(threadId),
    fetchModerationQueue: async () => SAMPLE_MODERATION_QUEUE
  });

  const initialData = await adapter.prefetch({
    viewerUserId: 'usr_buyer',
    threadIds: ['thr_alpha'],
    includeModerationQueue: true
  });

  const runtime = adapter.createRuntime(initialData, {
    clientOverrides: {
      fetchInbox: async () => SAMPLE_INBOX_PAYLOAD,
      fetchThread: async (threadId) => createSampleThreadPayload(threadId),
      fetchModerationQueue: async () => SAMPLE_MODERATION_QUEUE
    }
  });

  const controllerSnapshot = runtime.controller.getSnapshot();
  assert.equal(controllerSnapshot.viewerUserId, 'usr_buyer');

  const controller = runtime.controller;
  assert.deepEqual(controller.listThreadIds(), ['thr_alpha']);
  assert.equal(controller.getInboxState().orderedThreadIds[0], 'thr_alpha');
  const cases = controller.listModerationCases();
  assert.equal(Array.isArray(cases), true);
  assert.equal(cases[0]?.caseId, 'case-1');
  assert.equal(cases[0]?.threadId, 'thr_alpha');

  // Ensure client is functional
  await runtime.client.refreshInbox();
  runtime.dispose();
});
