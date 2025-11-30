const STATUS_IDLE = 'idle';
const STATUS_LOADING = 'loading';
const STATUS_READY = 'ready';
const STATUS_ERROR = 'error';

function cloneMedia(media = []) {
  if (!Array.isArray(media)) return [];
  return media.map((item) => ({ ...item }));
}

function clonePackages(packages = []) {
  if (!Array.isArray(packages)) return [];
  return packages.map((pkg) => ({
    ...pkg,
    addons: Array.isArray(pkg.addons) ? pkg.addons.map((addon) => ({ ...addon })) : []
  }));
}

function snapshotState(state) {
  return {
    status: state.status,
    error: state.error,
    profile: state.profile ? { ...state.profile } : null,
    roles: [...state.roles],
    activeRole: state.activeRole,
    safeModeEnabled: state.safeModeEnabled,
    heroMedia: state.heroMedia ? { ...state.heroMedia } : null,
    gallery: cloneMedia(state.gallery),
    packages: clonePackages(state.packages),
    testimonials: Array.isArray(state.testimonials) ? state.testimonials.map((item) => ({ ...item })) : [],
    addOns: Array.isArray(state.addOns) ? state.addOns.map((item) => ({ ...item })) : [],
    availability: Array.isArray(state.availability) ? [...state.availability] : [],
    completeness: state.completeness,
    completenessSegments: state.completenessSegments ? { ...state.completenessSegments } : null,
    seo: state.seo ? { ...state.seo } : null,
    telemetry: {
      lastInteractionAt: state.telemetry.lastInteractionAt,
      events: [...state.telemetry.events]
    }
  };
}

function timestamp() {
  return Date.now();
}

function normalizeProfilePayload(payload = {}) {
  if (!payload || typeof payload !== 'object') {
    return {
      profile: null,
      roles: [],
      activeRole: null,
      heroMedia: null,
      gallery: [],
      packages: [],
      testimonials: [],
      addOns: [],
      availability: [],
      completeness: null,
      completenessSegments: null,
      seo: null
    };
  }

  const profile = payload.profile ?? payload.identity ?? null;
  const roles = Array.isArray(payload.roles) ? payload.roles : Array.isArray(profile?.roles) ? profile.roles : [];
  const heroMedia = payload.hero ?? payload.heroMedia ?? profile?.heroImage ?? null;
  return {
    profile: profile
      ? {
          id: profile.id ?? profile.serviceProfileId ?? null,
          handle: profile.handle ?? null,
          displayName: profile.displayName ?? profile.name ?? 'Unknown profile',
          bio: profile.bio ?? '',
          headline: profile.headline ?? profile.tagline ?? null,
          location: profile.location ?? {
            city: profile.city ?? null,
            region: profile.region ?? null,
            country: profile.country ?? null
          },
          languages: Array.isArray(profile.languages) ? profile.languages : [],
          tags: Array.isArray(profile.tags) ? profile.tags : [],
          stats: profile.stats ?? {
            bookings: profile.stats?.bookings ?? null,
            ratingAvg: profile.stats?.ratingAvg ?? profile.ratingAvg ?? null,
            ratingCount: profile.stats?.ratingCount ?? profile.ratingCount ?? null
          },
          social: profile.social ?? {}
        }
      : null,
    roles,
    activeRole: payload.activeRole ?? profile?.activeRole ?? roles[0] ?? null,
    heroMedia: heroMedia ? { ...heroMedia } : null,
    gallery: cloneMedia(payload.gallery ?? profile?.gallery ?? []),
    packages: clonePackages(payload.packages ?? profile?.packages ?? []),
    testimonials: Array.isArray(payload.testimonials) ? payload.testimonials.map((item) => ({ ...item })) : [],
    addOns: Array.isArray(payload.addOns) ? payload.addOns.map((item) => ({ ...item })) : [],
    availability: Array.isArray(payload.availability) ? [...payload.availability] : [],
    completeness:
      typeof payload.completeness === 'number'
        ? Math.max(0, Math.min(100, Math.round(payload.completeness)))
        : typeof profile?.completeness === 'number'
        ? Math.max(0, Math.min(100, Math.round(profile.completeness)))
        : null,
    completenessSegments: payload.completenessSegments ?? profile?.completenessSegments ?? null,
    seo: payload.seo ?? profile?.seo ?? null,
    safeModeBand: payload.safeModeBand ?? profile?.safeModeBand ?? 0,
    safeModeOverride: Boolean(payload.safeModeOverride ?? profile?.safeModeOverride)
  };
}

