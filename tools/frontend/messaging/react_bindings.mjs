import { createMessagingController } from './controller.mjs';
import { createMessagingClient } from './client.mjs';

const noop = () => {};

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function createMatcher(scopes, threadId = null) {
  const targets = scopes === '*' ? null : toArray(scopes);
  const isThreadScoped = threadId !== null && threadId !== undefined;
  return (changes) => {
    if (!Array.isArray(changes) || changes.length === 0) {
      return false;
    }
    for (const change of changes) {
      if (!change || typeof change !== 'object') {
        continue;
      }
      if (targets && !targets.includes(change.scope)) {
        continue;
      }
      if (isThreadScoped && change.threadId && change.threadId !== threadId) {
        continue;
      }
      return true;
    }
    return false;
  };
}

export function createMessagingReactBindings(options = {}) {
  const react = options.react;
  if (!react) {
    throw new Error('createMessagingReactBindings requires options.react (a React-compatible module)');
  }

  const {
    createContext,
    createElement,
    useContext,
    useMemo = (fn) => fn(),
    useEffect = react.useEffect ?? react.useLayoutEffect ?? noop,
    useRef = react.useRef ?? (() => ({ current: null })),
    useSyncExternalStore = react.useSyncExternalStore ?? null,
    useState = react.useState ?? null
  } = react;

  if (typeof createContext !== 'function' || typeof createElement !== 'function' || typeof useContext !== 'function') {
    throw new Error('Provided React module is missing createContext, createElement, or useContext');
  }

  if (!useSyncExternalStore && !useState) {
    throw new Error('React module must expose useSyncExternalStore or useState for messaging hooks');
  }

  const MessagingContext = createContext(null);

  function useControllerStore(controller, matcher, snapshotFactory) {
    if (!controller || typeof controller.subscribe !== 'function') {
      throw new Error('Messaging controller not available in context');
    }
    const matcherRef = useRef(matcher);
    const snapshotRef = useRef(snapshotFactory);

    matcherRef.current = matcher;
    snapshotRef.current = snapshotFactory;

    const subscribe = (listener) =>
      controller.subscribe((changes) => {
        try {
          if (matcherRef.current(changes)) {
            listener();
          }
        } catch (error) {
          listener();
          throw error;
        }
      }) ?? noop;

    const getSnapshot = () => snapshotRef.current(controller);

    if (useSyncExternalStore) {
      return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    }

    const [state, setState] = useState(getSnapshot());
    useEffect(() => {
      const unsubscribe = subscribe(() => {
        setState(getSnapshot());
      });
      return () => {
        try {
          unsubscribe();
        } catch {
          // ignore cleanup errors
        }
      };
    }, [controller]);
    return state;
  }

  function useMessagingContextInternal() {
    const ctx = useContext(MessagingContext);
    if (!ctx) {
      throw new Error('useMessaging must be used within a MessagingProvider');
    }
    return ctx;
  }

  function MessagingProvider(props = {}) {
    const {
      children = null,
      controller: controllerProp = null,
      controllerOptions = {},
      client: clientProp = null,
      clientConfig = {},
      viewerUserId = null,
      autoStartInbox = true,
      autoRefreshInbox = true,
      autoSubscribeThreadIds = [],
      onClientError = null
    } = props;

    const controllerRef = useRef(null);
    if (!controllerRef.current) {
      const initialOptions = {
        ...controllerOptions,
        viewerUserId,
        inbox: controllerOptions.inbox ?? clientConfig.initialInbox,
        threads: controllerOptions.threads ?? clientConfig.initialThreads,
        notifications: controllerOptions.notifications ?? clientConfig.initialNotifications
      };
      controllerRef.current =
        controllerProp ?? options.createController?.(initialOptions) ?? createMessagingController(initialOptions);
    }
    const controller = controllerRef.current;

    if (
      viewerUserId !== null &&
      viewerUserId !== undefined &&
      typeof controller.setViewerUserId === 'function'
    ) {
      controller.setViewerUserId(viewerUserId);
    }

    const clientRef = useRef(null);
    if (!clientRef.current) {
      if (clientProp) {
        clientRef.current = clientProp;
      } else {
        const factory = options.createClient ?? createMessagingClient;
        clientRef.current = factory({
          controller,
          ...clientConfig
        });
      }
    }
    const client = clientRef.current;

    useEffect(() => {
      if (!autoStartInbox || typeof client.startInboxSubscription !== 'function') {
        return undefined;
      }
      let unsubscribe = noop;
      try {
        const result = client.startInboxSubscription();
        if (typeof result === 'function') {
          unsubscribe = result;
        }
      } catch (error) {
        onClientError?.(error, { stage: 'startInboxSubscription' });
      }
      return () => {
        try {
          unsubscribe();
        } catch (error) {
          onClientError?.(error, { stage: 'stopInboxSubscription' });
        }
      };
    }, [client, autoStartInbox]);

    useEffect(() => {
      if (!autoRefreshInbox || typeof client.refreshInbox !== 'function') {
        return undefined;
      }
      let cancelled = false;
      client.refreshInbox().catch((error) => {
        if (!cancelled) {
          onClientError?.(error, { stage: 'refreshInbox' });
        }
      });
      return () => {
        cancelled = true;
      };
    }, [client, autoRefreshInbox]);

    useEffect(() => {
      if (!autoSubscribeThreadIds || typeof client.startThreadSubscription !== 'function') {
        return undefined;
      }
      const cleanups = [];
      for (const threadId of toArray(autoSubscribeThreadIds)) {
        if (!threadId) continue;
        try {
          const cleanup = client.startThreadSubscription(threadId);
          if (typeof cleanup === 'function') {
            cleanups.push(cleanup);
          }
        } catch (error) {
          onClientError?.(error, { stage: 'startThreadSubscription', threadId });
        }
      }
      return () => {
        for (const cleanup of cleanups.reverse()) {
          try {
            cleanup();
          } catch (error) {
            onClientError?.(error, { stage: 'stopThreadSubscription' });
          }
        }
      };
    }, [client, autoSubscribeThreadIds]);

    useEffect(() => {
      return () => {
        try {
          client.dispose?.();
        } catch (error) {
          onClientError?.(error, { stage: 'dispose' });
        }
      };
    }, [client]);

    const contextValue = useMemo(() => {
      const safeBind = (method, fallbackMessage) => {
        if (typeof method === 'function') {
          return method.bind(client);
        }
        return () => {
          throw new Error(fallbackMessage);
        };
        };
        const controllerBind = (method, fallback) =>
          typeof method === 'function' ? method.bind(controller) : fallback;

        return {
          controller,
          client,
          refreshInbox: safeBind(client.refreshInbox, 'Messaging client missing refreshInbox'),
          hydrateThread: safeBind(client.hydrateThread, 'Messaging client missing hydrateThread'),
          startThreadSubscription: safeBind(
            client.startThreadSubscription,
            'Messaging client missing startThreadSubscription'
          ),
          stopThreadSubscription: typeof client.stopThreadSubscription === 'function'
            ? client.stopThreadSubscription.bind(client)
            : noop,
          sendMessage: safeBind(client.sendMessage, 'Messaging client missing sendMessage'),
          markThreadRead: safeBind(client.markThreadRead, 'Messaging client missing markThreadRead'),
          acceptMessageRequest: safeBind(
            client.acceptMessageRequest,
            'Messaging client missing acceptMessageRequest'
          ),
          declineMessageRequest: safeBind(
            client.declineMessageRequest,
            'Messaging client missing declineMessageRequest'
          ),
            pinThread: safeBind(client.pinThread, 'Messaging client missing pinThread'),
            unpinThread: safeBind(client.unpinThread, 'Messaging client missing unpinThread'),
            archiveThread: safeBind(client.archiveThread, 'Messaging client missing archiveThread'),
            unarchiveThread: safeBind(client.unarchiveThread, 'Messaging client missing unarchiveThread'),
            muteThread: safeBind(client.muteThread, 'Messaging client missing muteThread'),
            unmuteThread: safeBind(client.unmuteThread, 'Messaging client missing unmuteThread'),
            lockThread: safeBind(client.lockThread, 'Messaging client missing lockThread'),
            unlockThread: safeBind(client.unlockThread, 'Messaging client missing unlockThread'),
            blockThread: safeBind(client.blockThread, 'Messaging client missing blockThread'),
            unblockThread: safeBind(client.unblockThread, 'Messaging client missing unblockThread'),
            reportMessage: safeBind(client.reportMessage, 'Messaging client missing reportMessage'),
            reportThread: safeBind(client.reportThread, 'Messaging client missing reportThread'),
            hydrateModerationQueue: safeBind(
              client.hydrateModerationQueue,
              'Messaging client missing hydrateModerationQueue'
            ),
            updateModerationQueueCase: safeBind(
              client.updateModerationQueueCase,
              'Messaging client missing updateModerationQueueCase'
            ),
            submitModerationDecision: safeBind(
              client.submitModerationDecision,
              'Messaging client missing submitModerationDecision'
            ),
            resolveModerationQueueCase: safeBind(
              client.resolveModerationQueueCase,
              'Messaging client missing resolveModerationQueueCase'
            ),
            removeModerationQueueCase: safeBind(
              client.removeModerationQueueCase,
              'Messaging client missing removeModerationQueueCase'
            ),
          recordConversationStart:
            typeof client.recordConversationStart === 'function'
              ? client.recordConversationStart.bind(client)
              : async () => {},
          prepareUpload: safeBind(client.prepareUpload, 'Messaging client missing prepareUpload'),
          getUploadState: controllerBind(controller.getUploadState, () => null),
          getUpload: controllerBind(controller.getUpload, () => null),
          listUploads: controllerBind(controller.listUploads, () => []),
          cancelUpload: controllerBind(controller.cancelUpload, () => {}),
          applyAttachmentStatus: controllerBind(controller.applyAttachmentStatus, () => {}),
          markUploadFailed: controllerBind(controller.markUploadFailed, () => {}),
          enqueueNotification: controllerBind(controller.enqueueNotification, () => {}),
          flushNotifications: controllerBind(controller.flushNotifications, () => []),
          collectNotificationDigest: controllerBind(controller.collectNotificationDigest, () => []),
            listPendingNotifications: controllerBind(controller.listPendingNotifications, () => []),
            getModerationQueueState: controllerBind(controller.getModerationQueueState, () => null),
            getModerationStats: controllerBind(controller.getModerationStats, () => ({
              pending: 0,
              dualApproval: 0,
              awaitingSecond: 0,
              resolved: 0
            })),
            listModerationCases: controllerBind(controller.listModerationCases, () => []),
            listPendingModerationCases: controllerBind(controller.listPendingModerationCases, () => []),
            getModerationCase: controllerBind(controller.getModerationCase, () => null)
      };
    }, [controller, client]);

    return createElement(MessagingContext.Provider, { value: contextValue }, children);
  }

  function useMessaging() {
    return useMessagingContextInternal();
  }

  function useMessagingController() {
    return useMessaging().controller;
  }

  function useMessagingClient() {
    return useMessaging().client;
  }

  function useInboxThreads(options = {}) {
    const { controller } = useMessaging();
    const selector = typeof options === 'function' ? options : (ctrl) => ctrl.selectInboxThreads(options);
    const matcher = useMemo(() => createMatcher(['inbox', 'thread']), []);
    const snapshotFactory = useMemo(() => (ctrl) => selector(ctrl), [selector]);
    return useControllerStore(controller, matcher, snapshotFactory);
  }

  function useInboxSummary() {
    const { controller } = useMessaging();
    const matcher = useMemo(() => createMatcher(['inbox']), []);
    const snapshotFactory = useMemo(
      () => (ctrl) => ({
        totalUnread: ctrl.getTotalUnread(),
        canStartConversation: ctrl.canStartConversation()
      }),
      []
    );
    return useControllerStore(controller, matcher, snapshotFactory);
  }

    function useThread(threadId) {
      if (!threadId) {
        throw new Error('useThread requires threadId');
      }
      const { controller } = useMessaging();
      const matcher = useMemo(() => createMatcher(['thread'], threadId), [threadId]);
      const snapshotFactory = useMemo(() => (ctrl) => ctrl.getThreadState(threadId), [threadId]);
      return useControllerStore(controller, matcher, snapshotFactory);
    }

    function useUploads() {
      const { controller } = useMessaging();
      const matcher = useMemo(() => createMatcher(['uploads']), []);
      const snapshotFactory = useMemo(
        () =>
          (ctrl) =>
            typeof ctrl.getUploadState === 'function' ? ctrl.getUploadState() : null,
        []
      );
      return useControllerStore(controller, matcher, snapshotFactory);
    }

    function useModerationQueue(selector) {
      const { controller } = useMessaging();
      const matcher = useMemo(() => createMatcher(['moderationQueue']), []);
      const snapshotFactory = useMemo(() => {
        if (typeof selector === 'function') {
          return (ctrl) =>
            selector(
              typeof ctrl.getModerationQueueState === 'function' ? ctrl.getModerationQueueState() : null,
              ctrl
            );
        }
        return (ctrl) =>
          typeof ctrl.getModerationQueueState === 'function' ? ctrl.getModerationQueueState() : null;
      }, [selector]);
      return useControllerStore(controller, matcher, snapshotFactory);
    }

    function useNotifications() {
    const { controller } = useMessaging();
    const matcher = useMemo(() => createMatcher(['notifications']), []);
    const snapshotFactory = useMemo(() => (ctrl) => ctrl.getNotificationState(), []);
    return useControllerStore(controller, matcher, snapshotFactory);
  }

  function useMessagingActions() {
    const {
      sendMessage,
      markThreadRead,
      refreshInbox,
      acceptMessageRequest,
      declineMessageRequest,
        pinThread,
      unpinThread,
      archiveThread,
      unarchiveThread,
      muteThread,
      unmuteThread,
        lockThread,
        unlockThread,
        blockThread,
        unblockThread,
        reportMessage,
        reportThread,
        hydrateModerationQueue,
        updateModerationQueueCase,
          submitModerationDecision,
        resolveModerationQueueCase,
        removeModerationQueueCase,
      recordConversationStart,
      startThreadSubscription,
      stopThreadSubscription,
      hydrateThread,
      prepareUpload,
      cancelUpload,
      applyAttachmentStatus,
      markUploadFailed,
      enqueueNotification,
      flushNotifications,
      collectNotificationDigest,
      listPendingNotifications
    } = useMessaging();
    return {
      sendMessage,
      markThreadRead,
      refreshInbox,
      acceptMessageRequest,
      declineMessageRequest,
      pinThread,
      unpinThread,
      archiveThread,
      unarchiveThread,
      muteThread,
      unmuteThread,
        lockThread,
        unlockThread,
        blockThread,
        unblockThread,
        reportMessage,
        reportThread,
        hydrateModerationQueue,
        updateModerationQueueCase,
        submitModerationDecision,
        resolveModerationQueueCase,
        removeModerationQueueCase,
      recordConversationStart,
      startThreadSubscription,
      stopThreadSubscription,
      hydrateThread,
      prepareUpload,
      cancelUpload,
      applyAttachmentStatus,
      markUploadFailed,
      enqueueNotification,
      flushNotifications,
      collectNotificationDigest,
      listPendingNotifications
    };
  }

  return {
    MessagingProvider,
    MessagingContext,
    useMessaging,
    useMessagingController,
    useMessagingClient,
    useMessagingActions,
    useInboxThreads,
      useInboxSummary,
      useThread,
      useUploads,
      useModerationQueue,
      useNotifications
  };
}
