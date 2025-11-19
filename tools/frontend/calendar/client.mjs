const DASHBOARD_QUERY = `
  query CalendarDashboard(
    $role: String!
    $exceptionsFrom: AWSDate!
    $exceptionsTo: AWSDate!
    $calendarFrom: AWSDateTime!
    $calendarTo: AWSDateTime!
    $feasibleInput: FeasibleSlotInput!
  ) {
    weekly: myWeeklyRules(role: $role) {
      id
      role
      weekdayMask
      startLocal
      endLocal
      timezone
      minDurationMin
      leadTimeHours
      bookingWindowDays
      bufferBeforeMin
      bufferAfterMin
      active
      createdAt
      updatedAt
    }
    exceptions: myExceptions(dateFrom: $exceptionsFrom, dateTo: $exceptionsTo) {
      id
      dateLocal
      timezone
      kind
      startLocal
      endLocal
      note
      createdAt
    }
    holds: myHoldSummaries(role: $role) {
      id
      startUtc
      endUtc
      source
      orderId
      ttlExpiresAt
      createdAt
    }
    events: myCalendar(dateFrom: $calendarFrom, dateTo: $calendarTo) {
      id
      orderId
      startUtc
      endUtc
      status
      createdAt
      updatedAt
    }
    sources: myExternalCalendars {
      id
      kind
      urlOrRemoteId
      status
      lastPollAt
      lastEtag
      lastModified
      createdAt
      updatedAt
    }
    externalBusy: myExternalBusy(dateFrom: $calendarFrom, dateTo: $calendarTo) {
      id
      sourceId
      startUtc
      endUtc
      busy
      summary
      recurrenceId
      updatedAt
    }
    slots: feasibleSlots(input: $feasibleInput) {
      startUtc
      endUtc
      sourceRuleId
      confidence
    }
    feed: myIcsFeed {
      id
      token
      includeHolds
      createdAt
    }
  }
`;

const HOLD_SUMMARIES_QUERY = `
  query CalendarHolds($role: String!) {
    holds: myHoldSummaries(role: $role) {
      id
      startUtc
      endUtc
      source
      orderId
      ttlExpiresAt
      createdAt
    }
  }
`;

const EXTERNAL_CALENDARS_QUERY = `
  query CalendarExternalSources {
    sources: myExternalCalendars {
      id
      kind
      urlOrRemoteId
      status
      lastPollAt
      lastEtag
      lastModified
      createdAt
      updatedAt
    }
    feed: myIcsFeed {
      id
      token
      includeHolds
      createdAt
    }
  }
`;

const FEASIBLE_SLOTS_QUERY = `
  query CalendarFeasible($input: FeasibleSlotInput!) {
    slots: feasibleSlots(input: $input) {
      startUtc
      endUtc
      sourceRuleId
      confidence
    }
  }
`;

const SAVE_WEEKLY_RULE_MUTATION = `
  mutation SaveWeeklyRule($input: WeeklyRuleInput!) {
    upsertWeeklyRule(input: $input)
  }
`;

const ARCHIVE_WEEKLY_RULE_MUTATION = `
  mutation ArchiveWeeklyRule($id: ID!) {
    archiveWeeklyRule(id: $id)
  }
`;

const SAVE_EXCEPTION_MUTATION = `
  mutation SaveException($input: ExceptionInput!) {
    upsertException(input: $input)
  }
`;

const DELETE_EXCEPTION_MUTATION = `
  mutation DeleteException($id: ID!) {
    deleteException(id: $id)
  }
`;

const CREATE_HOLD_MUTATION = `
  mutation CreateHold($input: HoldInput!) {
    createHold(input: $input)
  }
`;

const RELEASE_HOLD_MUTATION = `
  mutation ReleaseHold($id: ID!) {
    releaseHold(id: $id)
  }
`;

const CONNECT_ICS_MUTATION = `
  mutation ConnectIcs($url: AWSURL!) {
    connectICS(url: $url)
  }
`;

const DISCONNECT_EXTERNAL_MUTATION = `
  mutation DisconnectExternal($id: ID!) {
    disconnectExternal(id: $id)
  }
`;

const CREATE_ICS_FEED_MUTATION = `
  mutation CreateIcsFeed($includeHolds: Boolean) {
    createIcsFeed(includeHolds: $includeHolds)
  }
`;

const REVOKE_ICS_FEED_MUTATION = `
  mutation RevokeIcsFeed {
    revokeIcsFeed
  }
`;