export function createProfileStore(initialPayload = {}) {
  const normalized = normalizeProfilePayload(initialPayload);
  const state = {
    status: STATUS_IDLE,
    error: null,
    profile: normalized.profile,
    roles: normalized.roles,
    activeRole: normalized.activeRole,
    safeModeEnabled: initialPayload.safeModeEnabled ?? true,
    safeModeBand: normalized.safeModeBand ?? 0,
    safeModeOverride: normalized.safeModeOverride ?? false,
    heroMedia: normalized.heroMedia,
    gallery: normalized.gallery,
    packages: normalized.packages,
    testimonials: normalized.testimonials,
    addOns: normalized.addOns,
    availability: normalized.availability,
    completeness: normalized.completeness,
    completenessSegments: normalized.completenessSegments,
    seo: normalized.seo,
    telemetry: {
      lastInteractionAt: null,
      events: []
    }
  };

  if (state.profile) {
    state.status = STATUS_READY;
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
    const normalizedPayload = normalizeProfilePayload(payload);
    state.profile = normalizedPayload.profile;
    state.roles = normalizedPayload.roles;
    state.activeRole =
      normalizedPayload.activeRole ??
      (normalizedPayload.roles.includes(state.activeRole) ? state.activeRole : normalizedPayload.roles[0] ?? null);
    state.heroMedia = normalizedPayload.heroMedia;
    state.gallery = normalizedPayload.gallery;
    state.packages = normalizedPayload.packages;
    state.testimonials = normalizedPayload.testimonials;
    state.addOns = normalizedPayload.addOns;
    state.availability = normalizedPayload.availability;
    state.completeness = normalizedPayload.completeness;
    state.completenessSegments = normalizedPayload.completenessSegments;
    state.seo = normalizedPayload.seo;
    state.safeModeBand = normalizedPayload.safeModeBand ?? state.safeModeBand;
    state.safeModeOverride = normalizedPayload.safeModeOverride ?? state.safeModeOverride;
    state.status = STATUS_READY;
    state.error = null;
    markTelemetry('profile:hydrate', { role: state.activeRole });
    return notify();
  }

  function setStatus(status) {
    if (![STATUS_IDLE, STATUS_LOADING, STATUS_READY, STATUS_ERROR].includes(status)) {
      throw new Error(`invalid profile status: ${status}`);
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
        : 'profile_load_failed';
    state.error = safeMessage;
    state.status = STATUS_ERROR;
    return notify();
  }

  function setSafeMode(enabled) {
    const value = enabled !== undefined ? Boolean(enabled) : !state.safeModeEnabled;
    if (value === state.safeModeEnabled) {
      return getState();
    }
    state.safeModeEnabled = value;
    markTelemetry('profile:safe_mode_toggle', { enabled: value });
    return notify();
  }

  function setActiveRole(role) {
    if (!role || role === state.activeRole) {
      return getState();
    }
    if (!state.roles.includes(role)) {
      throw new Error(`invalid role: ${role}`);
    }
    state.activeRole = role;
    markTelemetry('profile:role_change', { role });
    return notify();
  }

  return {
    subscribe,
    getState,
    hydrate,
    setStatus,
    setError,
    setSafeMode,
    setActiveRole
  };
}

export const PROFILE_STATUS = {
  IDLE: STATUS_IDLE,
  LOADING: STATUS_LOADING,
  READY: STATUS_READY,
  ERROR: STATUS_ERROR
};
