// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { MessagingProvider, useThread } from '../MessagingProvider';
import type { MessagingProviderProps } from '../MessagingProvider';
import { MessagingInbox, type MessagingInboxProps } from './MessagingInbox';
import { MessagingThread, type MessagingThreadProps } from './MessagingThread';
import { ProjectPanelTabs, type ProjectPanelTabsProps } from './ProjectPanelTabs';
import { MessagingNotificationCenter, type MessagingNotificationCenterProps } from './MessagingNotificationCenter';
import { MessagingModerationQueue } from './MessagingModerationQueue';

type ThreadProps = Omit<MessagingThreadProps, 'threadId' | 'viewerUserId'>;

export interface MessagingWorkspaceProps extends MessagingProviderProps {
  className?: string;
  layout?: 'split' | 'stacked';
  initialThreadId?: string | null;
  selectedThreadId?: string | null;
  header?: React.ReactNode;
  sidebar?: React.ReactNode;
  onThreadChange?: (threadId: string | null) => void;
  inboxProps?: Omit<MessagingInboxProps, 'activeThreadId' | 'onSelectThread'>;
  threadProps?: ThreadProps & { viewerUserId?: string };
  projectPanelProps?: ProjectPanelTabsProps;
  emptyThreadState?: React.ReactNode;
  showNotificationCenter?: boolean;
  notificationCenterProps?: MessagingNotificationCenterProps;
  showModerationQueue?: boolean;
  moderationQueueProps?: any;
}

interface ThreadRegionProps {
  threadId: string | null;
  viewerUserId: string | null;
  threadProps?: ThreadProps;
  panelProps?: ProjectPanelTabsProps;
  emptyState?: React.ReactNode;
}

const ThreadRegion: React.FC<ThreadRegionProps> = ({ threadId, viewerUserId, threadProps, panelProps, emptyState }) => {
  const effectiveViewer = viewerUserId ?? null;

  if (!threadId) {
    return (
      <div className="messaging-workspace__thread messaging-workspace__thread--empty">
        {emptyState ?? <p>Select a conversation to view the timeline.</p>}
      </div>
    );
  }

  const threadState = useThread(threadId);
  const threadLocale = threadProps?.locale;
  const threadTimezone = threadProps?.timezone;
  const {
    locale: panelLocale,
    timezone: panelTimezone,
    currency: panelCurrency,
    projectPanel: _panelProjectPanel,
    ...restPanelProps
  } = panelProps ?? {};
  const projectPanelLocale = panelLocale ?? threadLocale ?? 'en-US';
  const projectPanelTimezone = panelTimezone ?? threadTimezone ?? 'UTC';
  const projectPanelCurrency = panelCurrency ?? 'USD';

  return (
    <div className="messaging-workspace__thread">
      <MessagingThread
        threadId={threadId}
        viewerUserId={effectiveViewer ?? 'viewer'}
        {...threadProps}
      />
      <ProjectPanelTabs
        projectPanel={threadState?.projectPanel ?? null}
        locale={projectPanelLocale}
        timezone={projectPanelTimezone}
        currency={projectPanelCurrency}
        {...restPanelProps}
      />
    </div>
  );
};

export const MessagingWorkspace: React.FC<MessagingWorkspaceProps> = ({
  className,
  layout = 'split',
  initialThreadId = null,
  selectedThreadId: controlledThreadId,
  header,
  sidebar,
  onThreadChange,
  inboxProps,
  threadProps,
  projectPanelProps,
  emptyThreadState,
  showNotificationCenter = false,
  notificationCenterProps,
  showModerationQueue = false,
  moderationQueueProps,
  children,
  viewerUserId,
  ...providerProps
}) => {
  const [uncontrolledThreadId, setUncontrolledThreadId] = useState<string | null>(initialThreadId);

  useEffect(() => {
    if (controlledThreadId === undefined) {
      setUncontrolledThreadId(initialThreadId);
    }
  }, [initialThreadId, controlledThreadId]);

  const threadControlled = controlledThreadId !== undefined;
  const activeThreadId = threadControlled ? controlledThreadId ?? null : uncontrolledThreadId;

  const handleSelectThread = useCallback(
    (threadId: string) => {
      if (!threadControlled) {
        setUncontrolledThreadId(threadId);
      }
      onThreadChange?.(threadId);
    },
    [threadControlled, onThreadChange]
  );

  const resolvedViewerId = useMemo(() => {
    if (threadProps?.viewerUserId) return threadProps.viewerUserId;
    if (viewerUserId) return viewerUserId;
    if (providerProps.controllerOptions?.viewerUserId) {
      return providerProps.controllerOptions.viewerUserId;
    }
    return null;
  }, [threadProps?.viewerUserId, viewerUserId, providerProps.controllerOptions?.viewerUserId]);

  const workspaceClass = useMemo(() => {
    const base = ['messaging-workspace', `messaging-workspace--${layout}`];
    if (className) base.push(className);
    return base.join(' ');
  }, [className, layout]);

  return (
    <MessagingProvider viewerUserId={viewerUserId ?? resolvedViewerId} {...providerProps}>
      <div className={workspaceClass}>
        {header ? <div className="messaging-workspace__header">{header}</div> : null}
        <div className="messaging-workspace__body">
          <aside className="messaging-workspace__sidebar">
            {sidebar}
            <MessagingInbox
              {...inboxProps}
              activeThreadId={activeThreadId}
              onSelectThread={handleSelectThread}
            />
            {showNotificationCenter ? (
              <MessagingNotificationCenter
                {...notificationCenterProps}
                className={`messaging-workspace__notification-center${
                  notificationCenterProps?.className ? ` ${notificationCenterProps.className}` : ''
                }`}
              />
            ) : null}
            {showModerationQueue ? (
              <MessagingModerationQueue
                {...(moderationQueueProps as any)}
                className={`messaging-workspace__moderation-queue${
                  (moderationQueueProps as any)?.className ? ` ${(moderationQueueProps as any).className}` : ''
                }`}
              />
            ) : null}
          </aside>
          <section className="messaging-workspace__content">
            <ThreadRegion
              threadId={activeThreadId}
              viewerUserId={resolvedViewerId}
              threadProps={threadProps}
              panelProps={projectPanelProps}
              emptyState={emptyThreadState}
            />
            {children}
          </section>
        </div>
      </div>
    </MessagingProvider>
  );
};
