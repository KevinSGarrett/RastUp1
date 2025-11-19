import React, { useEffect, useMemo, useState } from 'react';

interface CalendarConnectStore {
  getState: () => any;
  subscribe: (listener: (state: any) => void) => () => void;
  setPendingUrl: (url: string | null) => any;
  upsertSource: (source: any) => any;
  removeSource: (srcId: string) => any;
  markSyncResult: (result: any) => any;
  recordError: (error: any) => any;
  setFeed: (feed: any) => any;
}

export interface CalendarConnectProps {
  store: CalendarConnectStore;
  onConnect?: (url: string) => void;
  onDisconnect?: (srcId: string) => void;
}

export const CalendarConnect: React.FC<CalendarConnectProps> = ({
  store,
  onConnect,
  onDisconnect
}) => {
  const [state, setState] = useState(() => store.getState());
  const [urlInput, setUrlInput] = useState('');

  useEffect(() => store.subscribe(setState), [store]);

  const lastError = useMemo(() => state.errorLog?.[0] ?? null, [state.errorLog]);

  const handleConnect = () => {
    if (!urlInput) {
      return;
    }
    store.setPendingUrl(urlInput);
    onConnect?.(urlInput);
    setUrlInput('');
  };

  const handleDisconnect = (srcId: string) => {
    store.removeSource(srcId);
    onDisconnect?.(srcId);
  };

  return (
    <section className="calendar-connect">
      <header className="calendar-connect__header">
        <h2>Calendar Connections</h2>
        <p>Add private ICS URLs to import busy events and prevent double bookings.</p>
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

      <ul className="calendar-connect__sources">
        {(state.orderedSourceIds ?? []).map((srcId: string) => {
          const source = state.sourcesById[srcId];
          return (
            <li key={srcId} className={`calendar-connect__source calendar-connect__source--${source.status}`}>
              <div>
                <strong>{source.kind?.toUpperCase()}</strong> — {source.urlOrRemoteId}
              </div>
              <div className="calendar-connect__source-meta">
                Last sync:{' '}
                {source.lastPollAt ? new Date(source.lastPollAt).toUTCString() : 'Never'} · Imported{' '}
                {source.lastImportedCount ?? 0} events
              </div>
              <button type="button" onClick={() => handleDisconnect(srcId)}>
                Disconnect
              </button>
            </li>
          );
        })}
      </ul>

      {state.feed ? (
        <div className="calendar-connect__feed">
          <h3>Personal ICS Feed</h3>
          <code>{state.feed.url ?? `(token: ${state.feed.token})`}</code>
          <p>Include holds: {state.feed.includeHolds ? 'Yes' : 'No'}</p>
        </div>
      ) : null}

      {lastError ? (
        <div className="calendar-connect__error">
          <strong>Last error</strong>: {lastError.message}{' '}
          {lastError.occurredAt ? `(${new Date(lastError.occurredAt).toUTCString()})` : null}
        </div>
      ) : null}
    </section>
  );
};
