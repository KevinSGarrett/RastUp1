'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { MessagingWorkspace, type MessagingWorkspaceProps } from './MessagingWorkspace';
import {
  applyMessagingStateToSearchParams,
  DEFAULT_QUERY_KEYS,
  isFilterStateEqual,
  parseMessagingQueryState
} from '../../tools/frontend/messaging/filter_params.mjs';
import type { MessagingInboxFilterState } from './MessagingInbox';

type HistoryMode = 'replace' | 'push';

export interface MessagingWorkspaceRouteBridgeProps extends MessagingWorkspaceProps {
  queryParamKeys?: Partial<typeof DEFAULT_QUERY_KEYS>;
  historyMode?: HistoryMode;
}

export const MessagingWorkspaceRouteBridge: React.FC<MessagingWorkspaceRouteBridgeProps> = ({
  queryParamKeys,
  historyMode = 'replace',
  inboxProps,
  onThreadChange,
  initialThreadId = null,
  ...workspaceProps
}) => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const queryKeys = useMemo(
    () => ({
      ...DEFAULT_QUERY_KEYS,
      ...(queryParamKeys ?? {})
    }),
    [queryParamKeys]
  );

  const initialParsedRef = useRef(
    parseMessagingQueryState(searchParams, {
      keys: queryKeys
    })
  );

  const { selectedThreadId: _ignoredSelectedThreadId, ...forwardWorkspaceProps } = workspaceProps;

  const [filters, setFilters] = useState<MessagingInboxFilterState>(() => initialParsedRef.current.filters);
  const [searchTerm, setSearchTerm] = useState(() => initialParsedRef.current.searchTerm);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(
    () => initialParsedRef.current.threadId ?? initialThreadId ?? null
  );

  const lastAppliedSearchRef = useRef(initialParsedRef.current.threadId ? searchParams.toString() : '');

  const updateRoute = useCallback(
    (nextState: { filters?: MessagingInboxFilterState; searchTerm?: string; threadId?: string | null }) => {
      const params = applyMessagingStateToSearchParams(searchParams, {
        filters: nextState.filters ?? filters,
        searchTerm: nextState.searchTerm ?? searchTerm,
        threadId: nextState.threadId ?? selectedThreadId
      }, { keys: queryKeys });

      const nextSearch = params.toString();
      const currentSearch = searchParams.toString();

      if (nextSearch === currentSearch || nextSearch === lastAppliedSearchRef.current) {
        return;
      }

      const url = nextSearch ? `${pathname}?${nextSearch}` : pathname;
      if (historyMode === 'push') {
        router.push(url, { scroll: false });
      } else {
        router.replace(url, { scroll: false });
      }
      lastAppliedSearchRef.current = nextSearch;
    },
    [filters, historyMode, pathname, queryKeys, router, searchParams, searchTerm, selectedThreadId]
  );

  useEffect(() => {
    const parsed = parseMessagingQueryState(searchParams, { keys: queryKeys });
    if (!isFilterStateEqual(parsed.filters, filters)) {
      setFilters(parsed.filters);
    }
    if (parsed.searchTerm !== searchTerm) {
      setSearchTerm(parsed.searchTerm);
    }
    const nextThread = parsed.threadId ?? null;
    if (nextThread !== selectedThreadId) {
      setSelectedThreadId(nextThread);
    }
  }, [filters, queryKeys, searchParams, searchTerm, selectedThreadId]);

  const handleFiltersChange = useCallback(
    (nextFilters: MessagingInboxFilterState) => {
      setFilters(nextFilters);
      updateRoute({ filters: nextFilters });
      inboxProps?.onFiltersChange?.(nextFilters);
    },
    [inboxProps, updateRoute]
  );

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchTerm(value);
      updateRoute({ searchTerm: value });
      inboxProps?.onSearchChange?.(value);
    },
    [inboxProps, updateRoute]
  );

  const handleThreadChange = useCallback(
    (threadId: string | null) => {
      setSelectedThreadId(threadId);
      updateRoute({ threadId });
      onThreadChange?.(threadId);
    },
    [onThreadChange, updateRoute]
  );

  const mergedInboxProps = useMemo(() => {
    return {
      ...inboxProps,
      filters,
      searchTerm,
      onFiltersChange: handleFiltersChange,
      onSearchChange: handleSearchChange,
      initialSearch: inboxProps?.initialSearch ?? searchTerm
    };
  }, [filters, handleFiltersChange, handleSearchChange, inboxProps, searchTerm]);

  return (
    <MessagingWorkspace
      {...forwardWorkspaceProps}
      initialThreadId={initialThreadId}
      selectedThreadId={selectedThreadId}
      onThreadChange={handleThreadChange}
      inboxProps={mergedInboxProps}
    />
  );
};
