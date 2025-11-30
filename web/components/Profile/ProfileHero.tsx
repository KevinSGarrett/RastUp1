'use client';

import Image from 'next/image';

type ProfileLocation = {
  city?: string | null;
  region?: string | null;
  country?: string | null;
};

type ProfileLanguage = string | { code?: string | null; label?: string | null };

type ProfileStats = {
  ratingAvg?: number | null;
  ratingCount?: number | null;
  bookings?: number | null;
  rating?: {
    avg?: number | null;
    count?: number | null;
  } | null;
};

interface ProfileSummary {
  displayName?: string | null;
  headline?: string | null;
  bio?: string | null;
  location?: ProfileLocation | null;
  languages?: ProfileLanguage[];
  stats?: ProfileStats | null;
  social?: Record<string, unknown> | null;
}

interface ProfileHeroProps {
  profile: ProfileSummary | null;
  heroMedia?: { url?: string | null; alt?: string | null; nsfwBand?: number | null } | null;
  safeModeEnabled: boolean;
  safeModeBand: number;
  onToggleSafeMode: () => void;
  onBook: () => void;
  onMessage: () => void;
  completeness?: number | null;
  activeRole?: string | null;
}

function formatLocation(location?: ProfileLocation | null) {
  if (!location) return null;
  const parts = [location.city, location.region, location.country].filter(
    (part): part is string => Boolean(part)
  );
  return parts.length ? parts.join(', ') : null;
}

function formatRating(stats?: ProfileStats | null) {
  if (!stats) return null;

  const avg = stats.ratingAvg ?? stats.rating?.avg;
  if (avg == null) return null;

  const rating = avg.toFixed(1);
  const count = stats.ratingCount ?? stats.rating?.count ?? 0;
  return `${rating} (${count} review${count === 1 ? '' : 's'})`;
}

function formatBookings(stats?: ProfileStats | null) {
  if (!stats?.bookings) return null;
  return `${stats.bookings.toLocaleString()} bookings`;
}

function formatLanguages(languages?: ProfileLanguage[] | null) {
  if (!languages || !languages.length) return [] as string[];
  return languages
    .map((lang) => {
      if (typeof lang === 'string') return lang;
      return lang.label ?? lang.code ?? '';
    })
    .filter((value): value is string => Boolean(value));
}

export function ProfileHero({
  profile,
  heroMedia,
  safeModeEnabled,
  safeModeBand,
  onToggleSafeMode,
  onBook,
  onMessage,
  completeness,
  activeRole
}: ProfileHeroProps) {
  if (!profile) {
    return null;
  }

  const displayName = profile.displayName ?? 'Profile';
  const location = formatLocation(profile.location ?? undefined);
  const rating = formatRating(profile.stats);
  const bookings = formatBookings(profile.stats);
  const languages = formatLanguages(profile.languages);

  const nsfwBand = heroMedia?.nsfwBand ?? 0;
  const heroUrl = heroMedia?.url ?? null;
  const heroAlt = heroMedia?.alt ?? `${displayName} hero image`;
  const shouldBlur = safeModeEnabled && nsfwBand === 1;
  const shouldHide = safeModeEnabled && nsfwBand > 1;

  const completenessValue =
    typeof completeness === 'number'
      ? Math.max(0, Math.min(100, completeness))
      : null;

  return (
    <header className="profile-hero">
      <div className="profile-hero__media">
        {heroUrl && !shouldHide ? (
          <Image
            src={heroUrl}
            alt={heroAlt}
            width={1200}
            height={640}
            className={`profile-hero__image${shouldBlur ? ' profile-hero__image--blur' : ''}`}
            priority
            unoptimized
          />
        ) : (
          <div className="profile-hero__image-placeholder" aria-hidden="true">
            {safeModeEnabled
              ? 'Safe-Mode hides sensitive previews. Disable Safe-Mode to reveal.'
              : 'Preview unavailable.'}
          </div>
        )}
        <div className="profile-hero__overlay">
          <h1 className="profile-hero__title">{displayName}</h1>
          {activeRole ? <span className="profile-hero__role">{activeRole}</span> : null}
          {profile.headline ? (
            <p className="profile-hero__headline">{profile.headline}</p>
          ) : null}
          <div className="profile-hero__meta">
            {location ? <span className="profile-hero__meta-item">{location}</span> : null}
            {rating ? <span className="profile-hero__meta-item">{rating}</span> : null}
            {bookings ? <span className="profile-hero__meta-item">{bookings}</span> : null}
          </div>
          {languages.length ? (
            <p className="profile-hero__languages">Speaks: {languages.join(', ')}</p>
          ) : null}
        </div>
      </div>

      <div className="profile-hero__actions">
        <div className="profile-hero__cta-group">
          <button
            type="button"
            className="profile-hero__cta profile-hero__cta--primary"
            onClick={onBook}
          >
            Book {displayName}
          </button>
          <button type="button" className="profile-hero__cta" onClick={onMessage}>
            Message
          </button>
        </div>
        <div className="profile-hero__toggles">
          <label className="profile-hero__safe-mode">
            <input
              type="checkbox"
              checked={safeModeEnabled}
              onChange={onToggleSafeMode}
              aria-describedby="profile-safe-mode-help"
            />
            Safe-Mode
          </label>
          <span id="profile-safe-mode-help" className="profile-hero__safe-mode-help">
            {safeModeEnabled
              ? 'Sensitive media hidden. Disable cautiously.'
              : safeModeBand > 1
              ? 'Safe-Mode off: explicit media visible.'
              : 'Safe-Mode off.'}
          </span>
        </div>
      </div>

      {completenessValue != null ? (
        <div
          className="profile-hero__completeness"
          role="group"
          aria-labelledby="profile-completeness-label"
        >
          <span id="profile-completeness-label" className="profile-hero__completeness-label">
            Profile completeness {completenessValue}%
          </span>
          <div
            className="profile-hero__completeness-track"
            role="progressbar"
            aria-valuenow={completenessValue}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="profile-hero__completeness-bar"
              style={{ width: `${completenessValue}%` }}
            />
          </div>
        </div>
      ) : null}
    </header>
  );
}
