'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useMessagingActions, useModerationQueue } from '../MessagingProvider';

type ModerationApproval = {
  actorId?: string;
  actorRole?: string;
  decision?: string;
  notes?: string;
  decidedAt?: string;
};

type ModerationResolution = {
  outcome?: string;
  notes?: string;
  resolvedBy?: string;
  resolvedAt?: string;
};

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
  approvals?: ModerationApproval[];
  requiresDualApproval?: boolean;
  resolution?: ModerationResolution | null;
};

type DecisionOption = {
  value: string;
  label: string;
  intent?: 'primary' | 'danger' | 'secondary';
  description?: string;
};

const DEFAULT_DECISION_OPTIONS: DecisionOption[] = [
  { value: 'APPROVE', label: 'Approve', intent: 'primary' },
  { value: 'REJECT', label: 'Reject', intent: 'danger' }
];

const formatTimestamp = (input?: string) => {
  if (!input) {
    return null;
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return input;
  }
  return date.toLocaleString();
};

const decisionClassName = (intent?: DecisionOption['intent']) => {
  const suffix = intent ? intent.toLowerCase() : 'primary';
  return `messaging-moderation-queue__decision messaging-moderation-queue__decision--${suffix}`;
};

export interface MessagingModerationQueueProps {
  className?: string;
  title?: string;
  statusFilter?: string;
  severityFilter?: string;
  emptyState?: React.ReactNode;
  decisionOptions?: DecisionOption[];
  onResolveCase?: (moderationCase: ModerationCase) => Promise<void> | void;
  onRemoveCase?: (moderationCase: ModerationCase) => Promise<void> | void;
  onSubmitDecision?: (moderationCase: ModerationCase, decision: string) => Promise<void> | void;

  /** Auto-hydrate the queue when the component mounts (default true) */
  autoHydrate?: boolean;
  /** Re-hydrate the queue on an interval (ms). Set 0 to disable. Default 30000. */
  autoRefreshIntervalMs?: number;
  /** Show a manual refresh button (default true). */
  showRefresh?: boolean;
}

