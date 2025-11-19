import test from 'node:test';
import assert from 'node:assert/strict';
import { createMessagingController } from '../../../tools/frontend/messaging/controller.mjs';
import { createMessagingClient } from '../../../tools/frontend/messaging/client.mjs';

function buildThreadPayload(threadId) {
  return {
    thread: {
      threadId,
      kind: 'INQUIRY',
      status: 'OPEN',
      safeModeRequired: false,
      lastMessageAt: '2025-11-18T01:00:00.000Z'
    },
    messages: [
      {
        messageId: 'msg-1',
        createdAt: '2025-11-18T01:00:00.000Z',
        authorUserId: 'usr-2',
        type: 'TEXT',
        body: 'Hello there'
      }
    ],
    participants: [
      {
        userId: 'usr-1',
        role: 'BUYER',
        lastReadMsgId: 'msg-1',
        lastReadAt: '2025-11-18T01:05:00.000Z'
      },
      {
        userId: 'usr-2',
        role: 'SELLER'
      }
    ],
    actionCards: [],
    projectPanel: { version: 1, tabs: {} },
    safeMode: { bandMax: 1, override: false },
    presenceTtlMs: 60000
  };
}

test('refreshInbox hydrates controller state from GraphQL payload', async () => {
  const controller = createMessagingController({ viewerUserId: 'usr-1' });
  const client = createMessagingClient({
    controller,
    fetchInbox: async () => ({
      threads: [
        {
          threadId: 'thr-1',
          kind: 'INQUIRY',
          lastMessageAt: '2025-11-18T00:00:00.000Z',
          unreadCount: 2,
          pinned: false,
          archived: false,
          muted: false,
          safeModeRequired: false
        }
      ],
      messageRequests: [
        {
          requestId: 'req-1',
          threadId: 'thr-2',
          creditCost: 1,
          expiresAt: '2025-11-20T00:00:00.000Z',
          createdAt: '2025-11-18T00:00:00.000Z'
        }
      ],
      rateLimit: { windowMs: 86_400_000, maxConversations: 5, initiations: [] },
      credits: { available: 3, costPerRequest: 1, floor: 0 }
    })
  });

  const normalized = await client.refreshInbox();
  assert.equal(normalized.threads.length, 1);
  assert.equal(controller.getTotalUnread(), 2);
  const inboxThreads = controller.selectInboxThreads();
  assert.equal(inboxThreads.length, 1);
  assert.equal(inboxThreads[0].threadId, 'thr-1');
});

test('hydrateThread and thread subscriptions synchronize timeline events', async () => {
  const controller = createMessagingController({ viewerUserId: 'usr-1' });
  const threadHandlers = new Map();

  const client = createMessagingClient({
    controller,
    fetchThread: async (threadId) => buildThreadPayload(threadId),
    subscribeThread: (threadId, handlers) => {
      threadHandlers.set(threadId, handlers);
      return () => {
        threadHandlers.delete(threadId);
      };
    }
  });

  await client.hydrateThread('thr-1');
  const initialState = controller.getThreadState('thr-1');
  assert.ok(initialState);
  assert.equal(initialState.messageOrder.length, 1);

  client.startThreadSubscription('thr-1');
  const handler = threadHandlers.get('thr-1');
  assert.ok(handler, 'subscription handler registered');

  handler.next({
    type: 'MESSAGE_CREATED',
    payload: {
      messageId: 'msg-2',
      createdAt: '2025-11-18T01:02:00.000Z',
      authorUserId: 'usr-2',
      type: 'TEXT',
      body: 'Follow-up note'
    }
  });

  const updatedState = controller.getThreadState('thr-1');
  assert.equal(updatedState.messageOrder.length, 2);
  const latestMessageId = updatedState.messageOrder.at(-1);
  assert.equal(latestMessageId, 'msg-2');
  assert.equal(updatedState.messagesById['msg-2'].body, 'Follow-up note');
});

test('sendMessage resolves optimistic messages with mutation acknowledgment', async () => {
  const controller = createMessagingController({ viewerUserId: 'usr-1' });
  const client = createMessagingClient({
    controller,
    fetchThread: async (threadId) => buildThreadPayload(threadId),
    mutations: {
      sendMessage: async (_threadId, input) => ({
        message: {
          messageId: 'msg-optimistic',
          createdAt: '2025-11-18T01:03:00.000Z',
          authorUserId: 'usr-1',
          type: input.type ?? 'TEXT',
          body: input.body ?? '',
          attachments: input.attachments ?? []
        }
      })
    }
  });

  await client.hydrateThread('thr-1');
  await client.sendMessage('thr-1', { clientId: 'client-1', body: 'Hi team!' });

  const state = controller.getThreadState('thr-1');
  const lastMessageId = state.messageOrder.at(-1);
  const lastMessage = state.messagesById[lastMessageId];
  assert.equal(lastMessage.body, 'Hi team!');
  assert.equal(lastMessage.deliveryState, 'SENT');
});

test('sendMessage failure marks optimistic message as failed with error code', async () => {
  const controller = createMessagingController({ viewerUserId: 'usr-1' });
  const error = new Error('network boom');
  error.code = 'NETWORK_FAILURE';

  const client = createMessagingClient({
    controller,
    fetchThread: async (threadId) => buildThreadPayload(threadId),
    mutations: {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      sendMessage: async (_threadId, _input) => {
        throw error;
      }
    }
  });

  await client.hydrateThread('thr-2');
  await assert.rejects(client.sendMessage('thr-2', { clientId: 'client-2', body: 'This will fail' }), /network boom/);

  const state = controller.getThreadState('thr-2');
  const tempId = state.optimisticByClientId['client-2'];
  assert.ok(tempId, 'optimistic message retained for failure state');
  const failedMessage = state.messagesById[tempId];
  assert.equal(failedMessage.deliveryState, 'FAILED');
  assert.equal(failedMessage.errorCode, 'NETWORK_FAILURE');
});

