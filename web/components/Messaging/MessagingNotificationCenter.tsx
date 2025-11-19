import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { useMessagingActions, useNotifications } from '../MessagingProvider';
import { isWithinQuietHours } from '../../../tools/frontend/messaging/notification_queue.mjs';
import { formatRelativeTimestamp } from '../../../tools/frontend/messaging/ui_helpers.mjs';

type ReadyNotification = {
  id?: string;
  threadId?: string | null;
  type?: string;
  severity?: string;
  message?: string | null;
  data?: Record<string, unknown>;
  count?: number;
  createdAt?: string;
  updatedAt?: string;
};

type DigestSummary = {
  threadId: string | null;
  count: number;
  highestSeverity: string;
  firstAt: string | null;
  lastAt: string | null;
  sampleMessages: string[];
};

export interface MessagingNotificationCenterProps {
  className?: string;
  locale?: string;
  timezone?: string;
  maxReady?: number;
  autoFlushIntervalMs?: number;
  autoDigestIntervalMs?: number;
  quietHoursPollIntervalMs?: number;
  showDigestSummaries?: boolean;
  onNotificationClick?: (notification: ReadyNotification) => void;
}

function formatTimeRange(minutes: number | null | undefined, locale: string, timezone: string): string | null {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) {
    return null;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const date = new Date(Date.UTC(1970, 0, 1, hours, mins));
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone
  }).format(date);
}

function formatSeverity(value: string | undefined) {
  if (!value) return 'NORMAL';
  return value.toUpperCase();
}

