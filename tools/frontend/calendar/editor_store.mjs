import { computeFeasibleSlots } from './feasibility.mjs';

function cloneEntries(entries = []) {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.map((entry) => ({ ...entry }));
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function snapshotState(state) {
  return {
    weeklyRules: cloneEntries(state.weeklyRules),
    exceptions: cloneEntries(state.exceptions),
    holds: cloneEntries(state.holds),
    confirmedEvents: cloneEntries(state.confirmedEvents),
    externalBusy: cloneEntries(state.externalBusy),
    previewRange: { ...state.previewRange },
    previewOptions: { ...state.previewOptions },
    previewSlots: cloneEntries(state.previewSlots),
    previewMetadata: { ...state.previewMetadata },
    previewError: state.previewError,
    lastComputedAt: state.lastComputedAt,
    dirtyWeeklyRuleIds: Array.from(state.dirtyWeeklyRuleIds),
    dirtyExceptionIds: Array.from(state.dirtyExceptionIds)
  };
}

function ensureRuleId(rule) {
  if (!rule || !rule.ruleId) {
    throw new Error('weekly rule must include ruleId');
  }
}

function ensureExceptionId(exception) {
  if (!exception || !exception.excId) {
    throw new Error('exception must include excId');
  }
}

function validateRange(range) {
  if (!range?.dateFrom || !range?.dateTo) {
    throw new Error('preview range requires dateFrom and dateTo');
  }
  if (range.dateTo < range.dateFrom) {
    throw new Error('preview dateTo must be on/after dateFrom');
  }
}

function timeNow() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

export function createAvailabilityEditorStore(initial = {}) {
  const now = initial.previewNow ? new Date(initial.previewNow) : new Date();
  const defaultFrom = initial.previewRange?.dateFrom ?? isoDate(now);
  const defaultTo =
    initial.previewRange?.dateTo ?? isoDate(new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000));

  const state = {
    weeklyRules: cloneEntries(initial.weeklyRules),
    exceptions: cloneEntries(initial.exceptions),
    holds: cloneEntries(initial.holds),
    confirmedEvents: cloneEntries(initial.confirmedEvents),
    externalBusy: cloneEntries(initial.externalBusy),
    previewRange: { dateFrom: defaultFrom, dateTo: defaultTo },
    previewOptions: {
      now: initial.previewNow ?? new Date().toISOString(),
      leadTimeHours: initial.leadTimeHours ?? 0,
      bookingWindowDays: initial.bookingWindowDays ?? 60,
      minDurationMin: initial.minDurationMin ?? 60,
      requestedDurationMin: initial.requestedDurationMin,
      bufferBeforeMinutes: initial.bufferBeforeMinutes ?? 0,
      bufferAfterMinutes: initial.bufferAfterMinutes ?? 0,
      slotGranularityMinutes: initial.slotGranularityMinutes ?? 60,
      maxSlots: initial.maxSlots ?? 100
    },
    previewSlots: [],
    previewMetadata: {
      totalSlots: 0,
      latencyMs: 0
    },
    previewError: null,
    lastComputedAt: null,
    dirtyWeeklyRuleIds: new Set(),
    dirtyExceptionIds: new Set()
  };

  const listeners = new Set();

  function notify() {
    const snapshot = snapshotState(state);
    for (const listener of listeners) {
      listener(snapshot);
    }
    return snapshot;
  }

  function recomputePreview() {
    const start = timeNow();
    try {
      const slots = computeFeasibleSlots({
        rules: state.weeklyRules,
        exceptions: state.exceptions,
        holds: state.holds,
        events: state.confirmedEvents,
        externalBusy: state.externalBusy,
        dateFrom: state.previewRange.dateFrom,
        dateTo: state.previewRange.dateTo,
        now: state.previewOptions.now,
        leadTimeHours: state.previewOptions.leadTimeHours,
        bookingWindowDays: state.previewOptions.bookingWindowDays,
        minDurationMin: state.previewOptions.minDurationMin,
        requestedDurationMin:
          state.previewOptions.requestedDurationMin ?? state.previewOptions.minDurationMin,
        bufferBeforeMinutes: state.previewOptions.bufferBeforeMinutes,
        bufferAfterMinutes: state.previewOptions.bufferAfterMinutes,
        slotGranularityMinutes: state.previewOptions.slotGranularityMinutes,
        maxSlots: state.previewOptions.maxSlots
      });
      state.previewSlots = slots;
      state.previewError = null;
      state.previewMetadata = {
        totalSlots: slots.length,
        latencyMs: timeNow() - start
      };
      state.lastComputedAt = new Date().toISOString();
    } catch (error) {
      state.previewSlots = [];
      state.previewError = error instanceof Error ? error.message : String(error);
      state.previewMetadata = {
        totalSlots: 0,
        latencyMs: timeNow() - start
      };
      state.lastComputedAt = new Date().toISOString();
    }
    return notify();
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function');
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function getState() {
    return snapshotState(state);
  }

  function hydrate(payload = {}) {
    state.weeklyRules = cloneEntries(payload.weeklyRules);
    state.exceptions = cloneEntries(payload.exceptions);
    state.holds = cloneEntries(payload.holds);
    state.confirmedEvents = cloneEntries(payload.confirmedEvents);
    state.externalBusy = cloneEntries(payload.externalBusy);
    state.dirtyWeeklyRuleIds.clear();
    state.dirtyExceptionIds.clear();
    if (payload.previewRange) {
      validateRange(payload.previewRange);
      state.previewRange = { ...payload.previewRange };
    }
    if (payload.previewOptions) {
      state.previewOptions = {
        ...state.previewOptions,
        ...payload.previewOptions
      };
    }
    return notify();
  }

  function setWeeklyRule(rule) {
    ensureRuleId(rule);
    const index = state.weeklyRules.findIndex((entry) => entry.ruleId === rule.ruleId);
    if (index >= 0) {
      state.weeklyRules[index] = { ...state.weeklyRules[index], ...rule };
    } else {
      state.weeklyRules.push({ ...rule });
    }
    state.dirtyWeeklyRuleIds.add(rule.ruleId);
    return notify();
  }

  function removeWeeklyRule(ruleId) {
    const beforeLength = state.weeklyRules.length;
    state.weeklyRules = state.weeklyRules.filter((rule) => rule.ruleId !== ruleId);
    if (state.weeklyRules.length !== beforeLength) {
      state.dirtyWeeklyRuleIds.add(ruleId);
      return notify();
    }
    return getState();
  }

  function upsertException(exception) {
    ensureExceptionId(exception);
    const index = state.exceptions.findIndex((entry) => entry.excId === exception.excId);
    if (index >= 0) {
      state.exceptions[index] = { ...state.exceptions[index], ...exception };
    } else {
      state.exceptions.push({ ...exception });
    }
    state.dirtyExceptionIds.add(exception.excId);
    return notify();
  }

  function removeException(excId) {
    const beforeLength = state.exceptions.length;
    state.exceptions = state.exceptions.filter((exc) => exc.excId !== excId);
    if (state.exceptions.length !== beforeLength) {
      state.dirtyExceptionIds.add(excId);
      return notify();
    }
    return getState();
  }

  function setHolds(holds = []) {
    state.holds = cloneEntries(holds);
    return notify();
  }

  function setConfirmedEvents(events = []) {
    state.confirmedEvents = cloneEntries(events);
    return notify();
  }

  function setExternalBusy(entries = []) {
    state.externalBusy = cloneEntries(entries);
    return notify();
  }

  function setPreviewRange(range) {
    validateRange(range);
    state.previewRange = { ...range };
    return notify();
  }

  function setPreviewOptions(options = {}) {
    state.previewOptions = {
      ...state.previewOptions,
      ...options
    };
    return notify();
  }

  function markClean() {
    state.dirtyWeeklyRuleIds.clear();
    state.dirtyExceptionIds.clear();
    return notify();
  }

  if (initial.autoCompute !== false) {
    recomputePreview();
  }

  return {
    getState,
    subscribe,
    hydrate,
    setWeeklyRule,
    removeWeeklyRule,
    upsertException,
    removeException,
    setHolds,
    setConfirmedEvents,
    setExternalBusy,
    setPreviewRange,
    setPreviewOptions,
    markClean,
    recomputePreview
  };
}
