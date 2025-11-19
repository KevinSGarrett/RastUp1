import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { useInboxSummary, useInboxThreads, useMessagingActions } from '../MessagingProvider';
import { formatRelativeTimestamp } from '../../../tools/frontend/messaging/ui_helpers.mjs';

type ThreadItem = {
  threadId: string;
  kind?: string;
  lastMessageAt?: string;
  unreadCount?: number;
  pinned?: boolean;
  archived?: boolean;
  muted?: boolean;
  safeModeRequired?: boolean;
};

type MessageRequest = {
  requestId: string;
  threadId: string;
  creditCost?: number;
  expiresAt?: string;
  createdAt?: string;
  status?: string;
};

type ThreadLabel = {
  title: string;
  subtitle?: string;
  meta?: string;
};

export type MessagingInboxMutedMode = 'all' | 'muted' | 'hidden';

export interface MessagingInboxFilterState {
  onlyUnread: boolean;
  includeInquiries: boolean;
  includeProjects: boolean;
  mutedMode: MessagingInboxMutedMode;
  safeModeOnly: boolean;
}

export interface MessagingInboxProps {
  activeThreadId?: string | null;
  onSelectThread?: (threadId: string) => void;
  onAcceptRequest?: (requestId: string) => Promise<void> | void;
  onDeclineRequest?: (requestId: string, options?: { block?: boolean }) => Promise<void> | void;
  onStartConversation?: () => Promise<void> | void;
  formatThreadLabel?: (thread: ThreadItem) => ThreadLabel;
  requestActions?: {
    acceptLabel?: string;
    declineLabel?: string;
    blockLabel?: string;
  };
  timezone?: string;
  locale?: string;
  emptyState?: React.ReactNode;
  defaultFilters?: Partial<MessagingInboxFilterState>;
  filters?: MessagingInboxFilterState;
  onFiltersChange?: (filters: MessagingInboxFilterState) => void;
  initialSearch?: string;
  searchTerm?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
}

const DEFAULT_REQUEST_ACTION_LABELS = {
  acceptLabel: 'Accept',
  declineLabel: 'Decline',
  blockLabel: 'Block'
};

const MUTED_MODE_LABELS: Record<MessagingInboxMutedMode, string> = {
  all: 'Muted: All',
  muted: 'Muted: Only',
  hidden: 'Muted: Hide'
};

function normalizeFilters(input: Partial<MessagingInboxFilterState> | undefined): MessagingInboxFilterState {
  const filters = {
    onlyUnread: Boolean(input?.onlyUnread),
    includeInquiries:
      input?.includeInquiries !== undefined ? Boolean(input.includeInquiries) : true,
    includeProjects:
      input?.includeProjects !== undefined ? Boolean(input.includeProjects) : true,
    mutedMode:
      input?.mutedMode === 'muted' || input?.mutedMode === 'hidden'
        ? input.mutedMode
        : 'all',
    safeModeOnly: Boolean(input?.safeModeOnly)
  };

  if (!filters.includeInquiries && !filters.includeProjects) {
    filters.includeInquiries = true;
    filters.includeProjects = true;
  }

  return filters;
}

function defaultFormatThreadLabel(thread: ThreadItem, timezone?: string): ThreadLabel {
  const titleCandidates = [
    typeof (thread as any).title === 'string' ? (thread as any).title.trim() : null,
    typeof (thread as any)?.metadata?.displayName === 'string' ? (thread as any).metadata.displayName.trim() : null,
    thread.threadId
  ].filter((value) => value && value.length > 0);
  const title = titleCandidates[0] ?? 'Unknown thread';

  const subtitleParts: string[] = [];
  if (thread.kind === 'PROJECT') {
    subtitleParts.push('Project thread');
  } else if (thread.kind === 'INQUIRY') {
    subtitleParts.push('Inquiry thread');
  }
  if (thread.safeModeRequired) {
    subtitleParts.push('Safe-Mode required');
  }
  if (thread.muted) {
    subtitleParts.push('Muted');
  }

  const metaParts: string[] = [];
  if (thread.lastMessageAt) {
    metaParts.push(formatRelativeTimestamp(thread.lastMessageAt, { timezone }));
  }
  if (typeof thread.unreadCount === 'number' && thread.unreadCount > 0) {
    metaParts.push(`${thread.unreadCount} unread`);
  }

  return {
    title,
    subtitle: subtitleParts.length > 0 ? subtitleParts.join(' · ') : undefined,
    meta: metaParts.length > 0 ? metaParts.join(' · ') : undefined
  };
}

