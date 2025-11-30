const STATUS_IDLE = 'idle';
const STATUS_LOADING = 'loading';
const STATUS_READY = 'ready';
const STATUS_ERROR = 'error';

function clonePackages(packages = []) {
  if (!Array.isArray(packages)) return [];
  return packages.map((pkg) => ({
    ...pkg,
    addons: Array.isArray(pkg.addons) ? pkg.addons.map((addon) => ({ ...addon })) : []
  }));
}

function cloneAvailability(availability = []) {
  if (!Array.isArray(availability)) return [];
  return availability.map((entry) => ({
    date: entry.date,
    slots: Array.isArray(entry.slots) ? [...entry.slots] : []
  }));
}

function formatPrice(priceCents) {
  if (priceCents == null) return 0;
  return Number(priceCents);
}

function snapshotState(state) {
  return {
    status: state.status,
    error: state.error,
    serviceProfile: state.serviceProfile ? { ...state.serviceProfile } : null,
    packages: clonePackages(state.packages),
    availability: cloneAvailability(state.availability),
    documents: Array.isArray(state.documents) ? state.documents.map((doc) => ({ ...doc })) : [],
    selectedPackageId: state.selectedPackageId,
    selectedAddonIds: new Set(state.selectedAddonIds),
    selectedSlot: state.selectedSlot ? { ...state.selectedSlot } : null,
    step: state.step,
    price: { ...state.price },
    telemetry: {
      lastInteractionAt: state.telemetry.lastInteractionAt,
      events: [...state.telemetry.events]
    }
  };
}

function timestamp() {
  return Date.now();
}

function calculatePrice(state) {
  const selectedPackage = state.packages.find((pkg) => pkg.packageId === state.selectedPackageId);
  const base = selectedPackage ? formatPrice(selectedPackage.priceCents) : 0;
  const addonsTotal = state.packages
    .flatMap((pkg) =>
      pkg.addons?.filter((addon) => state.selectedAddonIds.has(addon.addonId ?? addon.name)) ?? []
    )
    .reduce((sum, addon) => sum + formatPrice(addon.priceCents), 0);
  const subtotal = base + addonsTotal;
  const taxes = Math.round(subtotal * 0.0825);
  const fees = Math.round(subtotal * 0.05);
  const total = subtotal + taxes + fees;
  state.price = { base, addons: addonsTotal, subtotal, taxes, fees, total };
}

function normalizePayload(payload = {}) {
  const serviceProfile = payload.serviceProfile ?? payload.profile ?? null;
  return {
    serviceProfile: serviceProfile
      ? {
          id: serviceProfile.id ?? null,
          handle: serviceProfile.handle ?? null,
          displayName: serviceProfile.displayName ?? serviceProfile.name ?? 'Service Profile',
          role: serviceProfile.role ?? null,
          city: serviceProfile.city ?? serviceProfile.location?.city ?? null,
          heroImage: serviceProfile.heroImage ?? null
        }
      : null,
    packages: clonePackages(payload.packages ?? []),
    availability: cloneAvailability(payload.availability ?? []),
    documents: Array.isArray(payload.documents) ? payload.documents.map((doc) => ({ ...doc })) : [],
    defaultPackageId: payload.defaultPackageId ?? payload.packages?.[0]?.packageId ?? null
  };
}

