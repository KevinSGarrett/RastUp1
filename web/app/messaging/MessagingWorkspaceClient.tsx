// 'use client' must be first
'use client';

import { useEffect, useMemo, useRef } from 'react';
import type { ComponentProps } from 'react';

import {
  MessagingProvider,
  useMessagingActions
} from '../../components/MessagingProvider';
import { MessagingWorkspaceRouteBridge } from '../../components/Messaging/MessagingWorkspaceRouteBridge';
import type { MessagingInboxFilterState } from '../../components/Messaging/MessagingInbox';
import { MessagingModerationQueue } from '../../components/Messaging/MessagingModerationQueue';
type MessagingModerationQueueProps = ComponentProps<typeof MessagingModerationQueue>;

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

function ModerationQueueHydrator({ enabled }: { enabled: boolean }) {
  const actions = useMessagingActions();
  const startedRef = useRef(false);
  useEffect(() => {
    if (!enabled || startedRef.current) return;
    startedRef.current = true;
    if (typeof actions.hydrateModerationQueue === 'function') {
      actions.hydrateModerationQueue().catch((error: unknown) =>
        console.error('Messaging moderation queue hydration failed', error)
      );
    }
  }, [actions, enabled]);
  return null;
}

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

export function MessagingWorkspaceClient({
  initialData,
  viewerUserId,
  initialThreadId,
  initialFilters,
  initialSearchTerm,
  queryParamKeys,
  showModerationQueue = false,
  moderationQueueProps
}: MessagingWorkspaceClientProps) {
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

    if (typeof (dataSource as any).fetchModerationQueue === 'function') {
      (baseConfig as any).fetchModerationQueue = (dataSource as any).fetchModerationQueue;
    }

    const uploadsConfig = {
      createUploadSession:
        typeof (dataSource as any).createUploadSession === 'function'
          ? (dataSource as any).createUploadSession
          : undefined,
      completeUpload:
        typeof (dataSource as any).completeUpload === 'function'
          ? (dataSource as any).completeUpload
          : undefined,
      getUploadStatus:
        typeof (dataSource as any).getUploadStatus === 'function'
          ? (dataSource as any).getUploadStatus
          : undefined
    };

    if (uploadsConfig.createUploadSession || uploadsConfig.completeUpload || uploadsConfig.getUploadStatus) {
      (baseConfig as any).uploads = uploadsConfig;
    }

    if (typeof (dataSource as any).subscribeInbox === 'function') {
      (baseConfig as any).subscribeInbox = (dataSource as any).subscribeInbox;
    }
    if (typeof (dataSource as any).subscribeThread === 'function') {
      (baseConfig as any).subscribeThread = (dataSource as any).subscribeThread;
    }
    if ((dataSource as any).mutations) {
      (baseConfig as any).mutations = (dataSource as any).mutations;
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
      console.warn('Messaging workspace prefetch reported issues', initialData.errors);
    }
  }, [initialData.errors]);

  const effectiveViewerId = viewerUserId ?? initialData.viewerUserId ?? null;

  return (
    <MessagingProvider
      // viewerUserId *is* supported at runtime; provider typing widened in hotfix
      // @ts-expect-error
      viewerUserId={effectiveViewerId}
      clientConfig={clientConfig}
      autoStartInbox={typeof (dataSource as any).subscribeInbox === 'function'}
      autoRefreshInbox
      autoSubscribeThreadIds={hydratedThreadIds}
      onClientError={(error: unknown, context: Record<string, unknown>) => {
        console.error('Messaging client error', { error, context });
      }}
    >
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
}
