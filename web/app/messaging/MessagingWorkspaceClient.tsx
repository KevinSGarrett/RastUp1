'use client';
import React, { useEffect, useMemo, useRef, useCallback } from 'react';

import {
  MessagingProvider,
  useMessagingActions,
  useMessagingController
} from '../../components/MessagingProvider';
import { MessagingWorkspaceRouteBridge } from '../../components/Messaging/MessagingWorkspaceRouteBridge';
import type { MessagingInboxFilterState } from '../../components/Messaging/MessagingInbox';
import { MessagingModerationQueue } from '../../components/Messaging/MessagingModerationQueue';
type MessagingModerationQueueProps = React.ComponentProps<typeof MessagingModerationQueue>;
import { createMessagingDataSource } from '../../lib/messaging/dataSources.mjs';
import { DEFAULT_QUERY_KEYS } from '../../../tools/frontend/messaging/filter_params.mjs';

type PrefetchSnapshot = {
  viewerUserId: string | null;
  initialInbox: unknown;
  initialThreads: unknown[];
  initialNotifications: unknown;
  initialModerationQueue: unknown;
  hydratedThreadIds: string[];
  errors: Array<{ scope?: string; message?: string; threadId?: string }>;
};

interface ModerationQueueHydratorProps {
  enabled: boolean;
}

/**
 * Ensures moderation queue is hydrated when visible.
 */
const ModerationQueueHydrator: React.FC<ModerationQueueHydratorProps> = ({ enabled }) => {
  const actions = useMessagingActions();
  const startedRef = useRef(false);

  useEffect(() => {
    if (!enabled || startedRef.current) {
      return;
    }
    startedRef.current = true;

    if (typeof actions.hydrateModerationQueue === 'function') {
      actions
        .hydrateModerationQueue()
        // eslint-disable-next-line no-console
        .catch((error: unknown) => console.error('Messaging moderation queue hydration failed', error));
    }
  }, [actions, enabled]);

  return null;
};

interface OrchestratorAutoStarterProps {
  enabled?: boolean;
  keepaliveMs?: number;
}

/**
 * Boots (or reboots) the orchestrator defensively and keeps it alive.
 * Tries a variety of optional method shapes so this is safe across versions.
 */