function sortByUnreadPriority(threads: ThreadItem[]): ThreadItem[] {
  return [...threads].sort((a, b) => {
    const unreadA = a.unreadCount ?? 0;
    const unreadB = b.unreadCount ?? 0;
    if (unreadA === unreadB) {
      const timeA = Date.parse(a.lastMessageAt ?? 0) || 0;
      const timeB = Date.parse(b.lastMessageAt ?? 0) || 0;
      return timeB - timeA;
    }
    return unreadB - unreadA;
  });
}

function chipClass(active: boolean) {
  return `messaging-inbox__filter-chip${active ? ' messaging-inbox__filter-chip--active' : ''}`;
}

export const MessagingInbox: React.FC<MessagingInboxProps> = ({
  activeThreadId = null,
  onSelectThread,
  onAcceptRequest,
  onDeclineRequest,
  onStartConversation,
  formatThreadLabel = defaultFormatThreadLabel,
  requestActions,
  timezone = 'UTC',
  emptyState = <p className="messaging-inbox__empty">No threads yet.</p>,
  defaultFilters,
  filters: controlledFilters,
  onFiltersChange,
  initialSearch = '',
  searchTerm: controlledSearchTerm,
  onSearchChange,
  searchPlaceholder = 'Search threads...'
}) => {
  const summary = useInboxSummary();
  const messagingActions = useMessagingActions();

  const [uncontrolledFilters, setUncontrolledFilters] = useState<MessagingInboxFilterState>(() =>
    normalizeFilters(defaultFilters)
  );

  useEffect(() => {
    if (controlledFilters === undefined) {
      setUncontrolledFilters(normalizeFilters(defaultFilters));
    }
  }, [defaultFilters, controlledFilters]);

  const filtersControlled = controlledFilters !== undefined;
  const normalizedControlledFilters = filtersControlled ? normalizeFilters(controlledFilters) : undefined;
  const effectiveFilters = filtersControlled
    ? (normalizedControlledFilters as MessagingInboxFilterState)
    : uncontrolledFilters;

  const [uncontrolledSearch, setUncontrolledSearch] = useState(initialSearch);

  useEffect(() => {
    if (controlledSearchTerm === undefined) {
      setUncontrolledSearch(initialSearch);
    }
  }, [initialSearch, controlledSearchTerm]);

  const searchControlled = controlledSearchTerm !== undefined;
  const effectiveSearchTerm = searchControlled ? controlledSearchTerm ?? '' : uncontrolledSearch;

  const updateFilters = useCallback(
    (
      updater:
        | MessagingInboxFilterState
        | ((prev: MessagingInboxFilterState) => MessagingInboxFilterState)
    ) => {
      const base = filtersControlled
        ? (normalizedControlledFilters as MessagingInboxFilterState)
        : uncontrolledFilters;
      const next = normalizeFilters(
        typeof updater === 'function'
          ? (updater as (prev: MessagingInboxFilterState) => MessagingInboxFilterState)(base)
          : updater
      );
      if (!filtersControlled) {
        setUncontrolledFilters(next);
      }
      onFiltersChange?.(next);
    },
    [filtersControlled, normalizedControlledFilters, uncontrolledFilters, onFiltersChange]
  );

  const updateSearch = useCallback(
    (value: string) => {
      const next = typeof value === 'string' ? value : '';
      if (!searchControlled) {
        setUncontrolledSearch(next);
      }
      onSearchChange?.(next);
    },
    [searchControlled, onSearchChange]
  );

  const toggleUnread = useCallback(() => {
    updateFilters((previous) => ({
      ...previous,
      onlyUnread: !previous.onlyUnread
    }));
  }, [updateFilters]);

  const toggleKind = useCallback(
    (kind: 'INQUIRY' | 'PROJECT') => {
      updateFilters((previous) => {
        const key = kind === 'INQUIRY' ? 'includeInquiries' : 'includeProjects';
        const otherKey = kind === 'INQUIRY' ? 'includeProjects' : 'includeInquiries';
        const nextValue = !previous[key];
        if (!nextValue && !previous[otherKey]) {
          return previous;
        }
        return {
          ...previous,
          [key]: nextValue
        };
      });
    },
    [updateFilters]
  );

  const cycleMutedMode = useCallback(() => {
    updateFilters((previous) => {
      const order: MessagingInboxMutedMode[] = ['all', 'muted', 'hidden'];
      const currentIndex = order.indexOf(previous.mutedMode);
      const nextMode = order[(currentIndex + 1) % order.length];
      if (nextMode === previous.mutedMode) {
        return previous;
      }
      return {
        ...previous,
        mutedMode: nextMode
      };
    });
  }, [updateFilters]);

  const toggleSafeMode = useCallback(() => {
    updateFilters((previous) => ({
      ...previous,
      safeModeOnly: !previous.safeModeOnly
    }));
  }, [updateFilters]);

  const handleSearchChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    updateSearch(event.target.value);
  }, [updateSearch]);

  const searchQuery = useMemo(() => effectiveSearchTerm.trim(), [effectiveSearchTerm]);

  const normalizedKinds = useMemo(() => {
    const values: string[] = [];
    if (effectiveFilters.includeInquiries) {
      values.push('INQUIRY');
    }
    if (effectiveFilters.includeProjects) {
      values.push('PROJECT');
    }
    return values;
  }, [effectiveFilters.includeInquiries, effectiveFilters.includeProjects]);

  const mutedFilter = useMemo(() => {
    if (effectiveFilters.mutedMode === 'all') {
      return undefined;
    }
    return effectiveFilters.mutedMode === 'muted';
  }, [effectiveFilters.mutedMode]);

  const queryMatcher = useCallback(
    (thread: ThreadItem, normalized: string) => {
      if (!normalized) {
        return true;
      }
      const label = formatThreadLabel(thread, timezone);
      const values = [label.title, label.subtitle, label.meta];
      return values.some((value) => typeof value === 'string' && value.toLowerCase().includes(normalized));
    },
    [formatThreadLabel, timezone]
  );

  const baseOptions = useMemo(
    () => ({
      query: searchQuery,
      kinds: normalizedKinds,
      onlyUnread: effectiveFilters.onlyUnread,
      muted: mutedFilter,
      safeModeRequired: effectiveFilters.safeModeOnly ? true : undefined,
      queryMatcher
    }),
    [searchQuery, normalizedKinds, effectiveFilters.onlyUnread, mutedFilter, effectiveFilters.safeModeOnly, queryMatcher]
  );

  const pinnedOptions = useMemo(
    () => ({
      ...baseOptions,
      folder: 'pinned' as const
    }),
    [baseOptions]
  );
  const archivedOptions = useMemo(
    () => ({
      ...baseOptions,
      folder: 'archived' as const,
      includeArchived: true
    }),
    [baseOptions]
  );
  const requestsOptions = useMemo(
    () => ({
      folder: 'requests' as const,
      query: searchQuery
    }),
    [searchQuery]
  );

  const defaultThreads = useInboxThreads(baseOptions);
  const pinnedThreads = useInboxThreads(pinnedOptions);
  const archivedThreads = useInboxThreads(archivedOptions);
  const requests = useInboxThreads(requestsOptions) as MessageRequest[];

  const threadSections = useMemo(() => {
    const sections: Array<{ id: string; title: string; threads: ThreadItem[] }> = [];
    if (Array.isArray(pinnedThreads) && pinnedThreads.length > 0) {
      sections.push({ id: 'pinned', title: 'Pinned', threads: sortByUnreadPriority(pinnedThreads) });
    }
    if (Array.isArray(defaultThreads) && defaultThreads.length > 0) {
      sections.push({ id: 'inbox', title: 'Inbox', threads: sortByUnreadPriority(defaultThreads) });
    }
    if (Array.isArray(archivedThreads) && archivedThreads.length > 0) {
      sections.push({
        id: 'archived',
        title: 'Archived',
        threads: sortByUnreadPriority(archivedThreads as ThreadItem[])
      });
    }
    return sections;
  }, [pinnedThreads, defaultThreads, archivedThreads]);

  const totalVisibleThreads = useMemo(
    () => threadSections.reduce((sum, section) => sum + section.threads.length, 0),
    [threadSections]
  );

  const requestLabels = { ...DEFAULT_REQUEST_ACTION_LABELS, ...(requestActions ?? {}) };

  const handleSelectThread = useCallback(
    (threadId: string) => {
      onSelectThread?.(threadId);
    },
    [onSelectThread]
  );

  const handleAcceptRequest = useCallback(
    async (requestId: string) => {
      if (onAcceptRequest) {
        await onAcceptRequest(requestId);
        return;
      }
      await messagingActions.acceptMessageRequest(requestId);
    },
    [messagingActions, onAcceptRequest]
  );

  const handleDeclineRequest = useCallback(
    async (requestId: string, block: boolean) => {
      if (onDeclineRequest) {
        await onDeclineRequest(requestId, { block });
        return;
      }
      await messagingActions.declineMessageRequest(requestId, { block });
    },
    [messagingActions, onDeclineRequest]
  );

  const handleStartConversation = useCallback(async () => {
    if (onStartConversation) {
      await onStartConversation();
      return;
    }
    await messagingActions.recordConversationStart();
  }, [messagingActions, onStartConversation]);

  const canStartConversation = summary.canStartConversation ?? { allowed: true };
  const mutedModeLabel = MUTED_MODE_LABELS[effectiveFilters.mutedMode];

  return (
    <div className="messaging-inbox">
      <header className="messaging-inbox__summary">
        <div>
          <h2 className="messaging-inbox__title">Messages</h2>
          <p className="messaging-inbox__subtitle">
            {summary.totalUnread > 0 ? `${summary.totalUnread} unread` : 'All caught up'}
          </p>
        </div>
        <div className="messaging-inbox__actions">
          <button
            type="button"
            className="messaging-inbox__cta"
            onClick={handleStartConversation}
            disabled={!canStartConversation.allowed}
          >
            Start conversation
          </button>
          {!canStartConversation.allowed && canStartConversation.reason === 'INSUFFICIENT_CREDITS' ? (
            <span className="messaging-inbox__cta-note">
              {`Need ${canStartConversation.requiredCredits ?? 0} credits (available ${
                canStartConversation.availableCredits ?? 0
              })`}
            </span>
          ) : null}
          {!canStartConversation.allowed && canStartConversation.reason === 'RATE_LIMIT_EXCEEDED' ? (
            <span className="messaging-inbox__cta-note">
              {`Limit reached. Try again ${formatRelativeTimestamp(
                new Date(canStartConversation.nextAllowedAt ?? Date.now()).toISOString(),
                { now: Date.now() + 1000 }
              )}`}
            </span>
          ) : null}
        </div>
      </header>

        <div className="messaging-inbox__filters">
          <div className="messaging-inbox__search">
            <input
              type="search"
              value={effectiveSearchTerm}
              onChange={handleSearchChange}
              placeholder={searchPlaceholder}
              aria-label="Search threads"
            />
          </div>
          <div className="messaging-inbox__filter-chips">
            <button type="button" className={chipClass(effectiveFilters.onlyUnread)} onClick={toggleUnread}>
              Unread
            </button>
            <button
              type="button"
              className={chipClass(effectiveFilters.includeProjects)}
              onClick={() => toggleKind('PROJECT')}
            >
              Projects
            </button>
            <button
              type="button"
              className={chipClass(effectiveFilters.includeInquiries)}
              onClick={() => toggleKind('INQUIRY')}
            >
              Inquiries
            </button>
            <button
              type="button"
              className={chipClass(effectiveFilters.safeModeOnly)}
              onClick={toggleSafeMode}
            >
              Safe mode
            </button>
            <button
              type="button"
              className="messaging-inbox__filter-chip messaging-inbox__filter-chip--cycle"
              onClick={cycleMutedMode}
            >
              {mutedModeLabel}
            </button>
          </div>
          <div className="messaging-inbox__results">
            {totalVisibleThreads === 0
              ? 'No threads match filters'
              : `Showing ${totalVisibleThreads} ${totalVisibleThreads === 1 ? 'thread' : 'threads'}`}
          </div>
        </div>

      {Array.isArray(requests) && requests.length > 0 ? (
        <section className="messaging-inbox__section messaging-inbox__section--requests">
          <h3>Message requests</h3>
          <ul className="messaging-inbox__requests">
            {requests.map((request) => (
              <li key={request.requestId} className="messaging-inbox__request">
                <div className="messaging-inbox__request-details">
                  <div className="messaging-inbox__request-thread">Thread {request.threadId}</div>
                  <div className="messaging-inbox__request-meta">
                    <span className="messaging-inbox__request-cost">
                      {request.creditCost ? `${request.creditCost} credits` : 'No credit cost'}
                    </span>
                    {request.expiresAt ? (
                      <span className="messaging-inbox__request-expiry">
                        {`Expires ${formatRelativeTimestamp(request.expiresAt, { timezone })}`}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="messaging-inbox__request-actions">
                  <button type="button" onClick={() => handleAcceptRequest(request.requestId)}>
                    {requestLabels.acceptLabel}
                  </button>
                  <button type="button" onClick={() => handleDeclineRequest(request.requestId, false)}>
                    {requestLabels.declineLabel}
                  </button>
                  <button type="button" onClick={() => handleDeclineRequest(request.requestId, true)}>
                    {requestLabels.blockLabel}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {threadSections.length === 0 ? (
        emptyState
      ) : (
        threadSections.map((section) => (
          <section key={section.id} className="messaging-inbox__section">
            <h3>{section.title}</h3>
            <ul className="messaging-inbox__threads">
              {section.threads.map((thread) => {
                const label = formatThreadLabel(thread, timezone);
                const active = thread.threadId === activeThreadId;
                const showTags = thread.safeModeRequired || thread.muted;
                return (
                  <li key={`${section.id}-${thread.threadId}`}>
                    <button
                      type="button"
                      className={`messaging-inbox__thread${active ? ' messaging-inbox__thread--active' : ''}`}
                      onClick={() => handleSelectThread(thread.threadId)}
                    >
                      <div className="messaging-inbox__thread-header">
                        <span className="messaging-inbox__thread-title">{label.title}</span>
                        {thread.unreadCount ? (
                          <span className="messaging-inbox__thread-unread">{thread.unreadCount}</span>
                        ) : null}
                      </div>
                      {label.subtitle ? (
                        <p className="messaging-inbox__thread-subtitle">{label.subtitle}</p>
                      ) : null}
                      {label.meta ? <p className="messaging-inbox__thread-meta">{label.meta}</p> : null}
                      {showTags ? (
                        <div className="messaging-inbox__thread-tags">
                          {thread.safeModeRequired ? (
                            <span className="messaging-inbox__thread-tag messaging-inbox__thread-tag--safe">
                              Safe mode
                            </span>
                          ) : null}
                          {thread.muted ? (
                            <span className="messaging-inbox__thread-tag messaging-inbox__thread-tag--muted">
                              Muted
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
};
