'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';

import { AvailabilityEditor } from '../../components/AvailabilityEditor';
import { CalendarConnect } from '../../components/CalendarConnect';
import { ReschedulePicker } from '../../components/ReschedulePicker';
import { createCalendarDataSource } from '../../lib/calendar/dataSource.mjs';
import { createCalendarController } from '../../../tools/frontend/calendar/controller.mjs';

type CalendarDashboardSnapshot = {
  weeklyRules: any[];
  exceptions: any[];
  holds: any[];
  events: any[];
  externalSources: any[];
  externalBusy: any[];
  feasibleSlots: any[];
  icsFeed: any | null;
  metrics?: Record<string, unknown>;
};

type DataSourceMode = 'stub' | 'graphql';

export interface CalendarDashboardClientProps {
  initialRole: string;
  initialDashboard: CalendarDashboardSnapshot;
  dataSourceMode: DataSourceMode;
  viewerTimeZone: string | null;
}

type SyncedIds = {
  ruleIds: Set<string>;
  exceptionIds: Set<string>;
};

function buildSyncedIds(snapshot: CalendarDashboardSnapshot): SyncedIds {
  return {
    ruleIds: new Set((snapshot.weeklyRules ?? []).map((rule: any) => rule.ruleId)),
    exceptionIds: new Set((snapshot.exceptions ?? []).map((exception: any) => exception.excId))
  };
}

function createStatusMessage(message: string, mode: DataSourceMode) {
  if (mode === 'stub') {
    return `${message} (stub data)`;
  }
  return message;
}

