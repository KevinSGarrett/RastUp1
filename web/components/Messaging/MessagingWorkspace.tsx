import React, { useCallback, useMemo, useState } from 'react';

import { MessagingProvider, useThread } from '../MessagingProvider';
import type { MessagingProviderProps } from '../MessagingProvider';
import { MessagingInbox, type MessagingInboxProps } from './MessagingInbox';
import { MessagingThread, type MessagingThreadProps } from './MessagingThread';
import { ProjectPanelTabs, type ProjectPanelTabsProps } from './ProjectPanelTabs';

type ThreadProps = Omit<MessagingThreadProps, 'threadId' | 'viewerUserId'>;

export interface MessagingWorkspaceProps extends MessagingProviderProps {
  className?: string;
  layout?: 'split' | 'stacked';
  initialThreadId?: string | null;
  header?: React.ReactNode;
  sidebar?: React.ReactNode;
  onThreadChange?: (threadId: string | null) => void;
  inboxProps?: Omit<MessagingInboxProps, 'activeThreadId' | 'onSelectThread'>;
  threadProps?: ThreadProps & { viewerUserId?: string };
  projectPanelProps?: ProjectPanelTabsProps;
  emptyThreadState?: React.ReactNode;
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

  return (
    <div className="messaging-workspace__thread">
      <MessagingThread
        threadId={threadId}
        viewerUserId={effectiveViewer ?? 'viewer'}
        {...threadProps}
      />
      <ProjectPanelTabs projectPanel={threadState?.projectPanel ?? null} {...panelProps} />
    </div>
  );
};

export const MessagingWorkspace: React.FC<MessagingWorkspaceProps> = ({
  className,
  layout = 'split',
  initialThreadId = null,
  header,
  sidebar,
  onThreadChange,
  inboxProps,
  threadProps,
  projectPanelProps,
  emptyThreadState,
  children,
  viewerUserId,
  ...providerProps
}) => {
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(initialThreadId);

  const handleSelectThread = useCallback(
    (threadId: string) => {
      setSelectedThreadId(threadId);
      onThreadChange?.(threadId);
    },
    [onThreadChange]
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
    if (className) {
      base.push(className);
    }
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
              activeThreadId={selectedThreadId}
              onSelectThread={handleSelectThread}
            />
          </aside>
          <section className="messaging-workspace__content">
            <ThreadRegion
              threadId={selectedThreadId}
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
