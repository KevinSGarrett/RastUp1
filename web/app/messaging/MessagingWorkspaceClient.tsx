'use client';

import React, { useEffect, useMemo } from 'react';

import { MessagingProvider } from '../../components/MessagingProvider';
import { MessagingWorkspaceRouteBridge } from '../../components/Messaging/MessagingWorkspaceRouteBridge';
import type { MessagingInboxFilterState } from '../../components/Messaging/MessagingInbox';
import { createMessagingDataSource } from '../../lib/messaging/dataSources.mjs';
import { DEFAULT_QUERY_KEYS } from '../../../tools/frontend/messaging/filter_params.mjs';

type PrefetchSnapshot = {
  viewerUserId: string | null;
  initialInbox: unknown;
  initialThreads: unknown[];
  initialNotifications: unknown;
  hydratedThreadIds: string[];
  errors: Array<{ scope?: string; message?: string; threadId?: string }>;
};

export interface MessagingWorkspaceClientProps {
  initialData: PrefetchSnapshot;
  viewerUserId: string | null;
  initialThreadId: string | null;
  initialFilters: MessagingInboxFilterState;
  initialSearchTerm: string;
  queryParamKeys?: Partial<typeof DEFAULT_QUERY_KEYS>;
}

export const MessagingWorkspaceClient: React.FC<MessagingWorkspaceClientProps> = ({
  initialData,
  viewerUserId,
  initialThreadId,
  initialFilters,
  initialSearchTerm,
  queryParamKeys
}) => {
  const dataSource = useMemo(() => createMessagingDataSource(), []);

  const mergedQueryKeys = useMemo(
    () => (queryParamKeys ? { ...DEFAULT_QUERY_KEYS, ...queryParamKeys } : DEFAULT_QUERY_KEYS),
    [queryParamKeys]
  );

  const clientConfig = useMemo(
    () => ({
      fetchInbox: dataSource.fetchInbox,
      fetchThread: dataSource.fetchThread,
      initialInbox: initialData.initialInbox ?? null,
      initialThreads: Array.isArray(initialData.initialThreads) ? initialData.initialThreads : [],
      initialNotifications: initialData.initialNotifications ?? null
    }),
    [
      dataSource.fetchInbox,
      dataSource.fetchThread,
      initialData.initialInbox,
      initialData.initialThreads,
      initialData.initialNotifications
    ]
  );

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
      autoStartInbox={false}
      autoRefreshInbox
      autoSubscribeThreadIds={hydratedThreadIds}
      onClientError={(error, context) => {
        // eslint-disable-next-line no-console
        console.error('Messaging client error', { error, context });
      }}
    >
      <MessagingWorkspaceRouteBridge
        initialThreadId={initialThreadId ?? hydratedThreadIds[0] ?? null}
        inboxProps={{
          defaultFilters: initialFilters,
          initialSearch: initialSearchTerm
        }}
        queryParamKeys={mergedQueryKeys}
      />
    </MessagingProvider>
  );
};
