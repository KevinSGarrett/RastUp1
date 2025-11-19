import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeInboxPayload,
  normalizeThreadPayload,
  mapThreadEventEnvelope,
  mapInboxEventEnvelope,
  hydrateControllerFromGraphQL,
  createMessagingController,
  applyThreadEvent,
  createThreadState,
  applyInboxEvent,
  createInboxState
} from '../../../tools/frontend/messaging/index.mjs';

test('normalizeInboxPayload handles edges, requests, credits, and rate limits', () => {
  const payload = {
    threads: {
      edges: [
        {
          node: {
            id: 'thr-1',
            kind: 'PROJECT',
            lastMessageAt: '2025-11-18T12:00:00.000Z',
            unreadCount: 3,
            pinned: true,
            muted: false,
            archived: false,
            safeModeRequired: true
          }
        },
        {
          node: {
            id: 'thr-2',
            kind: 'INQUIRY',
            lastMessage: { createdAt: '2025-11-17T08:30:00.000Z' },
            unread: 1,
            isPinned: false,
            isMuted: true,
            isArchived: false
          }
        }
      ]
    },
    messageRequests: [
      {
        requestId: 'req-1',
        threadId: 'thr-3',
        creditCost: 2,
        expiresAt: '2025-11-20T00:00:00.000Z',
        createdAt: '2025-11-18T05:00:00.000Z'
      }
    ],
    rateLimit: {
      windowMs: 86_400_000,
      maxConversations: 4,
      initiations: ['2025-11-18T04:00:00.000Z']
    },
    credits: {
      available: 6,
      costPerRequest: 2,
      floor: 1
    }
  };

  const normalized = normalizeInboxPayload(payload);
  assert.equal(normalized.threads.length, 2);
  assert.equal(normalized.threads[0].threadId, 'thr-1');
  assert.equal(normalized.threads[0].kind, 'PROJECT');
  assert.equal(normalized.threads[0].unreadCount, 3);
  assert.equal(normalized.threads[0].pinned, true);
  assert.equal(normalized.threads[0].safeModeRequired, true);
  assert.equal(normalized.threads[1].muted, true);
  assert.equal(normalized.requests.length, 1);
  assert.equal(normalized.requests[0].threadId, 'thr-3');
  assert.equal(normalized.rateLimit.maxConversations, 4);
  assert.equal(normalized.credits.available, 6);
});

test('normalizeThreadPayload converts nested edges and metadata', () => {
  const payload = {
    thread: {
      id: 'thr-10',
      kind: 'project',
      status: 'open',
      safeModeRequired: false,
      lastMessageAt: '2025-11-18T12:00:00.000Z',
      projectPanel: {
        version: 2,
        tabs: {
          brief: { title: 'Updated brief' }
        }
      }
    },
    safeMode: { bandMax: 2, override: true },
    messages: {
      edges: [
        {
          node: {
            id: 'msg-1',
            createdAt: '2025-11-18T11:00:00.000Z',
            authorUserId: 'usr-a',
            type: 'text',
            body: 'Hello there',
            attachments: [{ kind: 'preview', s3Key: 'key-1' }]
          }
        }
      ]
    },
    actionCards: {
      edges: [
        {
          node: {
            actionId: 'act-1',
            type: 'REQUEST_EXTRA',
            state: 'PENDING',
            version: 3,
            createdAt: '2025-11-18T11:05:00.000Z'
          }
        }
      ]
    },
    participants: [
      {
        userId: 'usr-a',
        role: 'buyer',
        lastReadMsgId: 'msg-1',
        lastReadAt: '2025-11-18T11:10:00.000Z'
      }
    ],
    presenceTtlMs: 90_000
  };

  const normalized = normalizeThreadPayload(payload);
  assert.equal(normalized.thread.threadId, 'thr-10');
  assert.equal(normalized.thread.kind, 'PROJECT');
  assert.equal(normalized.messages.length, 1);
  assert.equal(normalized.messages[0].attachments.length, 1);
  assert.equal(normalized.actionCards.length, 1);
  assert.equal(normalized.participants.length, 1);
  assert.equal(normalized.projectPanel.version, 2);
  assert.equal(normalized.safeMode.override, true);
  assert.equal(normalized.presenceTtlMs, 90_000);
});

