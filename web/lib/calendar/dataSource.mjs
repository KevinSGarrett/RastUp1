import { createCalendarClient } from '../../../tools/frontend/calendar/client.mjs';
import { computeFeasibleSlots } from '../../../tools/frontend/calendar/feasibility.mjs';

const DEFAULT_ROLE = 'MODEL';
const MILLIS_PER_DAY = 86_400_000;

function structuredCloneFallback(value) {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function isoNow() {
  return new Date().toISOString();
}

function addDaysIso(isoDate, days) {
  const base = isoDate ? new Date(isoDate) : new Date();
  const next = new Date(base.getTime() + days * MILLIS_PER_DAY);
  return next.toISOString().slice(0, 10);
}

function resolveProcessEnv(key) {
  if (typeof process === 'undefined' || !process?.env) {
    return null;
  }
  return process.env[key] ?? null;
}

function buildDefaultStubState(overrides = {}) {
  const now = isoNow();
  const providerId = overrides.providerId ?? 'usr_stub_provider';
  const roleCode = overrides.defaultRole ?? DEFAULT_ROLE;
  return {
    defaultRole: roleCode,
    providerId,
    weeklyRules: overrides.weeklyRules ?? [
      {
        ruleId: 'wr_stub_1',
        userId: providerId,
        roleCode,
        weekdayMask: 0b0111110, // Mon-Fri
        startLocal: '09:00',
        endLocal: '17:00',
        timezone: 'America/Los_Angeles',
        minDurationMin: 60,
        leadTimeHours: 24,
        bookingWindowDays: 30,
        bufferBeforeMinutes: 15,
        bufferAfterMinutes: 15,
        active: true,
        createdAt: now,
        updatedAt: now
      }
    ],
    exceptions: overrides.exceptions ?? [
      {
        excId: 'ex_stub_1',
        userId: providerId,
        roleCode,
        dateLocal: addDaysIso(now.slice(0, 10), 2),
        timezone: 'America/Los_Angeles',
        kind: 'unavailable',
        startLocal: null,
        endLocal: null,
        note: 'Blackout day for personal travel',
        createdAt: now
      }
    ],
    holds: overrides.holds ?? [
      {
        holdId: 'hld_stub_1',
        userId: providerId,
        roleCode,
        startUtc: addDaysIso(now.slice(0, 10), 3) + 'T18:00:00Z',
        endUtc: addDaysIso(now.slice(0, 10), 3) + 'T19:00:00Z',
        ttlExpiresAt: addDaysIso(now.slice(0, 10), 3) + 'T18:30:00Z',
        source: 'checkout',
        orderId: 'ord_stub_1',
        status: 'active',
        createdAt: now
      }
    ],
    events: overrides.events ?? [
      {
        eventId: 'evt_stub_1',
        userId: providerId,
        roleCode,
        orderId: 'ord_stub_2',
        startUtc: addDaysIso(now.slice(0, 10), 4) + 'T17:00:00Z',
        endUtc: addDaysIso(now.slice(0, 10), 4) + 'T19:00:00Z',
        status: 'confirmed',
        createdAt: now,
        updatedAt: now
      }
    ],
    externalSources: overrides.externalSources ?? [
      {
        srcId: 'cxs_stub_1',
        userId: providerId,
        kind: 'ics',
        urlOrRemoteId: 'https://calendar.google.com/private/example.ics',
        status: 'active',
        lastPollAt: now,
        lastEtag: '"stub-etag"',
        lastModified: now,
        createdAt: now,
        updatedAt: now
      }
    ],
    externalBusy: overrides.externalBusy ?? [
      {
        extEventId: 'xev_stub_1',
        srcId: 'cxs_stub_1',
        userId: providerId,
        startUtc: addDaysIso(now.slice(0, 10), 1) + 'T20:00:00Z',
        endUtc: addDaysIso(now.slice(0, 10), 1) + 'T21:00:00Z',
        busy: true,
        summary: 'External busy block',
        recurrenceId: null,
        updatedAt: now
      }
    ],
    icsFeed: overrides.icsFeed ?? null,
    counters: {
      rule: 2,
      exception: 2,
      hold: 2,
      event: 2,
      source: 2,
      feed: 1
    }
  };
}

function cloneOutput(value) {
  return structuredCloneFallback(value);
}

function normalizeRole(role, fallback) {
  return role ?? fallback ?? DEFAULT_ROLE;
}

function filterByRole(entries, role) {
  return entries.filter((entry) => !entry.roleCode || entry.roleCode === role);
}

function computeStubFeasibleSlots(state, role, options = {}) {
  const now = new Date();
  const dateFrom = options.dateFrom ?? now.toISOString().slice(0, 10);
  const dateTo = options.dateTo ?? addDaysIso(now.toISOString(), 14);
  const requestedDurationMin = options.durationMin ?? 60;
  const weeklyRules = filterByRole(state.weeklyRules, role).map((rule) => ({
    ...rule,
    roleCode: rule.roleCode ?? role
  }));
  const exceptions = filterByRole(state.exceptions, role);
  const holds = state.holds.filter((hold) => hold.roleCode === role);
  const events = state.events.filter((event) => event.roleCode === role);
  const externalBusy = state.externalBusy.filter((busy) => {
    if (!busy.userId) {
      return true;
    }
    return state.providerId ? busy.userId === state.providerId : true;
  });

  return computeFeasibleSlots({
    rules: weeklyRules,
    exceptions,
    holds,
    events,
    externalBusy,
    dateFrom,
    dateTo,
    now: now.toISOString(),
    leadTimeHours: 24,
    bookingWindowDays: 30,
    minDurationMin: requestedDurationMin,
    requestedDurationMin,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    slotGranularityMinutes: requestedDurationMin,
    maxSlots: options.maxSlots ?? 100
  });
}

function createStubCalendarClient(initialState) {
  const state = buildDefaultStubState(initialState);

  function saveState() {
    return null;
  }

  async function fetchDashboard(input = {}) {
    const role = normalizeRole(input.role, state.defaultRole);
    const weeklyRules = filterByRole(state.weeklyRules, role).map((rule) => ({
      ...rule
    }));
    const exceptions = filterByRole(state.exceptions, role).map((exception) => ({
      ...exception
    }));
    const holds = state.holds
      .filter((hold) => hold.roleCode === role)
      .map(({ roleCode, ...hold }) => ({ ...hold }));
    const events = state.events
      .filter((event) => event.roleCode === role)
      .map(({ roleCode, ...event }) => ({ ...event }));
    const externalSources = state.externalSources.map((source) => ({ ...source }));
    const externalBusy = state.externalBusy.map((entry) => ({ ...entry }));
    const feasibleSlots = computeStubFeasibleSlots(state, role, {
      durationMin: input.durationMin ?? 60
    }).map((slot) => ({
      ...slot,
      slotId: `slot:${slot.startUtc}:${slot.endUtc}`,
      sourceRuleId: slot.sourceRuleId ?? weeklyRules[0]?.ruleId ?? null
    }));

    return {
      weeklyRules: cloneOutput(weeklyRules),
      exceptions: cloneOutput(exceptions),
      holds: cloneOutput(holds),
      events: cloneOutput(events),
      externalSources: cloneOutput(externalSources),
      externalBusy: cloneOutput(externalBusy),
      feasibleSlots: cloneOutput(feasibleSlots),
      icsFeed: state.icsFeed ? { ...state.icsFeed } : null,
      metrics: {
        weeklyRuleCount: weeklyRules.length,
        exceptionCount: exceptions.length,
        holdCount: holds.length,
        eventCount: events.length,
        externalSourceCount: externalSources.length,
        externalBusyCount: externalBusy.length,
        feasibleSlotCount: feasibleSlots.length
      }
    };
  }

  async function fetchHoldSummaries(role) {
    const roleCode = normalizeRole(role, state.defaultRole);
    return cloneOutput(
      state.holds
        .filter((hold) => hold.roleCode === roleCode)
        .map(({ roleCode: _ignored, ...hold }) => ({ ...hold }))
    );
  }

  async function fetchExternalCalendars() {
    return {
      sources: cloneOutput(state.externalSources),
      feed: state.icsFeed ? { ...state.icsFeed } : null
    };
  }

  async function fetchFeasibleSlots(input) {
    const role = normalizeRole(input?.role, state.defaultRole);
    return computeStubFeasibleSlots(state, role, {
      dateFrom: input?.dateFrom,
      dateTo: input?.dateTo,
      durationMin: input?.durationMin,
      maxSlots: input?.maxSlots ?? 100
    }).map((slot) => ({
      ...slot,
      slotId: `slot:${slot.startUtc}:${slot.endUtc}`
    }));
  }

  async function saveWeeklyRule(rule) {
    const role = normalizeRole(rule.roleCode ?? rule.role, state.defaultRole);
    const now = isoNow();
    const existingIndex = state.weeklyRules.findIndex((entry) => entry.ruleId === rule.ruleId);
    if (existingIndex >= 0) {
      state.weeklyRules[existingIndex] = {
        ...state.weeklyRules[existingIndex],
        ...rule,
        roleCode: role,
        updatedAt: now
      };
      return state.weeklyRules[existingIndex].ruleId;
    }
    const nextId = `wr_stub_${state.counters.rule++}`;
    state.weeklyRules.push({
      ruleId: nextId,
      userId: state.providerId,
      roleCode: role,
      weekdayMask: rule.weekdayMask ?? 0,
      startLocal: rule.startLocal ?? '09:00',
      endLocal: rule.endLocal ?? '17:00',
      timezone: rule.timezone ?? 'UTC',
      minDurationMin: rule.minDurationMin ?? 60,
      leadTimeHours: rule.leadTimeHours ?? 24,
      bookingWindowDays: rule.bookingWindowDays ?? 30,
      bufferBeforeMinutes: rule.bufferBeforeMinutes ?? 0,
      bufferAfterMinutes: rule.bufferAfterMinutes ?? 0,
      active: rule.active !== false,
      createdAt: now,
      updatedAt: now
    });
    saveState();
    return nextId;
  }

  async function archiveWeeklyRule(ruleId) {
    const existing = state.weeklyRules.find((entry) => entry.ruleId === ruleId);
    if (!existing) {
      return false;
    }
    existing.active = false;
    existing.updatedAt = isoNow();
    saveState();
    return true;
  }

  async function saveException(exception) {
    const role = normalizeRole(exception.roleCode ?? exception.role, state.defaultRole);
    const now = isoNow();
    const existingIndex = state.exceptions.findIndex((entry) => entry.excId === exception.excId);
    if (existingIndex >= 0) {
      state.exceptions[existingIndex] = {
        ...state.exceptions[existingIndex],
        ...exception,
        roleCode: role,
        createdAt: state.exceptions[existingIndex].createdAt ?? now
      };
      return state.exceptions[existingIndex].excId;
    }
    const nextId = `ex_stub_${state.counters.exception++}`;
    state.exceptions.push({
      excId: nextId,
      userId: state.providerId,
      roleCode: role,
      dateLocal: exception.dateLocal,
      timezone: exception.timezone ?? 'UTC',
      kind: exception.kind ?? 'unavailable',
      startLocal: exception.startLocal ?? null,
      endLocal: exception.endLocal ?? null,
      note: exception.note ?? null,
      createdAt: now
    });
    saveState();
    return nextId;
  }

  async function deleteException(exceptionId) {
    const before = state.exceptions.length;
    state.exceptions = state.exceptions.filter((entry) => entry.excId !== exceptionId);
    saveState();
    return before !== state.exceptions.length;
  }

  async function createHold(input) {
    const role = normalizeRole(input.role, state.defaultRole);
    const now = isoNow();
    const nextId = `hld_stub_${state.counters.hold++}`;
    const ttlMinutes = input.ttlMinutes ?? 30;
    const expiresAt =
      input.ttlExpiresAt ??
      new Date(Date.parse(input.startUtc ?? now) + ttlMinutes * 60 * 1000).toISOString();
    state.holds.push({
      holdId: nextId,
      userId: state.providerId,
      roleCode: role,
      startUtc: input.startUtc,
      endUtc: input.endUtc,
      ttlExpiresAt: expiresAt,
      source: input.source ?? 'checkout',
      orderId: input.orderId ?? null,
      status: 'active',
      createdAt: now
    });
    saveState();
    return nextId;
  }

  async function releaseHold(holdId) {
    const before = state.holds.length;
    state.holds = state.holds.filter((hold) => hold.holdId !== holdId);
    saveState();
    return before !== state.holds.length;
  }

  async function connectIcs(url) {
    const nextId = `cxs_stub_${state.counters.source++}`;
    const now = isoNow();
    state.externalSources.push({
      srcId: nextId,
      userId: state.providerId,
      kind: 'ics',
      urlOrRemoteId: url,
      status: 'active',
      lastPollAt: now,
      lastEtag: null,
      lastModified: now,
      createdAt: now,
      updatedAt: now
    });
    saveState();
    return nextId;
  }

  async function disconnectExternal(srcId) {
    const before = state.externalSources.length;
    state.externalSources = state.externalSources.filter((source) => source.srcId !== srcId);
    state.externalBusy = state.externalBusy.filter((entry) => entry.srcId !== srcId);
    saveState();
    return before !== state.externalSources.length;
  }

  async function createIcsFeed(options = {}) {
    const token = options.token ?? `stub-feed-${state.counters.feed++}`;
    const includeHolds = Boolean(options.includeHolds);
    const now = isoNow();
    state.icsFeed = {
      feedId: `ifd_stub_${state.counters.feed}`,
      token,
      includeHolds,
      createdAt: now,
      updatedAt: now,
      url: `${options.baseUrl ?? 'https://stub.rastup.calendar'}/feeds/${token}.ics`
    };
    saveState();
    return state.icsFeed.url;
  }

  async function revokeIcsFeed() {
    state.icsFeed = null;
    saveState();
    return true;
  }

  async function recordTelemetry() {
    return true;
  }

  async function recordSyncResult() {
    return true;
  }

  async function recordConnectError() {
    return true;
  }

  async function createHoldAndConfirm(payload) {
    const holdId = await createHold(payload.hold);
    return {
      hold: {
        holdId,
        startUtc: payload.hold.startUtc,
        endUtc: payload.hold.endUtc,
        source: payload.hold.source ?? 'checkout',
        orderId: payload.hold.orderId ?? null,
        ttlExpiresAt: new Date(
          Date.parse(payload.hold.startUtc) +
            (payload.hold.ttlMinutes ?? 30) * 60 * 1000
        ).toISOString(),
        status: 'active'
      },
      confirmation: {
        eventId: `evt_stub_${state.counters.event++}`,
        orderId: payload.booking?.orderId ?? `ord_stub_${state.counters.event}`,
        status: 'confirmed'
      }
    };
  }

  return {
    fetchDashboard,
    fetchHoldSummaries,
    fetchExternalCalendars,
    fetchFeasibleSlots,
    saveWeeklyRule,
    archiveWeeklyRule,
    saveException,
    deleteException,
    createHold,
    releaseHold,
    connectIcs,
    disconnectExternal,
    createIcsFeed,
    revokeIcsFeed,
    recordTelemetry,
    recordSyncResult,
    recordConnectError,
    createHoldAndConfirm
  };
}

export function createCalendarDataSource(options = {}) {
  const endpoint =
    options.endpoint ??
    (typeof window === 'undefined'
      ? resolveProcessEnv('CALENDAR_GRAPHQL_ENDPOINT')
      : resolveProcessEnv('NEXT_PUBLIC_CALENDAR_GRAPHQL_ENDPOINT'));

  const defaultFetch =
    options.fetchImpl ??
    (typeof fetch === 'function'
      ? typeof window === 'undefined'
        ? fetch
        : fetch.bind(window)
      : null);

  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers ?? {})
  };

  const apiKey =
    options.apiKey ??
    (typeof window === 'undefined'
      ? resolveProcessEnv('CALENDAR_GRAPHQL_API_KEY')
      : resolveProcessEnv('NEXT_PUBLIC_CALENDAR_GRAPHQL_API_KEY'));

  if (apiKey && !headers.Authorization && !headers['x-api-key']) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const useStubData = Boolean(options.useStubData) || !endpoint || !defaultFetch;

  if (useStubData) {
    return createStubCalendarClient(options.stubState);
  }

  async function execute({ query, variables, operationName }) {
    let response;
    try {
      response = await defaultFetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables, operationName })
      });
    } catch (error) {
      return {
        data: null,
        errors: [{ message: `Calendar GraphQL request failed: ${error.message}` }]
      };
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return {
        data: null,
        errors: [
          {
            message: `Calendar GraphQL endpoint returned HTTP ${response.status}`,
            details: text
          }
        ]
      };
    }

    try {
      return await response.json();
    } catch (error) {
      return {
        data: null,
        errors: [{ message: `Calendar GraphQL response parse error: ${error.message}` }]
      };
    }
  }

  return createCalendarClient({
    execute,
    logger: options.logger,
    booking: options.booking
  });
}

export { createStubCalendarClient, DEFAULT_ROLE };