function assertExecute(execute) {
  if (typeof execute !== 'function') {
    throw new TypeError('createCalendarClient requires options.execute function');
  }
  return execute;
}

function normalizeWeeklyRule(rule) {
  return {
    ruleId: rule.id,
    roleCode: rule.role,
    weekdayMask: rule.weekdayMask,
    startLocal: rule.startLocal,
    endLocal: rule.endLocal,
    timezone: rule.timezone,
    minDurationMin: rule.minDurationMin,
    leadTimeHours: rule.leadTimeHours,
    bookingWindowDays: rule.bookingWindowDays,
    bufferBeforeMinutes: rule.bufferBeforeMin,
    bufferAfterMinutes: rule.bufferAfterMin,
    active: rule.active !== false,
    createdAt: rule.createdAt ?? null,
    updatedAt: rule.updatedAt ?? null
  };
}

function normalizeException(exception) {
  return {
    excId: exception.id,
    dateLocal: exception.dateLocal,
    timezone: exception.timezone,
    kind: exception.kind,
    startLocal: exception.startLocal ?? null,
    endLocal: exception.endLocal ?? null,
    note: exception.note ?? null,
    createdAt: exception.createdAt ?? null
  };
}

function normalizeHold(hold) {
  return {
    holdId: hold.id,
    startUtc: hold.startUtc,
    endUtc: hold.endUtc,
    source: hold.source ?? 'checkout',
    orderId: hold.orderId ?? null,
    ttlExpiresAt: hold.ttlExpiresAt ?? null,
    createdAt: hold.createdAt ?? null,
    status: 'active'
  };
}

function normalizeEvent(event) {
  return {
    eventId: event.id,
    orderId: event.orderId,
    startUtc: event.startUtc,
    endUtc: event.endUtc,
    status: event.status,
    createdAt: event.createdAt ?? null,
    updatedAt: event.updatedAt ?? null
  };
}

function normalizeExternalSource(source) {
  return {
    srcId: source.id,
    kind: source.kind,
    urlOrRemoteId: source.urlOrRemoteId,
    status: source.status,
    lastPollAt: source.lastPollAt ?? null,
    lastEtag: source.lastEtag ?? null,
    lastModified: source.lastModified ?? null,
    createdAt: source.createdAt ?? null,
    updatedAt: source.updatedAt ?? null
  };
}

function normalizeExternalBusy(entry) {
  return {
    extEventId: entry.id,
    sourceId: entry.sourceId ?? null,
    startUtc: entry.startUtc,
    endUtc: entry.endUtc,
    busy: entry.busy !== false,
    summary: entry.summary ?? null,
    recurrenceId: entry.recurrenceId ?? null,
    updatedAt: entry.updatedAt ?? null
  };
}

function normalizeFeasibleSlot(slot) {
  const slotId = slot.sourceRuleId
    ? `slot:${slot.sourceRuleId}:${slot.startUtc}:${slot.endUtc}`
    : `slot:${slot.startUtc}:${slot.endUtc}`;
  return {
    slotId,
    startUtc: slot.startUtc,
    endUtc: slot.endUtc,
    sourceRuleId: slot.sourceRuleId ?? null,
    confidence: Number.isFinite(slot.confidence) ? slot.confidence : null
  };
}

function normalizeFeed(feed) {
  if (!feed) {
    return null;
  }
  return {
    feedId: feed.id ?? null,
    token: feed.token,
    includeHolds: feed.includeHolds ?? false,
    createdAt: feed.createdAt ?? null
  };
}

function isGraphqlError(response) {
  return response && Array.isArray(response.errors) && response.errors.length > 0;
}

function buildGraphqlError(response) {
  const message = response.errors?.[0]?.message ?? 'GraphQL request failed';
  const error = new Error(message);
  error.errors = response.errors;
  return error;
}

function mergeArraysUnique(existing, additions, key) {
  const seen = new Set(existing.map((entry) => entry[key]));
  for (const entry of additions) {
    if (!seen.has(entry[key])) {
      existing.push(entry);
      seen.add(entry[key]);
    }
  }
  return existing;
}

