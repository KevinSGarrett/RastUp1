import test from 'node:test';
import assert from 'node:assert/strict';
import { createMessagingController } from '../../../tools/frontend/messaging/controller.mjs';
import { createMessagingReactBindings } from '../../../tools/frontend/messaging/react_bindings.mjs';

function createFakeReact() {
  const effects = [];
  const stores = [];

  function createContext(defaultValue) {
    const context = { value: defaultValue };
    context.Provider = ({ value, children }) => {
      context.value = value;
      return Array.isArray(children) ? children[0] ?? null : children ?? null;
    };
    return context;
  }

  function useContext(context) {
    return context.value;
  }

  function useMemo(factory) {
    return factory();
  }

  function useRef(initialValue) {
    return { current: initialValue };
  }

  function useEffect(effect) {
    const cleanup = effect();
    if (typeof cleanup === 'function') {
      effects.push(cleanup);
    }
  }

  function useState(initial) {
    let state = typeof initial === 'function' ? initial() : initial;
    const setState = (nextValue) => {
      state = typeof nextValue === 'function' ? nextValue(state) : nextValue;
    };
    return [state, setState];
  }

  function useSyncExternalStore(subscribe, getSnapshot) {
    const store = { value: getSnapshot() };
    stores.push(store);
    const unsubscribe = subscribe(() => {
      store.value = getSnapshot();
    });
    effects.push(() => {
      unsubscribe?.();
    });
    return store.value;
  }

  function createElement(type, props, ...children) {
    if (typeof type === 'function') {
      return type({ ...(props ?? {}), children: children.length <= 1 ? children[0] ?? null : children });
    }
    return { type, props, children };
  }

  return {
    createContext,
    useContext,
    useMemo,
    useRef,
    useEffect,
    useLayoutEffect: useEffect,
    useState,
    useSyncExternalStore,
    createElement,
    stores,
    flushEffects() {
      while (effects.length) {
        const cleanup = effects.pop();
        try {
          cleanup();
        } catch {
          // ignore cleanup errors for the fake runtime
        }
      }
    }
  };
}

test('MessagingProvider wires client lifecycle and exposes actions', async () => {
  const fakeReact = createFakeReact();
  const lifecycleLog = [];

  const controller = createMessagingController({
    viewerUserId: 'usr_self',
    inbox: { threads: [] },
    threads: []
  });

  const client = {
    startInboxSubscription() {
      lifecycleLog.push('startInbox');
      return () => lifecycleLog.push('stopInbox');
    },
    refreshInbox() {
      lifecycleLog.push('refreshInbox');
      return Promise.resolve();
    },
    startThreadSubscription(threadId) {
      lifecycleLog.push(`startThread:${threadId}`);
      return () => lifecycleLog.push(`stopThread:${threadId}`);
    },
    stopThreadSubscription(threadId) {
      lifecycleLog.push(`stopThreadViaClient:${threadId}`);
    },
    hydrateThread: async () => lifecycleLog.push('hydrateThread'),
    sendMessage: async () => lifecycleLog.push('sendMessage'),
    markThreadRead: async () => lifecycleLog.push('markThreadRead'),
    acceptMessageRequest: async () => lifecycleLog.push('acceptRequest'),
    declineMessageRequest: async () => lifecycleLog.push('declineRequest'),
    pinThread: async () => lifecycleLog.push('pinThread'),
    unpinThread: async () => lifecycleLog.push('unpinThread'),
    archiveThread: async () => lifecycleLog.push('archiveThread'),
    unarchiveThread: async () => lifecycleLog.push('unarchiveThread'),
    muteThread: async () => lifecycleLog.push('muteThread'),
    unmuteThread: async () => lifecycleLog.push('unmuteThread'),
    recordConversationStart: async () => lifecycleLog.push('recordConversationStart'),
    reportMessage: async () => lifecycleLog.push('reportMessage'),
    reportThread: async () => lifecycleLog.push('reportThread'),
      submitModerationDecision: async () => lifecycleLog.push('submitModerationDecision'),
    resolveModerationQueueCase: async () => lifecycleLog.push('resolveModerationQueueCase'),
    removeModerationQueueCase: async () => lifecycleLog.push('removeModerationQueueCase'),
    hydrateModerationQueue: async () => lifecycleLog.push('hydrateModerationQueue'),
    dispose() {
      lifecycleLog.push('dispose');
    }
  };

  const { MessagingProvider, useMessagingActions, useMessagingController } = createMessagingReactBindings({
    react: fakeReact
  });

  MessagingProvider({
    controller,
    client,
    viewerUserId: 'usr_self',
    autoStartInbox: true,
    autoRefreshInbox: true,
    autoSubscribeThreadIds: ['thr-123'],
    children: null
  });

  assert.deepEqual(lifecycleLog.slice(0, 3), ['startInbox', 'refreshInbox', 'startThread:thr-123']);

  const actions = useMessagingActions();
  await actions.sendMessage('thr-1', {});
  await actions.markThreadRead('thr-1');
  await actions.acceptMessageRequest('req-1');
  await actions.declineMessageRequest('req-2');
  await actions.pinThread('thr-toggle');
  await actions.unpinThread('thr-toggle');
  await actions.archiveThread('thr-toggle');
  await actions.unarchiveThread('thr-toggle');
  await actions.muteThread('thr-toggle');
  await actions.unmuteThread('thr-toggle');
  await actions.recordConversationStart();
  await actions.hydrateThread('thr-1');
  await actions.hydrateModerationQueue();
  await actions.reportMessage('thr-1', 'msg-1', { reason: 'SPAM' });
  await actions.reportThread('thr-1', { reason: 'ABUSE' });
    await actions.submitModerationDecision('case-1', { decision: 'APPROVE' });
  await actions.resolveModerationQueueCase('case-1', { outcome: 'CLEARED' });
  await actions.removeModerationQueueCase('case-1');
  const notificationStateResult = actions.enqueueNotification({
    key: 'test:notification',
    message: 'New inbox activity'
  });
  assert.ok(notificationStateResult, 'enqueueNotification should return notification state');
  const pendingBeforeFlush = actions.listPendingNotifications();
  assert.ok(Array.isArray(pendingBeforeFlush), 'listPendingNotifications should return an array');
  assert.equal(pendingBeforeFlush.length, 1);
  const flushed = actions.flushNotifications();
  assert.ok(Array.isArray(flushed), 'flushNotifications should return an array');
  assert.equal(flushed.length, 1);
  const pendingAfterFlush = actions.listPendingNotifications();
  assert.equal(pendingAfterFlush.length, 0, 'listPendingNotifications should be empty after flush');
  const digests = actions.collectNotificationDigest();
  assert.ok(Array.isArray(digests), 'collectNotificationDigest should return an array');

  const wiringController = useMessagingController();
  assert.ok(wiringController === controller, 'Expected controller from context');

  assert.ok(lifecycleLog.includes('reportMessage'), 'expected reportMessage action to call client');
  assert.ok(lifecycleLog.includes('reportThread'), 'expected reportThread action to call client');
  assert.ok(
    lifecycleLog.includes('submitModerationDecision'),
    'expected submit decision action to call client'
  );
  assert.ok(lifecycleLog.includes('resolveModerationQueueCase'), 'expected resolve case action to call client');
  assert.ok(lifecycleLog.includes('removeModerationQueueCase'), 'expected remove case action to call client');
  assert.ok(lifecycleLog.includes('hydrateModerationQueue'), 'expected hydrate queue action to call client');

  fakeReact.flushEffects();

  assert.ok(lifecycleLog.includes('stopThread:thr-123'), 'expected thread subscription cleanup');
  assert.ok(lifecycleLog.includes('stopInbox'), 'expected inbox subscription cleanup');
  assert.ok(lifecycleLog.includes('dispose'), 'expected dispose during cleanup');
});

