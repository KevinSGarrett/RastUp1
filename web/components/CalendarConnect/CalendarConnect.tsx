import React, { useCallback, useEffect, useMemo, useState } from 'react';

interface CalendarConnectStore {
  getState: () => any;
  subscribe: (listener: (state: any) => void) => () => void;
  setPendingUrl: (url: string | null) => any;
  upsertSource: (source: any) => any;
  removeSource: (srcId: string) => any;
  markSyncResult: (result: any) => any;
  recordError: (error: any) => any;
  recordTelemetry: (event: any) => any;
  setFeed: (feed: any) => any;
}

export interface CalendarConnectProps {
  store: CalendarConnectStore;
  onConnect?: (url: string) => void;
  onDisconnect?: (srcId: string) => void;
  onRetry?: (srcId: string) => void;
  onCopyFeed?: (feed: any) => void;
}

function formatTimestamp(iso?: string | null) {
  if (!iso) {
    return 'Never';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return 'Invalid timestamp';
  }
  return `${date.toUTCString()}`;
}

function formatRelative(iso?: string | null) {
  if (!iso) {
    return 'n/a';
  }
  const target = Date.parse(iso);
  if (!Number.isFinite(target)) {
    return 'n/a';
  }
  const diff = Date.now() - target;
  const absolute = Math.abs(diff);
  const minutes = Math.round(absolute / 60000);
  if (minutes < 1) {
    return diff >= 0 ? 'just now' : 'in <1m';
  }
  if (minutes < 60) {
    return diff >= 0 ? `${minutes}m ago` : `in ${minutes}m`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return diff >= 0 ? `${hours}h ago` : `in ${hours}h`;
  }
  const days = Math.round(hours / 24);
  return diff >= 0 ? `${days}d ago` : `in ${days}d`;
}

const MAX_TELEMETRY_EVENTS = 5;

