// @ts-nocheck
'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  useMessagingActions,
  useMessagingController,
  useNotifications,
  useThread,
  useUploads
} from '../MessagingProvider';
import {
  formatRelativeTimestamp,
  groupMessagesByDay,
  summarizeParticipants,
  summarizePresence
} from '../../../tools/frontend/messaging/ui_helpers.mjs';
import { computeSafeModeState } from '../../../tools/frontend/messaging/safe_mode.mjs';
import { createPolicyState, evaluateWithAudit } from '../../../tools/frontend/messaging/policy.mjs';
import {
  presentActionCard,
  formatActionCardIntentLabel
} from '../../../tools/frontend/messaging/action_card_presenter.mjs';

type PolicyResult = ReturnType<typeof evaluateWithAudit>;

export interface MessagingThreadProps {
  threadId: string;
  viewerUserId: string;
  viewerIsVerifiedAdult?: boolean;
  allowSafeModeOverride?: boolean;
  initialSafeModeOverride?: boolean;
  timezone?: string;
  locale?: string;
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
  locale = 'en-US',
  composerPlaceholder = 'Write a message…',
  autoHydrate = true,
  autoSubscribe = true
}) => {
  const threadState = useThread(threadId);
  const messagingActions = useMessagingActions();
  const controller = useMessagingController();
  useNotifications(); // ensures notification context stays warm for toast pipelines

  const uploadState = useUploads();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingUploadIds, setPendingUploadIds] = useState<string[]>([]);
  const [isUploadInFlight, setIsUploadInFlight] = useState(false);
  const [reportingMessageId, setReportingMessageId] = useState<string | null>(null);

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
    setPendingUploadIds([]);
  }, [threadId]);

  const pendingUploads = useMemo(() => {
    if (!uploadState || !Array.isArray(uploadState.order)) {
      return [];
    }
    return pendingUploadIds
      .map((clientId) => uploadState.itemsByClientId?.[clientId])
      .filter(Boolean) as Array<Record<string, any>>;
  }, [uploadState, pendingUploadIds]);

  const uploadsReady = useMemo(
    () => pendingUploads.every((upload) => upload.status === 'READY'),
    [pendingUploads]
  );

  const attachmentsForSend = useMemo(
    () =>
      pendingUploads
        .filter((upload) => upload.status === 'READY')
        .map((upload) => ({
          attachmentId: upload.attachmentId ?? upload.clientId,
          fileName: upload.fileName ?? upload.metadata?.fileName ?? 'attachment',
          mimeType: upload.mimeType ?? 'application/octet-stream',
          status: upload.status,
          nsfwBand: upload.nsfwBand ?? 0
        })),
    [pendingUploads]
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
      // eslint-disable-next-line no-console
      console.warn('MessagingThread: failed to start thread subscription', error);
    }
    // resubscribe on focus/online events as needed
    const onFocus = () => {
      try {
        messagingActions.startThreadSubscription?.(threadId);
      } catch {
        /* ignore */
      }
    };
    const onOnline = () => {
      try {
        messagingActions.startThreadSubscription?.(threadId);
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);

    return () => {
      try {
        cleanup?.();
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('MessagingThread: failed to stop thread subscription', error);
      }
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
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

  const threadModeration = threadState?.thread?.moderation ?? null;
  const isThreadLocked = threadModeration?.locked ?? false;
  const isThreadBlocked = threadModeration?.blocked ?? false;
  const composerUnavailable = isThreadLocked || isThreadBlocked;

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

  const presentedActionCards = useMemo(
    () =>
      actionCards.map((card) => ({
        card,
        presentation: presentActionCard(card, { locale, timezone })
      })),
    [actionCards, locale, timezone]
  );

  const actionCardTransitions = useMemo(() => {
    const map: Record<string, Array<{ intent: string; toState?: string }>> = {};
    if (!controller) {
      return map;
    }
    for (const entry of actionCards) {
      const actionId = entry?.actionId;
      if (!actionId) {
        continue;
      }
      try {
        const transitions =
          controller.getActionCardTransitions?.(threadId, actionId, { includeInvalid: false }) ?? [];
        map[actionId] = Array.isArray(transitions) ? transitions : [];
      } catch {
        map[actionId] = [];
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
    // Guard if messaging is disabled for this thread.
    if (composerUnavailable) {
      setComposerError(
        isThreadBlocked
          ? 'This conversation is blocked pending moderation review.'
          : 'This conversation is locked. Messaging is temporarily disabled.'
      );
      return;
    }
    if (policyResult.status === 'BLOCK') {
      setComposerError('Message blocked by policy. Please revise and try again.');
      return;
    }
    if (!uploadsReady) {
      setComposerError('Please wait for uploads to finish before sending.');
      return;
    }
    const clientId = `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    setIsSending(true);
    setComposerError(null);
    try {
      await messagingActions.sendMessage(threadId, {
        clientId,
        body: trimmed,
        attachments: attachmentsForSend,
        authorUserId: viewerUserId
      });
      setComposerText('');
      const evaluation = evaluateWithAudit(policyState, '', { threadId, userId: viewerUserId });
      setPolicyState(evaluation.state);
      setPolicyResult(evaluation);
      setPendingUploadIds([]);
    } catch (error) {
      const message =
        (error as Error)?.message ??
        'Failed to send message. Please retry once your connection recovers.';
      setComposerError(message);
    } finally {
      setIsSending(false);
    }
  }, [
    attachmentsForSend,
    composerText,
    messagingActions,
    policyResult.status,
    policyState,
    threadId,
    threadState,
    uploadsReady,
    viewerUserId,
    composerUnavailable,
    isThreadBlocked
  ]);

  const handleActionCardIntent = useCallback(
    (actionId: string, intent: string) => {
      try {
        controller?.applyActionCardIntent?.(threadId, actionId, intent);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('MessagingThread: failed to apply action card intent', error);
      }
    },
    [controller, threadId]
  );

  const handleUploadButtonClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleSelectFiles = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const { files } = event.target;
      if (!files || files.length === 0) {
        return;
      }
      setComposerError(null);
      setIsUploadInFlight(true);
      try {
        for (const file of Array.from(files)) {
          try {
            const upload = await messagingActions.prepareUpload(threadId, {
              fileName: file.name,
              mimeType: file.type || undefined,
              sizeBytes: file.size,
              file
            });
            if (upload?.clientId) {
              setPendingUploadIds((previous) =>
                previous.includes(upload.clientId) ? previous : [...previous, upload.clientId]
              );
            }
          } catch (error) {
            const message =
              (error as Error)?.message ?? 'Failed to prepare upload. Please try again.';
            setComposerError(message);
          }
        }
      } finally {
        setIsUploadInFlight(false);
        if (event.target) {
          event.target.value = '';
        }
      }
    },
    [messagingActions, threadId]
  );

  const handleRemoveUpload = useCallback(
    (clientId: string) => {
      setPendingUploadIds((previous) => previous.filter((id) => id !== clientId));
      try {
        messagingActions.cancelUpload?.(clientId);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('MessagingThread: cancelUpload failed', error);
      }
    },
    [messagingActions]
  );

  const handleReportMessage = useCallback(
    async (messageId: string) => {
      if (!messageId) {
        return;
      }
      setReportingMessageId(messageId);
      try {
        await messagingActions.reportMessage?.(threadId, messageId, {
          reason: 'USER_REPORT',
          severity: 'MEDIUM'
        });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('MessagingThread: reportMessage failed', error);
      } finally {
        setReportingMessageId(null);
      }
    },
    [messagingActions, threadId]
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
          <h2 className="messaging-thread__title">
            {threadState.thread.kind === 'PROJECT' ? 'Project thread' : 'Inquiry'}
          </h2>
          <p className="messaging-thread__meta">
            Last message{' '}
            {threadState.thread.lastMessageAt
              ? formatRelativeTimestamp(threadState.thread.lastMessageAt)
              : 'unknown'}
          </p>
        </div>
        <div className="messaging-thread__participants">
          {participantsSummary.others.map((participant) => {
            const presence = presenceSummary.find((entry) => entry.userId === participant.userId);
            return (
              <span
                key={participant.userId}
                className={`messaging-thread__presence messaging-thread__presence--${
                  presence?.status ?? 'offline'
                }`}
              >
                {participant.userId}
                {presence?.status === 'typing'
                  ? ' • typing…'
                  : presence?.status === 'online'
                  ? ' • online'
                  : ''}
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
                    ) : message.moderationFlagged ? (
                      <span className="messaging-thread__message-status messaging-thread__message-status--flagged">
                        {message.moderationState ?? 'FLAGGED'}
                      </span>
                    ) : null}
                    {!message.moderationFlagged && (
                      <button
                        type="button"
                        className="messaging-thread__message-report"
                        onClick={() => void handleReportMessage(message.messageId)}
                        disabled={reportingMessageId === message.messageId}
                      >
                        {reportingMessageId === message.messageId ? 'Reporting…' : 'Report'}
                      </button>
                    )}
                  </div>
                  {message.redacted ? (
                    <p className="messaging-thread__message-body messaging-thread__message-body--redacted">
                      {message.body}
                    </p>
                  ) : (
                    <p className="messaging-thread__message-body">{message.body}</p>
                  )}
                  {message.moderationFlagged ? (
                    <div className="messaging-thread__message-moderation">
                      Flagged for review{message.moderationReason ? `: ${message.moderationReason}` : ''}
                    </div>
                  ) : null}
                  {Array.isArray(message.attachments) && message.attachments.length > 0 ? (
                    <ul className="messaging-thread__attachments">
                      {message.attachments.map((attachment) => (
                        <li
                          key={attachment.attachmentId ?? attachment.fileName ?? attachment.url ?? Math.random()}
                          className={`messaging-thread__attachment messaging-thread__attachment--${
                            attachment.display?.displayState ?? 'unknown'
                          }`}
                        >
                          <span className="messaging-thread__attachment-name">
                            {attachment.fileName ?? attachment.url ?? 'Attachment'}
                          </span>
                          <span className="messaging-thread__attachment-state">
                            {attachment.display?.reason ?? ''}
                          </span>
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

      {presentedActionCards.length > 0 ? (
        <section className="messaging-thread__actions-panel">
          <h3>Open action cards</h3>
          <ul className="messaging-thread__actions-list">
            {presentedActionCards.map(({ card, presentation }) => {
              const transitions = actionCardTransitions[card.actionId] ?? [];
              const actionClassNames = ['messaging-thread__action'];
              if (presentation.requiresAttention) {
                actionClassNames.push('messaging-thread__action--pending');
              }
              return (
                <li key={card.actionId} className={actionClassNames.join(' ')}>
                  <div className="messaging-thread__action-header">
                    <span className="messaging-thread__action-type">{presentation.title}</span>
                    <span
                      className={`messaging-thread__action-state messaging-thread__action-state--${presentation.stateTone}`}
                    >
                      {presentation.stateLabel}
                    </span>
                    <span className="messaging-thread__action-updated">
                      Updated {formatRelativeTimestamp(card.updatedAt ?? card.createdAt)}
                    </span>
                  </div>
                  {presentation.summary ? (
                    <p className="messaging-thread__action-summary">{presentation.summary}</p>
                  ) : null}
                  {presentation.metadata.length ? (
                    <dl className="messaging-thread__action-metadata">
                      {presentation.metadata.map((entry, index) => (
                        <div
                          key={`${card.actionId}-metadata-${index}`}
                          className="messaging-thread__action-metadata-row"
                        >
                          <dt>{entry.label}</dt>
                          <dd>{entry.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                  {presentation.attachments.length ? (
                    <ul className="messaging-thread__action-attachments">
                      {presentation.attachments.map((attachment, index) => (
                        <li key={`${card.actionId}-attachment-${index}`}>
                          <span className="messaging-thread__action-attachment-label">{attachment.label}</span>
                          <span className="messaging-thread__action-attachment-value">{attachment.value}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {transitions.length ? (
                    <div className="messaging-thread__action-buttons">
                      {transitions.map((transition, index) => {
                        const intent = typeof transition === 'string' ? transition : transition?.intent;
                        if (!intent) {
                          return null;
                        }
                        return (
                          <button
                            key={`${card.actionId}-intent-${intent}-${index}`}
                            type="button"
                            onClick={() => handleActionCardIntent(card.actionId, intent)}
                          >
                            {formatActionCardIntentLabel(intent)}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="messaging-thread__composer">
        {composerUnavailable ? (
          <div className="messaging-thread__composer-warning messaging-thread__composer-warning--locked">
            {isThreadBlocked
              ? 'This conversation is blocked. Messaging is disabled pending moderation review.'
              : 'This conversation is locked. Messaging is temporarily disabled.'}
          </div>
        ) : policyResult.status === 'NUDGE' ? (
          <div className="messaging-thread__composer-warning">
            <strong>Moderation notice:</strong> Please review your message before sending.
          </div>
        ) : null}
        {composerError ? <div className="messaging-thread__composer-error">{composerError}</div> : null}
        <div className="messaging-thread__composer-upload">
          <button
            type="button"
            className="messaging-thread__upload-button"
            onClick={handleUploadButtonClick}
            disabled={isUploadInFlight || composerUnavailable}
          >
            {isUploadInFlight ? 'Preparing…' : 'Attach files'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={handleSelectFiles}
            disabled={composerUnavailable}
          />
        </div>
        {pendingUploads.length > 0 ? (
          <ul className="messaging-thread__pending-uploads">
            {pendingUploads.map((upload) => {
              const sizeLabel =
                typeof upload.sizeBytes === 'number' ? `${Math.round(upload.sizeBytes / 1024)} KB` : null;
              const progress =
                upload.progress && typeof upload.progress.totalBytes === 'number'
                  ? Math.round((upload.progress.uploadedBytes / upload.progress.totalBytes) * 100)
                  : upload.status === 'READY'
                  ? 100
                  : null;
              return (
                <li
                  key={upload.clientId}
                  className={`messaging-thread__pending-upload messaging-thread__pending-upload--${upload.status.toLowerCase()}`}
                >
                  <div className="messaging-thread__pending-upload-info">
                    <span className="messaging-thread__pending-upload-name">
                      {upload.fileName ?? upload.metadata?.fileName ?? upload.clientId}
                    </span>
                    {sizeLabel ? <span className="messaging-thread__pending-upload-size">{sizeLabel}</span> : null}
                  </div>
                  <div className="messaging-thread__pending-upload-meta">
                    <span className="messaging-thread__pending-upload-status">{upload.status.toLowerCase()}</span>
                    {progress !== null ? (
                      <span className="messaging-thread__pending-upload-progress">{progress}%</span>
                    ) : null}
                    <button
                      type="button"
                      className="messaging-thread__pending-upload-remove"
                      onClick={() => handleRemoveUpload(upload.clientId)}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
        {!uploadsReady && pendingUploads.length > 0 ? (
          <p className="messaging-thread__upload-note">Uploads processing…</p>
        ) : null}
        <textarea
          value={composerText}
          onChange={handleComposerChange}
          onKeyDown={handleComposerKeyDown}
          placeholder={composerPlaceholder}
          rows={3}
          className="messaging-thread__composer-input"
          disabled={composerUnavailable}
        />
        <div className="messaging-thread__composer-footer">
          <span className="messaging-thread__composer-policy">{policyResult.status}</span>
          <button
            type="button"
            onClick={() => void handleSendMessage()}
            disabled={
              isSending ||
              isUploadInFlight ||
              composerText.trim().length === 0 ||
              policyResult.status === 'BLOCK' ||
              !uploadsReady ||
              composerUnavailable
            }
          >
            {isSending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </section>
    </div>
  );
};
