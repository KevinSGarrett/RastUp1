import { createAvailabilityEditorStore } from './editor_store.mjs';
import { createCalendarConnectStore } from './connect_store.mjs';
import { createReschedulePickerStore } from './reschedule_picker.mjs';

function cloneEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.map((entry) => ({ ...entry }));
}

function normalizeHold(input) {
  if (!input) {
    throw new Error('hold is required');
  }
  const holdId = input.holdId ?? input.id;
  if (!holdId) {
    throw new Error('hold must include holdId');
  }
  return {
    holdId,
    startUtc: input.startUtc,
    endUtc: input.endUtc,
    ttlExpiresAt: input.ttlExpiresAt ?? input.expiresAt ?? null,
    source: input.source ?? 'checkout',
    orderId: input.orderId ?? null,
    status: input.status ?? 'active',
    createdAt: input.createdAt ?? new Date().toISOString()
  };
}

function normalizeEvent(input) {
  if (!input) {
    throw new Error('event is required');
  }
  const eventId = input.eventId ?? input.id;
  if (!eventId) {
    throw new Error('event must include eventId');
  }
  return {
    eventId,
    startUtc: input.startUtc,
    endUtc: input.endUtc,
    status: input.status ?? 'confirmed',
    orderId: input.orderId ?? null,
    createdAt: input.createdAt ?? new Date().toISOString(),
    updatedAt: input.updatedAt ?? input.createdAt ?? new Date().toISOString()
  };
}

function normalizeExternalBusy(entry) {
  if (!entry) {
    throw new Error('external busy entry is required');
  }
  const extEventId = entry.extEventId ?? entry.id;
  if (!extEventId) {
    throw new Error('external busy entry must include extEventId');
  }
  return {
    extEventId,
    sourceId: entry.sourceId ?? null,
    startUtc: entry.startUtc,
    endUtc: entry.endUtc,
    busy: entry.busy !== false,
    summary: entry.summary ?? '',
    recurrenceId: entry.recurrenceId ?? null,
    updatedAt: entry.updatedAt ?? new Date().toISOString()
  };
}

function normalizeSlot(slot) {
  if (!slot || !slot.startUtc || !slot.endUtc) {
    throw new Error('slot must include startUtc and endUtc');
  }
  const baseId = slot.slotId ?? slot.id ?? `slot:${slot.startUtc}:${slot.endUtc}`;
  const slotId = baseId.startsWith('slot:') ? baseId : `slot:${baseId}`;
  return {
    slotId,
    startUtc: slot.startUtc,
    endUtc: slot.endUtc,
    durationMinutes: slot.durationMinutes ?? Math.round((Date.parse(slot.endUtc) - Date.parse(slot.startUtc)) / 60000),
    sourceRuleId: slot.sourceRuleId ?? null,
    confidence: Number.isFinite(slot.confidence) ? slot.confidence : null
  };
}

function invoke(listener, change, snapshot, logger) {
  if (typeof listener !== 'function') {
    return;
  }
  try {
    listener(change, snapshot);
  } catch (error) {
    if (logger?.warn) {
      logger.warn('calendar-controller: listener failed', { error, change });
    }
  }
}