test('acceptMessageRequest updates inbox state and calls mutation', async () => {
  const controller = createMessagingController({ viewerUserId: 'usr-1' });
  controller.hydrateInbox({
    threads: [
      {
        threadId: 'thr-3',
        kind: 'PROJECT',
        lastMessageAt: '2025-11-18T02:00:00.000Z',
        unreadCount: 0,
        pinned: false,
        archived: false,
        muted: false,
        safeModeRequired: false
      }
    ],
    requests: [
      {
        requestId: 'req-accept',
        threadId: 'thr-3',
        creditCost: 2,
        expiresAt: '2025-11-21T00:00:00.000Z',
        createdAt: '2025-11-18T02:00:00.000Z'
      }
    ],
    rateLimit: { windowMs: 86_400_000, maxConversations: 5, initiations: [] },
    credits: { available: 5, costPerRequest: 1, floor: 0 }
  });

  let mutationCalled = false;
  const client = createMessagingClient({
    controller,
    mutations: {
      acceptMessageRequest: async (requestId) => {
        mutationCalled = requestId === 'req-accept';
      }
    }
  });

  await client.acceptMessageRequest('req-accept');
  assert.ok(mutationCalled, 'mutation invoked');
  const inbox = controller.getInboxState();
  assert.ok(!inbox.requestsById['req-accept'], 'request removed from inbox state');
});

test('prepareUpload registers stub upload and marks ready', async () => {
  const controller = createMessagingController();
  const client = createMessagingClient({ controller });

  const upload = await client.prepareUpload('thr-upload', {
    fileName: 'proof.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 1024
  });

  assert.ok(upload);
  assert.equal(upload.status, 'READY');
  const state = controller.getUploadState();
  assert.equal(state.order.length, 1);
  const stored = state.itemsByClientId[state.order[0]];
  assert.equal(stored.status, 'READY');
  assert.equal(stored.metadata.threadId, 'thr-upload');
});

test('prepareUpload leverages custom upload handlers', async () => {
  const controller = createMessagingController();
  const events = [];
  const client = createMessagingClient({
    controller,
    uploads: {
      createUploadSession: async (threadId, descriptor) => {
        events.push(['session', threadId, descriptor.fileName]);
        return {
          attachmentId: 'att-custom',
          uploadUrl: 'https://upload.test/custom'
        };
      },
      completeUpload: async (threadId, attachmentId) => {
        events.push(['complete', threadId, attachmentId]);
        return {
          attachmentId,
          status: 'READY',
          nsfwBand: 0
        };
      }
    }
  });

  const upload = await client.prepareUpload('thr-custom', {
    fileName: 'doc.pdf',
    sizeBytes: 4096
  });

  assert.equal(upload.attachmentId, 'att-custom');
  assert.equal(upload.status, 'READY');
  assert.ok(events.find((event) => event[0] === 'session'));
  assert.ok(events.find((event) => event[0] === 'complete'));
});

test('prepareUpload failure marks upload as failed', async () => {
  const controller = createMessagingController();
  const error = new Error('upload pipeline failed');

  const client = createMessagingClient({
    controller,
    uploads: {
      createUploadSession: async () => {
        throw error;
      }
    }
  });

  await assert.rejects(
    client.prepareUpload('thr-failure', { fileName: 'fail.bin' }),
    /upload pipeline failed/
  );

  const state = controller.getUploadState();
  assert.equal(state.order.length, 1);
  const item = state.itemsByClientId[state.order[0]];
  assert.equal(item.status, 'FAILED');
  assert.equal(item.errorCode, 'Error');
});

test('prepareUpload polls attachment status until ready', async () => {
  const controller = createMessagingController();
  const statusCalls = [];
  const client = createMessagingClient({
    controller,
    uploads: {
      createUploadSession: async () => ({ attachmentId: 'att-scan', uploadUrl: 'https://upload.example/scan' }),
      completeUpload: async () => ({
        attachmentId: 'att-scan',
        status: 'SCANNING'
      }),
      getUploadStatus: async (attachmentId) => {
        statusCalls.push(attachmentId);
        if (statusCalls.length < 2) {
          return { attachmentId, status: 'SCANNING' };
        }
        return { attachmentId, status: 'READY', nsfwBand: 2 };
      }
    }
  });

  const upload = await client.prepareUpload(
    'thr-scan',
    { fileName: 'preview.png', sizeBytes: 2048 },
    { statusPollIntervalMs: 0, statusPollMaxAttempts: 5 }
  );

  assert.equal(upload.status, 'READY');
  assert.equal(upload.nsfwBand, 2);
  assert.equal(statusCalls.length, 2);
});

test('prepareUpload marks upload failed when status polling times out', async () => {
  const controller = createMessagingController();
  const client = createMessagingClient({
    controller,
    uploads: {
      createUploadSession: async () => ({ attachmentId: 'att-timeout' }),
      completeUpload: async () => ({ attachmentId: 'att-timeout', status: 'SCANNING' }),
      getUploadStatus: async (attachmentId) => ({ attachmentId, status: 'SCANNING' })
    }
  });

  const upload = await client.prepareUpload(
    'thr-timeout',
    { fileName: 'slow.bin', sizeBytes: 512 },
    { statusPollIntervalMs: 0, statusPollMaxAttempts: 2 }
  );

  assert.equal(upload.status, 'FAILED');
  assert.equal(upload.errorCode, 'UPLOAD_STATUS_TIMEOUT');
});
