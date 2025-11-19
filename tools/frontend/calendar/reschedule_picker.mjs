function calculateDurationMinutes(slot) {
  const start = Date.parse(slot.startUtc);
  const end = Date.parse(slot.endUtc);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 0;
  }
  return (end - start) / 60000;
}

function classifyDayType(date) {
  const day = date.getUTCDay();
  if (day === 0 || day === 6) {
    return 'WEEKEND';
  }
  return 'WEEKDAY';
}

function classifyTimeOfDay(date) {
  const hour = date.getUTCHours();
  if (hour >= 5 && hour < 12) {
    return 'MORNING';
  }
  if (hour >= 12 && hour < 17) {
    return 'AFTERNOON';
  }
  if (hour >= 17 && hour < 21) {
    return 'EVENING';
  }
  return 'NIGHT';
}

function snapshot(state) {
  return {
    durationMin: state.durationMin,
    filters: { ...state.filters },
    sourceSlots: state.sourceSlots.map((slot) => ({ ...slot })),
    filteredSlots: state.filteredSlots.map((slot) => ({ ...slot })),
    selection: state.selection ? { ...state.selection } : null,
    holdStatus: state.holdStatus ? { ...state.holdStatus } : null,
    metadata: { ...state.metadata },
    now: state.now
  };
}

function nowIso() {
  return new Date().toISOString();
}

export function createReschedulePickerStore(initial = {}) {
  const state = {
    durationMin: initial.durationMin ?? 60,
    filters: {
      day: initial.filters?.day ?? 'ANY',
      timeOfDay: initial.filters?.timeOfDay ?? 'ANY'
    },
    sourceSlots: [],
    filteredSlots: [],
    selection: null,
    holdStatus: null,
    metadata: {
      totalSourceSlots: 0,
      filteredCount: 0,
      lastRecomputedAt: null
    },
    now: initial.now ?? nowIso()
  };

  const listeners = new Set();

  function notify() {
    const snap = snapshot(state);
    for (const listener of listeners) {
      listener(snap);
    }
    return snap;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function');
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function applyFilters() {
    const filtered = [];
    const dayFilter = state.filters.day ?? 'ANY';
    const todFilter = state.filters.timeOfDay ?? 'ANY';
    for (const slot of state.sourceSlots) {
      const duration = slot.durationMinutes ?? calculateDurationMinutes(slot);
      if (duration < state.durationMin) {
        continue;
      }
      const startDate = new Date(slot.startUtc);
      if (dayFilter === 'WEEKDAY' && classifyDayType(startDate) !== 'WEEKDAY') {
        continue;
      }
      if (dayFilter === 'WEEKEND' && classifyDayType(startDate) !== 'WEEKEND') {
        continue;
      }
      const timeOfDay = classifyTimeOfDay(startDate);
      if (todFilter !== 'ANY' && todFilter !== timeOfDay) {
        continue;
      }
      filtered.push({
        ...slot,
        durationMinutes: duration,
        dayType: classifyDayType(startDate),
        timeOfDay
      });
    }
    filtered.sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc));
    state.filteredSlots = filtered;
    state.metadata = {
      totalSourceSlots: state.sourceSlots.length,
      filteredCount: filtered.length,
      lastRecomputedAt: nowIso()
    };
    if (state.selection && !filtered.some((slot) => slot.slotId === state.selection.slotId)) {
      state.selection = null;
    }
  }

  function getState() {
    return snapshot(state);
  }

  function loadSlots(input = {}) {
    const slots = Array.isArray(input.slots) ? input.slots : [];
    state.sourceSlots = slots.map((slot) => ({
      ...slot,
      slotId: slot.slotId ?? slot.startUtc,
      durationMinutes: slot.durationMinutes ?? calculateDurationMinutes(slot)
    }));
    if (Number.isFinite(input.durationMin)) {
      state.durationMin = input.durationMin;
    }
    state.now = input.nowUtc ?? state.now;
    applyFilters();
    return notify();
  }

  function setDuration(durationMin) {
    if (!Number.isFinite(durationMin) || durationMin <= 0) {
      throw new Error('durationMin must be positive number');
    }
    state.durationMin = Math.trunc(durationMin);
    applyFilters();
    return notify();
  }

  function setFilters(filters = {}) {
    state.filters = {
      ...state.filters,
      ...filters
    };
    applyFilters();
    return notify();
  }

  function selectSlot(slotId) {
    if (!slotId) {
      state.selection = null;
      return notify();
    }
    const slot = state.filteredSlots.find((entry) => entry.slotId === slotId);
    if (!slot) {
      throw new Error(`Slot ${slotId} not found in filtered view`);
    }
    state.selection = { ...slot };
    return notify();
  }

  function recordHoldResult(result = {}) {
    state.holdStatus = result
      ? {
          holdId: result.holdId ?? null,
          status: result.status ?? 'pending',
          expiresAt: result.expiresAt ?? null,
          createdAt: nowIso()
        }
      : null;
    return notify();
  }

  return {
    subscribe,
    getState,
    loadSlots,
    setDuration,
    setFilters,
    selectSlot,
    recordHoldResult
  };
}
