import React, { useMemo, useState } from 'react';

import {
  useMessagingActions,
  useModerationQueue
} from '../MessagingProvider';

type ModerationCase = {
  caseId: string;
  type?: string;
  threadId?: string;
  messageId?: string;
  status?: string;
  severity?: string;
  reason?: string;
  reportedBy?: string;
  reportedAt?: string;
  metadata?: Record<string, any>;
  resolution?: Record<string, any>;
};

interface MessagingModerationQueueProps {
  className?: string;
  title?: string;
  statusFilter?: string;
  severityFilter?: string;
  emptyState?: React.ReactNode;
  onResolveCase?: (moderationCase: ModerationCase) => Promise<void> | void;
  onRemoveCase?: (moderationCase: ModerationCase) => Promise<void> | void;
}

export const MessagingModerationQueue: React.FC<MessagingModerationQueueProps> = ({
  className,
  title = 'Moderation queue',
  statusFilter,
  severityFilter,
  emptyState = <p className="messaging-moderation-queue__empty">No moderation cases pending review.</p>,
  onResolveCase,
  onRemoveCase
}) => {
  const [resolvingCaseId, setResolvingCaseId] = useState<string | null>(null);
  const [removingCaseId, setRemovingCaseId] = useState<string | null>(null);
  const moderationState = useModerationQueue((state) => state);
  const messagingActions = useMessagingActions();

  const cases = useMemo(() => {
    if (!moderationState || !moderationState.order) {
      return [];
    }
    return moderationState.order
      .map((caseId: string) => moderationState.casesById?.[caseId])
      .filter(Boolean)
      .filter((entry: ModerationCase) => {
        if (statusFilter && entry.status !== statusFilter) {
          return false;
        }
        if (severityFilter && entry.severity !== severityFilter) {
          return false;
        }
        return true;
      });
  }, [moderationState, statusFilter, severityFilter]);

  const handleResolve = async (moderationCase: ModerationCase) => {
    if (!moderationCase?.caseId) {
      return;
    }
    setResolvingCaseId(moderationCase.caseId);
    try {
      if (onResolveCase) {
        await onResolveCase(moderationCase);
      } else {
        await messagingActions.resolveModerationQueueCase?.(moderationCase.caseId, {
          outcome: 'RESOLVED',
          notes: 'Resolved via queue UI'
        });
      }
    } catch (error) {
      console.error('MessagingModerationQueue: resolveCase failed', error);
    } finally {
      setResolvingCaseId(null);
    }
  };

  const handleRemove = async (moderationCase: ModerationCase) => {
    if (!moderationCase?.caseId) {
      return;
    }
    setRemovingCaseId(moderationCase.caseId);
    try {
      if (onRemoveCase) {
        await onRemoveCase(moderationCase);
      } else {
        await messagingActions.removeModerationQueueCase?.(moderationCase.caseId);
      }
    } catch (error) {
      console.error('MessagingModerationQueue: removeCase failed', error);
    } finally {
      setRemovingCaseId(null);
    }
  };

  return (
    <section className={`messaging-moderation-queue${className ? ` ${className}` : ''}`}>
      <header className="messaging-moderation-queue__header">
        <h3>{title}</h3>
        {moderationState?.stats ? (
          <div className="messaging-moderation-queue__stats">
            <span>Pending: {moderationState.stats.pending ?? 0}</span>
            <span>Dual approval: {moderationState.stats.dualApproval ?? 0}</span>
            <span>Resolved: {moderationState.stats.resolved ?? 0}</span>
          </div>
        ) : null}
      </header>
      {cases.length === 0 ? (
        emptyState
      ) : (
        <ul className="messaging-moderation-queue__list">
          {cases.map((entry) => (
            <li key={entry.caseId} className="messaging-moderation-queue__item">
              <div className="messaging-moderation-queue__item-summary">
                <span className={`messaging-moderation-queue__badge messaging-moderation-queue__badge--${(entry.severity ?? 'medium').toLowerCase()}`}>
                  {entry.severity ?? 'MEDIUM'}
                </span>
                <span className="messaging-moderation-queue__case-id">{entry.caseId}</span>
                <span className="messaging-moderation-queue__case-type">{entry.type ?? 'THREAD'}</span>
                <span className="messaging-moderation-queue__case-status">{entry.status ?? 'PENDING'}</span>
              </div>
              <dl className="messaging-moderation-queue__meta">
                {entry.reason ? (
                  <>
                    <dt>Reason</dt>
                    <dd>{entry.reason}</dd>
                  </>
                ) : null}
                {entry.threadId ? (
                  <>
                    <dt>Thread</dt>
                    <dd>{entry.threadId}</dd>
                  </>
                ) : null}
                {entry.messageId ? (
                  <>
                    <dt>Message</dt>
                    <dd>{entry.messageId}</dd>
                  </>
                ) : null}
                {entry.reportedBy ? (
                  <>
                    <dt>Reported by</dt>
                    <dd>{entry.reportedBy}</dd>
                  </>
                ) : null}
                {entry.reportedAt ? (
                  <>
                    <dt>Reported at</dt>
                    <dd>{new Date(entry.reportedAt).toLocaleString()}</dd>
                  </>
                ) : null}
              </dl>
              <div className="messaging-moderation-queue__actions">
                <button
                  type="button"
                  onClick={() => void handleResolve(entry)}
                  disabled={resolvingCaseId === entry.caseId}
                >
                  {resolvingCaseId === entry.caseId ? 'Resolving…' : 'Resolve'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleRemove(entry)}
                  disabled={removingCaseId === entry.caseId}
                >
                  {removingCaseId === entry.caseId ? 'Removing…' : 'Remove'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
