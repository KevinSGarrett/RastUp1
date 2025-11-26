'use client';

import Image from 'next/image';

interface ProfileGalleryProps {
  gallery: Array<{ url?: string; alt?: string; nsfwBand?: number }>;
  safeModeEnabled: boolean;
}

export function ProfileGallery({ gallery, safeModeEnabled }: ProfileGalleryProps) {
  if (!gallery.length) {
    return null;
  }

  return (
    <section className="profile-gallery" aria-label="Portfolio gallery">
      <h2 className="profile-gallery__title">Portfolio</h2>
      <div className="profile-gallery__grid">
        {gallery.map((media, index) => {
          if (!media?.url) {
            return (
              <div key={`placeholder-${index}`} className="profile-gallery__placeholder">
                Media unavailable
              </div>
            );
          }
          const safeBand = media.nsfwBand ?? 0;
          const shouldBlur = safeModeEnabled && safeBand === 1;
          const shouldHide = safeModeEnabled && safeBand > 1;
          if (shouldHide) {
            return (
              <div key={media.url} className="profile-gallery__placeholder profile-gallery__placeholder--hidden">
                Safe-Mode hidden
              </div>
            );
          }
          return (
            <figure key={media.url} className="profile-gallery__item">
              <Image
                src={media.url}
                alt={media.alt ?? 'Portfolio image'}
                width={400}
                height={400}
                className={`profile-gallery__image${shouldBlur ? ' profile-gallery__image--blur' : ''}`}
                unoptimized
              />
            </figure>
          );
        })}
      </div>
    </section>
  );
}
