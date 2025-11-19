import { createMessagingController } from './controller.mjs';
import { createMessagingClient } from './client.mjs';

function isFunction(value) {
  return typeof value === 'function';
}

function deepClone(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => deepClone(entry));
  }
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  if (value instanceof Set) {
    return new Set(Array.from(value, (entry) => deepClone(entry)));
  }
  const clone = {};
  for (const [key, entry] of Object.entries(value)) {
    clone[key] = deepClone(entry);
  }
  return clone;
}

function toArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

function removeUndefinedEntries(object) {
  if (!object || typeof object !== 'object') {
    return object;
  }
  for (const key of Object.keys(object)) {
    if (object[key] === undefined) {
      delete object[key];
    }
  }
  return object;
}

function normalizeThreadIds(input) {
  return toArray(input)
    .filter((value) => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim());
}

/**
 * Builds a Next.js-friendly adapter around the messaging controller/client pair.
 * Returns helpers for server-side prefetch, runtime instantiation, and provider wiring.
 * @param {{
 *   fetchInbox?: (args?: any) => Promise<any>;
 *   fetchThread?: (threadId: string, args?: any) => Promise<any>;
 *   subscribeInbox?: (handlers: { next: Function; error?: Function; complete?: Function }) => () => void;
 *   subscribeThread?: (threadId: string, handlers: { next: Function; error?: Function; complete?: Function }) => () => void;
 *   mutations?: Record<string, Function>;
 *   logger?: { debug?: Function; warn?: Function; error?: Function };
 *   now?: () => number;
 * }} config
 */