test('mapThreadEventEnvelope produces applyThreadEvent payloads', () => {
  const baseThread = createThreadState(
    normalizeThreadPayload({
      thread: {
        id: 'thr-11',
        kind: 'PROJECT',
        status: 'OPEN',
        lastMessageAt: '2025-11-18T11:00:00.000Z'
      },
      messages: [],
      actionCards: [],
      participants: []
    })
  );

  const messageEvent = mapThreadEventEnvelope({
    type: 'MessageCreatedEvent',
    message: {
      id: 'msg-100',
      createdAt: '2025-11-18T12:00:00.000Z',
      authorUserId: 'usr-b',
      type: 'text',
      body: 'New message body',
      clientId: 'optimistic-99'
    }
  });
  assert.equal(messageEvent.type, 'MESSAGE_CREATED');
  assert.equal(messageEvent.payload.messageId, 'msg-100');
  assert.equal(messageEvent.payload.clientId, 'optimistic-99');

  let next = applyThreadEvent(baseThread, messageEvent);
  assert.equal(next.messageOrder.includes('msg-100'), true);

  const actionCardEvent = mapThreadEventEnvelope({
    type: 'ActionCardStateChanged',
    actionCard: {
      actionId: 'act-1',
      type: 'REQUEST_EXTRA',
      state: 'PAID',
      version: 2,
      updatedAt: '2025-11-18T12:30:00.000Z'
    }
  });
  assert.equal(actionCardEvent.type, 'ACTION_CARD_UPSERT');
  next = applyThreadEvent(next, actionCardEvent);
  assert.equal(next.actionCardsById['act-1'].state, 'PAID');

  const presenceEvent = mapThreadEventEnvelope({
    type: 'PresenceEvent',
    presence: {
      userId: 'usr-b',
      lastSeen: new Date().toISOString(),
      typing: true
    }
  });
  assert.equal(presenceEvent.type, 'PRESENCE_EVENT');
  next = applyThreadEvent(next, presenceEvent);
  assert.equal(next.presenceByUserId['usr-b'].typing, true);
});

test('mapInboxEventEnvelope cooperates with inbox_store events', () => {
  let inbox = createInboxState();

  const threadCreated = mapInboxEventEnvelope({
    type: 'ThreadCreatedEvent',
    thread: {
      id: 'thr-20',
      kind: 'INQUIRY',
      lastMessageAt: '2025-11-18T08:00:00.000Z',
      unreadCount: 2
    }
  });
  inbox = applyInboxEvent(inbox, threadCreated);
  assert.equal(inbox.orderedThreadIds.includes('thr-20'), true);

  const messageReceived = mapInboxEventEnvelope({
    type: 'THREAD_MESSAGE_RECEIVED',
    payload: {
      threadId: 'thr-20',
      lastMessageAt: '2025-11-18T09:00:00.000Z',
      incrementUnread: 1
    }
  });
  inbox = applyInboxEvent(inbox, messageReceived);
  assert.equal(inbox.unreadByThreadId['thr-20'], 3);

  const requestReceived = mapInboxEventEnvelope({
    type: 'MessageRequestCreated',
    request: {
      requestId: 'req-77',
      threadId: 'thr-30',
      creditCost: 1,
      expiresAt: '2025-11-19T00:00:00.000Z',
      createdAt: '2025-11-18T10:00:00.000Z'
    }
  });
  inbox = applyInboxEvent(inbox, requestReceived);
  assert.equal(Object.keys(inbox.requestsById).length, 1);
  assert.equal(inbox.requestsById['req-77'].threadId, 'thr-30');
});

test('hydrateControllerFromGraphQL hydrates messaging controller with normalized data', () => {
  const controller = createMessagingController({ viewerUserId: 'usr-alpha' });
  const inboxPayload = {
    threads: [
      {
        id: 'thr-50',
        kind: 'PROJECT',
        lastMessageAt: '2025-11-18T07:00:00.000Z',
        unreadCount: 4
      }
    ],
    requests: [],
    credits: { available: 10, costPerRequest: 0, floor: 0 }
  };
  const threadPayload = {
    thread: {
      id: 'thr-50',
      kind: 'PROJECT',
      status: 'OPEN',
      lastMessageAt: '2025-11-18T07:00:00.000Z'
    },
    messages: [
      {
        id: 'msg-xyz',
        createdAt: '2025-11-18T07:00:00.000Z',
        authorUserId: 'usr-alpha',
        type: 'text',
        body: 'Welcome'
      }
    ],
    participants: [
      { userId: 'usr-alpha', role: 'BUYER', lastReadMsgId: 'msg-xyz', lastReadAt: '2025-11-18T07:05:00.000Z' }
    ]
  };

  hydrateControllerFromGraphQL(controller, { inbox: inboxPayload, threads: [threadPayload] });
  const snapshot = controller.getSnapshot();

  assert.equal(snapshot.inbox.orderedThreadIds[0], 'thr-50');
  assert.equal(snapshot.threads.get('thr-50').messagesById['msg-xyz'].body, 'Welcome');
  assert.equal(snapshot.threads.get('thr-50').participantsById['usr-alpha'].lastReadMsgId, 'msg-xyz');
});