export const CalendarDashboardClient: React.FC<CalendarDashboardClientProps> = ({
  initialRole,
  initialDashboard,
  dataSourceMode,
  viewerTimeZone
}) => {
  const initialDataRef = useRef({
    role: initialRole,
    dashboard: initialDashboard
  });

  const controller = useMemo(() => {
    const { dashboard } = initialDataRef.current;
    return createCalendarController({
      availability: {
        weeklyRules: dashboard.weeklyRules,
        exceptions: dashboard.exceptions,
        holds: dashboard.holds,
        confirmedEvents: dashboard.events,
        externalBusy: dashboard.externalBusy
      },
      connect: {
        sources: dashboard.externalSources,
        feed: dashboard.icsFeed
      },
      reschedule: {
        slots: dashboard.feasibleSlots,
        durationMin:
          dashboard.feasibleSlots?.[0]?.durationMinutes ??
          Math.max(30, Number.parseInt(String(dashboard.metrics?.requestedDurationMin ?? 60), 10) || 60)
      },
      holds: dashboard.holds,
      confirmedEvents: dashboard.events,
      externalBusy: dashboard.externalBusy,
      feasibleSlots: dashboard.feasibleSlots
    });
  }, []);

  const dataSource = useMemo(
    () =>
      createCalendarDataSource({
        useStubData: dataSourceMode === 'stub'
      }),
    [dataSourceMode]
  );

  const [activeRole, setActiveRole] = useState(initialRole);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [includeHoldsInFeed, setIncludeHoldsInFeed] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const syncedIdsRef = useRef<SyncedIds>(buildSyncedIds(initialDashboard));

  const availabilityStore = controller.availabilityStore;
  const rescheduleStore = controller.rescheduleStore;

  const resetMessages = useCallback(() => {
    setStatusMessage(null);
    setErrorMessage(null);
  }, []);

  const handleError = useCallback((error: unknown, context: string) => {
    const message = error instanceof Error ? error.message : String(error);
    setErrorMessage(`${context}: ${message}`);
    setStatusMessage(null);
  }, []);

  const refreshSyncedIds = useCallback(() => {
    syncedIdsRef.current = buildSyncedIds(controller.getSnapshot().availability);
  }, [controller]);

  const handleSaveAvailability = useCallback(async () => {
    if (isBusy) {
      return;
    }
    resetMessages();
    setIsBusy(true);
    try {
      const snapshot = availabilityStore.getState();
      const dirtyWeeklyRuleIds = new Set(snapshot.dirtyWeeklyRuleIds ?? []);
      const dirtyExceptionIds = new Set(snapshot.dirtyExceptionIds ?? []);

      const currentRuleIds = new Set((snapshot.weeklyRules ?? []).map((rule: any) => rule.ruleId));
      const removedRuleIds: string[] = [];
      for (const existingId of syncedIdsRef.current.ruleIds) {
        if (!currentRuleIds.has(existingId)) {
          removedRuleIds.push(existingId);
        }
      }

      const currentExceptionIds = new Set((snapshot.exceptions ?? []).map((exception: any) => exception.excId));
      const removedExceptionIds: string[] = [];
      for (const existingId of syncedIdsRef.current.exceptionIds) {
        if (!currentExceptionIds.has(existingId)) {
          removedExceptionIds.push(existingId);
        }
      }

      const saveRulePromises = (snapshot.weeklyRules ?? [])
        .filter((rule: any) => dirtyWeeklyRuleIds.has(rule.ruleId))
        .map((rule: any) =>
          dataSource.saveWeeklyRule({
            ...rule,
            role: activeRole,
            roleCode: activeRole
          })
        );

      const archiveRulePromises = removedRuleIds.map((ruleId) => dataSource.archiveWeeklyRule(ruleId));

      const saveExceptionPromises = (snapshot.exceptions ?? [])
        .filter((exception: any) => dirtyExceptionIds.has(exception.excId))
        .map((exception: any) =>
          dataSource.saveException({
            ...exception,
            role: activeRole,
            roleCode: activeRole
          })
        );

      const deleteExceptionPromises = removedExceptionIds.map((excId) => dataSource.deleteException(excId));

      await Promise.all([
        ...saveRulePromises,
        ...archiveRulePromises,
        ...saveExceptionPromises,
        ...deleteExceptionPromises
      ]);

      controller.markAvailabilityClean();
      refreshSyncedIds();
      setStatusMessage(createStatusMessage('Availability changes saved', dataSourceMode));
    } catch (error) {
      handleError(error, 'Failed to save availability');
    } finally {
      setIsBusy(false);
    }
  }, [
    activeRole,
    availabilityStore,
    controller,
    dataSource,
    dataSourceMode,
    handleError,
    isBusy,
    refreshSyncedIds,
    resetMessages
  ]);

  const handleRefreshDashboard = useCallback(async () => {
    if (isBusy) {
      return;
    }
    resetMessages();
    setIsBusy(true);
    try {
      const dashboard = await dataSource.fetchDashboard({
        role: activeRole,
        durationMin: rescheduleStore.getState().durationMin
      });

      controller.hydrateAvailability({
        weeklyRules: dashboard.weeklyRules,
        exceptions: dashboard.exceptions,
        holds: dashboard.holds,
        confirmedEvents: dashboard.events,
        externalBusy: dashboard.externalBusy
      });
      controller.hydrateConnections({
        sources: dashboard.externalSources,
        feed: dashboard.icsFeed
      });
      controller.setFeasibleSlots(dashboard.feasibleSlots, {
        durationMin: rescheduleStore.getState().durationMin
      });
      controller.updateHolds(dashboard.holds);
      controller.setConfirmedEvents(dashboard.events);
      controller.setExternalBusy(dashboard.externalBusy);
      refreshSyncedIds();
      setStatusMessage(createStatusMessage('Dashboard refreshed', dataSourceMode));
    } catch (error) {
      handleError(error, 'Failed to refresh dashboard');
    } finally {
      setIsBusy(false);
    }
  }, [
    activeRole,
    controller,
    dataSource,
    dataSourceMode,
    handleError,
    isBusy,
    refreshSyncedIds,
    resetMessages,
    rescheduleStore
  ]);

  const handleConnect = useCallback(
    async (url: string) => {
      if (!url || isBusy) {
        return;
      }
      resetMessages();
      setIsBusy(true);
      controller.setPendingUrl(url);
      controller.recordTelemetry({
        type: 'connect_submitted',
        url,
        occurredAt: new Date().toISOString()
      });
      try {
        const srcId = await dataSource.connectIcs(url);
        const { sources, feed } = await dataSource.fetchExternalCalendars();
        controller.hydrateConnections({ sources, feed });
        controller.setPendingUrl(null);
        setStatusMessage(createStatusMessage(`Connected calendar source ${srcId}`, dataSourceMode));
      } catch (error) {
        controller.recordConnectError({
          srcId: null,
          message: error instanceof Error ? error.message : String(error),
          retriable: true
        });
        handleError(error, 'Calendar connection failed');
      } finally {
        setIsBusy(false);
      }
    },
    [controller, dataSource, dataSourceMode, handleError, isBusy, resetMessages]
  );

  const handleDisconnect = useCallback(
    async (srcId: string) => {
      if (isBusy) {
        return;
      }
      resetMessages();
      setIsBusy(true);
      try {
        await dataSource.disconnectExternal(srcId);
        const { sources, feed } = await dataSource.fetchExternalCalendars();
        controller.hydrateConnections({ sources, feed });
        setStatusMessage(createStatusMessage(`Disconnected calendar ${srcId}`, dataSourceMode));
      } catch (error) {
        handleError(error, 'Failed to disconnect calendar');
      } finally {
        setIsBusy(false);
      }
    },
    [controller, dataSource, dataSourceMode, handleError, isBusy, resetMessages]
  );

  const handleRetry = useCallback(
    async (srcId: string) => {
      if (isBusy) {
        return;
      }
      controller.recordTelemetry({
        type: 'retry_clicked',
        srcId,
        occurredAt: new Date().toISOString()
      });
      try {
        const { sources } = await dataSource.fetchExternalCalendars();
        controller.hydrateConnections({ sources });
        setStatusMessage(createStatusMessage(`Retry requested for ${srcId}`, dataSourceMode));
      } catch (error) {
        handleError(error, 'Failed to refresh calendar source');
      }
    },
    [controller, dataSource, dataSourceMode, handleError, isBusy]
  );

  const handleCreateFeed = useCallback(async () => {
    if (isBusy) {
      return;
    }
    resetMessages();
    setIsBusy(true);
    try {
      const feedUrl = await dataSource.createIcsFeed({
        includeHolds: includeHoldsInFeed
      });
      const { feed } = await dataSource.fetchExternalCalendars();
      if (feed) {
        controller.setIcsFeed(feed);
      }
      setStatusMessage(createStatusMessage(`ICS feed ready: ${feedUrl}`, dataSourceMode));
    } catch (error) {
      handleError(error, 'Failed to create ICS feed');
    } finally {
      setIsBusy(false);
    }
  }, [
    controller,
    dataSource,
    dataSourceMode,
    handleError,
    includeHoldsInFeed,
    isBusy,
    resetMessages
  ]);

  const handleRevokeFeed = useCallback(async () => {
    if (isBusy) {
      return;
    }
    resetMessages();
    setIsBusy(true);
    try {
      await dataSource.revokeIcsFeed();
      controller.setIcsFeed(null);
      setStatusMessage(createStatusMessage('ICS feed revoked', dataSourceMode));
    } catch (error) {
      handleError(error, 'Failed to revoke ICS feed');
    } finally {
      setIsBusy(false);
    }
  }, [
    controller,
    dataSource,
    dataSourceMode,
    handleError,
    isBusy,
    resetMessages
  ]);

  const handleSubmitHold = useCallback(
    async (stateSnapshot: any) => {
      const selection = stateSnapshot?.selection;
      if (!selection || isBusy) {
        return;
      }
      resetMessages();
      setIsBusy(true);
      try {
        const holdId = await dataSource.createHold({
          role: activeRole,
          startUtc: selection.startUtc,
          endUtc: selection.endUtc,
          source: 'reschedule',
          ttlMinutes: 30
        });
        const holds = await dataSource.fetchHoldSummaries(activeRole);
        controller.updateHolds(holds);
        const createdHold =
          holds.find((hold: any) => hold.holdId === holdId) ??
          {
            holdId,
            startUtc: selection.startUtc,
            endUtc: selection.endUtc,
            ttlExpiresAt: new Date(Date.parse(selection.startUtc) + 30 * 60 * 1000).toISOString(),
            source: 'reschedule',
            status: 'active'
          };
        controller.applyHoldCreated(createdHold);
        setStatusMessage(createStatusMessage(`Hold created (${holdId})`, dataSourceMode));
      } catch (error) {
        handleError(error, 'Failed to create hold');
      } finally {
        setIsBusy(false);
      }
    },
    [
      activeRole,
      controller,
      dataSource,
      dataSourceMode,
      handleError,
      isBusy,
      resetMessages
    ]
  );

  const handleRefreshFeasible = useCallback(async () => {
    if (isBusy) {
      return;
    }
    resetMessages();
    setIsBusy(true);
    try {
      const state = rescheduleStore.getState();
      const slots = await dataSource.fetchFeasibleSlots({
        role: activeRole,
        dateFrom: state.sourceSlots?.at(0)?.startUtc ?? undefined,
        dateTo: undefined,
        durationMin: state.durationMin
      });
      controller.setFeasibleSlots(slots, { durationMin: state.durationMin });
      setStatusMessage(createStatusMessage('Feasible slots refreshed', dataSourceMode));
    } catch (error) {
      handleError(error, 'Failed to refresh feasible slots');
    } finally {
      setIsBusy(false);
    }
  }, [
    activeRole,
    controller,
    dataSource,
    dataSourceMode,
    handleError,
    isBusy,
    resetMessages,
    rescheduleStore
  ]);

  return (
    <div className="calendar-dashboard">
      <header className="calendar-dashboard__header">
        <div>
          <h1>Calendar Availability</h1>
          <p>
            Manage weekly rules, exceptions, external calendar connections, and rescheduling slots.{' '}
            {dataSourceMode === 'stub'
              ? 'Using local stub data — configure CALENDAR_GRAPHQL_ENDPOINT / API_KEY to enable live operations.'
              : 'GraphQL endpoint configured for live operations.'}
          </p>
        </div>
        <div className="calendar-dashboard__controls">
          <label>
            Provider role
            <input
              type="text"
              value={activeRole}
              onChange={(event) => setActiveRole(event.target.value || initialRole)}
              disabled={isBusy}
            />
          </label>
          <button type="button" onClick={handleSaveAvailability} disabled={isBusy}>
            Save availability
          </button>
          <button type="button" onClick={handleRefreshDashboard} disabled={isBusy}>
            Refresh dashboard
          </button>
          <button type="button" onClick={handleRefreshFeasible} disabled={isBusy}>
            Refresh feasible slots
          </button>
        </div>
      </header>

      <section className="calendar-dashboard__status">
        {viewerTimeZone ? (
          <span>
            Viewer timezone: <strong>{viewerTimeZone}</strong>
          </span>
        ) : null}
        {statusMessage ? <span className="calendar-dashboard__status-message">{statusMessage}</span> : null}
        {errorMessage ? <span className="calendar-dashboard__status-error">{errorMessage}</span> : null}
        {isBusy ? <span className="calendar-dashboard__status-spinner">Working…</span> : null}
      </section>

      <section className="calendar-dashboard__feed-controls">
        <h2>ICS Feed</h2>
        <div className="calendar-dashboard__feed-actions">
          <label>
            <input
              type="checkbox"
              checked={includeHoldsInFeed}
              onChange={(event) => setIncludeHoldsInFeed(event.target.checked)}
              disabled={isBusy}
            />{' '}
            Include active holds
          </label>
          <button type="button" onClick={handleCreateFeed} disabled={isBusy}>
            Generate feed
          </button>
          <button type="button" onClick={handleRevokeFeed} disabled={isBusy}>
            Revoke feed
          </button>
        </div>
      </section>

      <div className="calendar-dashboard__grid">
        <AvailabilityEditor store={availabilityStore} onSaveRules={handleSaveAvailability} />
        <CalendarConnect
          store={controller.connectStore}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          onRetry={handleRetry}
          onCopyFeed={() =>
            controller.recordTelemetry({
              type: 'feed_copied',
              occurredAt: new Date().toISOString()
            })
          }
        />
      </div>

      <ReschedulePicker
        store={rescheduleStore}
        onSubmitHold={handleSubmitHold}
        onRefresh={handleRefreshFeasible}
      />

      <section className="calendar-dashboard__metrics">
        <h2>Snapshot Metrics</h2>
        <ul>
          {(initialDashboard.metrics
            ? Object.entries(initialDashboard.metrics)
            : Object.entries(controller.getSnapshot().availability.previewMetadata ?? {})
          ).map(([key, value]) => (
            <li key={key}>
              <strong>{key}</strong>: {String(value)}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};