export const MessagingModerationQueue: React.FC<MessagingModerationQueueProps> = ({
  className,
  title = 'Moderation queue',
  statusFilter,
  severityFilter,
  emptyState = <p className="messaging-moderation-queue__empty">No moderation cases pending review.</p>,
  decisionOptions,
  onResolveCase,
  onRemoveCase,
  onSubmitDecision,
  autoHydrate = true,
  autoRefreshIntervalMs = 30000,
  showRefresh = true
}) => {
  const [resolvingCaseId, setResolvingCaseId] = useState<string | null>(null);
  const [removingCaseId, setRemovingCaseId] = useState<string | null>(null);
  const [decidingKey, setDecidingKey] = useState<string | null>(null);
  const moderationState = useModerationQueue((state: any) => state);
  const messagingActions = useMessagingActions();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const rehydrate = useCallback(async (reason: string) => {
    try {
      if (messagingActions.hydrateModerationQueue) {
        await messagingActions.hydrateModerationQueue({ reason });
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('MessagingModerationQueue: hydrate failed', error);
    }
  }, [messagingActions]);

  useEffect(() => {
    if (!autoHydrate) return;

    void rehydrate('mount');

    // If the data source exposes a live subscription, prefer that.
    let cleanup: (() => void) | undefined;
    try {
      if (typeof messagingActions.subscribeModerationQueue === 'function') {
        const maybeCleanup = messagingActions.subscribeModerationQueue();
        if (typeof maybeCleanup === 'function') {
          cleanup = maybeCleanup;
        }
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('MessagingModerationQueue: subscribe failed', error);
    }

    if (autoRefreshIntervalMs > 0) {
      intervalRef.current = setInterval(() => {
        void rehydrate('interval_refresh');
      }, autoRefreshIntervalMs);
    }

    const onFocus = () => void rehydrate('window_focus');
    const onOnline = () => void rehydrate('network_online');
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);

    return () => {
      if (cleanup) {
        try {
          cleanup();
        } catch {
          // ignore
        }
      }
      if (intervalRef.current) clearInterval(intervalRef.current);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
    };
  }, [autoHydrate, autoRefreshIntervalMs, messagingActions, rehydrate]);

  const normalizedDecisionOptions = useMemo(() => {
    const options = (decisionOptions ?? DEFAULT_DECISION_OPTIONS).filter(
      (option): option is DecisionOption => Boolean(option?.value && option?.label)
    );
    return options.length > 0 ? options : DEFAULT_DECISION_OPTIONS;
  }, [decisionOptions]);

  const canSubmitDecision = Boolean(onSubmitDecision || messagingActions.submitModerationDecision);

  const cases = useMemo(() => {
    if (!moderationState?.order) {
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

  const handleDecision = async (moderationCase: ModerationCase, decisionValue: string) => {
    if (!moderationCase?.caseId || !decisionValue) {
      return;
    }
    setDecidingKey(`${moderationCase.caseId}:${decisionValue}`);
    try {
      if (onSubmitDecision) {
        await onSubmitDecision(moderationCase, decisionValue);
      } else {
        await messagingActions.submitModerationDecision?.(moderationCase.caseId, { decision: decisionValue });
      }
      // keep the queue fresh
      await rehydrate('after_decision');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('MessagingModerationQueue: submitDecision failed', error);
    } finally {
      setDecidingKey(null);
    }
  };

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
      await rehydrate('after_resolve');
    } catch (error) {
      // eslint-disable-next-line no-console
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
      await rehydrate('after_remove');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('MessagingModerationQueue: removeCase failed', error);
    } finally {
      setRemovingCaseId(null);
    }
  };

  return (
    <section className={`messaging-moderation-queue${className ? ` ${className}` : ''}`}>
      <header className="messaging-moderation-queue__header">
        <h3>{title}</h3>
        {showRefresh ? (
          <div className="messaging-moderation-queue__header-actions">
            <button type="button" onClick={() => void rehydrate('manual_refresh')}>Refresh</button>
          </div>
        ) : null}
        {moderationState?.stats ? (
          <div className="messaging-moderation-queue__stats">
            <span>Pending: {moderationState.stats.pending ?? 0}</span>
            <span>Awaiting second: {moderationState.stats.awaitingSecond ?? 0}</span>
            <span>Dual approval: {moderationState.stats.dualApproval ?? 0}</span>
            <span>Resolved: {moderationState.stats.resolved ?? 0}</span>
          </div>
        ) : null}
      </header>
      {cases.length === 0 ? (
        emptyState
      ) : (
        <ul className="messaging-moderation-queue__list">
          {cases.map((entry: any) => {
            const status = (entry.status ?? 'PENDING').toUpperCase();
            const isResolved = status === 'RESOLVED';
            const awaitingSecond = status === 'AWAITING_SECOND_APPROVAL';
            const reportedAtLabel = formatTimestamp(entry.reportedAt);
            const decisionInFlight = decidingKey?.startsWith(`${entry.caseId}:`) ?? false;
            const resolving = resolvingCaseId === entry.caseId;
            const removing = removingCaseId === entry.caseId;
            const resolveDisabled = isResolved || resolving || decisionInFlight;
            const removeDisabled = removing || decisionInFlight;
            const resolutionTimestamp = entry.resolution ? formatTimestamp(entry.resolution.resolvedAt) : null;
            return (
              <li key={entry.caseId} className="messaging-moderation-queue__item">
                <div className="messaging-moderation-queue__item-summary">
                  <span
                    className={`messaging-moderation-queue__badge messaging-moderation-queue__badge--${
                      (entry.severity ?? 'medium').toLowerCase()
                    }`}
                  >
                    {entry.severity ?? 'MEDIUM'}
                  </span>
                  <span className="messaging-moderation-queue__case-id">{entry.caseId}</span>
                  <span className="messaging-moderation-queue__case-type">{entry.type ?? 'THREAD'}</span>
                  <span className="messaging-moderation-queue__case-status">{status}</span>
                  {entry.requiresDualApproval ? (
                    <span className="messaging-moderation-queue__badge messaging-moderation-queue__badge--dual">
                      Dual approval
                    </span>
                  ) : null}
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
                  {reportedAtLabel ? (
                    <>
                      <dt>Reported at</dt>
                      <dd>
                        <time dateTime={entry.reportedAt}>{reportedAtLabel}</time>
                      </dd>
                    </>
                  ) : null}
                  {entry.requiresDualApproval ? (
                    <>
                      <dt>Dual approval</dt>
                      <dd>{awaitingSecond ? 'Awaiting secondary reviewer' : 'Required'}</dd>
                    </>
                  ) : null}
                  {Array.isArray(entry.approvals) && entry.approvals.length > 0 ? (
                    <>
                      <dt>Approvals</dt>
                      <dd>
                        <ul className="messaging-moderation-queue__approvals">
                          {entry.approvals.map((approval: any, index: number) => {
                            const approvalKey = `${entry.caseId}-${approval.actorId ?? index}-${approval.decidedAt ?? index}`;
                            const approvalTimestamp = formatTimestamp(approval.decidedAt);
                            return (
                              <li key={approvalKey} className="messaging-moderation-queue__approval">
                                <span
                                  className={`messaging-moderation-queue__approval-decision messaging-moderation-queue__approval-decision--${
                                    (approval.decision ?? 'unknown').toLowerCase()
                                  }`}
                                >
                                  {approval.decision ?? 'UNKNOWN'}
                                </span>
                                {approval.actorId ? (
                                  <span className="messaging-moderation-queue__approval-actor">{approval.actorId}</span>
                                ) : null}
                                {approvalTimestamp ? (
                                  <time
                                    dateTime={approval.decidedAt}
                                    className="messaging-moderation-queue__approval-time"
                                  >
                                    {approvalTimestamp}
                                  </time>
                                ) : null}
                                {approval.notes ? (
                                  <span className="messaging-moderation-queue__approval-notes">{approval.notes}</span>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      </dd>
                    </>
                  ) : null}
                  {entry.resolution ? (
                    <>
                      <dt>Resolution</dt>
                      <dd>
                        <span
                          className={`messaging-moderation-queue__resolution-outcome messaging-moderation-queue__resolution-outcome--${(entry.resolution.outcome ?? 'resolved').toLowerCase()}`}
                        >
                          {entry.resolution.outcome ?? 'RESOLVED'}
                        </span>
                        {entry.resolution.resolvedBy ? (
                          <span className="messaging-moderation-queue__resolution-actor">
                            {entry.resolution.resolvedBy}
                          </span>
                        ) : null}
                        {resolutionTimestamp ? (
                          <time
                            dateTime={entry.resolution.resolvedAt ?? undefined}
                            className="messaging-moderation-queue__resolution-time"
                          >
                            {resolutionTimestamp}
                          </time>
                        ) : null}
                        {entry.resolution.notes ? (
                          <span className="messaging-moderation-queue__resolution-notes">{entry.resolution.notes}</span>
                        ) : null}
                      </dd>
                    </>
                  ) : null}
                </dl>
                <div className="messaging-moderation-queue__actions">
                  {!isResolved && canSubmitDecision && normalizedDecisionOptions.length > 0 ? (
                    <div className="messaging-moderation-queue__decision-group">
                      {normalizedDecisionOptions.map((option) => {
                        const key = `${entry.caseId}:${option.value}`;
                        const buttonInFlight = decidingKey === key;
                        const decisionDisabled = (decisionInFlight && !buttonInFlight) || resolving || removing;
                        return (
                          <button
                            key={key}
                            type="button"
                            className={decisionClassName(option.intent)}
                            onClick={() => void handleDecision(entry, option.value)}
                            disabled={decisionDisabled}
                            title={option.description}
                          >
                            {buttonInFlight ? `Submitting ${option.label}…` : option.label}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  <button type="button" onClick={() => void handleResolve(entry)} disabled={resolveDisabled}>
                    {isResolved ? 'Resolved' : resolving ? 'Resolving…' : 'Resolve'}
                  </button>
                  <button type="button" onClick={() => void handleRemove(entry)} disabled={removeDisabled}>
                    {removing ? 'Removing…' : 'Remove'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};
