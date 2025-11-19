'use client';

import React, { useEffect, useMemo, useRef } from 'react';

import {
  MessagingProvider,
  useMessagingActions
} from '../../components/MessagingProvider';
import { MessagingWorkspaceRouteBridge } from '../../components/Messaging/MessagingWorkspaceRouteBridge';
import type { MessagingInboxFilterState } from '../../components/Messaging/MessagingInbox';
import type { MessagingModerationQueueProps } from '../../components/Messaging/MessagingModerationQueue';
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
        .catch((error) => console.error('Messaging moderation queue hydration failed', error));
    }
  }, [actions, enabled]);

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

  return (
    <MessagingProvider
      viewerUserId={viewerUserId ?? initialData.viewerUserId ?? null}
      clientConfig={clientConfig}
      autoStartInbox={typeof dataSource.subscribeInbox === 'function'}
      autoRefreshInbox
      autoSubscribeThreadIds={hydratedThreadIds}
      onClientError={(error, context) => {
        // eslint-disable-next-line no-console
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
};