export const CalendarConnect: React.FC<CalendarConnectProps> = ({
  store,
  onConnect,
  onDisconnect,
  onRetry,
  onCopyFeed
}) => {
  const [state, setState] = useState(() => store.getState());
  const [urlInput, setUrlInput] = useState('');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  useEffect(() => store.subscribe(setState), [store]);

  useEffect(() => {
    if (copyStatus !== 'idle') {
      const timer = setTimeout(() => setCopyStatus('idle'), 2500);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [copyStatus]);

  const lastError = useMemo(() => state.errorLog?.[0] ?? null, [state.errorLog]);
  const telemetrySample = useMemo(
    () => (state.telemetry ?? []).slice(0, MAX_TELEMETRY_EVENTS),
    [state.telemetry]
  );

  const handleConnect = useCallback(() => {
    if (!urlInput) {
      return;
    }
    store.setPendingUrl(urlInput);
    store.recordTelemetry({
      type: 'connect_start',
      url: urlInput,
      occurredAt: new Date().toISOString()
    });
    onConnect?.(urlInput);
    setUrlInput('');
  }, [urlInput, store, onConnect]);

  const handleDisconnect = useCallback(
    (srcId: string) => {
      store.removeSource(srcId);
      store.recordTelemetry({
        type: 'disconnect',
        srcId,
        occurredAt: new Date().toISOString()
      });
      onDisconnect?.(srcId);
    },
    [store, onDisconnect]
  );

  const handleRetry = useCallback(
    (srcId: string) => {
      store.recordTelemetry({
        type: 'retry_requested',
        srcId,
        occurredAt: new Date().toISOString()
      });
      onRetry?.(srcId);
    },
    [store, onRetry]
  );

  const handleCopyFeed = useCallback(async () => {
    const feed = state.feed ?? null;
    if (!feed) {
      return;
    }
    const value = feed.url ?? feed.token;
    if (!value) {
      setCopyStatus('error');
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        setCopyStatus('copied');
        onCopyFeed?.(feed);
      } catch {
        setCopyStatus('error');
      }
    } else {
      setCopyStatus('error');
    }
  }, [state.feed, onCopyFeed]);

  return (
    <section className="calendar-connect">
      <header className="calendar-connect__header">
        <h2>Calendar Connections</h2>
        <p>Add private ICS URLs to import busy events and keep bookings conflict-free.</p>
      </header>

      <div className="calendar-connect__input">
        <input
          type="url"
          value={urlInput}
          placeholder="https://calendar.google.com/private.ics"
          onChange={(event) => setUrlInput(event.target.value)}
        />
        <button type="button" onClick={handleConnect} disabled={!urlInput}>
          Connect
        </button>
      </div>

      {state.pendingUrl ? (
        <p className="calendar-connect__pending">
          Connecting to <strong>{state.pendingUrl}</strong> … awaiting initial poll.
        </p>
      ) : null}

      <ul className="calendar-connect__sources">
        {(state.orderedSourceIds ?? []).map((srcId: string) => {
          const source = state.sourcesById[srcId];
          const summary = state.syncSummary?.[srcId] ?? null;
          return (
            <li key={srcId} className={`calendar-connect__source calendar-connect__source--${source.status}`}>
              <div className="calendar-connect__source-header">
                <div>
                  <strong>{source.kind?.toUpperCase() ?? 'UNKNOWN'}</strong>{' '}
                  <span className="calendar-connect__source-url">{source.urlOrRemoteId}</span>
                </div>
                <div className="calendar-connect__source-actions">
                  {source.status === 'error' ? (
                    <button type="button" onClick={() => handleRetry(srcId)}>
                      Retry
                    </button>
                  ) : null}
                  <button type="button" onClick={() => handleDisconnect(srcId)}>
                    Disconnect
                  </button>
                </div>
              </div>
              <div className="calendar-connect__source-meta">
                Last sync: {formatTimestamp(source.lastPollAt)} ({formatRelative(source.lastPollAt)}) · Imported{' '}
                {source.lastImportedCount ?? 0} events · Status:{' '}
                <span className={`calendar-connect__status calendar-connect__status--${source.status}`}>
                  {source.status}
                </span>
              </div>
              {summary ? (
                <div className="calendar-connect__source-summary">
                  Successes: {summary.okCount ?? 0} · Errors: {summary.errorCount ?? 0}{' '}
                  {summary.lastError ? (
                    <span className="calendar-connect__source-last-error">
                      Last error: {summary.lastError.message}{' '}
                      {summary.lastError.occurredAt ? `(${formatRelative(summary.lastError.occurredAt)})` : null}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {state.feed ? (
        <div className="calendar-connect__feed">
          <h3>Personal ICS Feed</h3>
          <code>{state.feed.url ?? `(token: ${state.feed.token})`}</code>
          <p>
            Include holds: {state.feed.includeHolds ? 'Yes' : 'No'} · Generated{' '}
            {state.feed.updatedAt ? formatRelative(state.feed.updatedAt) : 'recently'}
          </p>
          <button type="button" onClick={handleCopyFeed}>
            Copy link
          </button>
          <span className={`calendar-connect__copy-status calendar-connect__copy-status--${copyStatus}`}>
            {copyStatus === 'copied' ? 'Copied!' : copyStatus === 'error' ? 'Copy unavailable' : ''}
          </span>
        </div>
      ) : null}

      {telemetrySample.length > 0 ? (
        <section className="calendar-connect__telemetry">
          <h3>Recent actions</h3>
          <ul>
            {telemetrySample.map((entry: any, index: number) => (
              <li key={entry.id ?? `${entry.type}_${index}`}>
                <strong>{entry.type}</strong> — {entry.srcId ?? entry.url ?? 'n/a'} ·{' '}
                {formatRelative(entry.occurredAt)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {lastError ? (
        <div className="calendar-connect__error">
          <strong>Last error</strong>: {lastError.message}{' '}
          {lastError.occurredAt ? `(${formatRelative(lastError.occurredAt)})` : null}{' '}
          {lastError.retriable ? '— retriable' : '— manual intervention required'}
        </div>
      ) : null}
    </section>
  );
};