export function createCalendarClient(options = {}) {
  const execute = assertExecute(options.execute);
  const logger = options.logger ?? null;
  const bookingIntegration = options.booking ?? null;
  const defaultHoldTtlMinutes = Number.isFinite(options.defaultHoldTtlMinutes)
    ? options.defaultHoldTtlMinutes
    : 30;

  async function runGraphql(request) {
    const response = await execute(request);
    if (isGraphqlError(response)) {
      throw buildGraphqlError(response);
    }
    if (!response || typeof response !== 'object' || response.data === undefined) {
      throw new Error('GraphQL response missing data field');
    }
    return response.data;
  }

  function ensureRole(role) {
    if (!role) {
      throw new Error('role is required');
    }
    return role;
  }

  function defaultDateRange() {
    const now = new Date();
    const dateFrom = now.toISOString().slice(0, 10);
    const dateTo = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const calendarFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const calendarTo = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    return { dateFrom, dateTo, calendarFrom, calendarTo };
  }

  async function fetchDashboard(input = {}) {
    const role = ensureRole(input.role ?? options.defaultRole);
    const range = {
      ...defaultDateRange(),
      ...input.exceptionRange,
      calendarFrom: input.calendarRange?.start ?? input.calendarRange?.calendarFrom,
      calendarTo: input.calendarRange?.end ?? input.calendarRange?.calendarTo
    };
    const calendarFrom = range.calendarFrom ?? defaultDateRange().calendarFrom;
    const calendarTo = range.calendarTo ?? defaultDateRange().calendarTo;
    const durationMin = input.durationMin ?? input.slotDurationMin ?? 60;
    const data = await runGraphql({
      query: DASHBOARD_QUERY,
      variables: {
        role,
        exceptionsFrom: range.dateFrom,
        exceptionsTo: range.dateTo,
        calendarFrom,
        calendarTo,
        feasibleInput: {
          role,
          dateFrom: calendarFrom,
          dateTo: calendarTo,
          durationMin
        }
      },
      operationName: 'CalendarDashboard'
    });

    const weeklyRules = (data.weekly ?? []).map(normalizeWeeklyRule);
    const exceptions = (data.exceptions ?? []).map(normalizeException);
    const holds = (data.holds ?? []).map(normalizeHold);
    const events = (data.events ?? []).map(normalizeEvent);
    const externalSources = (data.sources ?? []).map(normalizeExternalSource);
    const externalBusy = (data.externalBusy ?? []).map(normalizeExternalBusy);
    const feasibleSlots = (data.slots ?? []).map(normalizeFeasibleSlot);
    const feed = normalizeFeed(data.feed);

    return {
      weeklyRules,
      exceptions,
      holds,
      events,
      externalSources,
      externalBusy,
      feasibleSlots,
      icsFeed: feed,
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
    const data = await runGraphql({
      query: HOLD_SUMMARIES_QUERY,
      variables: { role: ensureRole(role) },
      operationName: 'CalendarHolds'
    });
    return (data.holds ?? []).map(normalizeHold);
  }

  async function fetchExternalCalendars() {
    const data = await runGraphql({
      query: EXTERNAL_CALENDARS_QUERY,
      variables: {},
      operationName: 'CalendarExternalSources'
    });
    return {
      sources: (data.sources ?? []).map(normalizeExternalSource),
      feed: normalizeFeed(data.feed)
    };
  }

  async function fetchFeasibleSlots(input) {
    const data = await runGraphql({
      query: FEASIBLE_SLOTS_QUERY,
      variables: { input },
      operationName: 'CalendarFeasible'
    });
    return (data.slots ?? []).map(normalizeFeasibleSlot);
  }

  function buildWeeklyRuleInput(rule) {
    return {
      id: rule.ruleId ?? rule.id,
      role: rule.roleCode ?? rule.role,
      weekdayMask: rule.weekdayMask,
      startLocal: rule.startLocal,
      endLocal: rule.endLocal,
      timezone: rule.timezone,
      minDurationMin: rule.minDurationMin,
      leadTimeHours: rule.leadTimeHours,
      bookingWindowDays: rule.bookingWindowDays,
      bufferBeforeMin: rule.bufferBeforeMinutes ?? rule.bufferBeforeMin ?? 0,
      bufferAfterMin: rule.bufferAfterMinutes ?? rule.bufferAfterMin ?? 0,
      active: rule.active !== false
    };
  }

  function buildExceptionInput(exception) {
    return {
      id: exception.excId ?? exception.id,
      dateLocal: exception.dateLocal,
      timezone: exception.timezone,
      kind: exception.kind,
      startLocal: exception.startLocal ?? null,
      endLocal: exception.endLocal ?? null,
      note: exception.note ?? null
    };
  }

  function buildHoldInput(input) {
    return {
      role: ensureRole(input.role),
      startUtc: input.startUtc,
      endUtc: input.endUtc,
      source: input.source ?? 'checkout',
      orderId: input.orderId ?? null,
      ttlMinutes: Number.isFinite(input.ttlMinutes) ? input.ttlMinutes : defaultHoldTtlMinutes
    };
  }

  async function saveWeeklyRule(rule) {
    const input = buildWeeklyRuleInput(rule);
    const data = await runGraphql({
      query: SAVE_WEEKLY_RULE_MUTATION,
      variables: { input },
      operationName: 'SaveWeeklyRule'
    });
    return data.upsertWeeklyRule;
  }

  async function archiveWeeklyRule(ruleId) {
    await runGraphql({
      query: ARCHIVE_WEEKLY_RULE_MUTATION,
      variables: { id: ruleId },
      operationName: 'ArchiveWeeklyRule'
    });
    return true;
  }

  async function saveException(exception) {
    const input = buildExceptionInput(exception);
    const data = await runGraphql({
      query: SAVE_EXCEPTION_MUTATION,
      variables: { input },
      operationName: 'SaveException'
    });
    return data.upsertException;
  }

  async function deleteException(exceptionId) {
    await runGraphql({
      query: DELETE_EXCEPTION_MUTATION,
      variables: { id: exceptionId },
      operationName: 'DeleteException'
    });
    return true;
  }

  async function createHold(input, optionsCreate = {}) {
    const holdInput = buildHoldInput(input);
    const role = holdInput.role;
    const data = await runGraphql({
      query: CREATE_HOLD_MUTATION,
      variables: { input: holdInput },
      operationName: 'CreateHold'
    });
    const holdId = data.createHold;
    if (!holdId) {
      throw new Error('createHold did not return an id');
    }

    if (optionsCreate.refresh !== false) {
      try {
        const holds = await fetchHoldSummaries(role);
        const match = holds.find((hold) => hold.holdId === holdId);
        if (match) {
          return match;
        }
        mergeArraysUnique(holds, [{ holdId, startUtc: holdInput.startUtc, endUtc: holdInput.endUtc }], 'holdId');
        return holds.find((hold) => hold.holdId === holdId);
      } catch (error) {
        if (logger?.warn) {
          logger.warn('calendar-client: failed to refresh hold summaries', { error });
        }
      }
    }

    return {
      holdId,
      startUtc: holdInput.startUtc,
      endUtc: holdInput.endUtc,
      source: holdInput.source,
      orderId: holdInput.orderId,
      ttlExpiresAt: new Date(
        Date.now() + (holdInput.ttlMinutes ?? defaultHoldTtlMinutes) * 60 * 1000
      ).toISOString(),
      status: 'active'
    };
  }

  async function releaseHold(holdId) {
    await runGraphql({
      query: RELEASE_HOLD_MUTATION,
      variables: { id: holdId },
      operationName: 'ReleaseHold'
    });
    return true;
  }

  async function connectIcs(url) {
    const data = await runGraphql({
      query: CONNECT_ICS_MUTATION,
      variables: { url },
      operationName: 'ConnectIcs'
    });
    return data.connectICS;
  }

  async function disconnectExternal(id) {
    await runGraphql({
      query: DISCONNECT_EXTERNAL_MUTATION,
      variables: { id },
      operationName: 'DisconnectExternal'
    });
    return true;
  }

  async function createIcsFeed(optionsFeed = {}) {
    const data = await runGraphql({
      query: CREATE_ICS_FEED_MUTATION,
      variables: { includeHolds: optionsFeed.includeHolds ?? false },
      operationName: 'CreateIcsFeed'
    });
    return data.createIcsFeed;
  }

  async function revokeIcsFeed() {
    await runGraphql({
      query: REVOKE_ICS_FEED_MUTATION,
      variables: {},
      operationName: 'RevokeIcsFeed'
    });
    return true;
  }

  async function createHoldAndConfirm(payload) {
    if (!bookingIntegration?.confirmHold) {
      throw new Error('booking.confirmHold integration not configured');
    }
    const hold = await createHold(payload.hold, payload.holdOptions);
    try {
      const confirmation = await bookingIntegration.confirmHold({
        hold,
        booking: payload.booking
      });
      return { hold, confirmation };
    } catch (error) {
      try {
        await releaseHold(hold.holdId);
      } catch (releaseError) {
        if (logger?.error) {
          logger.error('calendar-client: failed to release hold after booking error', {
            error: releaseError,
            holdId: hold.holdId
          });
        }
      }
      throw error;
    }
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
    createHoldAndConfirm
  };
}
