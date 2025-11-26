'use client';

import Image from 'next/image';
import { useMemo } from 'react';

export interface SearchResultCardProps {
  result: {
    id: string;
    displayName: string;
    headline?: string | null;
    city?: string | null;
    region?: string | null;
    country?: string | null;
    role?: string | null;
    heroImage?: {
      url?: string;
      alt?: string;
      nsfwBand?: number;
    } | null;
    gallery?: Array<{ url?: string; alt?: string; nsfwBand?: number }>;
    safeModeBand?: number;
    priceFrom?: number | null;
    priceTo?: number | null;
    ratingAvg?: number | null;
    ratingCount?: number | null;
    instantBook?: boolean;
    verified?: {
      id?: boolean;
      background?: boolean;
      social?: boolean;
    };
    badges?: string[];
    tags?: string[];
    completeness?: number | null;
    promotion?: {
      slot?: string | null;
      disclosure?: string | null;
    } | null;
    amenities?: string[];
    packages?: Array<{ name?: string; priceCents?: number; price?: number }>;
    availabilityBuckets?: string[];
    url?: string | null;
  };
  safeModeEnabled: boolean;
  onSelect?: (resultId: string) => void;
  tabIndex?: number;
}

function formatPriceRange(from?: number | null, to?: number | null) {
  if (from == null && to == null) return null;
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });
  if (from != null && to != null) {
    return `${formatter.format(from / 100)} – ${formatter.format(to / 100)}`;
  }
  if (from != null) {
    return `${formatter.format(from / 100)}+`;
  }
  return formatter.format((to ?? 0) / 100);
}

function computeLocation(result: SearchResultCardProps['result']) {
  const parts = [result.city, result.region, result.country].filter(Boolean);
  return parts.join(', ');
}

function computeCompleteness(result: SearchResultCardProps['result']) {
  if (typeof result.completeness === 'number') {
    return Math.max(0, Math.min(100, Math.round(result.completeness)));
  }
  return null;
}

export function SearchResultCard({
  result,
  safeModeEnabled,
  onSelect,
  tabIndex = 0
}: SearchResultCardProps) {
  const safeModeBand = result.safeModeBand ?? 0;
  const shouldHide = safeModeEnabled && safeModeBand > 1;
  const shouldBlur = safeModeEnabled && safeModeBand === 1;
  const location = computeLocation(result);
  const completeness = computeCompleteness(result);
  const priceRange = formatPriceRange(result.priceFrom ?? null, result.priceTo ?? null);
  const ratingLabel =
    result.ratingAvg != null
      ? `${result.ratingAvg.toFixed(1)} (${result.ratingCount ?? 0} reviews)`
      : null;
  const verifiedBadges = useMemo(() => {
    const badges = [];
    if (result.verified?.id) badges.push('ID verified');
    if (result.verified?.background) badges.push('Background checked');
    if (result.verified?.social) badges.push('Social verified');
    return badges;
  }, [result.verified?.background, result.verified?.id, result.verified?.social]);

  const hero = result.heroImage ?? result.gallery?.[0] ?? null;
  const heroAlt = hero?.alt ?? `${result.displayName} cover image`;
  const heroUrl = shouldHide ? undefined : hero?.url;
  const handleClick = () => {
    onSelect?.(result.id);
  };

  return (
    <article
      className="search-result-card"
      aria-label={`${result.displayName} search result`}
      tabIndex={tabIndex}
      onClick={onSelect ? handleClick : undefined}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect?.(result.id);
        }
      }}
      role={onSelect ? 'button' : undefined}
    >
      <div className="search-result-card__media">
        {heroUrl ? (
          <Image
            src={heroUrl}
            alt={heroAlt}
            width={360}
            height={240}
            className={`search-result-card__image${shouldBlur ? ' search-result-card__image--blur' : ''}`}
            priority={false}
            unoptimized
          />
        ) : (
          <div className="search-result-card__image-placeholder" aria-hidden="true">
            Safe-Mode placeholder
          </div>
        )}
        {result.promotion?.slot ? (
          <span className="search-result-card__promotion" aria-label="Promoted listing">
            {result.promotion.disclosure ?? 'Promoted'}
          </span>
        ) : null}
        {result.instantBook ? (
          <span className="search-result-card__instant-book" aria-label="Instant book available">
            Instant Book
          </span>
        ) : null}
      </div>

      <div className="search-result-card__body">
        <header className="search-result-card__header">
          <h3 className="search-result-card__title">{result.displayName}</h3>
          {result.role ? <span className="search-result-card__role">{result.role}</span> : null}
          {location ? <p className="search-result-card__location">{location}</p> : null}
        </header>
        {result.headline ? (
          <p className="search-result-card__headline">{result.headline}</p>
        ) : null}

        <dl className="search-result-card__meta">
          {ratingLabel ? (
            <>
              <dt className="search-result-card__meta-label">Rating</dt>
              <dd className="search-result-card__meta-value">{ratingLabel}</dd>
            </>
          ) : null}
          {priceRange ? (
            <>
              <dt className="search-result-card__meta-label">Packages from</dt>
              <dd className="search-result-card__meta-value">{priceRange}</dd>
            </>
          ) : null}
        </dl>

        {completeness != null ? (
          <div className="search-result-card__completeness" aria-label="Profile completeness">
            <span className="search-result-card__completeness-label">
              Completeness {completeness}%
            </span>
            <div className="search-result-card__completeness-track" role="progressbar" aria-valuenow={completeness} aria-valuemin={0} aria-valuemax={100}>
              <div
                className="search-result-card__completeness-bar"
                style={{ width: `${completeness}%` }}
              />
            </div>
          </div>
        ) : null}

        <ul className="search-result-card__badge-list">
          {verifiedBadges.map((badge) => (
            <li key={badge} className="search-result-card__badge">
              {badge}
            </li>
          ))}
          {(result.badges ?? []).map((badge) => (
            <li key={badge} className="search-result-card__badge search-result-card__badge--status">
              {badge}
            </li>
          ))}
        </ul>

        <ul className="search-result-card__tags">
          {(result.tags ?? result.amenities ?? []).slice(0, 6).map((tag) => (
            <li key={tag} className="search-result-card__tag">
              {tag}
            </li>
          ))}
        </ul>

        {result.availabilityBuckets && result.availabilityBuckets.length ? (
          <p className="search-result-card__availability" aria-live="polite">
            Next availability:{' '}
            <time dateTime={result.availabilityBuckets[0]}>
              {new Date(result.availabilityBuckets[0]).toLocaleDateString()}
            </time>
          </p>
        ) : null}
      </div>
    </article>
  );
}