const OrchestratorAutoStarter: React.FC<OrchestratorAutoStarterProps> = ({
  enabled = true,
  keepaliveMs = 30000
}) => {
  const actions = useMessagingActions();
  const controller = useMessagingController?.();
  const bootedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = useCallback(
    async (reason: string) => {
      if (!enabled) return;
      try {
        // Prefer explicit orchestrator start hooks if available
        if (actions.startOrchestrator) {
          await actions.startOrchestrator({ reason });
        } else if (actions.restartOrchestrator) {
          await actions.restartOrchestrator({ reason });
        } else if (controller?.startOrchestrator) {
          await controller.startOrchestrator({ reason });
        } else if (controller?.start) {
          await controller.start({ reason });
        } else if (actions.ensureAutopilot) {
          await actions.ensureAutopilot({ reason });
        } else if (actions.getOrchestratorStatus) {
          // NOP call to warm up, some stacks auto-start on first status check
          await actions.getOrchestratorStatus();
        }
        // Try to make sure inbox subscription is live
        if (typeof actions.startInboxSubscription === 'function') {
          actions.startInboxSubscription();
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('OrchestratorAutoStarter: start failed', error);
      }
    },
    [actions, controller, enabled]
  );

  useEffect(() => {
    if (!enabled || bootedRef.current) return;
    bootedRef.current = true;
    void start('mount');

    const onFocus = () => void start('window_focus');
    const onOnline = () => void start('network_online');

    if (typeof window !== 'undefined') {
      window.addEventListener('focus', onFocus);
      window.addEventListener('online', onOnline);
    }

    if (keepaliveMs > 0) {
      timerRef.current = setInterval(() => {
        void (actions.ensureAutopilot?.({ reason: 'keepalive' }) ??
          controller?.ensureAutopilot?.({ reason: 'keepalive' }));
      }, keepaliveMs);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', onFocus);
        window.removeEventListener('online', onOnline);
      }
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [actions, controller, enabled, keepaliveMs, start]);

  return null;
};

export interface MessagingWorkspaceClientProps {
  initialData: PrefetchSnapshot;
  viewerUserId: string | null;
  initialThreadId: string | null;
  initialFilters: MessagingInboxFilterState;
  initialSearchTerm: string;
  queryParamKeys?: Partial<typeof DEFAULT_QUERY_KEYS>;
  showModerationQueue?: boolean;
  moderationQueueProps?: MessagingModerationQueueProps;
}

export const MessagingWorkspaceClient: React.FC<MessagingWorkspaceClientProps> = ({
  initialData,
  viewerUserId,
  initialThreadId,
  initialFilters,
  initialSearchTerm,
  queryParamKeys,
  showModerationQueue = false,
  moderationQueueProps
}) => {
  const dataSource = useMemo(() => createMessagingDataSource(), []);

  const mergedQueryKeys = useMemo(
    () => (queryParamKeys ? { ...DEFAULT_QUERY_KEYS, ...queryParamKeys } : DEFAULT_QUERY_KEYS),
    [queryParamKeys]
  );

  const clientConfig = useMemo(() => {
    const baseConfig: Record<string, unknown> = {
      fetchInbox: dataSource.fetchInbox,
      fetchThread: dataSource.fetchThread,
      initialInbox: initialData.initialInbox ?? null,
      initialThreads: Array.isArray(initialData.initialThreads) ? initialData.initialThreads : [],
      initialNotifications: initialData.initialNotifications ?? null,
      initialModerationQueue: initialData.initialModerationQueue ?? null
    };

    if (typeof dataSource.fetchModerationQueue === 'function') {
      baseConfig.fetchModerationQueue = dataSource.fetchModerationQueue;
    }

    const uploadsConfig = {
      createUploadSession:
        typeof dataSource.createUploadSession === 'function'
          ? dataSource.createUploadSession
          : undefined,
      completeUpload:
        typeof dataSource.completeUpload === 'function' ? dataSource.completeUpload : undefined,
      getUploadStatus:
        typeof dataSource.getUploadStatus === 'function'
          ? dataSource.getUploadStatus
          : undefined
    };

    if (
      uploadsConfig.createUploadSession ||
      uploadsConfig.completeUpload ||
      uploadsConfig.getUploadStatus
    ) {
      baseConfig.uploads = uploadsConfig;
    }

    if (typeof dataSource.subscribeInbox === 'function') {
      baseConfig.subscribeInbox = dataSource.subscribeInbox;
    }
    if (typeof dataSource.subscribeThread === 'function') {
      baseConfig.subscribeThread = dataSource.subscribeThread;
    }
    if (dataSource.mutations) {
      baseConfig.mutations = dataSource.mutations;
    }
    return baseConfig;
  }, [
    dataSource,
    initialData.initialInbox,
    initialData.initialModerationQueue,
    initialData.initialNotifications,
    initialData.initialThreads
  ]);

  const hydratedThreadIds = useMemo(() => {
    if (Array.isArray(initialData.hydratedThreadIds) && initialData.hydratedThreadIds.length > 0) {
      return initialData.hydratedThreadIds;
    }
    return initialThreadId ? [initialThreadId] : [];
  }, [initialData.hydratedThreadIds, initialThreadId]);

  useEffect(() => {
    if (Array.isArray(initialData.errors) && initialData.errors.length > 0) {
      // eslint-disable-next-line no-console
      console.warn('Messaging workspace prefetch reported issues', initialData.errors);
    }
  }, [initialData.errors]);

  const effectiveViewerId = viewerUserId ?? initialData.viewerUserId ?? null;

  return (
    <MessagingProvider
      // @ts-expect-error viewerUserId is supported at runtime; provider typing widened in hotfix
      viewerUserId={effectiveViewerId}
      clientConfig={clientConfig}
      autoStartInbox={typeof dataSource.subscribeInbox === 'function'}
      autoRefreshInbox
      autoSubscribeThreadIds={hydratedThreadIds}
      onClientError={(error: unknown, context: Record<string, unknown>) => {
        // eslint-disable-next-line no-console
        console.error('Messaging client error', { error, context });
      }}
    >
      {/* Orchestrator autopilot boot / keepalive */}
      <OrchestratorAutoStarter enabled keepaliveMs={30000} />
      <ModerationQueueHydrator enabled={showModerationQueue} />

      <MessagingWorkspaceRouteBridge
        initialThreadId={initialThreadId ?? hydratedThreadIds[0] ?? null}
        inboxProps={{
          defaultFilters: initialFilters,
          initialSearch: initialSearchTerm
        }}
        showModerationQueue={showModerationQueue}
        moderationQueueProps={moderationQueueProps}
        queryParamKeys={mergedQueryKeys}
      />
    </MessagingProvider>
  );
};
