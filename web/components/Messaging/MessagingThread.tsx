import React, { useCallback, useEffect, useMemo, useState } from 'react';

import {
  useMessagingActions,
  useMessagingController,
  useNotifications,
  useThread
} from '../MessagingProvider';
import {
  formatRelativeTimestamp,
  groupMessagesByDay,
  summarizeParticipants,
  summarizePresence
} from '../../../tools/frontend/messaging/ui_helpers.mjs';
import { computeSafeModeState } from '../../../tools/frontend/messaging/safe_mode.mjs';
import { createPolicyState, evaluateWithAudit } from '../../../tools/frontend/messaging/policy.mjs';

type PolicyResult = ReturnType<typeof evaluateWithAudit>;

interface MessagingThreadProps {
  threadId: string;
  viewerUserId: string;
  viewerIsVerifiedAdult?: boolean;
  allowSafeModeOverride?: boolean;
  initialSafeModeOverride?: boolean;
  timezone?: string;
  composerPlaceholder?: string;
  autoHydrate?: boolean;
  autoSubscribe?: boolean;
}

function buildPolicyResult(threadId: string, viewerUserId: string) {
  const evaluation = evaluateWithAudit(createPolicyState(), '', { threadId, userId: viewerUserId });
  return {
    state: evaluation.state,
    result: evaluation
  };
}

