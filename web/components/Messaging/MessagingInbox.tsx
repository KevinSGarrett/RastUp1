import React, { useMemo } from 'react';

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
}

const DEFAULT_REQUEST_ACTION_LABELS = {
  acceptLabel: 'Accept',
  declineLabel: 'Decline',
  blockLabel: 'Block'
};

function defaultFormatThreadLabel(thread: ThreadItem, timezone?: string): ThreadLabel {
  const label: ThreadLabel = {
    title: thread.threadId ?? 'Unknown thread',
    subtitle: thread.kind === 'PROJECT' ? 'Project thread' : 'Inquiry thread'
  };
  if (thread.lastMessageAt) {
    label.meta = formatRelativeTimestamp(thread.lastMessageAt, { timezone });
  }
  return label;
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

export const MessagingInbox: React.FC<MessagingInboxProps> = ({
  activeThreadId = null,
  onSelectThread,
  onAcceptRequest,
  onDeclineRequest,
  onStartConversation,
  formatThreadLabel = defaultFormatThreadLabel,
  requestActions,
  timezone = 'UTC',
  emptyState = <p className="messaging-inbox__empty">No threads yet.</p>
}) => {
  const summary = useInboxSummary();
  const defaultThreads = useInboxThreads();
  const pinnedThreads = useInboxThreads({ folder: 'pinned' });
  const archivedThreads = useInboxThreads({ folder: 'archived' });
  const requests = useInboxThreads({ folder: 'requests' }) as MessageRequest[];
  const messagingActions = useMessagingActions();

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

  const requestLabels = { ...DEFAULT_REQUEST_ACTION_LABELS, ...(requestActions ?? {}) };

  const handleSelectThread = (threadId: string) => {
    onSelectThread?.(threadId);
  };

  const handleAcceptRequest = async (requestId: string) => {
    if (onAcceptRequest) {
      await onAcceptRequest(requestId);
      return;
    }
    await messagingActions.acceptMessageRequest(requestId);
  };

  const handleDeclineRequest = async (requestId: string, block: boolean) => {
    if (onDeclineRequest) {
      await onDeclineRequest(requestId, { block });
      return;
    }
    await messagingActions.declineMessageRequest(requestId, { block });
  };

  const handleStartConversation = async () => {
    if (onStartConversation) {
      await onStartConversation();
      return;
    }
    await messagingActions.recordConversationStart();
  };

  const canStartConversation = summary.canStartConversation ?? { allowed: true };

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