export function createBookingStore(initialPayload = {}) {
  const normalized = normalizePayload(initialPayload);
  const state = {
    status: normalized.serviceProfile ? STATUS_READY : STATUS_IDLE,
    error: null,
    serviceProfile: normalized.serviceProfile,
    packages: normalized.packages,
    availability: normalized.availability,
    documents: normalized.documents,
    selectedPackageId: normalized.defaultPackageId,
    selectedAddonIds: new Set(),
    selectedSlot: null,
    step: 1,
    price: {
      base: 0,
      addons: 0,
      subtotal: 0,
      taxes: 0,
      fees: 0,
      total: 0
    },
    telemetry: {
      lastInteractionAt: null,
      events: []
    }
  };

  if (state.selectedPackageId) {
    calculatePrice(state);
  }

  const listeners = new Set();

  function notify() {
    const snapshot = snapshotState(state);
    for (const listener of listeners) {
      listener(snapshot);
    }
    return snapshot;
  }

  function getState() {
    return snapshotState(state);
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function');
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function markTelemetry(eventName, metadata) {
    state.telemetry.lastInteractionAt = timestamp();
    if (eventName) {
      state.telemetry.events.push({
        name: eventName,
        at: state.telemetry.lastInteractionAt,
        metadata: metadata ? { ...metadata } : undefined
      });
      if (state.telemetry.events.length > 50) {
        state.telemetry.events.splice(0, state.telemetry.events.length - 50);
      }
    }
  }

  function hydrate(payload) {
    const normalizedPayload = normalizePayload(payload);
    state.serviceProfile = normalizedPayload.serviceProfile;
    state.packages = normalizedPayload.packages;
    state.availability = normalizedPayload.availability;
    state.documents = normalizedPayload.documents;
    state.selectedPackageId =
      normalizedPayload.defaultPackageId ?? (state.packages[0]?.packageId ?? null);
    state.selectedAddonIds.clear();
    state.selectedSlot = null;
    calculatePrice(state);
    state.status = STATUS_READY;
    state.error = null;
    markTelemetry('booking:hydrate', { packageId: state.selectedPackageId });
    return notify();
  }

  function setStatus(status) {
    if (![STATUS_IDLE, STATUS_LOADING, STATUS_READY, STATUS_ERROR].includes(status)) {
      throw new Error(`invalid booking status: ${status}`);
    }
    if (state.status === status) {
      return getState();
    }
    state.status = status;
    return notify();
  }

  function setError(error) {
    if (!error) {
      state.error = null;
      state.status = STATUS_READY;
      return notify();
    }
    const safeMessage =
      typeof error === 'string'
        ? error
        : error && typeof error.message === 'string'
        ? error.message
        : 'booking_error';
    state.error = safeMessage;
    state.status = STATUS_ERROR;
    return notify();
  }

  function setPackage(packageId) {
    if (!packageId || packageId === state.selectedPackageId) {
      return getState();
    }
    if (!state.packages.some((pkg) => pkg.packageId === packageId)) {
      throw new Error(`unknown package: ${packageId}`);
    }
    state.selectedPackageId = packageId;
    state.selectedAddonIds.clear();
    calculatePrice(state);
    markTelemetry('booking:package_selected', { packageId });
    return notify();
  }

  function toggleAddon(addonId) {
    if (!addonId) return getState();
    const next = new Set(state.selectedAddonIds);
    if (next.has(addonId)) {
      next.delete(addonId);
    } else {
      next.add(addonId);
    }
    state.selectedAddonIds = next;
    calculatePrice(state);
    markTelemetry('booking:addon_toggle', { addonId, selected: next.has(addonId) });
    return notify();
  }

  function selectSlot(date, slot) {
    if (!date || !slot) {
      state.selectedSlot = null;
      return notify();
    }
    const availability = state.availability.find((entry) => entry.date === date);
    if (!availability || !availability.slots.includes(slot)) {
      throw new Error('invalid slot selection');
    }
    state.selectedSlot = { date, slot };
    markTelemetry('booking:slot_selected', { date, slot });
    return notify();
  }

  function setStep(step) {
    const nextStep = Math.max(1, Math.min(3, step));
    if (nextStep === state.step) {
      return getState();
    }
    state.step = nextStep;
    markTelemetry('booking:step_change', { step: nextStep });
    return notify();
  }

  return {
    subscribe,
    getState,
    hydrate,
    setStatus,
    setError,
    setPackage,
    toggleAddon,
    selectSlot,
    setStep
  };
}

export const BOOKING_STATUS = {
  IDLE: STATUS_IDLE,
  LOADING: STATUS_LOADING,
  READY: STATUS_READY,
  ERROR: STATUS_ERROR
};