export const MessagingThread: React.FC<MessagingThreadProps> = ({
  threadId,
  viewerUserId,
  viewerIsVerifiedAdult = false,
  allowSafeModeOverride = false,
  initialSafeModeOverride,
  timezone = 'UTC',
  composerPlaceholder = 'Write a message…',
  autoHydrate = true,
  autoSubscribe = true
}) => {
  const threadState = useThread(threadId);
  const messagingActions = useMessagingActions();
  const controller = useMessagingController();
  useNotifications(); // ensures notification context stays warm for toast pipelines

  const [{ state: initialPolicyState, result: initialPolicyResult }] = useState(() =>
    buildPolicyResult(threadId, viewerUserId)
  );
  const [policyState, setPolicyState] = useState(initialPolicyState);
  const [policyResult, setPolicyResult] = useState<PolicyResult>(initialPolicyResult);
  const [composerText, setComposerText] = useState('');
  const [composerError, setComposerError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [safeModeOverride, setSafeModeOverride] = useState<boolean>(
    initialSafeModeOverride ?? Boolean(threadState?.safeMode?.override)
  );

  useEffect(() => {
    if (initialSafeModeOverride !== undefined) {
      setSafeModeOverride(initialSafeModeOverride);
    }
  }, [initialSafeModeOverride]);

  useEffect(() => {
    if (autoHydrate) {
      messagingActions
        .hydrateThread(threadId, { syncInbox: true })
        .catch(() => {
          // hydration may fail if not configured yet — swallow to avoid noisy UI errors
        });
    }
  }, [autoHydrate, messagingActions, threadId]);

  useEffect(() => {
    if (!autoSubscribe) {
      return undefined;
    }
    let cleanup: (() => void) | undefined;
    try {
      const result = messagingActions.startThreadSubscription(threadId);
      if (typeof result === 'function') {
        cleanup = result;
      }
    } catch (error) {
      console.warn('MessagingThread: failed to start thread subscription', error);
    }
    return () => {
      try {
        cleanup?.();
      } catch (error) {
        console.warn('MessagingThread: failed to stop thread subscription', error);
      }
    };
  }, [autoSubscribe, messagingActions, threadId]);

  useEffect(() => {
    if (!threadState) return;
    const lastMessageId = threadState.messageOrder[threadState.messageOrder.length - 1];
    if (!lastMessageId) return;
    const lastMessage = threadState.messagesById[lastMessageId];
    if (!lastMessage) return;
    const viewerParticipant = threadState.participantsById?.[viewerUserId];
    const alreadyRead = viewerParticipant?.lastReadMsgId === lastMessage.messageId;
    if (alreadyRead) {
      return;
    }
    if (lastMessage.authorUserId === viewerUserId) {
      return;
    }
    messagingActions
      .markThreadRead(threadId, {
        userId: viewerUserId,
        lastReadMsgId: lastMessage.messageId,
        lastReadAt: new Date().toISOString()
      })
      .catch(() => {
        // soft failure — UI remains responsive even if server call fails
      });
  }, [threadState, viewerUserId, messagingActions, threadId]);

  const safeModeState = useMemo(() => {
    if (!threadState) {
      return { enabled: true, bandMax: 1 };
    }
    return computeSafeModeState({
      threadSafeModeRequired: threadState.thread.safeModeRequired,
      threadBandMax: threadState.safeMode?.bandMax ?? 1,
      userIsVerifiedAdult: viewerIsVerifiedAdult,
      userOverrideRequested: safeModeOverride,
      allowOverride: allowSafeModeOverride
    });
  }, [threadState, viewerIsVerifiedAdult, safeModeOverride, allowSafeModeOverride]);

  const messageGroups = useMemo(() => {
    if (!threadState) {
      return [];
    }
    return groupMessagesByDay(threadState, {
      viewerUserId,
      timezone,
      safeMode: { enabled: safeModeState.enabled, bandMax: safeModeState.bandMax }
    });
  }, [threadState, viewerUserId, timezone, safeModeState]);

  const participantsSummary = useMemo(() => {
    if (!threadState) return { viewer: null, others: [] };
    return summarizeParticipants(threadState, viewerUserId);
  }, [threadState, viewerUserId]);

  const presenceSummary = useMemo(() => {
    if (!threadState) return [];
    return summarizePresence(threadState);
  }, [threadState]);

  const actionCards = useMemo(() => {
    if (!threadState) return [];
    return threadState.actionCardOrder
      .map((actionId) => threadState.actionCardsById[actionId])
      .filter(Boolean);
  }, [threadState]);

  const actionCardTransitions = useMemo(() => {
    const map: Record<string, string[]> = {};
    if (!controller) {
      return map;
    }
    for (const card of actionCards) {
      try {
        map[card.actionId] =
          controller.getActionCardTransitions?.(threadId, card.actionId, { includeInvalid: false }) ?? [];
      } catch {
        map[card.actionId] = [];
      }
    }
    return map;
  }, [controller, actionCards, threadId]);

  const handleComposerChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const nextValue = event.target.value;
      setComposerText(nextValue);
      setComposerError(null);
      setPolicyState((previous) => {
        const evaluation = evaluateWithAudit(previous, nextValue, { threadId, userId: viewerUserId });
        setPolicyResult(evaluation);
        return evaluation.state;
      });
    },
    [threadId, viewerUserId]
  );

  const handleComposerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void handleSendMessage();
      }
    },
    []
  );

  const handleSendMessage = useCallback(async () => {
    const trimmed = composerText.trim();
    if (!threadState || trimmed.length === 0) {
      return;
    }
    if (policyResult.status === 'BLOCK') {
      setComposerError('Message blocked by policy. Please revise and try again.');
      return;
    }
    const clientId = `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    setIsSending(true);
    setComposerError(null);
    try {
      await messagingActions.sendMessage(threadId, {
        clientId,
        body: trimmed,
        attachments: [],
        authorUserId: viewerUserId
      });
      setComposerText('');
      const evaluation = evaluateWithAudit(policyState, '', { threadId, userId: viewerUserId });
      setPolicyState(evaluation.state);
      setPolicyResult(evaluation);
    } catch (error) {
      const message =
        (error as Error)?.message ?? 'Failed to send message. Please retry once your connection recovers.';
      setComposerError(message);
    } finally {
      setIsSending(false);
    }
  }, [composerText, messagingActions, policyResult.status, policyState, threadId, threadState, viewerUserId]);

  const handleActionCardIntent = useCallback(
    (actionId: string, intent: string) => {
      try {
        controller?.applyActionCardIntent?.(threadId, actionId, intent);
      } catch (error) {
        console.warn('MessagingThread: failed to apply action card intent', error);
      }
    },
    [controller, threadId]
  );

  if (!threadState) {
    return (
      <div className="messaging-thread messaging-thread--empty">
        <p>Select a conversation to begin messaging.</p>
      </div>
    );
  }

  return (
    <div className="messaging-thread">
      <header className="messaging-thread__header">
        <div>
          <h2 className="messaging-thread__title">{threadState.thread.kind === 'PROJECT' ? 'Project thread' : 'Inquiry'}</h2>
          <p className="messaging-thread__meta">
            Last message {threadState.thread.lastMessageAt ? formatRelativeTimestamp(threadState.thread.lastMessageAt) : 'unknown'}
          </p>
        </div>
        <div className="messaging-thread__participants">
          {participantsSummary.others.map((participant) => {
            const presence = presenceSummary.find((entry) => entry.userId === participant.userId);
            return (
              <span key={participant.userId} className={`messaging-thread__presence messaging-thread__presence--${presence?.status ?? 'offline'}`}>
                {participant.userId}
                {presence?.status === 'typing' ? ' • typing…' : presence?.status === 'online' ? ' • online' : ''}
              </span>
            );
          })}
        </div>
        {allowSafeModeOverride ? (
          <div className="messaging-thread__safemode">
            <label>
              <input
                type="checkbox"
                checked={!safeModeState.enabled}
                onChange={() => setSafeModeOverride((prev) => !prev)}
                disabled={threadState.thread.safeModeRequired}
              />
              {safeModeState.enabled ? 'Safe-Mode enabled' : 'Safe-Mode off'}
            </label>
            {threadState.thread.safeModeRequired ? (
              <span className="messaging-thread__safemode-note">Required by policy for this thread.</span>
            ) : null}
          </div>
        ) : (
          <div className="messaging-thread__safemode messaging-thread__safemode--readonly">
            {safeModeState.enabled ? 'Safe-Mode active' : 'Safe-Mode override active'}
          </div>
        )}
      </header>

      <section className="messaging-thread__timeline">
        {messageGroups.map((group) => (
          <div key={group.dayKey} className="messaging-thread__day">
            <div className="messaging-thread__day-divider">{group.label}</div>
            <ul className="messaging-thread__messages">
              {group.messages.map((message) => (
                <li
                  key={message.messageId}
                  className={`messaging-thread__message messaging-thread__message--${message.direction} messaging-thread__message--${message.type.toLowerCase()}`}
                >
                  <div className="messaging-thread__message-meta">
                    <span className="messaging-thread__message-author">{message.authorUserId ?? 'Unknown'}</span>
                    <span className="messaging-thread__message-time">{message.timeLabel}</span>
                    {message.optimistic ? (
                      <span className="messaging-thread__message-status">sending…</span>
                    ) : message.deliveryState === 'FAILED' ? (
                      <span className="messaging-thread__message-status messaging-thread__message-status--error">
                        failed
                      </span>
                    ) : null}
                  </div>
                  {message.redacted ? (
                    <p className="messaging-thread__message-body messaging-thread__message-body--redacted">
                      {message.body}
                    </p>
                  ) : (
                    <p className="messaging-thread__message-body">{message.body}</p>
                  )}
                  {Array.isArray(message.attachments) && message.attachments.length > 0 ? (
                    <ul className="messaging-thread__attachments">
                      {message.attachments.map((attachment) => (
                        <li
                          key={attachment.attachmentId ?? attachment.fileName ?? attachment.url ?? Math.random()}
                          className={`messaging-thread__attachment messaging-thread__attachment--${attachment.display?.displayState ?? 'unknown'}`}
                        >
                          <span className="messaging-thread__attachment-name">{attachment.fileName ?? attachment.url ?? 'Attachment'}</span>
                          <span className="messaging-thread__attachment-state">{attachment.display?.reason ?? ''}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {message.action ? (
                    <div className="messaging-thread__actioncard">
                      <span className="messaging-thread__actioncard-type">{message.action.type}</span>
                      <span className="messaging-thread__actioncard-state">{message.action.state}</span>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {actionCards.length > 0 ? (
        <section className="messaging-thread__actions-panel">
          <h3>Open action cards</h3>
          <ul className="messaging-thread__actions-list">
            {actionCards.map((card) => (
              <li key={card.actionId} className="messaging-thread__action">
                <div className="messaging-thread__action-header">
                  <span className="messaging-thread__action-type">{card.type}</span>
                  <span className="messaging-thread__action-state">{card.state}</span>
                  <span className="messaging-thread__action-updated">
                    Updated {formatRelativeTimestamp(card.updatedAt ?? card.createdAt)}
                  </span>
                </div>
                {card.payload ? (
                  <pre className="messaging-thread__action-payload">
                    {JSON.stringify(card.payload, null, 2)}
                  </pre>
                ) : null}
                {actionCardTransitions[card.actionId]?.length ? (
                  <div className="messaging-thread__action-buttons">
                    {actionCardTransitions[card.actionId].map((intent) => (
                      <button key={intent} type="button" onClick={() => handleActionCardIntent(card.actionId, intent)}>
                        {intent.toLowerCase()}
                      </button>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="messaging-thread__composer">
        {policyResult.status === 'NUDGE' ? (
          <div className="messaging-thread__composer-warning">
            <strong>Moderation notice:</strong> Please review your message before sending.
          </div>
        ) : null}
        {composerError ? <div className="messaging-thread__composer-error">{composerError}</div> : null}
        <textarea
          value={composerText}
          onChange={handleComposerChange}
          onKeyDown={handleComposerKeyDown}
          placeholder={composerPlaceholder}
          rows={3}
          className="messaging-thread__composer-input"
        />
        <div className="messaging-thread__composer-footer">
          <span className="messaging-thread__composer-policy">{policyResult.status}</span>
          <button
            type="button"
            onClick={() => void handleSendMessage()}
            disabled={isSending || composerText.trim().length === 0 || policyResult.status === 'BLOCK'}
          >
            {isSending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </section>
    </div>
  );
};