export function createMessagingNextAdapter(config = {}) {
  const baseConfig = {
    fetchInbox: config.fetchInbox,
    fetchThread: config.fetchThread,
    subscribeInbox: config.subscribeInbox,
    subscribeThread: config.subscribeThread,
    mutations: config.mutations ?? {},
    logger: config.logger,
    now: config.now
  };

  function buildClient(controller, overrides = {}) {
    const fetchInbox = overrides.fetchInbox ?? baseConfig.fetchInbox;
    const fetchThread = overrides.fetchThread ?? baseConfig.fetchThread;
    const subscribeInbox = overrides.subscribeInbox ?? baseConfig.subscribeInbox;
    const subscribeThread = overrides.subscribeThread ?? baseConfig.subscribeThread;
    const logger = overrides.logger ?? baseConfig.logger;
    const now = overrides.now ?? baseConfig.now;
    const mergedMutations = {
      ...(baseConfig.mutations ?? {}),
      ...(overrides.mutations ?? {})
    };

    return createMessagingClient(
      removeUndefinedEntries({
        controller,
        fetchInbox,
        fetchThread,
        subscribeInbox,
        subscribeThread,
        mutations: mergedMutations,
        logger,
        now
      })
    );
  }

  /**
   * Prefetches inbox and thread payloads on the server for initial render.
   * @param {{
   *   viewerUserId?: string|null;
   *   includeInbox?: boolean;
   *   threadIds?: string|string[];
   *   inboxArgs?: Record<string, any>;
   *   threadArgs?: Record<string, any>;
   *   initialNotifications?: Record<string, any>;
   *   clientOverrides?: Parameters<typeof buildClient>[1];
   *   failFast?: boolean;
   * }} options
   */
  async function prefetch(options = {}) {
    const viewerUserId = options.viewerUserId ?? null;
    const includeInbox = options.includeInbox !== false;
    const threadIds = normalizeThreadIds(options.threadIds);
    const failFast = options.failFast ?? false;
    const clientOverrides = options.clientOverrides ?? {};

    const result = {
      viewerUserId,
      initialInbox: null,
      initialThreads: [],
      initialNotifications: options.initialNotifications ? deepClone(options.initialNotifications) : null,
      hydratedThreadIds: [],
      errors: []
    };

    const controller = createMessagingController({ viewerUserId });

    let client;
    try {
      client = buildClient(controller, clientOverrides);
    } catch (error) {
      if (failFast) throw error;
      result.errors.push({
        scope: 'client',
        message: error?.message ?? 'Failed to instantiate messaging client'
      });
      return result;
    }

    if (includeInbox) {
      const fetchInboxFn = clientOverrides.fetchInbox ?? baseConfig.fetchInbox;
      if (!isFunction(fetchInboxFn)) {
        const message = 'fetchInbox is not configured for messaging adapter';
        if (failFast) throw new Error(message);
        result.errors.push({ scope: 'inbox', message });
      } else {
        try {
          const normalizedInbox = await client.refreshInbox(options.inboxArgs);
          result.initialInbox = deepClone(normalizedInbox);
        } catch (error) {
          if (failFast) throw error;
          result.errors.push({
            scope: 'inbox',
            message: error?.message ?? 'Failed to refresh inbox'
          });
        }
      }
    }

    const fetchThreadFn = clientOverrides.fetchThread ?? baseConfig.fetchThread;
    for (const threadId of threadIds) {
      if (!isFunction(fetchThreadFn)) {
        const message = 'fetchThread is not configured for messaging adapter';
        if (failFast) throw new Error(message);
        result.errors.push({ scope: 'thread', threadId, message });
        continue;
      }
      try {
        const normalizedThread = await client.hydrateThread(threadId, {
          ...(options.threadArgs ?? {}),
          subscribe: false,
          syncInbox: includeInbox
        });
        result.initialThreads.push(deepClone(normalizedThread));
        result.hydratedThreadIds.push(threadId);
      } catch (error) {
        if (failFast) throw error;
        result.errors.push({
          scope: 'thread',
          threadId,
          message: error?.message ?? 'Failed to hydrate thread'
        });
      }
    }

    try {
      client.dispose?.();
    } catch (error) {
      if (failFast) throw error;
      result.errors.push({
        scope: 'client',
        message: error?.message ?? 'Failed to dispose messaging client'
      });
    }

    return result;
  }

  /**
   * Builds props for `<MessagingProvider>` given prefetch output and optional overrides.
   * @param {Awaited<ReturnType<typeof prefetch>>} initialData
   * @param {{
   *   viewerUserId?: string|null;
   *   controllerOptions?: Record<string, any>;
   *   clientConfig?: Record<string, any>;
   *   clientOverrides?: Parameters<typeof buildClient>[1];
   *   autoStartInbox?: boolean;
   *   autoRefreshInbox?: boolean;
   *   autoSubscribeThreadIds?: string[];
   *   onClientError?: Function;
   * }} overrides
   */
  function createProviderProps(initialData = {}, overrides = {}) {
    const viewerUserId = overrides.viewerUserId ?? initialData.viewerUserId ?? null;
    const controllerOptions = { ...(overrides.controllerOptions ?? {}) };
    const clientConfig = { ...(overrides.clientConfig ?? {}) };
    const clientOverrides = overrides.clientOverrides ?? {};

    if (clientConfig.initialInbox === undefined && initialData.initialInbox) {
      clientConfig.initialInbox = deepClone(initialData.initialInbox);
    }
    if (clientConfig.initialThreads === undefined && initialData.initialThreads) {
      clientConfig.initialThreads = deepClone(initialData.initialThreads);
    }
    if (clientConfig.initialNotifications === undefined && initialData.initialNotifications) {
      clientConfig.initialNotifications = deepClone(initialData.initialNotifications);
    }

    const fetchInbox = clientOverrides.fetchInbox ?? baseConfig.fetchInbox;
    if (clientConfig.fetchInbox === undefined && isFunction(fetchInbox)) {
      clientConfig.fetchInbox = fetchInbox;
    }

    const fetchThread = clientOverrides.fetchThread ?? baseConfig.fetchThread;
    if (clientConfig.fetchThread === undefined && isFunction(fetchThread)) {
      clientConfig.fetchThread = fetchThread;
    }

    const subscribeInbox = clientOverrides.subscribeInbox ?? baseConfig.subscribeInbox;
    if (clientConfig.subscribeInbox === undefined && isFunction(subscribeInbox)) {
      clientConfig.subscribeInbox = subscribeInbox;
    }

    const subscribeThread = clientOverrides.subscribeThread ?? baseConfig.subscribeThread;
    if (clientConfig.subscribeThread === undefined && isFunction(subscribeThread)) {
      clientConfig.subscribeThread = subscribeThread;
    }

    const mergedMutations = {
      ...(baseConfig.mutations ?? {}),
      ...(clientOverrides.mutations ?? {}),
      ...(clientConfig.mutations ?? {})
    };
    clientConfig.mutations = mergedMutations;

    if (clientConfig.logger === undefined && (clientOverrides.logger ?? baseConfig.logger)) {
      clientConfig.logger = clientOverrides.logger ?? baseConfig.logger;
    }

    if (clientConfig.now === undefined && (clientOverrides.now ?? baseConfig.now)) {
      clientConfig.now = clientOverrides.now ?? baseConfig.now;
    }

    const autoSubscribeThreadIds =
      overrides.autoSubscribeThreadIds ?? (initialData.hydratedThreadIds?.length ? [...initialData.hydratedThreadIds] : undefined);

    const providerProps = removeUndefinedEntries({
      viewerUserId,
      controllerOptions,
      clientConfig: removeUndefinedEntries(clientConfig),
      autoStartInbox: overrides.autoStartInbox,
      autoRefreshInbox: overrides.autoRefreshInbox,
      autoSubscribeThreadIds,
      onClientError: overrides.onClientError
    });

    return providerProps;
  }

  /**
   * Instantiates controller + client from serialized initial data.
   * @param {Awaited<ReturnType<typeof prefetch>>} initialData
   * @param {{
   *   controllerOptions?: Record<string, any>;
   *   clientOverrides?: Parameters<typeof buildClient>[1];
   *   viewerUserId?: string|null;
   * }} overrides
   */
  function createRuntime(initialData = {}, overrides = {}) {
    const controllerConfig = { ...(overrides.controllerOptions ?? {}) };
    controllerConfig.viewerUserId = overrides.viewerUserId ?? initialData.viewerUserId ?? null;

    if (controllerConfig.inbox === undefined && initialData.initialInbox) {
      controllerConfig.inbox = deepClone(initialData.initialInbox);
    }
    if (controllerConfig.threads === undefined && initialData.initialThreads) {
      controllerConfig.threads = deepClone(initialData.initialThreads);
    }
    if (controllerConfig.notifications === undefined && initialData.initialNotifications) {
      controllerConfig.notifications = deepClone(initialData.initialNotifications);
    }

    const controller = createMessagingController(removeUndefinedEntries(controllerConfig));
    const client = buildClient(controller, overrides.clientOverrides ?? {});

    return {
      controller,
      client,
      dispose() {
        client.dispose?.();
      }
    };
  }

  return {
    prefetch,
    createProviderProps,
    createRuntime
  };
}
