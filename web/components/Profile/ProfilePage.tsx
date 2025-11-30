'use client';

import type { ChangeEvent } from 'react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition
} from 'react';

import {
  PROFILE_STATUS,
  createProfileStore
} from '../../../tools/frontend/profiles/index.mjs';
import { createProfileDataSource } from '../../lib/profiles';
import { emitTelemetry } from '../../lib/telemetry';
import { ProfileAbout } from './ProfileAbout';
import { ProfileAvailability } from './ProfileAvailability';
import { ProfileGallery } from './ProfileGallery';
import { ProfileHero } from './ProfileHero';
import { ProfilePackages } from './ProfilePackages';
import { ProfileRoleTabs } from './ProfileRoleTabs';
import { ProfileTestimonials } from './ProfileTestimonials';

type ProfileStore = ReturnType<typeof createProfileStore>;
type ProfileState = ReturnType<ProfileStore['getState']>;

// Extend the store state with the extra view-only field we use here.
type ProfileViewState = ProfileState & {
  safeModeBand?: number | null;
};

// Minimal structural type for the initial payload this page cares about.
type NormalizedProfile = {
  profile?: {
    id?: string | null;
    displayName?: string | null;
    bio?: string | null;
    tags?: string[];
  } | null;
  roles?: string[];
  activeRole?: string | null;
  heroMedia?: {
    url?: string;
    alt?: string;
    nsfwBand?: number;
  } | null;
  packages?: unknown[];
  gallery?: unknown[];
  testimonials?: unknown[];
  availability?: unknown;
  completeness?: number | null;
  completenessSegments?: unknown;
  safeModeEnabled?: boolean;
  [key: string]: unknown;
};

export interface ProfilePageProps {
  initialProfile: NormalizedProfile;
  handle: string;
  initialSafeMode?: boolean;
  dataSource?: ReturnType<typeof createProfileDataSource>;
}

function buildKey(handle: string, role: string | null, safeMode: boolean) {
  return JSON.stringify({ handle, role, safeMode });
}