export function createCalendarController(options = {}) {
  const availabilityStore =
    options.availabilityStore ?? createAvailabilityEditorStore(options.availability ?? {});
  const connectStore = options.connectStore ?? createCalendarConnectStore(options.connect ?? {});
  const rescheduleStore =
    options.rescheduleStore ?? createReschedulePickerStore(options.reschedule ?? {});

  const logger = options.logger ?? null;

  const runtime = {
    holds: cloneEntries(options.holds),
    confirmedEvents: cloneEntries(options.confirmedEvents ?? options.events),
    externalBusy: cloneEntries(options.externalBusy),
    feasibleSlots: cloneEntries(options.feasibleSlots ?? options.slots)
  };

  if (runtime.holds.length > 0) {
    availabilityStore.setHolds(runtime.holds);
  }
  if (runtime.confirmedEvents.length > 0) {
    availabilityStore.setConfirmedEvents(runtime.confirmedEvents);
  }
  if (runtime.externalBusy.length > 0) {
    availabilityStore.setExternalBusy(runtime.externalBusy);
  }
  if (runtime.feasibleSlots.length > 0) {
    rescheduleStore.loadSlots({ slots: runtime.feasibleSlots });
  }

  const listeners = new Set();

  function getSnapshot() {
    return {
      availability: availabilityStore.getState(),
      connect: connectStore.getState(),
      reschedule: rescheduleStore.getState(),
      holds: cloneEntries(runtime.holds),
      confirmedEvents: cloneEntries(runtime.confirmedEvents),
      externalBusy: cloneEntries(runtime.externalBusy),
      feasibleSlots: cloneEntries(runtime.feasibleSlots)
    };
  }

  function emit(change) {
    const snapshot = getSnapshot();
    for (const listener of listeners) {
      invoke(listener, change, snapshot, logger);
    }
    return change;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function');
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function hydrateAvailability(payload = {}) {
    const next = availabilityStore.hydrate?.({
      weeklyRules: cloneEntries(payload.weeklyRules),
      exceptions: cloneEntries(payload.exceptions),
      holds: cloneEntries(payload.holds ?? runtime.holds),
      confirmedEvents: cloneEntries(payload.confirmedEvents ?? runtime.confirmedEvents),
      externalBusy: cloneEntries(payload.externalBusy ?? runtime.externalBusy),
      previewRange: payload.previewRange,
      previewOptions: payload.previewOptions
    });
    if (payload.holds) {
      runtime.holds = cloneEntries(payload.holds);
    }
    if (payload.confirmedEvents) {
      runtime.confirmedEvents = cloneEntries(payload.confirmedEvents);
    }
    if (payload.externalBusy) {
      runtime.externalBusy = cloneEntries(payload.externalBusy);
    }
    emit({ type: 'availability/hydrated' });
    return next;
  }

  function hydrateConnections(payload = {}) {
    if (payload.sources) {
      connectStore.hydrateSources(payload.sources);
    }
    if (payload.feed !== undefined) {
      connectStore.setFeed(payload.feed);
    }
    if (Array.isArray(payload.telemetry)) {
      for (const entry of payload.telemetry) {
        connectStore.recordTelemetry(entry);
      }
    }
    if (Array.isArray(payload.errors)) {
      for (const error of payload.errors) {
        connectStore.recordError(error);
      }
    }
    emit({ type: 'connect/hydrated' });
    return connectStore.getState();
  }

  function setFeasibleSlots(slots = [], optionsSlots = {}) {
    const normalized = cloneEntries(slots).map(normalizeSlot);
    runtime.feasibleSlots = normalized;
    rescheduleStore.loadSlots({
      slots: normalized,
      durationMin: optionsSlots.durationMin,
      nowUtc: optionsSlots.nowUtc
    });
    emit({ type: 'feasible/updated', count: normalized.length });
    return normalized;
  }

  function updateHolds(nextHolds = []) {
    runtime.holds = cloneEntries(nextHolds).map((entry) => normalizeHold(entry));
    availabilityStore.setHolds(runtime.holds);
    emit({ type: 'holds/updated', count: runtime.holds.length });
    return runtime.holds;
  }

  function applyHoldCreated(input, optionsHold = {}) {
    const hold = normalizeHold(input);
    const existingIndex = runtime.holds.findIndex((entry) => entry.holdId === hold.holdId);
    if (existingIndex >= 0) {
      runtime.holds.splice(existingIndex, 1, hold);
    } else {
      runtime.holds.push(hold);
    }
    availabilityStore.setHolds(runtime.holds);
    if (optionsHold.updateReschedule !== false) {
      rescheduleStore.recordHoldResult({
        holdId: hold.holdId,
        status: hold.status,
        expiresAt: hold.ttlExpiresAt
      });
    }
    emit({ type: 'holds/created', holdId: hold.holdId });
    return hold;
  }

  function applyHoldReleased(holdId, optionsHold = {}) {
    if (!holdId) {
      throw new Error('holdId is required to release hold');
    }
    const beforeLength = runtime.holds.length;
    runtime.holds = runtime.holds.filter((entry) => entry.holdId !== holdId);
    availabilityStore.setHolds(runtime.holds);
    if (optionsHold.updateReschedule !== false) {
      rescheduleStore.recordHoldResult(null);
    }
    emit({ type: 'holds/released', holdId, removed: beforeLength !== runtime.holds.length });
    return true;
  }

  function expireHold(holdId) {
    const hold = runtime.holds.find((entry) => entry.holdId === holdId);
    if (!hold) {
      return false;
    }
    hold.status = 'expired';
    rescheduleStore.recordHoldResult({
      holdId: hold.holdId,
      status: 'expired',
      expiresAt: hold.ttlExpiresAt
    });
    emit({ type: 'holds/expired', holdId });
    return true;
  }

  function applyEventConfirmed(eventInput, optionsEvent = {}) {
    const event = normalizeEvent(eventInput);
    const existing = runtime.confirmedEvents.findIndex((entry) => entry.eventId === event.eventId);
    if (existing >= 0) {
      runtime.confirmedEvents.splice(existing, 1, event);
    } else {
      runtime.confirmedEvents.push(event);
    }
    availabilityStore.setConfirmedEvents(runtime.confirmedEvents);
    if (optionsEvent.releaseHoldId) {
      applyHoldReleased(optionsEvent.releaseHoldId, { updateReschedule: false });
    }
    emit({ type: 'events/confirmed', eventId: event.eventId });
    return event;
  }

  function setConfirmedEvents(events = []) {
    runtime.confirmedEvents = cloneEntries(events).map((entry) => normalizeEvent(entry));
    availabilityStore.setConfirmedEvents(runtime.confirmedEvents);
    emit({ type: 'events/updated', count: runtime.confirmedEvents.length });
    return runtime.confirmedEvents;
  }

  function setExternalBusy(entries = []) {
    runtime.externalBusy = cloneEntries(entries).map((entry) => normalizeExternalBusy(entry));
    availabilityStore.setExternalBusy(runtime.externalBusy);
    emit({ type: 'externalBusy/updated', count: runtime.externalBusy.length });
    return runtime.externalBusy;
  }

  function recordSyncResult(result) {
    connectStore.markSyncResult(result);
    emit({ type: 'connect/syncResult', srcId: result?.srcId ?? null });
    return connectStore.getState();
  }

  function recordConnectError(error) {
    connectStore.recordError(error);
    emit({ type: 'connect/error', srcId: error?.srcId ?? null });
    return connectStore.getState();
  }

  function recordTelemetry(event) {
    connectStore.recordTelemetry(event);
    emit({ type: 'connect/telemetry', eventType: event?.type ?? null });
    return connectStore.getState();
  }

  function setIcsFeed(feed) {
    connectStore.setFeed(feed);
    emit({ type: 'connect/feed', feed: feed ?? null });
    return connectStore.getState();
  }

  function setPendingUrl(url) {
    connectStore.setPendingUrl(url);
    emit({ type: 'connect/pending', url: url ?? null });
    return connectStore.getState();
  }

  function refreshPreview() {
    const snapshot = availabilityStore.recomputePreview();
    emit({ type: 'availability/recomputed', totalSlots: snapshot?.previewSlots?.length ?? null });
    return snapshot;
  }

  function markAvailabilityClean() {
    const snapshot = availabilityStore.markClean();
    emit({ type: 'availability/clean' });
    return snapshot;
  }

  return {
    availabilityStore,
    connectStore,
    rescheduleStore,
    subscribe,
    getSnapshot,
    hydrateAvailability,
    hydrateConnections,
    setFeasibleSlots,
    updateHolds,
    applyHoldCreated,
    applyHoldReleased,
    expireHold,
    applyEventConfirmed,
    setConfirmedEvents,
    setExternalBusy,
    recordSyncResult,
    recordConnectError,
    recordTelemetry,
    setIcsFeed,
    setPendingUrl,
    refreshPreview,
    markAvailabilityClean
  };
}
