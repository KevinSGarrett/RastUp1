'use client';

interface ProfileAboutProps {
  bio?: string | null;
  tags?: string[];
  completenessSegments?: Record<string, number>;
}

export function ProfileAbout({ bio, tags = [], completenessSegments }: ProfileAboutProps) {
  const normalizedSegments = completenessSegments
    ? Object.entries(completenessSegments).map(([key, value]) => ({
        key,
        label: key.replace(/_/g, ' '),
        value: Math.max(0, Math.min(100, Math.round(value ?? 0)))
      }))
    : [];

  return (
    <section className="profile-about">
      <h2 className="profile-about__title">About</h2>
      {bio ? <p className="profile-about__bio">{bio}</p> : <p>No bio provided yet.</p>}

      {tags.length ? (
        <ul className="profile-about__tags" aria-label="Specialties and keywords">
          {tags.map((tag) => (
            <li key={tag} className="profile-about__tag">
              {tag}
            </li>
          ))}
        </ul>
      ) : null}

      {normalizedSegments.length ? (
        <div className="profile-about__segments">
          <h3 className="profile-about__segments-title">Profile checklist</h3>
          <ul className="profile-about__segments-list">
            {normalizedSegments.map((segment) => (
              <li key={segment.key} className="profile-about__segment">
                <span className="profile-about__segment-label">{segment.label}</span>
                <div
                  className="profile-about__segment-track"
                  role="progressbar"
                  aria-valuenow={segment.value}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="profile-about__segment-bar"
                    style={{ width: `${segment.value}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