test('hooks surface inbox threads, summary, and thread state updates', () => {
  const fakeReact = createFakeReact();

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
          { userId: 'usr_self', role: 'buyer', lastReadMsgId: 'msg-1', lastReadAt: '2025-01-01T00:00:05Z' },
          { userId: 'usr_other', role: 'seller' }
        ]
      }
    ]
  });

  const clientStub = {
    startInboxSubscription: () => () => {},
    refreshInbox: () => Promise.resolve(),
    startThreadSubscription: () => () => {},
    dispose: () => {}
  };

  const {
    MessagingProvider,
    useInboxThreads,
    useInboxSummary,
    useThread,
    useModerationQueue
  } = createMessagingReactBindings({
    react: fakeReact
  });

  MessagingProvider({
    controller,
    client: clientStub,
    autoStartInbox: false,
    autoRefreshInbox: false,
    children: null
  });

  const inboxThreads = useInboxThreads({ folder: 'default' });
  assert.equal(Array.isArray(inboxThreads), true);
  assert.equal(inboxThreads.length, 1);
  assert.equal(inboxThreads[0].threadId, 'thr-1');

  const summary = useInboxSummary();
  assert.equal(summary.totalUnread, 0);
  const moderationQueue = useModerationQueue();
  assert.ok(moderationQueue, 'expected moderation queue state');

  const threadState = useThread('thr-1');
  assert.ok(threadState.messagesById['msg-1'], 'expected existing message');

  controller.applyThreadEvent('thr-1', {
    type: 'MESSAGE_CREATED',
    payload: {
      messageId: 'msg-2',
      createdAt: '2025-01-01T00:00:10Z',
      authorUserId: 'usr_other',
      type: 'TEXT',
      body: 'follow up'
    }
  });

  const inboxStore = fakeReact.stores.find((store) => Array.isArray(store.value));
  const summaryStore = fakeReact.stores.find((store) => store.value && typeof store.value.totalUnread === 'number');
  const threadStore = fakeReact.stores.find(
    (store) => store.value && store.value.messagesById && store.value.thread?.threadId === 'thr-1'
  );

  const controllerThreads = controller.selectInboxThreads({ folder: 'default' });
  assert.equal(controller.getTotalUnread(), 1, 'controller should reflect unread increment');
  assert.equal(controllerThreads[0].unreadCount, 1, 'controller thread unread should match');

  assert.ok(inboxStore, 'expected inbox store to exist');
  assert.ok(summaryStore, 'expected summary store to exist');
  assert.ok(threadStore, 'expected thread store to exist');
  assert.equal(inboxStore.value[0].unreadCount, 1, 'expected inbox unread to increment');
  assert.equal(summaryStore.value.totalUnread, 1, 'expected summary unread to match');
  assert.ok(threadStore.value.messagesById['msg-2'], 'expected new message in thread state');
});