export function ProfilePage({
  initialProfile,
  handle,
  initialSafeMode = true,
  dataSource: injectedDataSource
}: ProfilePageProps) {
  const initialPayloadKey = useMemo(
    () =>
      JSON.stringify({
        id: initialProfile.profile?.id ?? null,
        role: initialProfile.activeRole ?? null,
        safeMode: initialSafeMode
      }),
    [initialProfile.profile?.id, initialProfile.activeRole, initialSafeMode]
  );

  const [store] = useState<ProfileStore>(() =>
    createProfileStore({
      ...initialProfile,
      safeModeEnabled: initialSafeMode
    })
  );

  // React-facing snapshot of store state
  const [state, setState] = useState<ProfileViewState>(
    () => store.getState() as ProfileViewState
  );

  useEffect(() => {
    const listener = () => {
      setState(store.getState() as ProfileViewState);
    };

    // As with Booking, subscribe's return type isn't a cleanup fn,
    // so we just subscribe and return a no-op cleanup.
    store.subscribe(listener);

    return () => {
      // If subscribe() ever exposes an unsubscribe function, call it here.
    };
  }, [store]);

  const [pending, startTransition] = useTransition();
  const dataSource = useMemo(
    () => injectedDataSource ?? createProfileDataSource(),
    [injectedDataSource]
  );
  const lastFetchKeyRef = useRef<string | null>(
    buildKey(handle, state.activeRole ?? null, state.safeModeEnabled ?? true)
  );

  useEffect(() => {
    // hydrate with the server-provided payload
    store.hydrate(initialProfile);
    const snapshot = store.getState() as ProfileViewState;
    lastFetchKeyRef.current = buildKey(
      handle,
      snapshot.activeRole ?? null,
      snapshot.safeModeEnabled ?? true
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPayloadKey]);

  useEffect(() => {
    const currentState = store.getState() as ProfileViewState;
    const key = buildKey(
      handle,
      currentState.activeRole ?? null,
      currentState.safeModeEnabled ?? true
    );
    if (lastFetchKeyRef.current === key) {
      return;
    }
    lastFetchKeyRef.current = key;
    store.setStatus(PROFILE_STATUS.LOADING);

    startTransition(() => {
      dataSource
        .fetchProfile({
          handle,
          role: currentState.activeRole ?? undefined,
          safeMode: currentState.safeModeEnabled ?? true
        })
        .then((payload: NormalizedProfile) => {
          store.hydrate(payload);
        })
        .catch((error: unknown) => {
          const safeMessage =
            error instanceof Error
              ? error.message
              : typeof error === 'string'
              ? error
              : 'profile_load_failed';
          store.setError(safeMessage);
        });
    });
  }, [dataSource, handle, store, state.activeRole, state.safeModeEnabled, startTransition]);

  const handleRoleChange = useCallback(
    (role: string) => {
      emitTelemetry('profile:role_tab_selected', { role });
      store.setActiveRole(role);
    },
    [store]
  );

  const handleSafeModeToggle = useCallback(() => {
    const nextEnabled = !store.getState().safeModeEnabled;
    emitTelemetry('profile:safe_mode_toggle', { enabled: nextEnabled });
    store.setSafeMode(nextEnabled);
  }, [store]);

  const handleBook = useCallback(() => {
    emitTelemetry('profile:cta_click', {
      action: 'book',
      role: store.getState().activeRole
    });
  }, [store]);

  const handleMessage = useCallback(() => {
    emitTelemetry('profile:cta_click', {
      action: 'message',
      role: store.getState().activeRole
    });
  }, [store]);

  const handleReportToggle = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (event.target.checked) {
        handleSafeModeToggle();
      }
    },
    [handleSafeModeToggle]
  );

  return (
    <div className="profile-page">
      <ProfileHero
        profile={state.profile}
        heroMedia={state.heroMedia}
        safeModeEnabled={state.safeModeEnabled ?? true}
        safeModeBand={state.safeModeBand ?? 0}
        onToggleSafeMode={handleSafeModeToggle}
        onBook={handleBook}
        onMessage={handleMessage}
        completeness={state.completeness}
        activeRole={state.activeRole}
      />

      <ProfileRoleTabs
        roles={state.roles}
        activeRole={state.activeRole}
        onSelectRole={handleRoleChange}
      />

      {state.status === PROFILE_STATUS.ERROR ? (
        <div className="profile-page__banner" role="alert">
          We could not load this profile. {state.error}
        </div>
      ) : null}

      {pending || state.status === PROFILE_STATUS.LOADING ? (
        <div className="profile-page__loading" role="status" aria-live="polite">
          Loading role details…
        </div>
      ) : null}

      <div className="profile-page__content">
        <div className="profile-page__column profile-page__column--primary">
          <ProfileAbout
            bio={state.profile?.bio}
            tags={state.profile?.tags ?? []}
            completenessSegments={state.completenessSegments ?? undefined}
          />
          <ProfilePackages packages={state.packages} />
          <ProfileGallery
            gallery={state.gallery}
            safeModeEnabled={state.safeModeEnabled ?? true}
          />
          <ProfileTestimonials testimonials={state.testimonials} />
        </div>

        <aside className="profile-page__column profile-page__column--secondary">
          <ProfileAvailability availability={state.availability} />
          <div className="profile-page__safety">
            <h3 className="profile-page__safety-title">Safety & Reporting</h3>
            <p>
              Spot something concerning? Capture context and share with support. Sensitive media
              remains hidden while Safe-Mode is enabled.
            </p>
            <label className="profile-page__safety-toggle">
              <input
                type="checkbox"
                checked={!state.safeModeEnabled}
                onChange={handleReportToggle}
              />
              Reveal sensitive content (acknowledge policy)
            </label>
          </div>
        </aside>
      </div>
    </div>
  );
}
