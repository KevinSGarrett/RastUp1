import test from 'node:test';
import assert from 'node:assert/strict';
import { createMessagingController } from '../../../tools/frontend/messaging/controller.mjs';

test('message events update inbox unread counts and notify listeners', () => {
  const controller = createMessagingController({
    viewerUserId: 'usr_self',
    inbox: {
      threads: [
        {
          threadId: 'thr-1',
          kind: 'INQUIRY',
          lastMessageAt: '2025-01-01T00:00:00Z',
          unreadCount: 0
        }
      ]
    },
    threads: [
      {
        thread: { threadId: 'thr-1', kind: 'INQUIRY', lastMessageAt: '2025-01-01T00:00:00Z' },
        messages: [
          {
            messageId: 'msg-1',
            createdAt: '2025-01-01T00:00:00Z',
            authorUserId: 'usr_other',
            type: 'TEXT',
            body: 'hello'
          }
        ],
        participants: [
          {
            userId: 'usr_self',
            role: 'buyer',
            lastReadMsgId: 'msg-1',
            lastReadAt: '2025-01-01T00:00:05Z'
          },
          { userId: 'usr_other', role: 'seller' }
        ]
      }
    ],
    now: () => Date.parse('2025-01-01T00:00:00Z')
  });

  const changeLog = [];
  controller.subscribe((changes) => changeLog.push(changes));

  controller.applyThreadEvent('thr-1', {
    type: 'MESSAGE_CREATED',
    payload: {
      messageId: 'msg-2',
      createdAt: '2025-01-01T00:00:10Z',
      authorUserId: 'usr_other',
      type: 'TEXT',
      body: 'new message from seller'
    }
  });

  assert.equal(controller.getTotalUnread(), 1);
  const threads = controller.selectInboxThreads({ folder: 'default' });
  assert.equal(threads.length, 1);
  assert.equal(threads[0].threadId, 'thr-1');
  assert.equal(threads[0].unreadCount, 1);
  assert.ok(
    changeLog.some((batch) =>
      batch.some((change) => change.scope === 'inbox' && change.event?.type === 'THREAD_MESSAGE_RECEIVED')
    ),
    'expected inbox sync change for message received'
  );

  controller.markThreadRead('thr-1', { userId: 'usr_self', lastReadMsgId: 'msg-2' });
  assert.equal(controller.getTotalUnread(), 0);
});

test('optimistic send flows update thread without increasing unread', () => {
  const controller = createMessagingController({
    viewerUserId: 'usr_self',
    inbox: {
      threads: [
        {
          threadId: 'thr-1',
          kind: 'PROJECT',
          lastMessageAt: '2025-01-01T00:00:00Z'
        }
      ]
    },
    threads: [
      {
        thread: { threadId: 'thr-1', kind: 'PROJECT', lastMessageAt: '2025-01-01T00:00:00Z' },
        messages: [],
        participants: [{ userId: 'usr_self', role: 'buyer' }]
      }
    ],
    now: () => Date.parse('2025-01-01T00:00:20Z')
  });

  controller.enqueueOptimisticMessage('thr-1', {
    clientId: 'client-1',
    authorUserId: 'usr_self',
    body: 'optimistic hello',
    type: 'TEXT'
  });

  assert.equal(controller.getTotalUnread(), 0);
  let threadState = controller.getThreadState('thr-1');
  const tempId = threadState.messageOrder.at(-1);
  assert.ok(tempId.startsWith('temp:'), 'expected temporary optimistic message id');

  controller.resolveOptimisticMessage('thr-1', 'client-1', {
    messageId: 'msg-optimistic',
    createdAt: '2025-01-01T00:00:25Z',
    authorUserId: 'usr_self',
    type: 'TEXT',
    body: 'server ack'
  });
  threadState = controller.getThreadState('thr-1');
  assert.ok(threadState.messagesById['msg-optimistic'], 'expected resolved message to persist');
});

test('notification queue respects quiet hours and digest collection', () => {
  const controller = createMessagingController({
    notifications: {
      quietHours: { start: '22:00', end: '06:00', timezoneOffsetMinutes: 0 },
      dedupeWindowMs: 60_000
    },
    now: () => Date.parse('2025-01-01T02:00:00Z')
  });

  controller.enqueueNotification(
    { threadId: 'thr-1', type: 'MESSAGE', message: 'late night ping' },
    { now: Date.parse('2025-01-01T02:00:00Z') }
  );

  const pending = controller.listPendingNotifications();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].deferred, true);

  const digest = controller.collectNotificationDigest({ now: Date.parse('2025-01-01T12:30:00Z') });
  assert.equal(digest.length, 1);
  assert.equal(digest[0].count, 1);

  const flushed = controller.flushNotifications({ now: Date.parse('2025-01-01T07:05:00Z') });
  assert.equal(flushed.length, 1);
  assert.equal(flushed[0].message, 'late night ping');
});

test('accepting a message request moves it into the inbox and deducts credits', () => {
  const controller = createMessagingController({
    inbox: {
      threads: [],
      requests: [
        {
          requestId: 'req-1',
          threadId: 'thr-req',
          creditCost: 2,
          expiresAt: '2025-01-02T00:00:00Z',
          createdAt: '2025-01-01T00:00:00Z'
        }
      ],
      credits: {
        available: 5,
        costPerRequest: 2,
        floor: 0
      }
    },
    now: () => Date.parse('2025-01-01T01:00:00Z')
  });

  controller.acceptMessageRequest('req-1', { now: Date.parse('2025-01-01T01:15:00Z') });

  const threads = controller.selectInboxThreads({ folder: 'default' });
  assert.equal(threads.length, 1);
  assert.equal(threads[0].threadId, 'thr-req');
  assert.equal(controller.getSnapshot().inbox.requestOrder.length, 0, 'request should be removed');
  assert.equal(controller.getSnapshot().inbox.credits.available, 3);
});

test('action card intents update thread state and trigger analytics callback', () => {
  const analyticsEvents = [];
  const controller = createMessagingController({
    viewerUserId: 'usr_self',
    inbox: {
      threads: [
        {
          threadId: 'thr-1',
          kind: 'PROJECT',
          lastMessageAt: '2025-01-01T00:00:00Z'
        }
      ]
    },
    threads: [
      {
        thread: { threadId: 'thr-1', kind: 'PROJECT', lastMessageAt: '2025-01-01T00:00:00Z' },
        actionCards: [
          {
            actionId: 'card-1',
            type: 'REQUEST_EXTRA',
            state: 'PENDING',
            version: 1,
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:00:00Z',
            payload: { name: 'Additional hours', priceCents: 7500 }
          }
        ]
      }
    ],
    onAnalyticsEvent: (event) => analyticsEvents.push(event),
    now: () => Date.parse('2025-01-01T02:00:00Z')
  });

  const { state: updatedThread, auditEvent } = controller.applyActionCardIntent('thr-1', 'card-1', 'approve', {
    actorUserId: 'usr_self',
    metadata: { source: 'unit-test' }
  });

  assert.equal(updatedThread.actionCardsById['card-1'].state, 'PAID');
  assert.ok(auditEvent);
  assert.equal(analyticsEvents.length, 1);
  assert.equal(analyticsEvents[0].type, 'messaging.action_card.intent');
});