export const MessagingNotificationCenter: React.FC<MessagingNotificationCenterProps> = ({
  className,
  locale = 'en-US',
  timezone = 'UTC',
  maxReady = 20,
  autoFlushIntervalMs,
  autoDigestIntervalMs,
  quietHoursPollIntervalMs = 60_000,
  showDigestSummaries = true,
  onNotificationClick
}) => {
  const notificationState = useNotifications();
  const {
    flushNotifications,
    collectNotificationDigest,
    listPendingNotifications
  } = useMessagingActions();

  const [readyNotifications, setReadyNotifications] = useState<ReadyNotification[]>([]);
  const [digests, setDigests] = useState<DigestSummary[]>([]);
  const [lastFlushAt, setLastFlushAt] = useState<string | null>(null);
  const [lastDigestAt, setLastDigestAt] = useState<string | null>(null);
  const [quietHoursActive, setQuietHoursActive] = useState<boolean>(() =>
    notificationState ? isWithinQuietHours(notificationState) : false
  );

  const pendingNotifications = useMemo<ReadyNotification[]>(() => {
    if (!listPendingNotifications) return [];
    try {
      const pending = listPendingNotifications();
      if (!Array.isArray(pending)) return [];
      return pending as ReadyNotification[];
    } catch {
      return [];
    }
  }, [listPendingNotifications, notificationState?.lastUpdatedAt]);

  const flushNow = useCallback(() => {
    if (!flushNotifications) return;
    try {
      const flushed = flushNotifications();
      if (Array.isArray(flushed) && flushed.length > 0) {
        setReadyNotifications((prev) => {
          const merged = [...flushed, ...prev];
          if (merged.length <= maxReady) {
            return merged;
          }
          return merged.slice(0, maxReady);
        });
        setLastFlushAt(new Date().toISOString());
      }
    } catch (error) {
      console.warn('MessagingNotificationCenter: failed to flush notifications', error);
    }
  }, [flushNotifications, maxReady]);

  const collectDigestNow = useCallback(() => {
    if (!collectNotificationDigest) {
      setDigests([]);
      return;
    }
    try {
      const summaries = collectNotificationDigest();
      if (Array.isArray(summaries)) {
        setDigests(summaries as DigestSummary[]);
        if (summaries.length > 0) {
          setLastDigestAt(new Date().toISOString());
        }
      } else {
        setDigests([]);
      }
    } catch (error) {
      console.warn('MessagingNotificationCenter: failed to collect digest', error);
    }
  }, [collectNotificationDigest]);

  const clearReady = useCallback(() => {
    setReadyNotifications([]);
  }, []);

  useEffect(() => {
    flushNow();
  }, [flushNow]);

  useEffect(() => {
    if (!autoFlushIntervalMs || autoFlushIntervalMs <= 0) {
      return () => {};
    }
    const handle = setInterval(flushNow, autoFlushIntervalMs);
    return () => clearInterval(handle);
  }, [flushNow, autoFlushIntervalMs]);

  useEffect(() => {
    if (!showDigestSummaries) {
      setDigests([]);
      return () => {};
    }
    if (!autoDigestIntervalMs || autoDigestIntervalMs <= 0) {
      return () => {};
    }
    const tick = () => collectDigestNow();
    const handle = setInterval(tick, autoDigestIntervalMs);
    return () => clearInterval(handle);
  }, [autoDigestIntervalMs, collectDigestNow, showDigestSummaries]);

  useEffect(() => {
    if (showDigestSummaries) {
      collectDigestNow();
    } else {
      setDigests([]);
    }
  }, [collectDigestNow, showDigestSummaries]);

  useEffect(() => {
    setQuietHoursActive(notificationState ? isWithinQuietHours(notificationState) : false);
    if (!quietHoursPollIntervalMs || quietHoursPollIntervalMs <= 0) {
      return () => {};
    }
    const handle = setInterval(() => {
      setQuietHoursActive(notificationState ? isWithinQuietHours(notificationState) : false);
    }, quietHoursPollIntervalMs);
    return () => clearInterval(handle);
  }, [notificationState, quietHoursPollIntervalMs]);

  const quietHoursWindow = useMemo(() => {
    if (!notificationState?.quietHours) {
      return null;
    }
    const { startMinutes, endMinutes } = notificationState.quietHours;
    const start = formatTimeRange(startMinutes, locale, timezone);
    const end = formatTimeRange(endMinutes, locale, timezone);
    if (!start || !end) return null;
    return `${start} – ${end}`;
  }, [notificationState?.quietHours, locale, timezone]);

  const centerClassName = useMemo(() => {
    const classes = ['messaging-notification-center'];
    if (quietHoursActive) {
      classes.push('messaging-notification-center--quiet');
    }
    if (className) {
      classes.push(className);
    }
    return classes.join(' ');
  }, [className, quietHoursActive]);

  const renderNotification = useCallback(
    (notification: ReadyNotification) => {
      const createdAt = notification.createdAt ?? notification.updatedAt ?? null;
      const relativeTime = createdAt ? formatRelativeTimestamp(createdAt, { locale, timezone }) : null;
      return (
        <li key={notification.id ?? `${notification.threadId ?? 'global'}:${createdAt ?? Math.random()}`}>
          <button
            type="button"
            className={`messaging-notification-center__item messaging-notification-center__item--${formatSeverity(notification.severity)}`}
            onClick={() => onNotificationClick?.(notification)}
          >
            <div className="messaging-notification-center__item-header">
              <span className="messaging-notification-center__item-severity">
                {formatSeverity(notification.severity)}
              </span>
              {relativeTime ? (
                <time dateTime={createdAt ?? undefined} className="messaging-notification-center__item-timestamp">
                  {relativeTime}
                </time>
              ) : null}
              {typeof notification.count === 'number' && notification.count > 1 ? (
                <span className="messaging-notification-center__item-count">×{notification.count}</span>
              ) : null}
            </div>
            <div className="messaging-notification-center__item-body">
              <span>{notification.message ?? 'Notification'}</span>
            </div>
          </button>
        </li>
      );
    },
    [locale, onNotificationClick, timezone]
  );

  return (
    <div className={centerClassName}>
      <header className="messaging-notification-center__header">
        <h2>Notifications</h2>
        <div className="messaging-notification-center__status">
          <span className="messaging-notification-center__quiet-hours-label">
            Quiet hours: {quietHoursWindow ?? 'not configured'}
          </span>
          <span
            className={`messaging-notification-center__quiet-indicator messaging-notification-center__quiet-indicator--${quietHoursActive ? 'active' : 'inactive'}`}
          >
            {quietHoursActive ? 'Quiet hours active' : 'Outside quiet hours'}
          </span>
        </div>
        <div className="messaging-notification-center__controls">
          <button type="button" onClick={flushNow}>
            Flush now
          </button>
          <button type="button" onClick={clearReady} disabled={readyNotifications.length === 0}>
            Clear ready
          </button>
          {showDigestSummaries ? (
            <button type="button" onClick={collectDigestNow}>
              Collect digest
            </button>
          ) : null}
        </div>
        <div className="messaging-notification-center__meta">
          <span>
            Ready: {readyNotifications.length} • Deferred: {pendingNotifications.length}
          </span>
          {lastFlushAt ? (
            <span>Last flush {formatRelativeTimestamp(lastFlushAt, { locale, timezone })}</span>
          ) : null}
          {showDigestSummaries && lastDigestAt ? (
            <span>Last digest {formatRelativeTimestamp(lastDigestAt, { locale, timezone })}</span>
          ) : null}
        </div>
      </header>
      <section className="messaging-notification-center__section">
        <h3>Newest notifications</h3>
        {readyNotifications.length === 0 ? (
          <p className="messaging-notification-center__empty">No new notifications.</p>
        ) : (
          <ul className="messaging-notification-center__list">
            {readyNotifications.map((notification) => renderNotification(notification))}
          </ul>
        )}
      </section>
      <section className="messaging-notification-center__section">
        <h3>Queued during quiet hours</h3>
        {pendingNotifications.length === 0 ? (
          <p className="messaging-notification-center__empty">Queue is clear.</p>
        ) : (
          <ul className="messaging-notification-center__list">
            {pendingNotifications.map((notification) => (
              <li key={`pending:${notification.id ?? notification.threadId ?? Math.random()}`}>
                <div className="messaging-notification-center__item messaging-notification-center__item--pending">
                  <div className="messaging-notification-center__item-header">
                    <span className="messaging-notification-center__item-severity">
                      {formatSeverity(notification.severity)}
                    </span>
                    {notification.createdAt ? (
                      <time
                        dateTime={notification.createdAt}
                        className="messaging-notification-center__item-timestamp"
                      >
                        {formatRelativeTimestamp(notification.createdAt, { locale, timezone })}
                      </time>
                    ) : null}
                  </div>
                  <div className="messaging-notification-center__item-body">
                    <span>{notification.message ?? 'Notification queued'}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {showDigestSummaries ? (
        <section className="messaging-notification-center__section">
          <h3>Digest summaries</h3>
          {digests.length === 0 ? (
            <p className="messaging-notification-center__empty">No digest summaries available.</p>
          ) : (
            <ul className="messaging-notification-center__list">
              {digests.map((digest) => (
                <li key={`digest:${digest.threadId ?? 'global'}`}>
                  <div className="messaging-notification-center__item messaging-notification-center__item--digest">
                    <div className="messaging-notification-center__item-header">
                      <span className="messaging-notification-center__item-severity">
                        {digest.highestSeverity}
                      </span>
                      <span className="messaging-notification-center__item-count">{digest.count} events</span>
                      {digest.lastAt ? (
                        <time
                          dateTime={digest.lastAt}
                          className="messaging-notification-center__item-timestamp"
                        >
                          {formatRelativeTimestamp(digest.lastAt, { locale, timezone })}
                        </time>
                      ) : null}
                    </div>
                    <div className="messaging-notification-center__item-body">
                      <p>
                        Thread: <strong>{digest.threadId ?? 'All threads'}</strong>
                      </p>
                      {digest.sampleMessages.length > 0 ? (
                        <ul className="messaging-notification-center__digest-samples">
                          {digest.sampleMessages.map((message, index) => (
                            <li key={`${digest.threadId ?? 'global'}:sample:${index}`}>{message}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
};
